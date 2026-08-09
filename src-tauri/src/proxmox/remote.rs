use std::sync::Arc;
use tokio::time::{timeout, Duration};

use super::types::{parse_lxc_list, parse_lxc_snapshots, LxcAction, LxcContainer, LxcSnapshot};
use crate::ssh::client::SshClient;

type SshHandle = Arc<russh::client::Handle<SshClient>>;

const DEFAULT_EXEC_TIMEOUT: Duration = Duration::from_secs(15);
const LONG_EXEC_TIMEOUT: Duration = Duration::from_secs(60);

async fn exec_command(handle: &SshHandle, cmd: &str) -> Result<String, String> {
    exec_command_timeout(handle, cmd, DEFAULT_EXEC_TIMEOUT).await
}

/// Turn a finished exec into a result. `pct` reports every failure through the
/// exit status — "snapshot feature is not available" and friends are ordinary
/// output otherwise, so ignoring the status reports a no-op as a success and an
/// agent acts on a snapshot that was never taken.
///
/// A channel that closes without ever sending an exit status is treated as
/// success: not every server sends one, and the previous behaviour was to
/// accept whatever arrived.
fn exec_result(
    cmd: &str,
    code: Option<u32>,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
) -> Result<String, String> {
    let out = String::from_utf8_lossy(&stdout).to_string();
    match code {
        Some(0) | None => Ok(out),
        Some(status) => {
            let err = String::from_utf8_lossy(&stderr);
            let detail = if err.trim().is_empty() {
                out.trim()
            } else {
                err.trim()
            };
            if detail.is_empty() {
                Err(format!("`{cmd}` failed with exit status {status}"))
            } else {
                Err(format!(
                    "`{cmd}` failed with exit status {status}: {detail}"
                ))
            }
        }
    }
}

async fn exec_command_timeout(
    handle: &SshHandle,
    cmd: &str,
    limit: Duration,
) -> Result<String, String> {
    let mut channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("channel error: {e}"))?;

    channel
        .exec(true, cmd)
        .await
        .map_err(|e| format!("exec error: {e}"))?;

    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let mut code = None;

    // Read to Close rather than Eof: the exit status usually follows Eof, and
    // breaking there is what loses it.
    let _ = timeout(limit, async {
        while let Some(msg) = channel.wait().await {
            match msg {
                russh::ChannelMsg::Data { ref data } => stdout.extend_from_slice(data),
                russh::ChannelMsg::ExtendedData { ref data, .. } => stderr.extend_from_slice(data),
                russh::ChannelMsg::ExitStatus { exit_status } => code = Some(exit_status),
                russh::ChannelMsg::Close => break,
                _ => {}
            }
        }
    })
    .await;

    exec_result(cmd, code, stdout, stderr)
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

#[cfg(test)]
mod tests {
    use super::exec_result;

    #[test]
    fn a_zero_exit_returns_stdout() {
        let r = exec_result("pct list", Some(0), b"VMID 100\n".to_vec(), Vec::new());
        assert_eq!(r.unwrap(), "VMID 100\n");
    }

    #[test]
    fn a_missing_exit_status_is_still_accepted() {
        let r = exec_result("pct list", None, b"VMID 100\n".to_vec(), Vec::new());
        assert_eq!(r.unwrap(), "VMID 100\n");
    }

    /// The live-gate bug: `pct snapshot` on storage without snapshot support
    /// exits 255 and this used to be reported as a successful no-op.
    #[test]
    fn a_nonzero_exit_is_an_error_carrying_stderr() {
        let r = exec_result(
            "pct snapshot 107 'mcpgate'",
            Some(255),
            Vec::new(),
            b"snapshot feature is not available\n".to_vec(),
        );
        let e = r.unwrap_err();
        assert!(e.contains("exit status 255"), "{e}");
        assert!(e.contains("snapshot feature is not available"), "{e}");
    }

    #[test]
    fn a_nonzero_exit_falls_back_to_stdout_when_stderr_is_empty() {
        let r = exec_result(
            "pct rollback 1 'x'",
            Some(2),
            b"boom\n".to_vec(),
            Vec::new(),
        );
        assert!(r.unwrap_err().contains("boom"));
    }

    #[test]
    fn a_nonzero_exit_with_no_output_still_names_the_status() {
        let r = exec_result("pct start 9", Some(1), Vec::new(), Vec::new());
        assert_eq!(r.unwrap_err(), "`pct start 9` failed with exit status 1");
    }
}
