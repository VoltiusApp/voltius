//! Running one-shot commands over an SSH session: quoting, starting the
//! command, and collecting its stdout, stderr and exit status.

use crate::commands::sftp::TransferProgress;
use russh::client::{Handle, Msg};
use russh::{Channel, ChannelMsg};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncWrite, AsyncWriteExt};
use tokio_util::sync::CancellationToken;

/// Single-quote a string for a POSIX shell.
pub fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// `sh -c '<script>' x <arg…>`: dynamic values reach the fixed script as `$1…`,
/// quoted exactly once, so the script never has to escape user data.
pub fn sh_c(script: &str, args: &[&str]) -> String {
    let mut cmd = format!("sh -c {} x", shell_quote(script));
    for a in args {
        cmd.push(' ');
        cmd.push_str(&shell_quote(a));
    }
    cmd
}

/// Open a session channel on `handle` and start `cmd` on it.
pub async fn open_exec<H: russh::client::Handler>(
    handle: &Handle<H>,
    cmd: &str,
) -> Result<Channel<Msg>, String> {
    let channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("Channel error: {e}"))?;
    channel
        .exec(true, cmd)
        .await
        .map_err(|e| format!("Exec error: {e}"))?;
    Ok(channel)
}

/// What a finished command printed and how it exited.
pub struct Captured {
    pub stdout: Vec<u8>,
    pub stderr: String,
    pub code: Option<i32>,
}

impl Captured {
    pub fn stdout_text(&self) -> String {
        String::from_utf8_lossy(&self.stdout).into_owned()
    }
}

/// Run `cmd` on `handle` to completion, capturing its output and exit status.
pub async fn run_captured<H: russh::client::Handler>(
    handle: &Handle<H>,
    cmd: &str,
) -> Result<Captured, String> {
    let mut channel = open_exec(handle, cmd).await?;
    let mut stdout = Vec::new();
    let (code, err) = drain_channel(&mut channel, &mut stdout, None, None).await?;
    Ok(Captured {
        stdout,
        stderr: String::from_utf8_lossy(&err).into_owned(),
        code,
    })
}

/// Drain a russh channel until it ends: stdout goes to `out`, stderr is
/// collected, and the exit status is returned alongside it — turning that into
/// an error message is the caller's business, because each caller words it
/// differently. `progress` is `(app, transfer_id, total)` for the callers that
/// stream a transfer; with `token` set, a cancellation between messages aborts
/// the drain.
///
/// The status is `None` when the channel ended without one, which every caller
/// must treat as a failure: reporting a missing status as exit 0 is how a
/// deleted path used to look like a successful command.
///
/// `Eof` is never a stopping point — the exit status follows it — and `Close`
/// only stops the drain once the status has actually arrived, because russh can
/// deliver the two in either order.
pub async fn drain_channel<W: AsyncWrite + Unpin>(
    channel: &mut Channel<Msg>,
    out: &mut W,
    progress: Option<(&AppHandle, &str, u64)>,
    token: Option<&CancellationToken>,
) -> Result<(Option<i32>, Vec<u8>), String> {
    let mut transferred = 0u64;
    let mut err = Vec::new();
    let mut code = None;
    loop {
        if token.is_some_and(|t| t.is_cancelled()) {
            return Err("Transfer cancelled".into());
        }
        match channel.wait().await {
            Some(ChannelMsg::Data { data }) => {
                out.write_all(&data)
                    .await
                    .map_err(|e| format!("Write error: {e}"))?;
                transferred += data.len() as u64;
                if let Some((app, transfer_id, total)) = progress {
                    let _ = app.emit(
                        &format!("sftp-progress-{transfer_id}"),
                        TransferProgress { transferred, total },
                    );
                }
            }
            Some(ChannelMsg::ExtendedData { data, .. }) => err.extend_from_slice(&data),
            Some(ChannelMsg::ExitStatus { exit_status }) => code = Some(exit_status as i32),
            Some(ChannelMsg::Close) if code.is_some() => break,
            None => break,
            _ => {}
        }
    }
    Ok((code, err))
}

/// The error a non-zero — or missing — exit status deserves, or `Ok` when the
/// command succeeded. `stderr` is used when it says anything.
pub fn exit_error(label: &str, code: Option<i32>, stderr: &str) -> Result<(), String> {
    match code {
        Some(0) => Ok(()),
        _ => Err(format!("{label}: {}", exit_detail(code, stderr))),
    }
}

fn exit_detail(code: Option<i32>, stderr: &str) -> String {
    let stderr = stderr.trim();
    if !stderr.is_empty() {
        return stderr.to_string();
    }
    match code {
        Some(c) => format!("exit {c}"),
        None => "no exit status".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_exit_zero_is_a_success() {
        assert_eq!(exit_error("delete failed", Some(0), ""), Ok(()));
        assert_eq!(
            exit_error("delete failed", Some(1), ""),
            Err("delete failed: exit 1".to_string())
        );
    }

    #[test]
    fn a_missing_exit_status_is_a_failure_not_a_success() {
        assert_eq!(
            exit_error("stat failed", None, ""),
            Err("stat failed: no exit status".to_string())
        );
    }

    #[test]
    fn stderr_wins_over_the_bare_exit_code() {
        assert_eq!(
            exit_error("read failed", Some(2), "  No such file\n"),
            Err("read failed: No such file".to_string())
        );
        assert_eq!(
            exit_error("read failed", None, "container is not running\n"),
            Err("read failed: container is not running".to_string())
        );
    }

    #[test]
    fn sh_c_passes_every_value_as_one_quoted_argument() {
        assert_eq!(
            sh_c("chmod \"$1\" -- \"$2\"", &["u+x", "/tmp/it's here"]),
            r#"sh -c 'chmod "$1" -- "$2"' x 'u+x' '/tmp/it'\''s here'"#
        );
    }
}
