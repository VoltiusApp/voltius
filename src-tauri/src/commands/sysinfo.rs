use crate::ssh::session::SessionManager;
use sysinfo::System;
use tauri::State;
use tokio::io::AsyncReadExt;
use tokio::time::{timeout, Duration};

#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct SystemInfo {
    pub cpu_brand: String,
    pub cpu_cores_physical: usize,
    pub cpu_cores_logical: usize,
    pub mem_total_kb: u64,
    pub os_name: String,
    pub os_version: String,
    pub kernel_version: String,
    pub host_name: String,
    pub arch: String,
    pub gpus: Vec<String>,
}

const REMOTE_SYSTEM_INFO_CMD: &str = r#"
cpu=$(awk -F': ' '/model name|Hardware|Processor/{print $2; exit}' /proc/cpuinfo 2>/dev/null)
logical=$(getconf _NPROCESSORS_ONLN 2>/dev/null || awk -F': ' '/^processor/{n++} END{print n+0}' /proc/cpuinfo 2>/dev/null)
physical=$(awk -F': ' '/^cpu cores/{print $2; exit}' /proc/cpuinfo 2>/dev/null)
[ -n "$physical" ] || physical="$logical"
mem_total=$(awk '/MemTotal:/{print $2; exit}' /proc/meminfo 2>/dev/null)
pretty_name=""
version_id=""
if [ -r /etc/os-release ]; then
  . /etc/os-release
fi
printf 'CPU: %s\n' "$cpu"
printf 'PHYSICAL_CORES: %s\n' "$physical"
printf 'LOGICAL_CORES: %s\n' "$logical"
printf 'MemTotal: %s kB\n' "$mem_total"
printf 'PRETTY_NAME="%s"\n' "$PRETTY_NAME"
printf 'VERSION_ID="%s"\n' "$VERSION_ID"
printf 'KERNEL_ARCH: %s\n' "$(uname -srm 2>/dev/null)"
printf 'HOSTNAME: %s\n' "$(hostname 2>/dev/null)"
printf 'ARCH: %s\n' "$(uname -m 2>/dev/null)"
if command -v lspci >/dev/null 2>&1; then
  lspci 2>/dev/null | grep -iE '(VGA|3D|Display) compatible' | while IFS= read -r line; do
    gpu=${line#*: }
    gpu=${gpu#*: }
    [ -n "$gpu" ] && printf 'GPU: %s\n' "$gpu"
  done
fi
"#;

#[cfg(target_os = "windows")]
const WINDOWS_CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(target_os = "windows")]
fn windows_hidden_child_process_flags() -> u32 {
    WINDOWS_CREATE_NO_WINDOW
}

#[cfg(target_os = "windows")]
fn prevent_visible_child_window(command: &mut std::process::Command) {
    use std::os::windows::process::CommandExt;

    command.creation_flags(windows_hidden_child_process_flags());
}

fn detect_gpus() -> Vec<String> {
    #[cfg(target_os = "linux")]
    {
        if let Ok(output) = std::process::Command::new("sh")
            .args([
                "-c",
                "lspci 2>/dev/null | grep -iE '(VGA|3D|Display) compatible'",
            ])
            .output()
        {
            let text = String::from_utf8_lossy(&output.stdout);
            let gpus: Vec<String> = text
                .lines()
                .filter_map(|l| {
                    // lspci format: "00:02.0 VGA compatible controller: Intel HD Graphics 620 (rev 02)"
                    l.splitn(2, ':')
                        .nth(1)
                        .and_then(|s| s.splitn(2, ':').nth(1))
                        .map(|s| s.trim().to_string())
                })
                .filter(|s| !s.is_empty())
                .collect();
            if !gpus.is_empty() {
                return gpus;
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Ok(output) = std::process::Command::new("sh")
            .args([
                "-c",
                "system_profiler SPDisplaysDataType 2>/dev/null | grep 'Chipset Model'",
            ])
            .output()
        {
            let text = String::from_utf8_lossy(&output.stdout);
            let gpus: Vec<String> = text
                .lines()
                .filter_map(|l| l.splitn(2, ':').nth(1))
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
            if !gpus.is_empty() {
                return gpus;
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        let mut command = std::process::Command::new("powershell");
        command.args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Get-WmiObject Win32_VideoController | ForEach-Object { $_.Name }",
        ]);
        prevent_visible_child_window(&mut command);

        if let Ok(output) = command.output() {
            let text = String::from_utf8_lossy(&output.stdout);
            let gpus: Vec<String> = text
                .lines()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
            if !gpus.is_empty() {
                return gpus;
            }
        }
    }

    vec![]
}

#[tauri::command]
pub fn get_system_info() -> SystemInfo {
    let mut sys = System::new();
    sys.refresh_cpu_all();
    sys.refresh_memory();

    let cpu_brand = sys
        .cpus()
        .first()
        .map(|c| c.brand().to_string())
        .unwrap_or_default();

    let cpu_cores_logical = sys.cpus().len();
    let cpu_cores_physical = sys.physical_core_count().unwrap_or(cpu_cores_logical);

    SystemInfo {
        cpu_brand,
        cpu_cores_physical,
        cpu_cores_logical,
        mem_total_kb: sys.total_memory() / 1024,
        os_name: System::name().unwrap_or_default(),
        os_version: System::os_version().unwrap_or_default(),
        kernel_version: System::kernel_version().unwrap_or_default(),
        host_name: System::host_name().unwrap_or_default(),
        arch: System::cpu_arch(),
        gpus: detect_gpus(),
    }
}

#[tauri::command]
pub async fn get_connected_system_info(
    session_manager: State<'_, SessionManager>,
    session_id: String,
    session_type: String,
    session_name: Option<String>,
) -> Result<SystemInfo, String> {
    match session_type.as_str() {
        "ssh" => get_remote_system_info(session_manager, &session_id).await,
        "local" => Ok(get_system_info()),
        "serial" => Ok(SystemInfo {
            host_name: session_name.unwrap_or_else(|| "Serial".to_string()),
            ..SystemInfo::default()
        }),
        other => Err(format!("Unsupported session type: {other}")),
    }
}

async fn get_remote_system_info(
    session_manager: State<'_, SessionManager>,
    session_id: &str,
) -> Result<SystemInfo, String> {
    let handle = session_manager.get_handle(session_id).await?;
    let channel: russh::Channel<russh::client::Msg> = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("Channel error: {e}"))?;

    channel
        .exec(true, REMOTE_SYSTEM_INFO_CMD)
        .await
        .map_err(|e| format!("Exec error: {e}"))?;

    let mut stream = channel.into_stream();
    let mut output = Vec::new();

    let _ = timeout(Duration::from_secs(5), async {
        let mut buf = [0u8; 4096];
        loop {
            match stream.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => output.extend_from_slice(&buf[..n]),
            }
        }
    })
    .await;

    let text = String::from_utf8_lossy(&output);
    Ok(parse_remote_system_info(&text))
}

fn parse_remote_system_info(text: &str) -> SystemInfo {
    let mut info = SystemInfo::default();

    for line in text.lines() {
        if let Some(v) = line.strip_prefix("CPU: ") {
            info.cpu_brand = v.trim().to_string();
        } else if let Some(v) = line.strip_prefix("PHYSICAL_CORES: ") {
            info.cpu_cores_physical = v.trim().parse().unwrap_or(0);
        } else if let Some(v) = line.strip_prefix("LOGICAL_CORES: ") {
            info.cpu_cores_logical = v.trim().parse().unwrap_or(0);
        } else if line.starts_with("MemTotal:") {
            info.mem_total_kb = line
                .split_whitespace()
                .nth(1)
                .and_then(|s| s.parse().ok())
                .unwrap_or(0);
        } else if let Some(v) = line.strip_prefix("PRETTY_NAME=") {
            info.os_name = trim_shell_value(v);
        } else if let Some(v) = line.strip_prefix("VERSION_ID=") {
            info.os_version = trim_shell_value(v);
        } else if let Some(v) = line.strip_prefix("KERNEL_ARCH: ") {
            let parts: Vec<&str> = v.splitn(3, ' ').collect();
            if parts.len() == 3 {
                info.kernel_version = parts[1].to_string();
                if info.arch.is_empty() {
                    info.arch = parts[2].trim().to_string();
                }
            }
        } else if let Some(v) = line.strip_prefix("HOSTNAME: ") {
            info.host_name = v.trim().to_string();
        } else if let Some(v) = line.strip_prefix("ARCH: ") {
            info.arch = v.trim().to_string();
        } else if let Some(v) = line.strip_prefix("GPU: ") {
            let gpu = v.trim();
            if !gpu.is_empty() {
                info.gpus.push(gpu.to_string());
            }
        }
    }

    info
}

fn trim_shell_value(value: &str) -> String {
    value.trim().trim_matches('"').to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_remote_system_info_output() {
        let output = r#"CPU: AMD Ryzen 7 7840U with Radeon 780M Graphics
PHYSICAL_CORES: 8
LOGICAL_CORES: 16
MemTotal:       32768000 kB
PRETTY_NAME="Ubuntu 24.04.2 LTS"
VERSION_ID="24.04"
KERNEL_ARCH: Linux 6.8.0-59-generic x86_64
HOSTNAME: remote-box
ARCH: x86_64
GPU: NVIDIA Corporation GA104 [GeForce RTX 3070]
GPU: Advanced Micro Devices, Inc. [AMD/ATI] Phoenix1
"#;

        let info = parse_remote_system_info(output);

        assert_eq!(
            info.cpu_brand,
            "AMD Ryzen 7 7840U with Radeon 780M Graphics"
        );
        assert_eq!(info.cpu_cores_physical, 8);
        assert_eq!(info.cpu_cores_logical, 16);
        assert_eq!(info.mem_total_kb, 32_768_000);
        assert_eq!(info.os_name, "Ubuntu 24.04.2 LTS");
        assert_eq!(info.os_version, "24.04");
        assert_eq!(info.kernel_version, "6.8.0-59-generic");
        assert_eq!(info.host_name, "remote-box");
        assert_eq!(info.arch, "x86_64");
        assert_eq!(
            info.gpus,
            vec![
                "NVIDIA Corporation GA104 [GeForce RTX 3070]".to_string(),
                "Advanced Micro Devices, Inc. [AMD/ATI] Phoenix1".to_string(),
            ]
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_child_processes_are_configured_without_visible_windows() {
        assert_eq!(windows_hidden_child_process_flags(), 0x08000000);
    }
}
