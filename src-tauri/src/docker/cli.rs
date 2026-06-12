//! Backend-agnostic parsing of the Docker CLI's `--format '{{json .}}'` rows.
//!
//! Both the local (WSL/CLI exec) and remote (SSH exec) backends run the same
//! `docker ps/images/volume ls/network ls` commands and get back the same JSON
//! row shapes. Only the *transport* differs; the parsing lives here once so the
//! two backends can't drift.

use super::types::{DockerContainer, DockerImage, DockerNetwork, DockerVolume, PortMapping};
use serde::Deserialize;

/// The `--format` template that yields one JSON object per row.
pub const JSON_LINE_FORMAT: &str = "{{json .}}";

#[derive(Deserialize)]
pub struct CliContainer {
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

impl CliContainer {
    pub fn into_domain(self) -> DockerContainer {
        DockerContainer {
            id: self.id,
            names: self
                .names
                .split(',')
                .map(|s| s.trim().to_string())
                .collect(),
            image: self.image,
            status: self.status,
            state: self.state,
            ports: parse_ports(&self.ports),
            created: 0,
        }
    }
}

#[derive(Deserialize)]
pub struct CliImage {
    #[serde(rename = "ID", default)]
    id: String,
    #[serde(rename = "Repository", default)]
    repository: String,
    #[serde(rename = "Tag", default)]
    tag: String,
    #[serde(rename = "Size", default)]
    size: String,
}

impl CliImage {
    pub fn into_domain(self) -> DockerImage {
        let repo_tag = if self.tag.is_empty() || self.tag == "<none>" {
            self.repository.clone()
        } else {
            format!("{}:{}", self.repository, self.tag)
        };
        DockerImage {
            id: self.id,
            repo_tags: vec![repo_tag],
            size: parse_size(&self.size),
            created: 0,
        }
    }
}

#[derive(Deserialize)]
pub struct CliVolume {
    #[serde(rename = "Name", default)]
    name: String,
    #[serde(rename = "Driver", default)]
    driver: String,
}

impl CliVolume {
    pub fn into_domain(self) -> DockerVolume {
        DockerVolume {
            name: self.name,
            driver: self.driver,
        }
    }
}

#[derive(Deserialize)]
pub struct CliNetwork {
    #[serde(rename = "ID", default)]
    id: String,
    #[serde(rename = "Name", default)]
    name: String,
    #[serde(rename = "Driver", default)]
    driver: String,
}

impl CliNetwork {
    pub fn into_domain(self) -> DockerNetwork {
        DockerNetwork {
            id: self.id,
            name: self.name,
            driver: self.driver,
        }
    }
}

/// Parse the `Ports` column of `docker ps --format '{{json .}}'`. The host IP of
/// published bindings is intentionally not retained.
pub fn parse_ports(ports_str: &str) -> Vec<PortMapping> {
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

/// Parse a human-readable size string (e.g. `142MB`, `1.5GB`) into bytes.
pub fn parse_size(s: &str) -> i64 {
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

#[cfg(test)]
mod tests {
    use super::*;

    // `host_ip` is always `None` — the local backend's long-standing behavior,
    // which the remote backend now adopts too.

    #[test]
    fn parse_ports_published_drops_host_ip() {
        let ports = parse_ports("0.0.0.0:8080->80/tcp");
        assert_eq!(ports.len(), 1);
        assert_eq!(ports[0].host_ip, None);
        assert_eq!(ports[0].host_port, Some(8080));
        assert_eq!(ports[0].container_port, 80);
        assert_eq!(ports[0].protocol, "tcp");
    }

    #[test]
    fn parse_ports_exposed_only_and_multi() {
        let ports = parse_ports("80/tcp, 0.0.0.0:5432->5432/tcp");
        assert_eq!(ports.len(), 2);
        assert_eq!(ports[0].host_ip, None);
        assert_eq!(ports[0].host_port, None);
        assert_eq!(ports[0].container_port, 80);
        assert_eq!(ports[0].protocol, "tcp");
        assert_eq!(ports[1].host_ip, None);
        assert_eq!(ports[1].host_port, Some(5432));
        assert_eq!(ports[1].container_port, 5432);
    }

    #[test]
    fn parse_ports_empty_is_empty() {
        assert!(parse_ports("").is_empty());
    }

    #[test]
    fn parse_size_units() {
        assert_eq!(parse_size("1.5GB"), 1_610_612_736);
        assert_eq!(parse_size("100MB"), 104_857_600);
        assert_eq!(parse_size("512kB"), 524_288);
        assert_eq!(parse_size("42B"), 42);
        assert_eq!(parse_size("garbage"), 0);
    }

    #[test]
    fn container_row_into_domain() {
        let line = r#"{"ID":"abc","Names":"web,web2","Image":"nginx","Status":"Up","State":"running","Ports":"0.0.0.0:8080->80/tcp"}"#;
        let c = serde_json::from_str::<CliContainer>(line)
            .unwrap()
            .into_domain();
        assert_eq!(c.id, "abc");
        assert_eq!(c.names, vec!["web", "web2"]);
        assert_eq!(c.image, "nginx");
        assert_eq!(c.status, "Up");
        assert_eq!(c.state, "running");
        assert_eq!(c.ports.len(), 1);
        assert_eq!(c.ports[0].container_port, 80);
    }

    #[test]
    fn image_row_into_domain() {
        let tagged = serde_json::from_str::<CliImage>(
            r#"{"ID":"img1","Repository":"nginx","Tag":"latest","Size":"142MB"}"#,
        )
        .unwrap()
        .into_domain();
        assert_eq!(tagged.repo_tags, vec!["nginx:latest"]);
        assert_eq!(tagged.size, 142 * 1024 * 1024);

        let untagged = serde_json::from_str::<CliImage>(
            r#"{"ID":"img2","Repository":"nginx","Tag":"<none>","Size":"0B"}"#,
        )
        .unwrap()
        .into_domain();
        assert_eq!(untagged.repo_tags, vec!["nginx"]);
    }

    #[test]
    fn volume_and_network_rows_into_domain() {
        let v = serde_json::from_str::<CliVolume>(r#"{"Name":"data","Driver":"local"}"#)
            .unwrap()
            .into_domain();
        assert_eq!(v.name, "data");
        assert_eq!(v.driver, "local");
        let n = serde_json::from_str::<CliNetwork>(
            r#"{"ID":"net1","Name":"bridge","Driver":"bridge"}"#,
        )
        .unwrap()
        .into_domain();
        assert_eq!(n.id, "net1");
        assert_eq!(n.name, "bridge");
        assert_eq!(n.driver, "bridge");
    }
}
