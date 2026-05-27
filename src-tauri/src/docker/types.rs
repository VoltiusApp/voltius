use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DockerContainer {
    pub id: String,
    pub names: Vec<String>,
    pub image: String,
    pub status: String,
    pub state: String,
    pub ports: Vec<PortMapping>,
    pub created: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortMapping {
    pub host_ip: Option<String>,
    pub host_port: Option<u16>,
    pub container_port: u16,
    pub protocol: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DockerImage {
    pub id: String,
    pub repo_tags: Vec<String>,
    pub size: i64,
    pub created: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DockerVolume {
    pub name: String,
    pub driver: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DockerNetwork {
    pub id: String,
    pub name: String,
    pub driver: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DockerLogLine {
    pub line: String,
    pub stream: String,
    pub ts: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DockerStack {
    pub name: String,
    pub status: String,
    pub config_files: Vec<String>,
    pub running: u32,
    pub exited: u32,
    pub paused: u32,
    pub total: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DockerStackService {
    pub id: String,
    pub name: String,
    pub project: String,
    pub service: String,
    pub image: String,
    pub state: String,
    pub status: String,
    pub ports: Vec<PortMapping>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ContainerAction {
    Start,
    Stop,
    Restart,
    Remove,
    Pause,
    Unpause,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum StackAction {
    Up,
    Stop,
    Restart,
    Down,
}

#[derive(Debug, Deserialize)]
struct RawComposeStack {
    #[serde(rename = "Name", default)]
    name: String,
    #[serde(rename = "Status", default)]
    status: String,
    #[serde(rename = "ConfigFiles", default)]
    config_files: String,
}

#[derive(Debug, Deserialize)]
struct RawComposeService {
    #[serde(rename = "ID", default)]
    id: String,
    #[serde(rename = "Name", default)]
    name: String,
    #[serde(rename = "Project", default)]
    project: String,
    #[serde(rename = "Service", default)]
    service: String,
    #[serde(rename = "Image", default)]
    image: String,
    #[serde(rename = "State", default)]
    state: String,
    #[serde(rename = "Status", default)]
    status: String,
    #[serde(rename = "Publishers", default)]
    publishers: Vec<RawComposePort>,
}

#[derive(Debug, Deserialize)]
struct RawComposePort {
    #[serde(rename = "URL", default)]
    url: Option<String>,
    #[serde(rename = "TargetPort", default)]
    target_port: Option<u16>,
    #[serde(rename = "PublishedPort", default)]
    published_port: Option<u16>,
    #[serde(rename = "Protocol", default)]
    protocol: Option<String>,
}

pub fn parse_compose_stacks(output: &str) -> Result<Vec<DockerStack>, String> {
    let trimmed = output.trim();
    if trimmed.is_empty() {
        return Ok(vec![]);
    }

    let raw_stacks = if trimmed.starts_with('[') {
        serde_json::from_str::<Vec<RawComposeStack>>(trimmed)
            .map_err(|e| format!("Failed to parse docker compose ls output: {e}"))?
    } else {
        trimmed
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(|line| {
                serde_json::from_str::<RawComposeStack>(line.trim())
                    .map_err(|e| format!("Failed to parse docker compose ls output: {e}"))
            })
            .collect::<Result<Vec<_>, _>>()?
    };

    Ok(raw_stacks
        .into_iter()
        .map(|raw| {
            let (running, exited, paused, total) = parse_compose_status_counts(&raw.status);
            DockerStack {
                name: raw.name,
                status: raw.status,
                config_files: split_config_files(&raw.config_files),
                running,
                exited,
                paused,
                total,
            }
        })
        .collect())
}

pub fn parse_compose_services(output: &str) -> Result<Vec<DockerStackService>, String> {
    let trimmed = output.trim();
    if trimmed.is_empty() {
        return Ok(vec![]);
    }

    let raw_services = if trimmed.starts_with('[') {
        serde_json::from_str::<Vec<RawComposeService>>(trimmed)
            .map_err(|e| format!("Failed to parse docker compose ps output: {e}"))?
    } else {
        trimmed
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(|line| {
                serde_json::from_str::<RawComposeService>(line.trim())
                    .map_err(|e| format!("Failed to parse docker compose ps output: {e}"))
            })
            .collect::<Result<Vec<_>, _>>()?
    };

    Ok(raw_services
        .into_iter()
        .map(|raw| DockerStackService {
            id: raw.id,
            name: raw.name,
            project: raw.project,
            service: raw.service,
            image: raw.image,
            state: raw.state,
            status: raw.status,
            ports: raw
                .publishers
                .into_iter()
                .filter_map(|port| {
                    Some(PortMapping {
                        host_ip: port.url,
                        host_port: port.published_port,
                        container_port: port.target_port?,
                        protocol: port.protocol.unwrap_or_else(|| "tcp".to_string()),
                    })
                })
                .collect(),
        })
        .collect())
}

fn split_config_files(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn parse_compose_status_counts(status: &str) -> (u32, u32, u32, u32) {
    let mut running = 0;
    let mut exited = 0;
    let mut paused = 0;

    for part in status.split(',') {
        let part = part.trim().to_lowercase();
        let count = part
            .split_once('(')
            .and_then(|(_, rest)| rest.split_once(')'))
            .and_then(|(count, _)| count.parse::<u32>().ok())
            .unwrap_or(0);

        if part.starts_with("running") {
            running += count;
        } else if part.starts_with("exited") {
            exited += count;
        } else if part.starts_with("paused") {
            paused += count;
        }
    }

    (running, exited, paused, running + exited + paused)
}
