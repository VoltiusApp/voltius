use std::sync::Arc;
use tokio::io::AsyncReadExt;
use tokio::time::{timeout, Duration};

use super::types::{parse_lxc_list, parse_lxc_snapshots, LxcAction, LxcContainer, LxcSnapshot};
use crate::ssh::client::SshClient;

type SshHandle = Arc<russh::client::Handle<SshClient>>;

const DEFAULT_EXEC_TIMEOUT: Duration = Duration::from_secs(15);
const LONG_EXEC_TIMEOUT: Duration = Duration::from_secs(60);

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

pub async fn list_containers(handle: &SshHandle) -> Result<Vec<LxcContainer>, String> {
    let output = exec_command(handle, "pct list").await?;
    Ok(parse_lxc_list(&output))
}

pub async fn container_action(
    handle: &SshHandle,
    vmid: u32,
    action: &LxcAction,
) -> Result<(), String> {
    let verb = match action {
        LxcAction::Start => "start",
        LxcAction::Stop => "stop",
        LxcAction::Restart => "restart",
    };
    let cmd = format!("pct {verb} {vmid}");
    exec_command_timeout(handle, &cmd, LONG_EXEC_TIMEOUT).await?;
    Ok(())
}

pub async fn list_snapshots(handle: &SshHandle, vmid: u32) -> Result<Vec<LxcSnapshot>, String> {
    let cmd = format!("pct listsnapshot {vmid}");
    let output = exec_command(handle, &cmd).await?;
    Ok(parse_lxc_snapshots(&output))
}

pub async fn snapshot_create(
    handle: &SshHandle,
    vmid: u32,
    snapname: &str,
    description: Option<&str>,
) -> Result<(), String> {
    let desc_flag = description
        .map(|d| format!(" --description {}", shell_quote(d)))
        .unwrap_or_default();
    let cmd = format!("pct snapshot {vmid} {}{desc_flag}", shell_quote(snapname));
    exec_command_timeout(handle, &cmd, LONG_EXEC_TIMEOUT).await?;
    Ok(())
}

pub async fn snapshot_rollback(
    handle: &SshHandle,
    vmid: u32,
    snapname: &str,
) -> Result<(), String> {
    let cmd = format!("pct rollback {vmid} {}", shell_quote(snapname));
    exec_command_timeout(handle, &cmd, LONG_EXEC_TIMEOUT).await?;
    Ok(())
}

pub async fn snapshot_delete(handle: &SshHandle, vmid: u32, snapname: &str) -> Result<(), String> {
    let cmd = format!("pct delsnapshot {vmid} {}", shell_quote(snapname));
    exec_command_timeout(handle, &cmd, LONG_EXEC_TIMEOUT).await?;
    Ok(())
}
