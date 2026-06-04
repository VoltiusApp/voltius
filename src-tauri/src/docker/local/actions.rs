use super::exec::{connect, run_compose, run_docker, run_wsl_docker, should_use_wsl_cli};
use super::list::list_stacks;
use crate::docker::recreate::{build_run_command, parse_inspect};
use crate::docker::types::*;
use bollard::container::RemoveContainerOptions;
use bollard::image::RemoveImageOptions;
use bollard::volume::RemoveVolumeOptions;

/// Reconstruct a pasteable `docker run …` command for a container.
pub async fn container_run_command(
    local_shell: Option<&str>,
    container_id: &str,
    image: &str,
) -> Result<String, String> {
    let inspect = run_docker(local_shell, &["inspect", container_id]).await?;
    let parsed = parse_inspect(&inspect)?;
    Ok(build_run_command(&parsed, image))
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

/// Pull newer images for a stack and recreate it: `compose pull` then `up -d`.
pub async fn stack_update(local_shell: Option<&str>, stack_name: &str) -> Result<(), String> {
    let config_files = list_stacks(local_shell)
        .await
        .ok()
        .and_then(|stacks| stacks.into_iter().find(|stack| stack.name == stack_name))
        .map(|stack| stack.config_files)
        .unwrap_or_default();

    let mut base = Vec::new();
    for file in &config_files {
        base.push("-f".to_string());
        base.push(file.clone());
    }
    base.push("-p".to_string());
    base.push(stack_name.to_string());

    let mut pull = base.clone();
    pull.push("pull".to_string());
    let pull_refs = pull.iter().map(String::as_str).collect::<Vec<_>>();
    run_compose(local_shell, &pull_refs).await?;

    let mut up = base;
    up.extend(["up".to_string(), "-d".to_string()]);
    let up_refs = up.iter().map(String::as_str).collect::<Vec<_>>();
    run_compose(local_shell, &up_refs).await?;
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
