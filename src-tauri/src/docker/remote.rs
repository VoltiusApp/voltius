use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncReadExt;
use tokio::time::{timeout, Duration};

use super::cli::{self, CliContainer, CliImage, CliNetwork, CliVolume};
use super::recreate::{build_network_connects, build_run_args, build_run_command, parse_inspect};
use super::types::*;
use crate::ssh::client::SshClient;

type SshHandle = Arc<russh::client::Handle<SshClient>>;

/// Default timeout for quick docker queries (`ps`, `inspect`, …).
const DEFAULT_EXEC_TIMEOUT: Duration = Duration::from_secs(10);
/// Generous timeout for long operations (`pull`, `compose pull/up`, recreate).
const LONG_EXEC_TIMEOUT: Duration = Duration::from_secs(600);

async fn exec_command(handle: &SshHandle, cmd: &str) -> Result<String, String> {
    exec_command_timeout(handle, cmd, DEFAULT_EXEC_TIMEOUT).await
}

async fn exec_command_timeout(
    handle: &SshHandle,
    cmd: &str,
    limit: Duration,
) -> Result<String, String> {
    let channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("channel error: {e}"))?;

    channel
        .exec(true, cmd)
        .await
        .map_err(|e| format!("exec error: {e}"))?;

    let mut stream = channel.into_stream();
    let mut output = Vec::new();

    let _ = timeout(limit, async {
        let mut buf = [0u8; 16384];
        loop {
            match stream.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => output.extend_from_slice(&buf[..n]),
            }
        }
    })
    .await;

    Ok(String::from_utf8_lossy(&output).to_string())
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

pub async fn list_containers(
    handle: &SshHandle,
    all: bool,
) -> Result<Vec<DockerContainer>, String> {
    let all_flag = if all { " -a" } else { "" };
    let cmd = format!("docker ps{all_flag} --format '{}'", cli::JSON_LINE_FORMAT);
    let output = exec_command(handle, &cmd).await?;

    let mut containers = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Ok(raw) = serde_json::from_str::<CliContainer>(line) {
            containers.push(raw.into_domain());
        }
    }
    Ok(containers)
}

pub async fn list_images(handle: &SshHandle) -> Result<Vec<DockerImage>, String> {
    let cmd = format!("docker images --format '{}'", cli::JSON_LINE_FORMAT);
    let output = exec_command(handle, &cmd).await?;
    let mut images = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Ok(raw) = serde_json::from_str::<CliImage>(line) {
            images.push(raw.into_domain());
        }
    }
    Ok(images)
}

pub async fn list_volumes(handle: &SshHandle) -> Result<Vec<DockerVolume>, String> {
    let cmd = format!("docker volume ls --format '{}'", cli::JSON_LINE_FORMAT);
    let output = exec_command(handle, &cmd).await?;
    let mut volumes = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Ok(raw) = serde_json::from_str::<CliVolume>(line) {
            volumes.push(raw.into_domain());
        }
    }
    Ok(volumes)
}

pub async fn list_networks(handle: &SshHandle) -> Result<Vec<DockerNetwork>, String> {
    let cmd = format!("docker network ls --format '{}'", cli::JSON_LINE_FORMAT);
    let output = exec_command(handle, &cmd).await?;
    let mut networks = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Ok(raw) = serde_json::from_str::<CliNetwork>(line) {
            networks.push(raw.into_domain());
        }
    }
    Ok(networks)
}

pub async fn list_stacks(handle: &SshHandle) -> Result<Vec<DockerStack>, String> {
    let output = exec_command(handle, "docker compose ls --all --format json").await?;
    parse_compose_stacks(&output)
}

pub async fn list_stack_services(
    handle: &SshHandle,
    stack_name: &str,
) -> Result<Vec<DockerStackService>, String> {
    let output = exec_command(
        handle,
        &format!(
            "docker compose -p {} ps --all --format json",
            shell_quote(stack_name)
        ),
    )
    .await?;
    parse_compose_services(&output)
}

pub async fn container_action(
    handle: &SshHandle,
    container_id: &str,
    action: &ContainerAction,
) -> Result<(), String> {
    let cmd = match action {
        ContainerAction::Start => format!("docker start {container_id}"),
        ContainerAction::Stop => format!("docker stop {container_id}"),
        ContainerAction::Restart => format!("docker restart {container_id}"),
        ContainerAction::Remove => format!("docker rm -f {container_id}"),
        ContainerAction::Pause => format!("docker pause {container_id}"),
        ContainerAction::Unpause => format!("docker unpause {container_id}"),
    };
    // stop/restart honor docker's ~10s graceful-shutdown window, so don't cap at 10s.
    exec_command_timeout(handle, &cmd, LONG_EXEC_TIMEOUT).await?;
    Ok(())
}

pub async fn stack_action(
    handle: &SshHandle,
    stack_name: &str,
    action: &StackAction,
) -> Result<(), String> {
    let config_files = list_stacks(handle)
        .await
        .ok()
        .and_then(|stacks| stacks.into_iter().find(|stack| stack.name == stack_name))
        .map(|stack| stack.config_files)
        .unwrap_or_default();

    let file_args = config_files
        .iter()
        .map(|file| format!(" -f {}", shell_quote(file)))
        .collect::<String>();
    let project = shell_quote(stack_name);
    let action_cmd = match action {
        StackAction::Up => "up -d",
        StackAction::Stop => "stop",
        StackAction::Restart => "restart",
        StackAction::Down => "down",
    };
    let cmd = format!("docker compose{file_args} -p {project} {action_cmd}");
    exec_command_timeout(handle, &cmd, LONG_EXEC_TIMEOUT).await?;
    Ok(())
}

/// Pull newer images for a remote stack and recreate it: `compose pull` then `up -d`.
pub async fn stack_update(handle: &SshHandle, stack_name: &str) -> Result<(), String> {
    let config_files = list_stacks(handle)
        .await
        .ok()
        .and_then(|stacks| stacks.into_iter().find(|stack| stack.name == stack_name))
        .map(|stack| stack.config_files)
        .unwrap_or_default();

    let file_args = config_files
        .iter()
        .map(|file| format!(" -f {}", shell_quote(file)))
        .collect::<String>();
    let project = shell_quote(stack_name);
    let cmd = format!(
        "docker compose{file_args} -p {project} pull && docker compose{file_args} -p {project} up -d"
    );
    exec_command_timeout(handle, &cmd, LONG_EXEC_TIMEOUT).await?;
    Ok(())
}

pub async fn remove_image(handle: &SshHandle, image_id: &str) -> Result<(), String> {
    exec_command(handle, &format!("docker rmi -f {image_id}")).await?;
    Ok(())
}

/// The digest the image was pulled at on the remote host (its `RepoDigest`).
pub async fn local_image_digest(handle: &SshHandle, image: &str) -> Option<String> {
    let q = shell_quote(image);
    exec_command(
        handle,
        &format!("docker image inspect {q} --format '{{{{json .RepoDigests}}}}'"),
    )
    .await
    .ok()
    .and_then(|out| serde_json::from_str::<Vec<String>>(out.trim()).ok())
    .and_then(|digests| pick_repo_digest(&digests, image))
}

/// Pull the latest image for a tag on the remote host. Returns the CLI output.
pub async fn pull_image(handle: &SshHandle, image: &str) -> Result<String, String> {
    exec_command_timeout(
        handle,
        &format!("docker pull {}", shell_quote(image)),
        LONG_EXEC_TIMEOUT,
    )
    .await
}

/// Reconstruct a pasteable `docker run …` command for a remote container.
pub async fn container_run_command(
    handle: &SshHandle,
    container_id: &str,
    image: &str,
) -> Result<String, String> {
    let inspect = exec_command(
        handle,
        &format!("docker inspect {}", shell_quote(container_id)),
    )
    .await?;
    let parsed = parse_inspect(&inspect)?;
    Ok(build_run_command(&parsed, image))
}

/// Recreate a standalone container on the remote host by reconstructing its
/// `docker run` from `docker inspect`. Because the remote exec channel doesn't
/// surface exit codes, the whole stop → rename-backup → run → rollback sequence
/// runs server-side as one script that prints a success sentinel.
async fn recreate_standalone(
    handle: &SshHandle,
    image: &str,
    container_id: &str,
    name: &str,
) -> Result<(), String> {
    let inspect = exec_command(
        handle,
        &format!("docker inspect {}", shell_quote(container_id)),
    )
    .await?;
    let parsed = parse_inspect(&inspect)?;
    let run_args = build_run_args(&parsed, image);
    let connects = build_network_connects(&parsed, name);

    let backup = format!(
        "{name}-old-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );

    let id_q = shell_quote(container_id);
    let backup_q = shell_quote(&backup);
    let name_q = shell_quote(name);
    let run_cmd = format!(
        "docker {}",
        run_args
            .iter()
            .map(|a| shell_quote(a))
            .collect::<Vec<_>>()
            .join(" ")
    );
    let connect_cmds = connects
        .iter()
        .map(|cmd| {
            format!(
                "docker {} >/dev/null 2>&1 || true; ",
                cmd.iter()
                    .map(|a| shell_quote(a))
                    .collect::<Vec<_>>()
                    .join(" ")
            )
        })
        .collect::<String>();

    let script = format!(
        "docker stop {id} >/dev/null 2>&1 || true; \
         docker rename {id} {backup} || {{ echo __RC_FAIL__; exit 0; }}; \
         if {run} >/dev/null 2>&1; then \
           {connects}docker rm -f {backup} >/dev/null 2>&1 || true; echo __RC_OK__; \
         else \
           docker rm -f {name} >/dev/null 2>&1 || true; \
           docker rename {backup} {name} >/dev/null 2>&1 || true; \
           docker start {name} >/dev/null 2>&1 || true; echo __RC_FAIL__; \
         fi",
        id = id_q,
        backup = backup_q,
        name = name_q,
        run = run_cmd,
        connects = connect_cmds,
    );

    let out = exec_command_timeout(handle, &script, LONG_EXEC_TIMEOUT).await?;
    if out.contains("__RC_OK__") {
        Ok(())
    } else {
        Err("recreate failed (original restored)".into())
    }
}

/// List running containers using `image` (with compose identity). Must run
/// *before* the pull — see the local counterpart for why.
async fn list_image_container_refs(
    handle: &SshHandle,
    image: &str,
) -> Result<Vec<ContainerComposeRef>, String> {
    let cmd = format!(
        "docker ps --filter ancestor={} --format {}",
        shell_quote(image),
        shell_quote(RECREATE_PS_FORMAT),
    );
    let output = exec_command(handle, &cmd).await?;
    Ok(output.lines().filter_map(parse_recreate_ps_line).collect())
}

/// Recreate the given remote containers against `image`.
async fn recreate_refs(
    handle: &SshHandle,
    image: &str,
    refs: Vec<ContainerComposeRef>,
) -> RecreateResult {
    let mut result = RecreateResult::default();
    let mut seen = std::collections::HashSet::new();

    for ctr in refs {
        if !ctr.is_compose() {
            match recreate_standalone(handle, image, &ctr.id, &ctr.name).await {
                Ok(()) => result.recreated.push(ctr.name),
                Err(e) => {
                    result.manual.push(ctr.name.clone());
                    result.errors.push(format!("{}: {e}", ctr.name));
                }
            }
            continue;
        }
        let key = format!("{}/{}", ctr.project, ctr.service);
        if !seen.insert(key.clone()) {
            continue;
        }

        let mut cmd = format!(
            "docker compose --project-name {}",
            shell_quote(&ctr.project)
        );
        for cf in &ctr.config_files {
            cmd.push_str(&format!(" -f {}", shell_quote(cf)));
        }
        if !ctr.working_dir.is_empty() {
            cmd.push_str(&format!(
                " --project-directory {}",
                shell_quote(&ctr.working_dir)
            ));
        }
        cmd.push_str(&format!(
            " up -d --no-deps {} 2>&1",
            shell_quote(&ctr.service)
        ));

        match exec_command_timeout(handle, &cmd, LONG_EXEC_TIMEOUT).await {
            Ok(_) => result.recreated.push(key),
            Err(e) => result.errors.push(format!("{key}: {e}")),
        }
    }

    result
}

/// Recreate the containers currently using `image` (no pull).
pub async fn recreate_image_containers(
    handle: &SshHandle,
    image: &str,
) -> Result<RecreateResult, String> {
    let refs = list_image_container_refs(handle, image).await?;
    Ok(recreate_refs(handle, image, refs).await)
}

/// Resolve an image's content id, used to detect whether a pull changed it.
async fn image_id(handle: &SshHandle, image: &str) -> Option<String> {
    exec_command(
        handle,
        &format!(
            "docker image inspect {} --format '{{{{.Id}}}}'",
            shell_quote(image)
        ),
    )
    .await
    .ok()
    .map(|s| s.trim().to_string())
    .filter(|s| !s.is_empty() && s.starts_with("sha256:"))
}

/// Pull `image` and, when `recreate` is set and the pull fetched a new image,
/// recreate the containers that were using it (target list captured before the
/// pull). Remote counterpart of [`super::local::pull_and_recreate`].
pub async fn pull_and_recreate(
    handle: &SshHandle,
    image: &str,
    recreate: bool,
) -> Result<RecreateResult, String> {
    let before = image_id(handle, image).await;
    let refs = if recreate {
        list_image_container_refs(handle, image)
            .await
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    let pull_output = pull_image(handle, image).await?;

    let after = image_id(handle, image).await;
    let image_updated = after.is_some() && before != after;

    let mut result = if recreate && image_updated {
        recreate_refs(handle, image, refs).await
    } else {
        RecreateResult::default()
    };
    result.image_updated = image_updated;
    if !image_updated {
        result.pull_output = tail_chars(&pull_output, 300);
    }
    Ok(result)
}

pub async fn remove_volume(handle: &SshHandle, name: &str) -> Result<(), String> {
    exec_command(handle, &format!("docker volume rm {name}")).await?;
    Ok(())
}

pub async fn remove_network(handle: &SshHandle, id: &str) -> Result<(), String> {
    exec_command(handle, &format!("docker network rm {id}")).await?;
    Ok(())
}

pub async fn prune_images(handle: &SshHandle) -> Result<String, String> {
    let out = exec_command_timeout(handle, "docker image prune -f", LONG_EXEC_TIMEOUT).await?;
    Ok(parse_prune_output(&out))
}

pub async fn prune_volumes(handle: &SshHandle) -> Result<String, String> {
    let out = exec_command(handle, "docker volume prune -f").await?;
    Ok(parse_prune_output(&out))
}

pub async fn prune_networks(handle: &SshHandle) -> Result<String, String> {
    exec_command(handle, "docker network prune -f").await?;
    Ok("Networks pruned".to_string())
}

pub async fn system_prune(handle: &SshHandle) -> Result<String, String> {
    let out = exec_command_timeout(handle, "docker system prune -af", LONG_EXEC_TIMEOUT).await?;
    Ok(parse_prune_output(&out))
}

fn parse_prune_output(out: &str) -> String {
    for line in out.lines() {
        let l = line.trim();
        if l.starts_with("Total reclaimed space:") {
            return l.to_string();
        }
    }
    "Done".to_string()
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub async fn stream_stack_logs(
    app: AppHandle,
    stream_id: String,
    stack_name: String,
    tail: u32,
    handle: SshHandle,
) {
    let event = format!("docker:log:{stream_id}");

    let channel = match handle.channel_open_session().await {
        Ok(c) => c,
        Err(e) => {
            let _ = app.emit(
                &event,
                &DockerLogLine {
                    line: format!("Error opening channel: {e}"),
                    stream: "stderr".to_string(),
                    ts: now_ms(),
                },
            );
            return;
        }
    };

    let cmd = format!("docker compose -p {stack_name} logs --follow --tail {tail}");
    if let Err(e) = channel.exec(true, cmd.as_str()).await {
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

    let mut stream = channel.into_stream();
    let mut buf = [0u8; 4096];

    loop {
        match stream.read(&mut buf).await {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                let text = String::from_utf8_lossy(&buf[..n]);
                for line in text.lines() {
                    if line.is_empty() {
                        continue;
                    }
                    let _ = app.emit(
                        &event,
                        &DockerLogLine {
                            line: line.to_string(),
                            stream: "stdout".to_string(),
                            ts: now_ms(),
                        },
                    );
                }
            }
        }
    }
}

pub async fn stream_logs(
    app: AppHandle,
    stream_id: String,
    container_id: String,
    tail: u32,
    handle: SshHandle,
) {
    let event = format!("docker:log:{stream_id}");

    let channel = match handle.channel_open_session().await {
        Ok(c) => c,
        Err(e) => {
            let _ = app.emit(
                &event,
                &DockerLogLine {
                    line: format!("Error opening channel: {e}"),
                    stream: "stderr".to_string(),
                    ts: now_ms(),
                },
            );
            return;
        }
    };

    let cmd = format!("docker logs --follow --tail {tail} {container_id}");
    if let Err(e) = channel.exec(true, cmd.as_str()).await {
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

    let mut stream = channel.into_stream();
    let mut buf = [0u8; 4096];

    loop {
        match stream.read(&mut buf).await {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                let text = String::from_utf8_lossy(&buf[..n]);
                for line in text.lines() {
                    if line.is_empty() {
                        continue;
                    }
                    let _ = app.emit(
                        &event,
                        &DockerLogLine {
                            line: line.to_string(),
                            stream: "stdout".to_string(),
                            ts: now_ms(),
                        },
                    );
                }
            }
        }
    }
}
