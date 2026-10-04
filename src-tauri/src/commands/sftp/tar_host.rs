use super::remote_shell::{detect, wrap, RemoteShell, PROBE_TIMEOUT};
use super::stream::Progress;
use crate::ssh::client::SshClient;
use crate::ssh::exec::run_captured;
use crate::ssh::live_cells::read_cell;
use crate::ssh::session::SessionHandle;
use russh::client::Handle;
use std::sync::Arc;
use tokio::sync::OnceCell;
use tokio_util::task::AbortOnDropHandle;

#[derive(Clone)]
pub struct TarHost {
    handle: SessionHandle,
    container: Option<String>,
    pub shell: RemoteShell,
}

impl TarHost {
    pub fn ssh(&self) -> Arc<Handle<SshClient>> {
        read_cell(&self.handle)
    }

    pub fn wrap(&self, cmd: &str) -> String {
        wrap(self.container.as_deref(), cmd)
    }

    async fn size(&self, parent: &str, items: &[String]) -> Option<u64> {
        let cmd = self.wrap(&self.shell.size_probe(parent, items)?);
        let out = tokio::time::timeout(PROBE_TIMEOUT, run_captured(&self.ssh(), &cmd))
            .await
            .ok()?
            .ok()?;
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

pub struct TarProbe {
    handle: SessionHandle,
    container: Option<String>,
    found: OnceCell<Option<(RemoteShell, bool)>>,
}

impl TarProbe {
    pub fn new(handle: SessionHandle, container: Option<String>) -> Self {
        Self {
            handle,
            container,
            found: OnceCell::new(),
        }
    }

    async fn found(&self) -> Option<(RemoteShell, bool)> {
        self.found
            .get_or_init(|| async {
                detect(&*read_cell(&self.handle), self.container.as_deref()).await
            })
            .await
            .clone()
    }

    pub async fn shell(&self) -> Option<RemoteShell> {
        self.found().await.map(|(shell, _)| shell)
    }

    pub async fn host(&self) -> Option<TarHost> {
        let (shell, streams) = self.found().await?;
        streams.then(|| TarHost {
            handle: Arc::clone(&self.handle),
            container: self.container.clone(),
            shell,
        })
    }
}
