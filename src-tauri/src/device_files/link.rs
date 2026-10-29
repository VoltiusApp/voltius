use crate::error::{AppError, ErrorCode};
use crate::lan_sync::manager::{FilesDialError, FilesDialer};
use crate::lan_sync::protocol::{FilesReply, FilesRequest, Refusal};
use crate::lan_sync::stream::SessionStream;
use crate::sftp::link::SftpReopen;
use async_trait::async_trait;
use russh_sftp::client::SftpSession;
use std::collections::HashMap;
use std::future::Future;
use std::io;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock, Weak};
use std::task::{Context, Poll};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio_util::sync::{CancellationToken, WaitForCancellationFutureOwned};

// russh_sftp loops forever on any read error but EOF, so every failure and `stop` read as EOF.
pub(crate) struct Wire<G = ()> {
    stream: SessionStream,
    stop: Pin<Box<WaitForCancellationFutureOwned>>,
    _guard: G,
}

impl<G> Wire<G> {
    pub(crate) fn new(stream: SessionStream, stop: CancellationToken, guard: G) -> Self {
        Self {
            stream,
            stop: Box::pin(stop.cancelled_owned()),
            _guard: guard,
        }
    }
}

fn ended() -> io::Error {
    io::ErrorKind::UnexpectedEof.into()
}

impl<G: Unpin> Wire<G> {
    fn live(&mut self, cx: &mut Context<'_>) -> io::Result<Pin<&mut SessionStream>> {
        match self.stop.as_mut().poll(cx) {
            Poll::Ready(()) => Err(ended()),
            Poll::Pending => Ok(Pin::new(&mut self.stream)),
        }
    }
}

impl<G: Unpin> AsyncRead for Wire<G> {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        match self.get_mut().live(cx) {
            Ok(stream) => stream.poll_read(cx, buf).map_err(|_| ended()),
            Err(e) => Poll::Ready(Err(e)),
        }
    }
}

impl<G: Unpin> AsyncWrite for Wire<G> {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        match self.get_mut().live(cx) {
            Ok(stream) => stream.poll_write(cx, buf).map_err(|_| ended()),
            Err(e) => Poll::Ready(Err(e)),
        }
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.get_mut().stream).poll_flush(cx)
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.get_mut().stream).poll_shutdown(cx)
    }
}

#[async_trait]
pub trait FilesSource: Send + Sync {
    async fn dialer(&self) -> Option<FilesDialer>;
}

pub const READ_ONLY_MESSAGE: &str = "device-read-only";

pub type OnClosed = Box<dyn Fn(&str, Option<ErrorCode>) + Send + Sync>;
pub type OnReadOnly = Box<dyn Fn(&str, bool) + Send + Sync>;

pub struct LinkEvents {
    pub closed: OnClosed,
    pub read_only: OnReadOnly,
}

#[derive(Clone, Default, Debug, PartialEq)]
pub struct Pass {
    grant: Option<String>,
    key: Option<String>,
}

pub struct DeviceLink {
    source: Arc<dyn FilesSource>,
    device_id: String,
    pass: Mutex<Pass>,
    opened: AtomicBool,
    read_only: AtomicBool,
    closed: CancellationToken,
    sftp_id: OnceLock<String>,
    events: LinkEvents,
}

fn unreachable(why: impl std::fmt::Display) -> AppError {
    AppError::coded(
        ErrorCode::DeviceUnreachable,
        format!("The device can't be reached: {why}"),
    )
}

pub fn refused(reason: Refusal) -> AppError {
    let (code, message) = match reason {
        Refusal::Off => (
            ErrorCode::DeviceFileAccessOff,
            "File access is off on that device",
        ),
        Refusal::Denied => (ErrorCode::DeviceAccessDenied, "The device denied access"),
        Refusal::TimedOut => (
            ErrorCode::DeviceApprovalTimedOut,
            "Nobody answered the approval request on the device",
        ),
        Refusal::Busy => (
            ErrorCode::DeviceBusy,
            "The device has too many open file sessions",
        ),
        Refusal::Expired => (ErrorCode::DeviceAccessExpired, "Access to the device ended"),
    };
    AppError::coded(code, message)
}

impl DeviceLink {
    pub fn new(
        source: Arc<dyn FilesSource>,
        device_id: String,
        pass: Pass,
        closed: CancellationToken,
        events: LinkEvents,
    ) -> Self {
        Self {
            source,
            device_id,
            pass: Mutex::new(pass),
            opened: AtomicBool::new(false),
            read_only: AtomicBool::new(false),
            closed,
            sftp_id: OnceLock::new(),
            events,
        }
    }

    pub fn read_only(&self) -> bool {
        self.read_only.load(Ordering::Relaxed)
    }

    pub fn bind(&self, sftp_id: String) {
        let _ = self.sftp_id.set(sftp_id);
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Pass> {
        self.pass.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn pass(&self) -> Pass {
        self.lock().clone()
    }

    fn close_with(&self, err: AppError) -> AppError {
        self.closed.cancel();
        if let Some(id) = self.sftp_id.get() {
            (self.events.closed)(id, err.code());
        }
        err
    }

    pub async fn dial(&self) -> Result<SftpSession, AppError> {
        let dialer = self
            .source
            .dialer()
            .await
            .ok_or_else(|| unreachable("local sync is off"))?;
        let pass = self.pass();
        let req = FilesRequest {
            grant: pass.grant,
            reopen: self.opened.load(Ordering::Relaxed),
        };
        let pinned = pass.key.as_deref();
        let (stream, reply, key) = match dialer.open_files(&self.device_id, req, pinned).await {
            Ok(opened) => opened,
            Err(FilesDialError::Refused(reason)) => return Err(self.close_with(refused(reason))),
            Err(e @ FilesDialError::WrongDevice) if pinned.is_some() => {
                return Err(self.close_with(unreachable(e)))
            }
            Err(e) => return Err(unreachable(e)),
        };
        let mut flipped = None;
        {
            let mut pass = self.lock();
            pass.key = Some(key);
            if let FilesReply::Accepted { read_only, grant } = reply {
                if self.read_only.swap(read_only, Ordering::Relaxed) != read_only {
                    flipped = Some(read_only);
                }
                if let Some(g) = grant {
                    pass.grant = Some(g);
                }
            }
        }
        if let (Some(read_only), Some(id), true) = (
            flipped,
            self.sftp_id.get(),
            self.opened.load(Ordering::Relaxed),
        ) {
            (self.events.read_only)(id, read_only);
        }
        let session = SftpSession::new(Wire::new(stream, self.closed.clone(), ()))
            .await
            .map_err(unreachable)?;
        self.opened.store(true, Ordering::Relaxed);
        Ok(session)
    }
}

#[derive(Default)]
pub struct DeviceLinks(Mutex<HashMap<String, Weak<DeviceLink>>>);

impl DeviceLinks {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Weak<DeviceLink>>> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn pass(&self, sftp_id: &str, device_id: &str) -> Pass {
        self.lock()
            .get(sftp_id)
            .and_then(Weak::upgrade)
            .filter(|link| link.device_id == device_id)
            .map(|link| link.pass())
            .unwrap_or_default()
    }

    pub fn insert(&self, sftp_id: String, link: &Arc<DeviceLink>) {
        let mut links = self.lock();
        links.retain(|_, l| l.strong_count() > 0);
        links.insert(sftp_id, Arc::downgrade(link));
    }
}

#[async_trait]
impl SftpReopen for DeviceLink {
    async fn open(&self) -> Result<SftpSession, AppError> {
        self.dial().await
    }

    fn open_timed_out(&self) -> AppError {
        unreachable("timed out reopening")
    }

    fn closed_now(&self) -> bool {
        self.closed.is_cancelled()
    }

    fn closed(&self) -> &CancellationToken {
        &self.closed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct NoSync;

    #[async_trait]
    impl FilesSource for NoSync {
        async fn dialer(&self) -> Option<FilesDialer> {
            None
        }
    }

    struct Silent;

    #[async_trait]
    impl FilesSource for Silent {
        async fn dialer(&self) -> Option<FilesDialer> {
            std::future::pending().await
        }
    }

    fn link_over(source: Arc<dyn FilesSource>) -> DeviceLink {
        DeviceLink::new(
            source,
            "dev".into(),
            Pass::default(),
            CancellationToken::new(),
            LinkEvents {
                closed: Box::new(|_, _| {}),
                read_only: Box::new(|_, _| {}),
            },
        )
    }

    #[tokio::test(start_paused = true)]
    async fn a_reopen_that_times_out_is_unreachable() {
        let err = link_over(Arc::new(Silent))
            .open_bounded()
            .await
            .err()
            .unwrap();
        assert_eq!(err.code(), Some(ErrorCode::DeviceUnreachable));
    }

    #[tokio::test]
    async fn a_failed_reopen_keeps_the_unreachable_code() {
        let link = link_over(Arc::new(NoSync));
        let err = link.open_bounded().await.err().unwrap();
        assert_eq!(err.code(), Some(ErrorCode::DeviceUnreachable));
    }
}
