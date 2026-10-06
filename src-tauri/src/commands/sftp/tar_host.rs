use super::remote_shell::{answer, detect, run_in, wrap, RemoteShell, Unreachable};
use super::resume::names::remote_hash;
use super::stream::Progress;
use crate::error::AppError;
use crate::ssh::client::SshClient;
use crate::ssh::exec::run_captured;
use crate::ssh::live_cells::{read_cell, Cell};
use crate::ssh::session::SessionHandle;
use russh::client::{Handle, Handler};
use std::future::Future;
use std::sync::{Arc, Weak};
use std::time::{Duration, Instant};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use tokio_util::task::AbortOnDropHandle;

const RETRY_AFTER: Duration = Duration::from_secs(30);

#[derive(Clone)]
pub struct TarHost {
    handle: SessionHandle,
    inside: Option<String>,
    pub shell: RemoteShell,
}

impl TarHost {
    pub fn ssh(&self) -> Arc<Handle<SshClient>> {
        read_cell(&self.handle)
    }

    pub fn wrap(&self, cmd: &str) -> String {
        wrap(self.inside.as_deref(), cmd)
    }

    async fn size(&self, parent: &str, items: &[String]) -> Option<u64> {
        let cmd = self.wrap(&self.shell.size_probe(parent, items)?);
        let out = answer(run_captured(&self.ssh(), &cmd)).await.ok()?;
        (out.code == Some(0)).then(|| self.shell.parse_size(&out.stdout_text()))?
    }

    pub fn spawn_size(
        &self,
        parent: &str,
        items: &[String],
        progress: Progress,
    ) -> AbortOnDropHandle<()> {
        let (host, parent, items) = (self.clone(), parent.to_string(), items.to_vec());
        AbortOnDropHandle::new(tokio::spawn(async move {
            if let Some(n) = host.size(&parent, &items).await {
                progress.set_total(n);
            }
        }))
    }
}

type Found = Option<(RemoteShell, bool)>;

struct Probed<H: Handler> {
    on: Weak<Handle<H>>,
    found: Result<Found, Instant>,
}

pub struct TarProbe<H: Handler = SshClient> {
    handle: Cell<Arc<Handle<H>>>,
    inside: Option<String>,
    last: Mutex<Option<Probed<H>>>,
}

impl<H: Handler> TarProbe<H> {
    pub fn new(handle: Cell<Arc<Handle<H>>>, inside: Option<String>) -> Self {
        Self {
            handle,
            inside,
            last: Mutex::new(None),
        }
    }

    /// Answers are kept until the session reconnects; a probe that got no answer is retried after `RETRY_AFTER`.
    async fn found(&self) -> Result<Found, Unreachable> {
        let ssh = read_cell(&self.handle);
        let mut last = self.last.lock().await;
        if let Some(p) = last
            .as_ref()
            .filter(|p| Weak::ptr_eq(&p.on, &Arc::downgrade(&ssh)))
        {
            match &p.found {
                Ok(found) => return Ok(found.clone()),
                Err(retry_at) if Instant::now() < *retry_at => return Err(Unreachable),
                Err(_) => {}
            }
        }
        let found = detect(&ssh, self.inside.as_deref()).await;
        *last = Some(Probed {
            on: Arc::downgrade(&ssh),
            found: found.clone().map_err(|_| Instant::now() + RETRY_AFTER),
        });
        found
    }

    pub async fn shell(&self) -> Option<RemoteShell> {
        self.found().await.ok()?.map(|(shell, _)| shell)
    }

    /// A command in the session's dialect, run where the session's files are.
    pub fn wrap(&self, cmd: &str) -> String {
        wrap(self.inside.as_deref(), cmd)
    }

    /// A host command line (such as `sh_c`'s), run where the session's files are.
    pub fn run_in(&self, argv: &str) -> String {
        run_in(self.inside.as_deref(), argv)
    }

    /// `path`'s sha256, computed where the session's files are; None when no shell answers.
    pub async fn hash(
        &self,
        path: &str,
        token: &CancellationToken,
        dead: impl Future<Output = bool>,
    ) -> Result<Option<String>, AppError> {
        let shell = tokio::select! {
            _ = token.cancelled() => return Ok(None),
            shell = self.shell() => shell,
        };
        let Some(shell) = shell else {
            return Ok(None);
        };
        let cmd = self.wrap(&shell.sha256(path));
        remote_hash(&read_cell(&self.handle), &cmd, path, token, dead).await
    }
}

impl TarProbe {
    pub async fn host(&self) -> Result<Option<TarHost>, Unreachable> {
        Ok(self.found().await?.and_then(|(shell, streams)| {
            streams.then(|| TarHost {
                handle: Arc::clone(&self.handle),
                inside: self.inside.clone(),
                shell,
            })
        }))
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::port_forward::test_ssh::TestClient;
    use crate::ssh::exec::docker_exec;
    use crate::ssh::live_cells::own_cell;
    use crate::ssh::test_proc_server::{proc_server, ProcLog, ProcOptions};

    type Log = Arc<std::sync::Mutex<ProcLog>>;

    async fn probe_of(opts: ProcOptions, inside: Option<&str>) -> (TarProbe<TestClient>, Log) {
        let (handle, log) = proc_server(opts).await;
        let probe = TarProbe::new(own_cell(handle), inside.map(str::to_string));
        (probe, log)
    }

    fn runs(log: &Log) -> usize {
        log.lock().unwrap().ran.len()
    }

    const CRLF: ProcOptions = ProcOptions {
        crlf: true,
        exit_status: true,
        window: None,
        refuse_channels: 0,
        drop_after_bytes: None,
        blackhole_after_bytes: None,
    };

    #[tokio::test]
    async fn a_refused_channel_is_retried_once_the_delay_passes() {
        let refusing = ProcOptions {
            refuse_channels: 1,
            ..Default::default()
        };
        let (probe, _) = probe_of(refusing, None).await;
        assert_eq!(probe.found().await, Err(Unreachable));
        assert_eq!(probe.found().await, Err(Unreachable), "retried too soon");
        if let Some(p) = probe.last.lock().await.as_mut() {
            p.found = Err(Instant::now());
        }
        assert_eq!(probe.found().await, Ok(Some((RemoteShell::Posix, true))));
    }

    #[tokio::test]
    async fn a_host_that_answers_no_is_asked_once() {
        let (probe, log) = probe_of(
            ProcOptions::default(),
            Some(&docker_exec("voltius-no-such-container")),
        )
        .await;
        assert_eq!(probe.found().await, Ok(None));
        let asked = runs(&log);
        assert_eq!(probe.found().await, Ok(None));
        assert_eq!(runs(&log), asked);
    }

    #[tokio::test]
    async fn a_host_that_mangles_binary_is_asked_once() {
        let (probe, log) = probe_of(CRLF, None).await;
        assert_eq!(probe.found().await, Ok(Some((RemoteShell::Posix, false))));
        let asked = runs(&log);
        assert_eq!(probe.found().await, Ok(Some((RemoteShell::Posix, false))));
        assert_eq!(runs(&log), asked);
    }

    #[tokio::test]
    async fn a_reconnect_probes_again() {
        let (probe, _) = probe_of(CRLF, None).await;
        assert_eq!(probe.found().await, Ok(Some((RemoteShell::Posix, false))));
        let (fresh, _) = proc_server(ProcOptions::default()).await;
        *probe.handle.write().unwrap() = fresh;
        assert_eq!(probe.found().await, Ok(Some((RemoteShell::Posix, true))));
    }
}
