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

/// Result of checking a tagged image against its registry.
/// `status` is one of: "current", "outdated", "unknown".
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageUpdateStatus {
    pub repo_tag: String,
    pub status: String,
    pub local_digest: Option<String>,
    pub remote_digest: Option<String>,
    pub error: Option<String>,
}

/// Outcome of recreating the containers that use a freshly-pulled image.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RecreateResult {
    /// Whether the pull actually fetched a different image (id changed).
    pub image_updated: bool,
    /// `docker pull` output — surfaced when the image didn't change so the real
    /// reason (rate limit, "up to date", auth) is visible.
    pub pull_output: String,
    /// Compose services recreated, as "project/service".
    pub recreated: Vec<String>,
    /// Running standalone (non-compose) containers that need manual recreation.
    pub manual: Vec<String>,
    /// Per-service recreate failures.
    pub errors: Vec<String>,
}

/// Keep the last `max` chars of `s` (docker pull tails are the informative part).
pub fn tail_chars(s: &str, max: usize) -> String {
    let s = s.trim();
    let count = s.chars().count();
    if count <= max {
        return s.to_string();
    }
    s.chars().skip(count - max).collect()
}

/// Go-template for `docker ps --format` that emits the fields needed to map a
/// container back to its compose service. Tab-delimited; docker converts `\t`.
pub const RECREATE_PS_FORMAT: &str = r#"{{.ID}}\t{{.Names}}\t{{.Label "com.docker.compose.project"}}\t{{.Label "com.docker.compose.service"}}\t{{.Label "com.docker.compose.project.config_files"}}\t{{.Label "com.docker.compose.project.working_dir"}}"#;

/// Parsed compose identity of a running container (or standalone name).
pub struct ContainerComposeRef {
    pub id: String,
    pub name: String,
    pub project: String,
    pub service: String,
    pub config_files: Vec<String>,
    pub working_dir: String,
}

impl ContainerComposeRef {
    pub fn is_compose(&self) -> bool {
        !self.project.is_empty() && !self.service.is_empty()
    }
}

/// Parse one tab-delimited line produced by [`RECREATE_PS_FORMAT`].
pub fn parse_recreate_ps_line(line: &str) -> Option<ContainerComposeRef> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }
    let mut fields = line.split('\t');
    let id = fields.next()?.to_string();
    let name = fields.next().unwrap_or("").to_string();
    let project = fields.next().unwrap_or("").trim().to_string();
    let service = fields.next().unwrap_or("").trim().to_string();
    let config_files = fields
        .next()
        .unwrap_or("")
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToString::to_string)
        .collect();
    let working_dir = fields.next().unwrap_or("").trim().to_string();
    Some(ContainerComposeRef {
        id,
        name,
        project,
        service,
        config_files,
        working_dir,
    })
}

/// Strip the tag from an image reference to get the repository part.
/// Handles `registry:port/path:tag` — the trailing `:tag` is only a tag when
/// the part after the last colon contains no slash.
pub fn image_repo(image_ref: &str) -> &str {
    match image_ref.rsplit_once(':') {
        Some((repo, tag)) if !tag.contains('/') => repo,
        _ => image_ref,
    }
}

/// From a parsed `RepoDigests` array (entries like `repo@sha256:...`), pick the
/// digest whose repo matches `image_ref`, falling back to the first available.
pub fn pick_repo_digest(repo_digests: &[String], image_ref: &str) -> Option<String> {
    let repo = image_repo(image_ref);
    repo_digests
        .iter()
        .find_map(|entry| {
            let (entry_repo, digest) = entry.split_once('@')?;
            (entry_repo == repo).then(|| digest.to_string())
        })
        .or_else(|| {
            repo_digests
                .first()
                .and_then(|e| e.split_once('@').map(|(_, d)| d.to_string()))
        })
}

/// Derive an [`ImageUpdateStatus`] from the local and registry digests.
pub fn build_update_status(
    repo_tag: String,
    local_digest: Option<String>,
    remote_digest: Option<String>,
    error: Option<String>,
) -> ImageUpdateStatus {
    let status = match (&local_digest, &remote_digest) {
        (Some(l), Some(r)) if l == r => "current",
        (Some(_), Some(_)) => "outdated",
        _ => "unknown",
    }
    .to_string();
    ImageUpdateStatus {
        repo_tag,
        status,
        local_digest,
        remote_digest,
        error,
    }
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
