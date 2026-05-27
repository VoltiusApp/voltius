use bollard::container::{ListContainersOptions, LogsOptions, RemoveContainerOptions};
use bollard::image::{ListImagesOptions, RemoveImageOptions};
use bollard::models::PortTypeEnum;
use bollard::volume::RemoveVolumeOptions;
use bollard::Docker;
use futures_util::StreamExt;
use serde::Deserialize;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use super::types::*;

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn connect() -> Result<Docker, String> {
    Docker::connect_with_local_defaults().map_err(|e| format!("Docker not available: {e}"))
}

fn should_use_wsl_cli(local_shell: Option<&str>) -> bool {
    local_shell
        .and_then(|shell| shell.rsplit(['\\', '/']).next())
        .map(|name| name.eq_ignore_ascii_case("wsl") || name.eq_ignore_ascii_case("wsl.exe"))
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
const WINDOWS_CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(target_os = "windows")]
fn windows_hidden_child_process_flags() -> u32 {
    WINDOWS_CREATE_NO_WINDOW
}

#[cfg(target_os = "windows")]
fn prevent_visible_child_window(command: &mut Command) {
    command.creation_flags(windows_hidden_child_process_flags());
}

#[cfg(not(target_os = "windows"))]
fn prevent_visible_child_window(_command: &mut Command) {}

async fn run_wsl_docker(local_shell: Option<&str>, args: &[&str]) -> Result<String, String> {
    let shell = local_shell.unwrap_or("wsl.exe");
    let mut command = Command::new(shell);
    command.arg("docker").args(args);
    prevent_visible_child_window(&mut command);

    let output = command
        .output()
        .await
        .map_err(|e| format!("Docker not available in WSL: {e}"))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Err(if stderr.is_empty() { stdout } else { stderr })
    }
}

async fn run_local_docker(args: &[&str]) -> Result<String, String> {
    let mut command = Command::new("docker");
    command.args(args);
    prevent_visible_child_window(&mut command);

    let output = command
        .output()
        .await
        .map_err(|e| format!("Docker not available: {e}"))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Err(if stderr.is_empty() { stdout } else { stderr })
    }
}

async fn run_compose(local_shell: Option<&str>, args: &[&str]) -> Result<String, String> {
    let mut docker_args = vec!["compose"];
    docker_args.extend_from_slice(args);

    if should_use_wsl_cli(local_shell) {
        run_wsl_docker(local_shell, &docker_args).await
    } else {
        run_local_docker(&docker_args).await
    }
}

#[derive(Deserialize)]
struct CliContainer {
    #[serde(rename = "ID", default)]
    id: String,
    #[serde(rename = "Names", default)]
    names: String,
    #[serde(rename = "Image", default)]
    image: String,
    #[serde(rename = "Status", default)]
    status: String,
    #[serde(rename = "State", default)]
    state: String,
    #[serde(rename = "Ports", default)]
    ports: String,
}

async fn list_containers_cli(
    local_shell: Option<&str>,
    all: bool,
) -> Result<Vec<DockerContainer>, String> {
    let mut args = vec!["ps"];
    if all {
        args.push("-a");
    }
    args.extend(["--format", "{{json .}}"]);
    let output = run_wsl_docker(local_shell, &args).await?;

    output
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| {
            serde_json::from_str::<CliContainer>(line)
                .map(|raw| DockerContainer {
                    id: raw.id,
                    names: raw.names.split(',').map(|s| s.trim().to_string()).collect(),
                    image: raw.image,
                    status: raw.status,
                    state: raw.state,
                    ports: parse_cli_ports(&raw.ports),
                    created: 0,
                })
                .map_err(|e| format!("Failed to parse docker ps output: {e}"))
        })
        .collect()
}

fn parse_cli_ports(ports_str: &str) -> Vec<PortMapping> {
    ports_str
        .split(", ")
        .filter_map(|part| {
            let part = part.trim();
            if part.is_empty() {
                return None;
            }

            if let Some((host_part, container_part)) = part.split_once("->") {
                let (container_port, protocol) = split_port_proto(container_part)?;
                let (_, host_port_str) = host_part.rsplit_once(':').unwrap_or(("", host_part));
                return Some(PortMapping {
                    host_ip: None,
                    host_port: host_port_str.parse().ok(),
                    container_port,
                    protocol,
                });
            }

            let (container_port, protocol) = split_port_proto(part)?;
            Some(PortMapping {
                host_ip: None,
                host_port: None,
                container_port,
                protocol,
            })
        })
        .collect()
}

fn split_port_proto(value: &str) -> Option<(u16, String)> {
    let (port, proto) = value.split_once('/').unwrap_or((value, "tcp"));
    Some((port.parse().ok()?, proto.to_string()))
}

pub async fn list_containers(
    local_shell: Option<&str>,
    all: bool,
) -> Result<Vec<DockerContainer>, String> {
    if should_use_wsl_cli(local_shell) {
        return list_containers_cli(local_shell, all).await;
    }

    let docker = connect()?;
    let containers = docker
        .list_containers(Some(ListContainersOptions::<String> {
            all,
            ..Default::default()
        }))
        .await
        .map_err(|e| format!("{e}"))?;

    Ok(containers
        .into_iter()
        .map(|c| {
            let ports = c
                .ports
                .unwrap_or_default()
                .into_iter()
                .map(|p| PortMapping {
                    host_ip: p.ip,
                    host_port: p.public_port.map(|x| x as u16),
                    container_port: p.private_port as u16,
                    protocol: p
                        .typ
                        .map(|t| match t {
                            PortTypeEnum::TCP => "tcp",
                            PortTypeEnum::UDP => "udp",
                            PortTypeEnum::SCTP => "sctp",
                            _ => "tcp",
                        })
                        .unwrap_or("tcp")
                        .to_string(),
                })
                .collect();

            DockerContainer {
                id: c.id.unwrap_or_default(),
                names: c.names.unwrap_or_default(),
                image: c.image.unwrap_or_default(),
                status: c.status.unwrap_or_default(),
                state: c.state.unwrap_or_default(),
                ports,
                created: c.created.unwrap_or(0),
            }
        })
        .collect())
}

#[derive(Deserialize)]
struct CliImage {
    #[serde(rename = "ID", default)]
    id: String,
    #[serde(rename = "Repository", default)]
    repository: String,
    #[serde(rename = "Tag", default)]
    tag: String,
    #[serde(rename = "Size", default)]
    size: String,
}

pub async fn list_images(local_shell: Option<&str>) -> Result<Vec<DockerImage>, String> {
    if should_use_wsl_cli(local_shell) {
        let output = run_wsl_docker(local_shell, &["images", "--format", "{{json .}}"]).await?;
        return output
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(|line| {
                serde_json::from_str::<CliImage>(line)
                    .map(|raw| {
                        let repo_tag = if raw.tag.is_empty() || raw.tag == "<none>" {
                            raw.repository.clone()
                        } else {
                            format!("{}:{}", raw.repository, raw.tag)
                        };
                        DockerImage {
                            id: raw.id,
                            repo_tags: vec![repo_tag],
                            size: parse_cli_size(&raw.size),
                            created: 0,
                        }
                    })
                    .map_err(|e| format!("Failed to parse docker images output: {e}"))
            })
            .collect();
    }

    let docker = connect()?;
    let images = docker
        .list_images(Some(ListImagesOptions::<String> {
            all: false,
            ..Default::default()
        }))
        .await
        .map_err(|e| format!("{e}"))?;

    Ok(images
        .into_iter()
        .map(|i| DockerImage {
            id: i.id,
            repo_tags: i.repo_tags,
            size: i.size,
            created: i.created,
        })
        .collect())
}

fn parse_cli_size(s: &str) -> i64 {
    let s = s.trim();
    if let Some(val) = s.strip_suffix("GB") {
        return (val.trim().parse::<f64>().unwrap_or(0.0) * 1024.0 * 1024.0 * 1024.0) as i64;
    }
    if let Some(val) = s.strip_suffix("MB") {
        return (val.trim().parse::<f64>().unwrap_or(0.0) * 1024.0 * 1024.0) as i64;
    }
    if let Some(val) = s.strip_suffix("kB") {
        return (val.trim().parse::<f64>().unwrap_or(0.0) * 1024.0) as i64;
    }
    if let Some(val) = s.strip_suffix('B') {
        return val.trim().parse::<f64>().unwrap_or(0.0) as i64;
    }
    0
}

#[derive(Deserialize)]
struct CliVolume {
    #[serde(rename = "Name", default)]
    name: String,
    #[serde(rename = "Driver", default)]
    driver: String,
}

pub async fn list_volumes(local_shell: Option<&str>) -> Result<Vec<DockerVolume>, String> {
    if should_use_wsl_cli(local_shell) {
        let output =
            run_wsl_docker(local_shell, &["volume", "ls", "--format", "{{json .}}"]).await?;
        return output
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(|line| {
                serde_json::from_str::<CliVolume>(line)
                    .map(|raw| DockerVolume {
                        name: raw.name,
                        driver: raw.driver,
                    })
                    .map_err(|e| format!("Failed to parse docker volume output: {e}"))
            })
            .collect();
    }

    let docker = connect()?;
    let resp = docker
        .list_volumes::<String>(None)
        .await
        .map_err(|e| format!("{e}"))?;
    Ok(resp
        .volumes
        .unwrap_or_default()
        .into_iter()
        .map(|v| DockerVolume {
            name: v.name,
            driver: v.driver,
        })
        .collect())
}

#[derive(Deserialize)]
struct CliNetwork {
    #[serde(rename = "ID", default)]
    id: String,
    #[serde(rename = "Name", default)]
    name: String,
    #[serde(rename = "Driver", default)]
    driver: String,
}

pub async fn list_networks(local_shell: Option<&str>) -> Result<Vec<DockerNetwork>, String> {
    if should_use_wsl_cli(local_shell) {
        let output =
            run_wsl_docker(local_shell, &["network", "ls", "--format", "{{json .}}"]).await?;
        return output
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(|line| {
                serde_json::from_str::<CliNetwork>(line)
                    .map(|raw| DockerNetwork {
                        id: raw.id,
                        name: raw.name,
                        driver: raw.driver,
                    })
                    .map_err(|e| format!("Failed to parse docker network output: {e}"))
            })
            .collect();
    }

    let docker = connect()?;
    let networks = docker
        .list_networks::<String>(None)
        .await
        .map_err(|e| format!("{e}"))?;
    Ok(networks
        .into_iter()
        .map(|n| DockerNetwork {
            id: n.id.unwrap_or_default(),
            name: n.name.unwrap_or_default(),
            driver: n.driver.unwrap_or_default(),
        })
        .collect())
}

pub async fn list_stacks(local_shell: Option<&str>) -> Result<Vec<DockerStack>, String> {
    let output = run_compose(local_shell, &["ls", "--all", "--format", "json"]).await?;
    parse_compose_stacks(&output)
}

pub async fn list_stack_services(
    local_shell: Option<&str>,
    stack_name: &str,
) -> Result<Vec<DockerStackService>, String> {
    let output = run_compose(
        local_shell,
        &["-p", stack_name, "ps", "--all", "--format", "json"],
    )
    .await?;
    parse_compose_services(&output)
}

pub async fn container_action(
    local_shell: Option<&str>,
    container_id: &str,
    action: &ContainerAction,
) -> Result<(), String> {
    if should_use_wsl_cli(local_shell) {
        let action = match action {
            ContainerAction::Start => "start",
            ContainerAction::Stop => "stop",
            ContainerAction::Restart => "restart",
            ContainerAction::Remove => "rm",
            ContainerAction::Pause => "pause",
            ContainerAction::Unpause => "unpause",
        };
        let args = if action == "rm" {
            vec![action, "-f", container_id]
        } else {
            vec![action, container_id]
        };
        run_wsl_docker(local_shell, &args).await?;
        return Ok(());
    }

    let docker = connect()?;
    match action {
        ContainerAction::Start => docker
            .start_container::<String>(container_id, None)
            .await
            .map_err(|e| format!("{e}"))?,
        ContainerAction::Stop => docker
            .stop_container(container_id, None)
            .await
            .map_err(|e| format!("{e}"))?,
        ContainerAction::Restart => docker
            .restart_container(container_id, None)
            .await
            .map_err(|e| format!("{e}"))?,
        ContainerAction::Remove => docker
            .remove_container(
                container_id,
                Some(RemoveContainerOptions {
                    force: true,
                    ..Default::default()
                }),
            )
            .await
            .map_err(|e| format!("{e}"))?,
        ContainerAction::Pause => docker
            .pause_container(container_id)
            .await
            .map_err(|e| format!("{e}"))?,
        ContainerAction::Unpause => docker
            .unpause_container(container_id)
            .await
            .map_err(|e| format!("{e}"))?,
    }
    Ok(())
}

pub async fn stack_action(
    local_shell: Option<&str>,
    stack_name: &str,
    action: &StackAction,
) -> Result<(), String> {
    let config_files = list_stacks(local_shell)
        .await
        .ok()
        .and_then(|stacks| stacks.into_iter().find(|stack| stack.name == stack_name))
        .map(|stack| stack.config_files)
        .unwrap_or_default();

    let mut args = Vec::new();
    for file in &config_files {
        args.push("-f".to_string());
        args.push(file.clone());
    }
    args.push("-p".to_string());
    args.push(stack_name.to_string());

    match action {
        StackAction::Up => args.extend(["up".to_string(), "-d".to_string()]),
        StackAction::Stop => args.push("stop".to_string()),
        StackAction::Restart => args.push("restart".to_string()),
        StackAction::Down => args.push("down".to_string()),
    };

    let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();
    run_compose(local_shell, &arg_refs).await?;
    Ok(())
}

pub async fn remove_image(local_shell: Option<&str>, image_id: &str) -> Result<(), String> {
    if should_use_wsl_cli(local_shell) {
        run_wsl_docker(local_shell, &["rmi", "-f", image_id]).await?;
        return Ok(());
    }

    let docker = connect()?;
    docker
        .remove_image(
            image_id,
            Some(RemoveImageOptions {
                force: true,
                noprune: false,
            }),
            None,
        )
        .await
        .map_err(|e| format!("{e}"))?;
    Ok(())
}

pub async fn remove_volume(local_shell: Option<&str>, name: &str) -> Result<(), String> {
    if should_use_wsl_cli(local_shell) {
        run_wsl_docker(local_shell, &["volume", "rm", "-f", name]).await?;
        return Ok(());
    }

    let docker = connect()?;
    docker
        .remove_volume(name, Some(RemoveVolumeOptions { force: true }))
        .await
        .map_err(|e| format!("{e}"))?;
    Ok(())
}

pub async fn remove_network(local_shell: Option<&str>, id: &str) -> Result<(), String> {
    if should_use_wsl_cli(local_shell) {
        run_wsl_docker(local_shell, &["network", "rm", id]).await?;
        return Ok(());
    }

    let docker = connect()?;
    docker
        .remove_network(id)
        .await
        .map_err(|e| format!("{e}"))?;
    Ok(())
}

pub async fn prune_images(local_shell: Option<&str>) -> Result<String, String> {
    if should_use_wsl_cli(local_shell) {
        return run_wsl_docker(local_shell, &["image", "prune", "-f"]).await;
    }

    let docker = connect()?;
    let result = docker
        .prune_images::<String>(None)
        .await
        .map_err(|e| format!("{e}"))?;
    let reclaimed = result.space_reclaimed.unwrap_or(0);
    Ok(fmt_freed(reclaimed))
}

pub async fn prune_volumes(local_shell: Option<&str>) -> Result<String, String> {
    if should_use_wsl_cli(local_shell) {
        return run_wsl_docker(local_shell, &["volume", "prune", "-f"]).await;
    }

    let docker = connect()?;
    let result = docker
        .prune_volumes::<String>(None)
        .await
        .map_err(|e| format!("{e}"))?;
    let reclaimed = result.space_reclaimed.unwrap_or(0);
    Ok(fmt_freed(reclaimed))
}

pub async fn prune_networks(local_shell: Option<&str>) -> Result<String, String> {
    if should_use_wsl_cli(local_shell) {
        return run_wsl_docker(local_shell, &["network", "prune", "-f"]).await;
    }

    let docker = connect()?;
    docker
        .prune_networks::<String>(None)
        .await
        .map_err(|e| format!("{e}"))?;
    Ok("Networks pruned".to_string())
}

pub async fn system_prune(local_shell: Option<&str>) -> Result<String, String> {
    if should_use_wsl_cli(local_shell) {
        return run_wsl_docker(local_shell, &["system", "prune", "-f"]).await;
    }

    let docker = connect()?;
    let mut total: i64 = 0;

    if let Ok(r) = docker.prune_containers::<String>(None).await {
        total += r.space_reclaimed.unwrap_or(0);
    }
    if let Ok(r) = docker.prune_images::<String>(None).await {
        total += r.space_reclaimed.unwrap_or(0);
    }
    if let Ok(r) = docker.prune_volumes::<String>(None).await {
        total += r.space_reclaimed.unwrap_or(0);
    }
    let _ = docker.prune_networks::<String>(None).await;

    Ok(fmt_freed(total))
}

fn fmt_freed(bytes: i64) -> String {
    let b = bytes.max(0) as u64;
    if b < 1024 * 1024 {
        format!("Freed {} KB", b / 1024)
    } else if b < 1024 * 1024 * 1024 {
        format!("Freed {:.1} MB", b as f64 / 1024.0 / 1024.0)
    } else {
        format!("Freed {:.2} GB", b as f64 / 1024.0 / 1024.0 / 1024.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_wsl_shell_path() {
        assert!(should_use_wsl_cli(Some(r"C:\Windows\System32\wsl.exe")));
        assert!(should_use_wsl_cli(Some(r"C:\Windows\Sysnative\wsl.exe")));
        assert!(!should_use_wsl_cli(Some(r"C:\Windows\System32\cmd.exe")));
        assert!(!should_use_wsl_cli(None));
    }

    #[test]
    fn parses_compose_stack_list_json_array() {
        let output = r#"[
          {"Name":"demo","Status":"running(2)","ConfigFiles":"/tmp/docker-compose.yml"},
          {"Name":"stopped","Status":"exited(1), running(1)","ConfigFiles":"/tmp/compose.yml,/tmp/override.yml"}
        ]"#;

        let stacks = parse_compose_stacks(output).expect("stacks parse");

        assert_eq!(stacks.len(), 2);
        assert_eq!(stacks[0].name, "demo");
        assert_eq!(stacks[0].running, 2);
        assert_eq!(stacks[0].total, 2);
        assert_eq!(stacks[0].config_files, vec!["/tmp/docker-compose.yml"]);
        assert_eq!(stacks[1].running, 1);
        assert_eq!(stacks[1].exited, 1);
        assert_eq!(stacks[1].total, 2);
        assert_eq!(stacks[1].config_files, vec!["/tmp/compose.yml", "/tmp/override.yml"]);
    }

    #[test]
    fn parses_compose_service_ps_json_lines() {
        let output = r#"{"ID":"abc123","Name":"demo-web-1","Project":"demo","Service":"web","Image":"nginx:latest","State":"running","Status":"Up 2 minutes","Publishers":[{"URL":"0.0.0.0","TargetPort":80,"PublishedPort":8080,"Protocol":"tcp"}]}
{"ID":"def456","Name":"demo-db-1","Project":"demo","Service":"db","Image":"postgres:16","State":"exited","Status":"Exited (0)"}"#;

        let services = parse_compose_services(output).expect("services parse");

        assert_eq!(services.len(), 2);
        assert_eq!(services[0].service, "web");
        assert_eq!(services[0].ports.len(), 1);
        assert_eq!(services[0].ports[0].host_port, Some(8080));
        assert_eq!(services[0].ports[0].container_port, 80);
        assert_eq!(services[1].state, "exited");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_wsl_child_processes_are_configured_without_visible_windows() {
        assert_eq!(windows_hidden_child_process_flags(), 0x08000000);
    }
}

pub async fn stream_stack_logs(
    app: AppHandle,
    stream_id: String,
    stack_name: String,
    tail: u32,
    local_shell: Option<String>,
) {
    let event = format!("docker:log:{stream_id}");
    let tail_str = tail.to_string();

    let mut command = if should_use_wsl_cli(local_shell.as_deref()) {
        let shell = local_shell.unwrap_or_else(|| "wsl.exe".to_string());
        let mut cmd = Command::new(shell);
        cmd.arg("docker")
            .args(["compose", "-p", &stack_name, "logs", "--follow", "--tail", &tail_str]);
        cmd
    } else {
        let mut cmd = Command::new("docker");
        cmd.args(["compose", "-p", &stack_name, "logs", "--follow", "--tail", &tail_str]);
        cmd
    };

    command
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    prevent_visible_child_window(&mut command);

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(e) => {
            let _ = app.emit(
                &event,
                &DockerLogLine {
                    line: format!("Error: {e}"),
                    stream: "stderr".to_string(),
                    ts: now_ms(),
                },
            );
            return;
        }
    };

    if let Some(stdout) = child.stdout.take() {
        let app = app.clone();
        let event = event.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app.emit(
                    &event,
                    &DockerLogLine {
                        line,
                        stream: "stdout".to_string(),
                        ts: now_ms(),
                    },
                );
            }
        });
    }

    if let Some(stderr) = child.stderr.take() {
        let app = app.clone();
        let event = event.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app.emit(
                    &event,
                    &DockerLogLine {
                        line,
                        stream: "stderr".to_string(),
                        ts: now_ms(),
                    },
                );
            }
        });
    }

    let _ = child.wait().await;
}

pub async fn stream_logs(
    app: AppHandle,
    stream_id: String,
    container_id: String,
    tail: u32,
    local_shell: Option<String>,
) {
    if should_use_wsl_cli(local_shell.as_deref()) {
        stream_logs_cli(app, stream_id, container_id, tail, local_shell).await;
        return;
    }

    let docker = match connect() {
        Ok(d) => d,
        Err(e) => {
            let _ = app.emit(
                &format!("docker:log:{stream_id}"),
                &DockerLogLine {
                    line: format!("Error: {e}"),
                    stream: "stderr".to_string(),
                    ts: now_ms(),
                },
            );
            return;
        }
    };

    let event = format!("docker:log:{stream_id}");

    let mut log_stream = docker.logs(
        &container_id,
        Some(LogsOptions::<String> {
            follow: true,
            stdout: true,
            stderr: true,
            since: 0,
            until: 0,
            timestamps: false,
            tail: tail.to_string(),
        }),
    );

    while let Some(result) = log_stream.next().await {
        match result {
            Ok(output) => {
                use bollard::container::LogOutput;
                let (line, stream_name) = match output {
                    LogOutput::StdOut { message } => (
                        String::from_utf8_lossy(&message).trim_end().to_string(),
                        "stdout",
                    ),
                    LogOutput::StdErr { message } => (
                        String::from_utf8_lossy(&message).trim_end().to_string(),
                        "stderr",
                    ),
                    LogOutput::Console { message } | LogOutput::StdIn { message } => (
                        String::from_utf8_lossy(&message).trim_end().to_string(),
                        "stdout",
                    ),
                };
                let _ = app.emit(
                    &event,
                    &DockerLogLine {
                        line,
                        stream: stream_name.to_string(),
                        ts: now_ms(),
                    },
                );
            }
            Err(_) => break,
        }
    }
}

async fn stream_logs_cli(
    app: AppHandle,
    stream_id: String,
    container_id: String,
    tail: u32,
    local_shell: Option<String>,
) {
    let event = format!("docker:log:{stream_id}");
    let mut command = Command::new(local_shell.unwrap_or_else(|| "wsl.exe".to_string()));
    command
        .arg("docker")
        .args(["logs", "-f", "--tail", &tail.to_string(), &container_id])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    prevent_visible_child_window(&mut command);

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(e) => {
            let _ = app.emit(
                &event,
                &DockerLogLine {
                    line: format!("Error: Docker not available in WSL: {e}"),
                    stream: "stderr".to_string(),
                    ts: now_ms(),
                },
            );
            return;
        }
    };

    if let Some(stdout) = child.stdout.take() {
        let app = app.clone();
        let event = event.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app.emit(
                    &event,
                    &DockerLogLine {
                        line,
                        stream: "stdout".to_string(),
                        ts: now_ms(),
                    },
                );
            }
        });
    }

    if let Some(stderr) = child.stderr.take() {
        let app = app.clone();
        let event = event.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app.emit(
                    &event,
                    &DockerLogLine {
                        line,
                        stream: "stderr".to_string(),
                        ts: now_ms(),
                    },
                );
            }
        });
    }

    let _ = child.wait().await;
}
