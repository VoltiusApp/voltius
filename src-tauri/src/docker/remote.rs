use std::sync::Arc;
use serde::Deserialize;
use tokio::io::AsyncReadExt;
use tokio::time::{timeout, Duration};
use tauri::{AppHandle, Emitter};

use super::types::*;
use crate::ssh::client::SshClient;

type SshHandle = Arc<russh::client::Handle<SshClient>>;

async fn exec_command(handle: &SshHandle, cmd: &str) -> Result<String, String> {
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

    let _ = timeout(Duration::from_secs(10), async {
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

#[derive(Deserialize)]
struct RawContainer {
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

pub async fn list_containers(handle: &SshHandle, all: bool) -> Result<Vec<DockerContainer>, String> {
    let all_flag = if all { " -a" } else { "" };
    let cmd = format!("docker ps{all_flag} --format '{{{{json .}}}}'");
    let output = exec_command(handle, &cmd).await?;

    let mut containers = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Ok(raw) = serde_json::from_str::<RawContainer>(line) {
            containers.push(DockerContainer {
                id: raw.id,
                names: raw
                    .names
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .collect(),
                image: raw.image,
                status: raw.status,
                state: raw.state,
                ports: parse_ports(&raw.ports),
                created: 0,
            });
        }
    }
    Ok(containers)
}

fn parse_ports(ports_str: &str) -> Vec<PortMapping> {
    if ports_str.is_empty() {
        return vec![];
    }
    ports_str
        .split(", ")
        .filter_map(|part| {
            let part = part.trim();
            if part.contains("->") {
                let mut it = part.splitn(2, "->");
                let host_part = it.next()?;
                let container_proto = it.next()?;

                let (container_port_str, protocol) = if container_proto.contains('/') {
                    let mut it2 = container_proto.splitn(2, '/');
                    (it2.next()?, it2.next().unwrap_or("tcp"))
                } else {
                    (container_proto, "tcp")
                };

                let container_port: u16 = container_port_str.parse().ok()?;

                let (host_ip, host_port_str) = if let Some(idx) = host_part.rfind(':') {
                    (&host_part[..idx], &host_part[idx + 1..])
                } else {
                    ("", host_part)
                };

                Some(PortMapping {
                    host_ip: if host_ip.is_empty() {
                        None
                    } else {
                        Some(host_ip.to_string())
                    },
                    host_port: host_port_str.parse().ok(),
                    container_port,
                    protocol: protocol.to_string(),
                })
            } else {
                let (port_str, protocol) = if part.contains('/') {
                    let mut it = part.splitn(2, '/');
                    (it.next()?, it.next().unwrap_or("tcp"))
                } else {
                    (part, "tcp")
                };
                Some(PortMapping {
                    host_ip: None,
                    host_port: None,
                    container_port: port_str.parse().ok()?,
                    protocol: protocol.to_string(),
                })
            }
        })
        .collect()
}

#[derive(Deserialize)]
struct RawImage {
    #[serde(rename = "ID", default)]
    id: String,
    #[serde(rename = "Repository", default)]
    repository: String,
    #[serde(rename = "Tag", default)]
    tag: String,
    #[serde(rename = "Size", default)]
    size: String,
}

pub async fn list_images(handle: &SshHandle) -> Result<Vec<DockerImage>, String> {
    let output = exec_command(handle, "docker images --format '{{json .}}'").await?;
    let mut images = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Ok(raw) = serde_json::from_str::<RawImage>(line) {
            let repo_tag = if raw.tag.is_empty() || raw.tag == "<none>" {
                raw.repository.clone()
            } else {
                format!("{}:{}", raw.repository, raw.tag)
            };
            images.push(DockerImage {
                id: raw.id,
                repo_tags: vec![repo_tag],
                size: parse_size_str(&raw.size),
                created: 0,
            });
        }
    }
    Ok(images)
}

fn parse_size_str(s: &str) -> i64 {
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
struct RawVolume {
    #[serde(rename = "Name", default)]
    name: String,
    #[serde(rename = "Driver", default)]
    driver: String,
}

pub async fn list_volumes(handle: &SshHandle) -> Result<Vec<DockerVolume>, String> {
    let output = exec_command(handle, "docker volume ls --format '{{json .}}'").await?;
    let mut volumes = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Ok(raw) = serde_json::from_str::<RawVolume>(line) {
            volumes.push(DockerVolume {
                name: raw.name,
                driver: raw.driver,
            });
        }
    }
    Ok(volumes)
}

#[derive(Deserialize)]
struct RawNetwork {
    #[serde(rename = "ID", default)]
    id: String,
    #[serde(rename = "Name", default)]
    name: String,
    #[serde(rename = "Driver", default)]
    driver: String,
}

pub async fn list_networks(handle: &SshHandle) -> Result<Vec<DockerNetwork>, String> {
    let output = exec_command(handle, "docker network ls --format '{{json .}}'").await?;
    let mut networks = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Ok(raw) = serde_json::from_str::<RawNetwork>(line) {
            networks.push(DockerNetwork {
                id: raw.id,
                name: raw.name,
                driver: raw.driver,
            });
        }
    }
    Ok(networks)
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
    exec_command(handle, &cmd).await?;
    Ok(())
}

pub async fn remove_image(handle: &SshHandle, image_id: &str) -> Result<(), String> {
    exec_command(handle, &format!("docker rmi -f {image_id}")).await?;
    Ok(())
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
    let out = exec_command(handle, "docker image prune -f").await?;
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
    let out = exec_command(handle, "docker system prune -af").await?;
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
