//! The SSH link an SFTP session rides: how to reopen it, whether it is dead,
//! and waiting (bounded, cancellable) for a reconnect to swap in a live one.

use super::real::SftpOpener;
use crate::error::{AppError, ErrorCode};
use crate::ssh::client::SshClient;
use crate::ssh::live_cells::{read_cell, Cell};
use russh::client::{Handle, Handler};
use russh_sftp::client::error::Error as SftpError;
use russh_sftp::client::SftpSession;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use tokio::time::{timeout, Instant};
use tokio_util::sync::CancellationToken;

pub const LINK_POLL: Duration = Duration::from_secs(1);
pub const LINK_PROBE: Duration = Duration::from_secs(5);

pub struct SftpLink<H: Handler = SshClient> {
    pub handle: Cell<Arc<Handle<H>>>,
    pub opener: SftpOpener,
    pub closed: CancellationToken,
}

/// True when the transport under the session is gone (closed writer, unanswered request),
/// as opposed to the server refusing one operation: the fix is a new channel.
pub(crate) fn is_transport_dead(e: &SftpError) -> bool {
    match e {
        SftpError::Status(_) | SftpError::Limited(_) => false,
        SftpError::IO(_) | SftpError::Timeout | SftpError::UnexpectedPacket => true,
        SftpError::UnexpectedBehavior(msg) => {
            msg.contains("session closed")
                || msg.contains("SendError")
                || msg.contains("RecvError")
                || msg.contains("EOF")
        }
    }
}

/// Open a fresh SFTP session on `handle` the same way the original was opened.
pub async fn open_sftp<H: Handler>(
    handle: &Handle<H>,
    opener: &SftpOpener,
) -> Result<SftpSession, String> {
    let channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("Channel error: {e}"))?;
    match opener {
        SftpOpener::Subsystem => channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(|e| format!("SFTP subsystem error: {e}"))?,
        SftpOpener::Exec(cmd) => channel
            .exec(true, cmd.as_str())
            .await
            .map_err(|e| format!("Exec error: {e}"))?,
    }
    SftpSession::new(channel.into_stream())
        .await
        .map_err(|e| format!("SFTP session error: {e}"))
}

/// The lock and the round trip both count against the caller's timeout.
async fn answers(session: &Mutex<SftpSession>) -> Result<(), SftpError> {
    session.lock().await.canonicalize(".").await.map(|_| ())
}

impl<H: Handler> SftpLink<H> {
    pub async fn open(&self) -> Result<SftpSession, String> {
        let handle = read_cell(&self.handle);
        open_sftp(&handle, &self.opener).await
    }

    /// False for an exec'd sftp-server (a container): the host shell sees other paths.
    pub fn host_shell(&self) -> bool {
        matches!(self.opener, SftpOpener::Subsystem)
    }

    pub fn closed_now(&self) -> bool {
        read_cell(&self.handle).is_closed()
    }

    pub async fn dead(&self, session: &Mutex<SftpSession>) -> bool {
        if self.closed_now() {
            return true;
        }
        match timeout(LINK_PROBE, answers(session)).await {
            Ok(Ok(())) => false,
            Ok(Err(e)) => is_transport_dead(&e),
            Err(_) => true,
        }
    }

    async fn revive(&self, session: &Mutex<SftpSession>) -> bool {
        if self.closed_now() {
            return false;
        }
        if matches!(timeout(LINK_PROBE, answers(session)).await, Ok(Ok(()))) {
            return true;
        }
        let Ok(Ok(fresh)) = timeout(LINK_PROBE, self.open()).await else {
            return false;
        };
        match timeout(LINK_PROBE, session.lock()).await {
            Ok(mut sftp) => {
                *sftp = fresh;
                true
            }
            Err(_) => false,
        }
    }

    pub async fn wait(
        &self,
        session: &Mutex<SftpSession>,
        token: &CancellationToken,
        deadline: Instant,
    ) -> Result<(), AppError> {
        loop {
            let step = async {
                if self.revive(session).await {
                    return true;
                }
                tokio::time::sleep(LINK_POLL).await;
                false
            };
            tokio::select! {
                biased;
                _ = token.cancelled() => return Err("Transfer cancelled".into()),
                _ = self.closed.cancelled() => return Err("SFTP session closed".into()),
                _ = tokio::time::sleep_until(deadline) => {
                    return Err(AppError::coded(
                        ErrorCode::ConnectionLost,
                        "Connection lost; the partial copy is kept for Retry",
                    ))
                }
                alive = step => if alive {
                    return Ok(());
                },
            }
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::port_forward::test_ssh::TestClient;
    use crate::ssh::live_cells::own_cell;
    use crate::ssh::test_proc_server::{proc_server, ProcOptions};
    use std::time::Duration;
    use tokio::time::Instant;

    async fn linked(opts: ProcOptions) -> (Arc<SftpLink<TestClient>>, Mutex<SftpSession>) {
        let (handle, _) = proc_server(opts).await;
        let link = Arc::new(SftpLink {
            handle: own_cell(handle),
            opener: SftpOpener::Subsystem,
            closed: CancellationToken::new(),
        });
        let session = Mutex::new(link.open().await.unwrap());
        (link, session)
    }

    async fn kill(link: &SftpLink<TestClient>) {
        let h = read_cell(&link.handle);
        let _ = h
            .disconnect(russh::Disconnect::ByApplication, "", "en")
            .await;
        while !h.is_closed() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }

    #[tokio::test]
    async fn a_live_link_is_not_dead_and_a_dropped_one_is() {
        let (link, session) = linked(ProcOptions::default()).await;
        assert!(!link.dead(&session).await);
        kill(&link).await;
        assert!(link.dead(&session).await);
    }

    #[tokio::test]
    async fn waiting_returns_once_a_live_handle_is_swapped_in() {
        let (link, session) = linked(ProcOptions::default()).await;
        kill(&link).await;
        let swap = {
            let link = Arc::clone(&link);
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(300)).await;
                let (fresh, _) = proc_server(ProcOptions::default()).await;
                *link.handle.write().unwrap() = fresh;
            })
        };
        let deadline = Instant::now() + Duration::from_secs(10);
        link.wait(&session, &CancellationToken::new(), deadline)
            .await
            .unwrap();
        swap.await.unwrap();
        assert!(session.lock().await.canonicalize(".").await.is_ok());
    }

    #[tokio::test]
    async fn waiting_ends_on_cancel_close_or_deadline() {
        let (link, session) = linked(ProcOptions::default()).await;
        kill(&link).await;
        let token = CancellationToken::new();
        token.cancel();
        let far = Instant::now() + Duration::from_secs(60);
        let e = link.wait(&session, &token, far).await.unwrap_err();
        assert!(e.to_string().contains("cancelled"));

        let soon = Instant::now() + Duration::from_millis(200);
        let e = link
            .wait(&session, &CancellationToken::new(), soon)
            .await
            .unwrap_err();
        assert_eq!(e.code(), Some(ErrorCode::ConnectionLost));

        link.closed.cancel();
        let e = link
            .wait(&session, &CancellationToken::new(), far)
            .await
            .unwrap_err();
        assert!(e.to_string().contains("closed"));
    }
}
#[cfg(test)]
mod transport_tests {
    use super::{is_transport_dead, SftpError};
    use russh_sftp::protocol::{Status, StatusCode};

    fn status(code: StatusCode) -> SftpError {
        SftpError::Status(Status {
            id: 1,
            status_code: code,
            error_message: String::new(),
            language_tag: String::new(),
        })
    }

    #[test]
    fn a_refused_operation_is_not_a_dead_transport() {
        assert!(!is_transport_dead(&status(StatusCode::NoSuchFile)));
        assert!(!is_transport_dead(&status(StatusCode::PermissionDenied)));
        assert!(!is_transport_dead(&SftpError::Limited("too big".into())));
    }

    #[test]
    fn a_closed_or_unanswered_session_is_a_dead_transport() {
        assert!(is_transport_dead(&SftpError::UnexpectedBehavior(
            "session closed".into()
        )));
        assert!(is_transport_dead(&SftpError::Timeout));
        assert!(is_transport_dead(&SftpError::IO("broken pipe".into())));
        assert!(is_transport_dead(&SftpError::UnexpectedBehavior(
            "SendError: channel closed".into()
        )));
    }
}
