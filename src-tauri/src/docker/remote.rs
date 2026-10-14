use tauri::AppHandle;
use tokio::io::AsyncReadExt;
use tokio::time::Duration;

use super::cli::{self, CliContainer, CliImage, CliNetwork, CliVolume};
use super::log_stream::{emit_error, emit_line, log_event};
use super::recreate::{build_network_connects, build_run_args, build_run_command, parse_inspect};
use super::types::*;
use crate::ssh::exec::{open_exec, shell_quote};
use crate::ssh::session::Machine;

/// Default timeout for quick docker queries (`ps`, `inspect`, …).
const DEFAULT_EXEC_TIMEOUT: Duration = Duration::from_secs(10);
/// Generous timeout for long operations (`pull`, `compose pull/up`, recreate).
const LONG_EXEC_TIMEOUT: Duration = Duration::from_secs(600);

async fn exec_command(host: &Machine, cmd: &str) -> Result<String, String> {
    host.stdout(cmd, DEFAULT_EXEC_TIMEOUT).await
}

fn build_stack_logs_cmd(stack_name: &str, tail: u32) -> String {
    format!(
        "docker compose -p {} logs --follow --tail {tail}",
        shell_quote(stack_name)
    )
}

fn build_container_logs_cmd(container_id: &str, tail: u32) -> String {
    format!(
        "docker logs --follow --tail {tail} {}",
        shell_quote(container_id)
    )
}

pub async fn list_containers(host: &Machine, all: bool) -> Result<Vec<DockerContainer>, String> {
    let all_flag = if all { " -a" } else { "" };
    let cmd = format!("docker ps{all_flag} --format '{}'", cli::JSON_LINE_FORMAT);
    let output = exec_command(host, &cmd).await?;

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

pub async fn list_images(host: &Machine) -> Result<Vec<DockerImage>, String> {
    let cmd = format!("docker images --format '{}'", cli::JSON_LINE_FORMAT);
    let output = exec_command(host, &cmd).await?;
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

pub async fn list_volumes(host: &Machine) -> Result<Vec<DockerVolume>, String> {
    let cmd = format!("docker volume ls --format '{}'", cli::JSON_LINE_FORMAT);
    let output = exec_command(host, &cmd).await?;
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

pub async fn list_networks(host: &Machine) -> Result<Vec<DockerNetwork>, String> {
    let cmd = format!("docker network ls --format '{}'", cli::JSON_LINE_FORMAT);
    let output = exec_command(host, &cmd).await?;
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

pub async fn list_stacks(host: &Machine) -> Result<Vec<DockerStack>, String> {
    let output = exec_command(host, "docker compose ls --all --format json").await?;
    parse_compose_stacks(&output)
}

pub async fn list_stack_services(
    host: &Machine,
    stack_name: &str,
) -> Result<Vec<DockerStackService>, String> {
    let output = exec_command(
        host,
        &format!(
            "docker compose -p {} ps --all --format json",
            shell_quote(stack_name)
        ),
    )
    .await?;
    parse_compose_services(&output)
}

pub async fn container_action(
    host: &Machine,
    container_id: &str,
    action: &ContainerAction,
) -> Result<(), String> {
    let id_q = shell_quote(container_id);
    let cmd = match action {
        ContainerAction::Start => format!("docker start {id_q}"),
        ContainerAction::Stop => format!("docker stop {id_q}"),
        ContainerAction::Restart => format!("docker restart {id_q}"),
        ContainerAction::Remove => format!("docker rm -f {id_q}"),
        ContainerAction::Pause => format!("docker pause {id_q}"),
        ContainerAction::Unpause => format!("docker unpause {id_q}"),
    };
    // stop/restart honor docker's ~10s graceful-shutdown window, so don't cap at 10s.
    host.stdout(&cmd, LONG_EXEC_TIMEOUT).await?;
    Ok(())
}

pub async fn stack_action(
    host: &Machine,
    stack_name: &str,
    action: &StackAction,
) -> Result<(), String> {
    let config_files = list_stacks(host)
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
    host.stdout(&cmd, LONG_EXEC_TIMEOUT).await?;
    Ok(())
}

/// Pull newer images for a remote stack and recreate it: `compose pull` then `up -d`.
pub async fn stack_update(host: &Machine, stack_name: &str) -> Result<(), String> {
    let config_files = list_stacks(host)
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
    host.stdout(&cmd, LONG_EXEC_TIMEOUT).await?;
    Ok(())
}

pub async fn remove_image(host: &Machine, image_id: &str) -> Result<(), String> {
    exec_command(host, &format!("docker rmi -f {}", shell_quote(image_id))).await?;
    Ok(())
}

/// The digest the image was pulled at on the remote host (its `RepoDigest`).
pub async fn local_image_digest(host: &Machine, image: &str) -> Option<String> {
    let q = shell_quote(image);
    exec_command(
        host,
        &format!("docker image inspect {q} --format '{{{{json .RepoDigests}}}}'"),
    )
    .await
    .ok()
    .and_then(|out| serde_json::from_str::<Vec<String>>(out.trim()).ok())
    .and_then(|digests| pick_repo_digest(&digests, image))
}

/// Pull the latest image for a tag on the remote host. Returns the CLI output.
pub async fn pull_image(host: &Machine, image: &str) -> Result<String, String> {
    host.stdout(
        &format!("docker pull {}", shell_quote(image)),
        LONG_EXEC_TIMEOUT,
    )
    .await
}

/// Reconstruct a pasteable `docker run …` command for a remote container.
pub async fn container_run_command(
    host: &Machine,
    container_id: &str,
    image: &str,
) -> Result<String, String> {
    let inspect = exec_command(
        host,
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
    host: &Machine,
    image: &str,
    container_id: &str,
    name: &str,
) -> Result<(), String> {
    let inspect = exec_command(
        host,
        &format!("docker inspect {}", shell_quote(container_id)),
    )
    .await?;
    let parsed = parse_inspect(&inspect)?;
    let run_args = build_run_args(&parsed, image);
    let connects = build_network_connects(&parsed, name);

    let backup = format!("{name}-old-{}", crate::clock::now_ms());

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

    let out = host.stdout(&script, LONG_EXEC_TIMEOUT).await?;
    if out.contains("__RC_OK__") {
        Ok(())
    } else {
        Err("recreate failed (original restored)".into())
    }
}

/// List running containers using `image` (with compose identity). Must run
/// *before* the pull — see the local counterpart for why.
async fn list_image_container_refs(
    host: &Machine,
    image: &str,
) -> Result<Vec<ContainerComposeRef>, String> {
    let cmd = format!(
        "docker ps --filter ancestor={} --format {}",
        shell_quote(image),
        shell_quote(RECREATE_PS_FORMAT),
    );
    let output = exec_command(host, &cmd).await?;
    Ok(output.lines().filter_map(parse_recreate_ps_line).collect())
}

/// Recreate the given remote containers against `image`.
async fn recreate_refs(
    host: &Machine,
    image: &str,
    refs: Vec<ContainerComposeRef>,
) -> RecreateResult {
    let mut result = RecreateResult::default();
    let mut seen = std::collections::HashSet::new();

    for ctr in refs {
        if !ctr.is_compose() {
            match recreate_standalone(host, image, &ctr.id, &ctr.name).await {
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

        match host.stdout(&cmd, LONG_EXEC_TIMEOUT).await {
            Ok(_) => result.recreated.push(key),
            Err(e) => result.errors.push(format!("{key}: {e}")),
        }
    }

    result
}

/// Recreate the containers currently using `image` (no pull).
pub async fn recreate_image_containers(
    host: &Machine,
    image: &str,
) -> Result<RecreateResult, String> {
    let refs = list_image_container_refs(host, image).await?;
    Ok(recreate_refs(host, image, refs).await)
}

/// Resolve an image's content id, used to detect whether a pull changed it.
async fn image_id(host: &Machine, image: &str) -> Option<String> {
    exec_command(
        host,
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
    host: &Machine,
    image: &str,
    recreate: bool,
) -> Result<RecreateResult, String> {
    let before = image_id(host, image).await;
    let refs = if recreate {
        list_image_container_refs(host, image)
            .await
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    let pull_output = pull_image(host, image).await?;

    let after = image_id(host, image).await;
    let image_updated = after.is_some() && before != after;

    let mut result = if recreate && image_updated {
        recreate_refs(host, image, refs).await
    } else {
        RecreateResult::default()
    };
    result.image_updated = image_updated;
    if !image_updated {
        result.pull_output = tail_chars(&pull_output, 300);
    }
    Ok(result)
}

pub async fn remove_volume(host: &Machine, name: &str) -> Result<(), String> {
    exec_command(host, &format!("docker volume rm {}", shell_quote(name))).await?;
    Ok(())
}

pub async fn remove_network(host: &Machine, id: &str) -> Result<(), String> {
    exec_command(host, &format!("docker network rm {}", shell_quote(id))).await?;
    Ok(())
}

pub async fn prune_images(host: &Machine) -> Result<String, String> {
    let out = host
        .stdout("docker image prune -f", LONG_EXEC_TIMEOUT)
        .await?;
    Ok(parse_prune_output(&out))
}

pub async fn prune_volumes(host: &Machine) -> Result<String, String> {
    let out = exec_command(host, "docker volume prune -f").await?;
    Ok(parse_prune_output(&out))
}

pub async fn prune_networks(host: &Machine) -> Result<String, String> {
    exec_command(host, "docker network prune -f").await?;
    Ok("Networks pruned".to_string())
}

pub async fn system_prune(host: &Machine) -> Result<String, String> {
    let out = host
        .stdout("docker system prune -af", LONG_EXEC_TIMEOUT)
        .await?;
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

/// Follow a docker log command over SSH, emitting each non-empty line on the
/// stream's event. The two remote log streams differ only in the command.
async fn stream_ssh_logs(app: AppHandle, stream_id: String, host: Machine, cmd: String) {
    let event = log_event(&stream_id);

    let mut stream = match open_exec(&host.handle, &host.wrap(&cmd)).await {
        Ok(c) => c.into_stream(),
        Err(e) => return emit_error(&app, &event, e),
    };
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
                    emit_line(&app, &event, line.to_string(), "stdout");
                }
            }
        }
    }
}

pub async fn stream_stack_logs(
    app: AppHandle,
    stream_id: String,
    stack_name: String,
    tail: u32,
    host: Machine,
) {
    stream_ssh_logs(
        app,
        stream_id,
        host,
        build_stack_logs_cmd(&stack_name, tail),
    )
    .await
}

pub async fn stream_logs(
    app: AppHandle,
    stream_id: String,
    container_id: String,
    tail: u32,
    host: Machine,
) {
    stream_ssh_logs(
        app,
        stream_id,
        host,
        build_container_logs_cmd(&container_id, tail),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    const INJECTION: &str = "abc; rm -rf / #";

    #[test]
    fn shell_quote_neutralizes_command_separators() {
        let quoted = shell_quote(INJECTION);
        assert_eq!(quoted, "'abc; rm -rf / #'");
    }

    #[test]
    fn shell_quote_escapes_embedded_single_quotes() {
        assert_eq!(shell_quote("a'b"), "'a'\\''b'");
    }

    #[test]
    fn container_logs_cmd_quotes_container_id() {
        let cmd = build_container_logs_cmd(INJECTION, 100);
        assert_eq!(cmd, "docker logs --follow --tail 100 'abc; rm -rf / #'");
    }

    #[test]
    fn stack_logs_cmd_quotes_stack_name() {
        let cmd = build_stack_logs_cmd(INJECTION, 100);
        assert_eq!(
            cmd,
            "docker compose -p 'abc; rm -rf / #' logs --follow --tail 100"
        );
    }
}
