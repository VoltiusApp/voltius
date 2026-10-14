//! Running one-shot commands over an SSH session: quoting, starting the
//! command, and collecting its stdout, stderr and exit status.

use russh::client::{Handle, Msg};
use russh::{Channel, ChannelMsg, ChannelReadHalf};
use std::future::Future;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio_util::sync::CancellationToken;

const STDERR_KEEP: usize = 16 * 1024;

pub type OnData<'a> = dyn FnMut(&[u8]) + Send + 'a;

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

/// The prefix that runs a host command line inside `container`, stdin attached.
pub fn docker_exec(container: &str) -> String {
    format!("docker exec -i {}", shell_quote(container))
}

/// The prefix that runs a Proxmox host command line inside LXC `vmid`.
pub fn pct_exec(vmid: u32) -> String {
    format!("pct exec {vmid} --")
}

/// `argv`, a host command line, run where `inside` puts it: behind a prefix such as
/// `docker exec -i <id>` or `pct exec <vmid> --`, or on the host itself.
pub fn run_in(inside: Option<&str>, argv: &str) -> String {
    match inside {
        Some(prefix) => format!("{prefix} {argv}"),
        None => argv.to_string(),
    }
}

/// `cmd`, written in the session's dialect, run where `inside` puts it; a container runs it through its `sh`.
pub fn wrap(inside: Option<&str>, cmd: &str) -> String {
    match inside {
        Some(_) => run_in(inside, &format!("sh -c {}", shell_quote(cmd))),
        None => cmd.to_string(),
    }
}

/// The prefix `inner` run behind `outer`. `inner` may hold shell syntax, which `outer`'s shell expands.
pub fn nest(outer: Option<&str>, inner: String) -> String {
    match outer {
        Some(_) => run_in(outer, &sh_c(&format!("{inner} \"$@\""), &[])),
        None => inner,
    }
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

/// Stdout of an exec'd `channel` until it ends or `limit` passes, and whether it ended in time.
pub async fn collect_stdout(channel: Channel<Msg>, limit: Duration) -> (Vec<u8>, bool) {
    let mut stream = channel.into_stream();
    let mut out = Vec::new();
    let completed = tokio::time::timeout(limit, async {
        let mut buf = [0u8; 16384];
        loop {
            match stream.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => out.extend_from_slice(&buf[..n]),
            }
        }
    })
    .await
    .is_ok();
    (out, completed)
}

/// What `cmd` printed on stdout before it ended or `limit` passed. Its exit status is ignored.
pub async fn stdout_within<H: russh::client::Handler>(
    handle: &Handle<H>,
    cmd: &str,
    limit: Duration,
) -> Result<String, String> {
    let (out, _) = collect_stdout(open_exec(handle, cmd).await?, limit).await;
    Ok(String::from_utf8_lossy(&out).into_owned())
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
    run_captured_with_stdin(handle, cmd, None).await
}

pub async fn run_captured_with_stdin<H: russh::client::Handler>(
    handle: &Handle<H>,
    cmd: &str,
    stdin: Option<&[u8]>,
) -> Result<Captured, String> {
    let mut channel = open_exec(handle, cmd).await?;
    if let Some(input) = stdin {
        channel
            .data(input)
            .await
            .map_err(|e| format!("Write error: {e}"))?;
        channel
            .eof()
            .await
            .map_err(|e| format!("Write error: {e}"))?;
    }
    let mut stdout = Vec::new();
    let (code, err) = drain_channel(&mut channel, &mut stdout, None, None).await?;
    Ok(Captured {
        stdout,
        stderr: String::from_utf8_lossy(&err).into_owned(),
        code,
    })
}

pub trait MsgSource: Send {
    fn wait(&mut self) -> impl Future<Output = Option<ChannelMsg>> + Send;
}

impl MsgSource for Channel<Msg> {
    fn wait(&mut self) -> impl Future<Output = Option<ChannelMsg>> + Send {
        Channel::wait(self)
    }
}

impl MsgSource for ChannelReadHalf {
    fn wait(&mut self) -> impl Future<Output = Option<ChannelMsg>> + Send {
        ChannelReadHalf::wait(self)
    }
}

/// Drain a russh channel until it ends: stdout goes to `out`, stderr is
/// collected, and the exit status is returned alongside it — turning that into
/// an error message is the caller's business, because each caller words it
/// differently. `on_data` sees every stdout chunk after it is written. With
/// `token` set, a cancellation aborts the drain, even during a silent wait.
///
/// The status is `None` when the channel ended without one, which every caller
/// must treat as a failure: reporting a missing status as exit 0 is how a
/// deleted path used to look like a successful command.
///
/// `Eof` is never a stopping point — the exit status follows it — and `Close`
/// only stops the drain once the status has actually arrived, because russh can
/// deliver the two in either order.
pub async fn drain_channel<C: MsgSource, W: AsyncWrite + Unpin>(
    channel: &mut C,
    out: &mut W,
    mut on_data: Option<&mut OnData<'_>>,
    token: Option<&CancellationToken>,
) -> Result<(Option<i32>, Vec<u8>), String> {
    let mut err = Vec::new();
    let mut code = None;
    loop {
        let msg = match token {
            Some(t) => tokio::select! {
                biased;
                _ = t.cancelled() => return Err("Transfer cancelled".into()),
                m = channel.wait() => m,
            },
            None => channel.wait().await,
        };
        match msg {
            Some(ChannelMsg::Data { data }) => {
                let write = out.write_all(&data);
                match token {
                    Some(t) => tokio::select! {
                        biased;
                        _ = t.cancelled() => return Err("Transfer cancelled".into()),
                        r = write => r,
                    },
                    None => write.await,
                }
                .map_err(|e| format!("Write error: {e}"))?;
                if let Some(f) = on_data.as_mut() {
                    f(&data);
                }
            }
            Some(ChannelMsg::ExtendedData { data, .. }) => {
                err.extend_from_slice(&data);
                let excess = err.len().saturating_sub(STDERR_KEEP);
                err.drain(..excess);
            }
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
    fn container_commands_run_inside_sh() {
        assert_eq!(wrap(None, "tar -xzf - -O"), "tar -xzf - -O");
        assert_eq!(
            wrap(Some(&docker_exec("ab c")), "tar -xzf - -O"),
            "docker exec -i 'ab c' sh -c 'tar -xzf - -O'"
        );
        assert_eq!(
            wrap(Some("pct exec 7 --"), "tar -xzf - -O"),
            "pct exec 7 -- sh -c 'tar -xzf - -O'"
        );
    }

    #[test]
    fn a_nested_prefix_expands_inside_the_outer_one() {
        assert_eq!(nest(None, docker_exec("c")), "docker exec -i 'c'");
        let nested = nest(Some("pct exec 7 --"), "x \"$(id -u)\"".into());
        assert_eq!(nested, r#"pct exec 7 -- sh -c 'x "$(id -u)" "$@"' x"#);
        assert_eq!(
            run_in(Some(&nested), "ls -l"),
            r#"pct exec 7 -- sh -c 'x "$(id -u)" "$@"' x ls -l"#
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_nested_prefix_passes_every_argument_through() {
        let nested = nest(Some("env"), "printf '[%s]'".into());
        let cmd = run_in(Some(&nested), &sh_c("printf '%s' \"$1\"", &["a b'c"]));
        let out = std::process::Command::new("sh")
            .arg("-c")
            .arg(&cmd)
            .output()
            .unwrap();
        assert_eq!(
            String::from_utf8_lossy(&out.stdout),
            "[sh][-c][printf '%s' \"$1\"][x][a b'c]"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_command_runs_behind_a_nested_prefix_over_ssh() {
        use crate::ssh::test_proc_server::{proc_server, ProcOptions};
        let (handle, _) = proc_server(ProcOptions::default()).await;
        let inside = nest(Some("env OUTER=1"), "env INNER=2".into());
        let cmd = wrap(Some(&inside), "echo \"$OUTER$INNER\"");
        let out = stdout_within(&handle, &cmd, Duration::from_secs(5)).await;
        assert_eq!(out, Ok("12\n".to_string()));
    }

    #[test]
    fn sh_c_passes_every_value_as_one_quoted_argument() {
        assert_eq!(
            sh_c("chmod \"$1\" -- \"$2\"", &["u+x", "/tmp/it's here"]),
            r#"sh -c 'chmod "$1" -- "$2"' x 'u+x' '/tmp/it'\''s here'"#
        );
    }
}
