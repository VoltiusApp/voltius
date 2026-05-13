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

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_wsl_child_processes_are_configured_without_visible_windows() {
        assert_eq!(windows_hidden_child_process_flags(), 0x08000000);
    }
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
