//! Native `docker run` reconstruction from `docker inspect`, used to recreate a
//! standalone (non-compose) container so it adopts a freshly-pulled image.
//!
//! This is the same strategy Docker Desktop's "Copy docker run" and the
//! `runlike` project use: read the container's full config and map the fields
//! back to CLI flags. It reconstructs the common 90% (name, ports, env, volumes,
//! restart policy, networks, caps, devices, user, workdir, resources). A handful
//! of exotic options (sysctls, ulimits, log/security opts, multi-element
//! entrypoints) don't round-trip and are intentionally left to the new image's
//! defaults — preferring a working container over a brittle exact clone.

use std::collections::HashMap;

use serde::Deserialize;

#[derive(Deserialize)]
pub struct InspectContainer {
    #[serde(rename = "Name", default)]
    pub name: String,
    #[serde(rename = "Config", default)]
    pub config: InspectConfig,
    #[serde(rename = "HostConfig", default)]
    pub host_config: InspectHostConfig,
    #[serde(rename = "NetworkSettings", default)]
    pub network_settings: InspectNetworkSettings,
    #[serde(rename = "Mounts", default)]
    pub mounts: Vec<InspectMount>,
}

#[derive(Deserialize, Default)]
pub struct InspectConfig {
    #[serde(rename = "Hostname", default)]
    pub hostname: String,
    #[serde(rename = "User", default)]
    pub user: String,
    #[serde(rename = "Env", default)]
    pub env: Vec<String>,
    #[serde(rename = "Cmd", default)]
    pub cmd: Option<Vec<String>>,
    #[serde(rename = "Entrypoint", default)]
    pub entrypoint: Option<Vec<String>>,
    #[serde(rename = "Labels", default)]
    pub labels: HashMap<String, String>,
    #[serde(rename = "WorkingDir", default)]
    pub working_dir: String,
    #[serde(rename = "Tty", default)]
    pub tty: bool,
    #[serde(rename = "OpenStdin", default)]
    pub open_stdin: bool,
}

#[derive(Deserialize, Default)]
pub struct InspectHostConfig {
    #[serde(rename = "NetworkMode", default)]
    pub network_mode: String,
    #[serde(rename = "PortBindings", default)]
    pub port_bindings: HashMap<String, Option<Vec<PortBinding>>>,
    #[serde(rename = "RestartPolicy", default)]
    pub restart_policy: RestartPolicy,
    #[serde(rename = "Privileged", default)]
    pub privileged: bool,
    #[serde(rename = "CapAdd", default)]
    pub cap_add: Option<Vec<String>>,
    #[serde(rename = "CapDrop", default)]
    pub cap_drop: Option<Vec<String>>,
    #[serde(rename = "Dns", default)]
    pub dns: Option<Vec<String>>,
    #[serde(rename = "ExtraHosts", default)]
    pub extra_hosts: Option<Vec<String>>,
    #[serde(rename = "Devices", default)]
    pub devices: Option<Vec<DeviceMapping>>,
    #[serde(rename = "Memory", default)]
    pub memory: i64,
    #[serde(rename = "NanoCpus", default)]
    pub nano_cpus: i64,
}

#[derive(Deserialize, Default)]
pub struct PortBinding {
    #[serde(rename = "HostIp", default)]
    pub host_ip: String,
    #[serde(rename = "HostPort", default)]
    pub host_port: String,
}

#[derive(Deserialize, Default)]
pub struct RestartPolicy {
    #[serde(rename = "Name", default)]
    pub name: String,
    #[serde(rename = "MaximumRetryCount", default)]
    pub maximum_retry_count: i64,
}

#[derive(Deserialize)]
pub struct DeviceMapping {
    #[serde(rename = "PathOnHost", default)]
    pub path_on_host: String,
    #[serde(rename = "PathInContainer", default)]
    pub path_in_container: String,
    #[serde(rename = "CgroupPermissions", default)]
    pub cgroup_permissions: String,
}

#[derive(Deserialize)]
pub struct InspectMount {
    #[serde(rename = "Type", default)]
    pub typ: String,
    #[serde(rename = "Name", default)]
    pub name: String,
    #[serde(rename = "Source", default)]
    pub source: String,
    #[serde(rename = "Destination", default)]
    pub destination: String,
    #[serde(rename = "RW", default)]
    pub rw: bool,
}

#[derive(Deserialize, Default)]
pub struct InspectNetworkSettings {
    #[serde(rename = "Networks", default)]
    pub networks: HashMap<String, NetworkEndpoint>,
}

#[derive(Deserialize, Default)]
pub struct NetworkEndpoint {
    #[serde(rename = "IPAMConfig", default)]
    pub ipam: Option<IpamConfig>,
}

#[derive(Deserialize, Default)]
pub struct IpamConfig {
    #[serde(rename = "IPv4Address", default)]
    pub ipv4: String,
}

impl NetworkEndpoint {
    fn static_ipv4(&self) -> Option<String> {
        self.ipam
            .as_ref()
            .map(|i| i.ipv4.clone())
            .filter(|s| !s.is_empty())
    }
}

/// Docker's default hostname is the container's 12-char short id; re-passing it
/// would pin a stale value, so we skip hostnames that look like one.
fn looks_like_short_id(s: &str) -> bool {
    s.len() == 12 && s.chars().all(|c| c.is_ascii_hexdigit())
}

fn is_default_network(mode: &str) -> bool {
    matches!(mode, "" | "default" | "bridge")
}

/// Build the `docker run` argument vector (starting with `run`) that recreates
/// `c` against image `image` (the freshly-pulled tag, not the old image id).
pub fn build_run_args(c: &InspectContainer, image: &str) -> Vec<String> {
    let mut a: Vec<String> = vec!["run".into(), "-d".into()];

    let name = c.name.trim_start_matches('/').to_string();
    if !name.is_empty() {
        a.push("--name".into());
        a.push(name);
    }

    let rp = &c.host_config.restart_policy;
    if !rp.name.is_empty() && rp.name != "no" {
        a.push("--restart".into());
        if rp.name == "on-failure" && rp.maximum_retry_count > 0 {
            a.push(format!("on-failure:{}", rp.maximum_retry_count));
        } else {
            a.push(rp.name.clone());
        }
    }

    if !c.config.hostname.is_empty() && !looks_like_short_id(&c.config.hostname) {
        a.push("--hostname".into());
        a.push(c.config.hostname.clone());
    }
    if !c.config.user.is_empty() {
        a.push("-u".into());
        a.push(c.config.user.clone());
    }
    if !c.config.working_dir.is_empty() {
        a.push("-w".into());
        a.push(c.config.working_dir.clone());
    }

    // Primary network (only when not the default bridge).
    let primary = (!is_default_network(&c.host_config.network_mode))
        .then(|| c.host_config.network_mode.clone());
    if let Some(net) = &primary {
        a.push("--network".into());
        a.push(net.clone());
        if let Some(ip) = c
            .network_settings
            .networks
            .get(net)
            .and_then(NetworkEndpoint::static_ipv4)
        {
            a.push("--ip".into());
            a.push(ip);
        }
    }

    for (port, bindings) in &c.host_config.port_bindings {
        let Some(binds) = bindings else { continue };
        let (cport, proto) = port.split_once('/').unwrap_or((port.as_str(), "tcp"));
        for b in binds {
            let mut spec = String::new();
            if !b.host_ip.is_empty() {
                spec.push_str(&b.host_ip);
                spec.push(':');
            }
            spec.push_str(&b.host_port);
            spec.push(':');
            spec.push_str(cport);
            if proto != "tcp" {
                spec.push('/');
                spec.push_str(proto);
            }
            a.push("-p".into());
            a.push(spec);
        }
    }

    for e in &c.config.env {
        a.push("-e".into());
        a.push(e.clone());
    }

    for m in &c.mounts {
        match m.typ.as_str() {
            "tmpfs" => {
                a.push("--tmpfs".into());
                a.push(m.destination.clone());
            }
            "volume" | "bind" => {
                let src = if m.typ == "volume" && !m.name.is_empty() {
                    &m.name
                } else {
                    &m.source
                };
                let mut v = format!("{}:{}", src, m.destination);
                if !m.rw {
                    v.push_str(":ro");
                }
                a.push("-v".into());
                a.push(v);
            }
            _ => {}
        }
    }

    for (k, v) in &c.config.labels {
        a.push("--label".into());
        a.push(format!("{k}={v}"));
    }

    if let Some(caps) = &c.host_config.cap_add {
        for cap in caps {
            a.push("--cap-add".into());
            a.push(cap.clone());
        }
    }
    if let Some(caps) = &c.host_config.cap_drop {
        for cap in caps {
            a.push("--cap-drop".into());
            a.push(cap.clone());
        }
    }
    if c.host_config.privileged {
        a.push("--privileged".into());
    }

    if let Some(devices) = &c.host_config.devices {
        for d in devices {
            let mut spec = d.path_on_host.clone();
            if !d.path_in_container.is_empty() {
                spec.push(':');
                spec.push_str(&d.path_in_container);
            }
            if !d.cgroup_permissions.is_empty() && d.cgroup_permissions != "rwm" {
                spec.push(':');
                spec.push_str(&d.cgroup_permissions);
            }
            a.push("--device".into());
            a.push(spec);
        }
    }

    if let Some(dns) = &c.host_config.dns {
        for d in dns {
            a.push("--dns".into());
            a.push(d.clone());
        }
    }
    if let Some(hosts) = &c.host_config.extra_hosts {
        for h in hosts {
            a.push("--add-host".into());
            a.push(h.clone());
        }
    }

    if c.host_config.memory > 0 {
        a.push("--memory".into());
        a.push(c.host_config.memory.to_string());
    }
    if c.host_config.nano_cpus > 0 {
        a.push("--cpus".into());
        a.push(format!("{:.3}", c.host_config.nano_cpus as f64 / 1e9));
    }

    if c.config.tty {
        a.push("-t".into());
    }
    if c.config.open_stdin {
        a.push("-i".into());
    }

    // Single-element entrypoint overrides are expressible; multi-element ones
    // aren't, so those fall back to the (possibly updated) image default.
    if let Some(ep) = &c.config.entrypoint {
        if ep.len() == 1 {
            a.push("--entrypoint".into());
            a.push(ep[0].clone());
        }
    }

    a.push(image.to_string());

    if let Some(cmd) = &c.config.cmd {
        a.extend(cmd.iter().cloned());
    }

    a
}

/// `docker network connect` invocations for any networks beyond the primary one
/// (a container can only attach to one network at `run` time).
pub fn build_network_connects(c: &InspectContainer, name: &str) -> Vec<Vec<String>> {
    let primary = (!is_default_network(&c.host_config.network_mode))
        .then(|| c.host_config.network_mode.as_str());

    let mut cmds = Vec::new();
    for (net, ep) in &c.network_settings.networks {
        if Some(net.as_str()) == primary || matches!(net.as_str(), "bridge" | "host" | "none") {
            continue;
        }
        let mut cmd = vec!["network".to_string(), "connect".to_string()];
        if let Some(ip) = ep.static_ipv4() {
            cmd.push("--ip".into());
            cmd.push(ip);
        }
        cmd.push(net.clone());
        cmd.push(name.to_string());
        cmds.push(cmd);
    }
    cmds
}

/// Shell-quote a single argument, leaving "safe" tokens unquoted for a readable
/// command line (matching how Docker Desktop's "Copy docker run" reads).
fn sh_arg(value: &str) -> String {
    let safe = !value.is_empty()
        && value.bytes().all(|b| {
            matches!(b,
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9'
                | b'_' | b'@' | b'%' | b'+' | b'=' | b':' | b',' | b'.' | b'/' | b'-')
        });
    if safe {
        value.to_string()
    } else {
        format!("'{}'", value.replace('\'', "'\\''"))
    }
}

/// Boolean `docker run` flags that take no value.
fn is_bool_flag(tok: &str) -> bool {
    matches!(tok, "-d" | "--privileged" | "-t" | "-i")
}

/// Build a human-readable, multi-line `docker run …` command for a container —
/// one option per line with `\` continuations, matching Docker Desktop's "Copy
/// docker run". Networks beyond the primary are appended as `&& docker network
/// connect …` so the whole thing stays a single pasteable command.
pub fn build_run_command(c: &InspectContainer, image: &str) -> String {
    let args = build_run_args(c, image); // ["run", "-d", "--name", "app", …, image, cmd…]

    let mut header = String::from("docker run");
    let mut lines: Vec<String> = Vec::new();

    let mut i = 1; // skip the leading "run"
    while i < args.len() {
        let tok = &args[i];
        if !tok.starts_with('-') {
            break; // reached the image (positional)
        }
        if tok == "-d" {
            header.push_str(" -d"); // keep detach on the first line, as is conventional
            i += 1;
        } else if is_bool_flag(tok) {
            lines.push(tok.clone());
            i += 1;
        } else if let Some(val) = args.get(i + 1) {
            lines.push(format!("{tok} {}", sh_arg(val)));
            i += 2;
        } else {
            lines.push(tok.clone());
            i += 1;
        }
    }

    // Image + any command/args on a final line.
    if i < args.len() {
        lines.push(
            args[i..]
                .iter()
                .map(|a| sh_arg(a))
                .collect::<Vec<_>>()
                .join(" "),
        );
    }

    // Extra network attachments, chained so they run after the container exists.
    for cmd in build_network_connects(c, c.name.trim_start_matches('/')) {
        lines.push(format!(
            "&& docker {}",
            cmd.iter().map(|a| sh_arg(a)).collect::<Vec<_>>().join(" ")
        ));
    }

    let mut out = header;
    for line in &lines {
        out.push_str(" \\\n  ");
        out.push_str(line);
    }
    out
}

/// Parse the `docker inspect <id>` JSON array and return the single container.
pub fn parse_inspect(json: &str) -> Result<InspectContainer, String> {
    let mut parsed: Vec<InspectContainer> =
        serde_json::from_str(json.trim()).map_err(|e| format!("parse inspect: {e}"))?;
    if parsed.is_empty() {
        return Err("inspect returned no container".into());
    }
    Ok(parsed.remove(0))
}
