use bollard::container::{ListContainersOptions, LogsOptions, RemoveContainerOptions};
use bollard::image::{ListImagesOptions, RemoveImageOptions};
use bollard::models::PortTypeEnum;
use bollard::volume::RemoveVolumeOptions;
use bollard::Docker;
use futures_util::StreamExt;
use tauri::{AppHandle, Emitter};

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

pub async fn list_containers(all: bool) -> Result<Vec<DockerContainer>, String> {
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

pub async fn list_images() -> Result<Vec<DockerImage>, String> {
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

pub async fn list_volumes() -> Result<Vec<DockerVolume>, String> {
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

pub async fn list_networks() -> Result<Vec<DockerNetwork>, String> {
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

pub async fn container_action(container_id: &str, action: &ContainerAction) -> Result<(), String> {
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

pub async fn remove_image(image_id: &str) -> Result<(), String> {
    let docker = connect()?;
    docker
        .remove_image(
            image_id,
            Some(RemoveImageOptions { force: true, noprune: false }),
            None,
        )
        .await
        .map_err(|e| format!("{e}"))?;
    Ok(())
}

pub async fn remove_volume(name: &str) -> Result<(), String> {
    let docker = connect()?;
    docker
        .remove_volume(name, Some(RemoveVolumeOptions { force: true }))
        .await
        .map_err(|e| format!("{e}"))?;
    Ok(())
}

pub async fn remove_network(id: &str) -> Result<(), String> {
    let docker = connect()?;
    docker
        .remove_network(id)
        .await
        .map_err(|e| format!("{e}"))?;
    Ok(())
}

pub async fn prune_images() -> Result<String, String> {
    let docker = connect()?;
    let result = docker
        .prune_images::<String>(None)
        .await
        .map_err(|e| format!("{e}"))?;
    let reclaimed = result.space_reclaimed.unwrap_or(0);
    Ok(fmt_freed(reclaimed))
}

pub async fn prune_volumes() -> Result<String, String> {
    let docker = connect()?;
    let result = docker
        .prune_volumes::<String>(None)
        .await
        .map_err(|e| format!("{e}"))?;
    let reclaimed = result.space_reclaimed.unwrap_or(0);
    Ok(fmt_freed(reclaimed))
}

pub async fn prune_networks() -> Result<String, String> {
    let docker = connect()?;
    docker
        .prune_networks::<String>(None)
        .await
        .map_err(|e| format!("{e}"))?;
    Ok("Networks pruned".to_string())
}

pub async fn system_prune() -> Result<String, String> {
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

pub async fn stream_logs(app: AppHandle, stream_id: String, container_id: String, tail: u32) {
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
                    LogOutput::StdOut { message } => {
                        (String::from_utf8_lossy(&message).trim_end().to_string(), "stdout")
                    }
                    LogOutput::StdErr { message } => {
                        (String::from_utf8_lossy(&message).trim_end().to_string(), "stderr")
                    }
                    LogOutput::Console { message } | LogOutput::StdIn { message } => {
                        (String::from_utf8_lossy(&message).trim_end().to_string(), "stdout")
                    }
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
