#![cfg(unix)]

use crate::port_forward::test_ssh::{serve_one, TestClient};
use bytes::Bytes;
use russh::server::{Auth, ChannelOpenHandle, Msg as ServerMsg, Session};
use russh::{Channel, ChannelId};
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::ChildStdin;
use tokio::sync::Mutex;

#[derive(Clone, Copy)]
pub struct ProcOptions {
    pub crlf: bool,
    pub exit_status: bool,
    pub window: Option<u32>,
    pub refuse_channels: usize,
}

impl Default for ProcOptions {
    fn default() -> Self {
        Self {
            crlf: false,
            exit_status: true,
            window: None,
            refuse_channels: 0,
        }
    }
}

#[derive(Default)]
pub struct ProcLog {
    pub ran: Vec<String>,
    pub exited: usize,
}

struct ProcServer {
    opts: ProcOptions,
    refused: usize,
    log: Arc<std::sync::Mutex<ProcLog>>,
    stdins: Arc<Mutex<HashMap<ChannelId, ChildStdin>>>,
}

fn crlf(chunk: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(chunk.len());
    for &b in chunk {
        if b == b'\n' {
            out.push(b'\r');
        }
        out.push(b);
    }
    out
}

impl russh::server::Handler for ProcServer {
    type Error = russh::Error;

    async fn auth_none(&mut self, _user: &str) -> Result<Auth, Self::Error> {
        Ok(Auth::Accept)
    }

    async fn channel_open_session(
        &mut self,
        _channel: Channel<ServerMsg>,
        reply: ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        if self.refused < self.opts.refuse_channels {
            self.refused += 1;
            reply
                .reject(russh::ChannelOpenFailure::ResourceShortage)
                .await;
        } else {
            reply.accept().await;
        }
        Ok(())
    }

    async fn exec_request(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        let cmd = String::from_utf8_lossy(data).into_owned();
        self.log.lock().unwrap().ran.push(cmd.clone());
        session.channel_success(channel)?;
        let mut child = tokio::process::Command::new("sh")
            .args(["-c", &cmd])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn sh");
        self.stdins
            .lock()
            .await
            .insert(channel, child.stdin.take().unwrap());
        let (mut out, mut err) = (child.stdout.take().unwrap(), child.stderr.take().unwrap());
        let (handle, opts, log) = (session.handle(), self.opts, self.log.clone());
        tokio::spawn(async move {
            let errs = handle.clone();
            let err_task = tokio::spawn(async move {
                let mut b = vec![0u8; 8192];
                while let Ok(n @ 1..) = err.read(&mut b).await {
                    let _ = errs
                        .extended_data(channel, 1, Bytes::copy_from_slice(&b[..n]))
                        .await;
                }
            });
            let mut b = vec![0u8; 32 * 1024];
            while let Ok(n @ 1..) = out.read(&mut b).await {
                let chunk = if opts.crlf {
                    crlf(&b[..n])
                } else {
                    b[..n].to_vec()
                };
                if handle.data(channel, Bytes::from(chunk)).await.is_err() {
                    break;
                }
            }
            let _ = err_task.await;
            let code = child
                .wait()
                .await
                .ok()
                .and_then(|s| s.code())
                .unwrap_or(255);
            log.lock().unwrap().exited += 1;
            if opts.exit_status {
                let _ = handle.exit_status_request(channel, code as u32).await;
            }
            let _ = handle.eof(channel).await;
            let _ = handle.close(channel).await;
        });
        Ok(())
    }

    async fn data(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        if let Some(stdin) = self.stdins.lock().await.get_mut(&channel) {
            let _ = stdin.write_all(data).await;
        }
        Ok(())
    }

    async fn channel_eof(
        &mut self,
        channel: ChannelId,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.stdins.lock().await.remove(&channel);
        Ok(())
    }

    async fn channel_close(
        &mut self,
        channel: ChannelId,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.stdins.lock().await.remove(&channel);
        Ok(())
    }
}

pub async fn proc_server(
    opts: ProcOptions,
) -> (
    Arc<russh::client::Handle<TestClient>>,
    Arc<std::sync::Mutex<ProcLog>>,
) {
    let log = Arc::new(std::sync::Mutex::new(ProcLog::default()));
    let server = ProcServer {
        opts,
        refused: 0,
        log: log.clone(),
        stdins: Arc::default(),
    };
    let mut config = russh::server::Config::default();
    if let Some(window) = opts.window {
        config.window_size = window;
    }
    let port = serve_one(config, server).await;
    let mut handle = russh::client::connect(Default::default(), ("127.0.0.1", port), TestClient)
        .await
        .unwrap();
    assert!(handle.authenticate_none("test").await.unwrap().success());
    (Arc::new(handle), log)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::ssh::exec::{drain_channel, open_exec, run_captured, run_captured_with_stdin};

    #[tokio::test]
    async fn runs_the_command_with_its_stdio() {
        let (handle, log) = proc_server(ProcOptions::default()).await;
        let out = run_captured_with_stdin(
            &handle,
            "tr a-z A-Z; echo oops >&2; exit 3",
            Some(&b"hi\n"[..]),
        )
        .await
        .unwrap();
        assert_eq!(out.stdout, b"HI\n");
        assert_eq!(out.stderr.trim(), "oops");
        assert_eq!(out.code, Some(3));
        assert_eq!(
            log.lock().unwrap().ran,
            ["tr a-z A-Z; echo oops >&2; exit 3"]
        );
    }

    #[tokio::test]
    async fn a_split_channel_drains_its_read_half() {
        let (handle, _) = proc_server(ProcOptions::default()).await;
        let (mut rx, _tx) = open_exec(&handle, "printf abc").await.unwrap().split();
        let mut out = Vec::new();
        let mut seen = 0usize;
        let mut on_data = |c: &[u8]| seen += c.len();
        let (code, _) = drain_channel(&mut rx, &mut out, Some(&mut on_data), None)
            .await
            .unwrap();
        assert_eq!((code, out.as_slice(), seen), (Some(0), &b"abc"[..], 3));
    }

    #[tokio::test]
    async fn cancelling_interrupts_a_silent_command() {
        let (handle, _) = proc_server(ProcOptions::default()).await;
        let mut channel = open_exec(&handle, "sleep 30").await.unwrap();
        let token = tokio_util::sync::CancellationToken::new();
        let t = token.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            t.cancel();
        });
        let r = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            drain_channel(&mut channel, &mut tokio::io::sink(), None, Some(&token)),
        )
        .await
        .expect("cancel did not interrupt the wait");
        assert_eq!(r.unwrap_err(), "Transfer cancelled");
    }

    #[tokio::test]
    async fn stderr_keeps_only_its_tail() {
        let (handle, _) = proc_server(ProcOptions::default()).await;
        let out = run_captured(
            &handle,
            "head -c 100000 /dev/zero | tr '\\0' x >&2; echo END >&2",
        )
        .await
        .unwrap();
        assert!(out.stderr.ends_with("END\n"));
        assert!(out.stderr.len() <= 16 * 1024);
    }

    #[tokio::test]
    async fn crlf_mode_rewrites_stdout() {
        let (handle, _) = proc_server(ProcOptions {
            crlf: true,
            ..Default::default()
        })
        .await;
        let out = run_captured(&handle, "printf 'a\\nb'").await.unwrap();
        assert_eq!(out.stdout, b"a\r\nb");
    }

    #[tokio::test]
    async fn exit_status_can_be_withheld() {
        let (handle, _) = proc_server(ProcOptions {
            exit_status: false,
            ..Default::default()
        })
        .await;
        let out = run_captured(&handle, "true").await.unwrap();
        assert_eq!(out.code, None);
    }
}
