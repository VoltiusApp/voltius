use crate::error::{AppError, ErrorCode};
use crate::lan_sync::handshake::HandshakeError;
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
            Err(e) => {
                let fatal = match e {
                    FilesDialError::Refused(reason) => refused(reason),
                    FilesDialError::NotListed
                    | FilesDialError::Handshake(HandshakeError::Pinned(..)) => {
                        refused(Refusal::Denied)
                    }
                    FilesDialError::WrongDevice => unreachable(e),
                    e => return Err(unreachable(e)),
                };
                return Err(self.close_with(fatal));
            }
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

    pub fn drain(&self) -> Vec<String> {
        let mut links = self.lock();
        links
            .drain()
            .filter(|(_, l)| l.strong_count() > 0)
            .map(|(id, _)| id)
            .collect()
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
    use crate::lan_sync::identity::{derive_auth_key, test_identity, DeviceKey, LocalIdentity};
    use crate::lan_sync::manager::{self, Manager};
    use crate::lan_sync::peers::{now_secs, PeerStore, PinPolicy};
    use std::net::{Ipv4Addr, SocketAddr};

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

    struct Dialing(FilesDialer);

    #[async_trait]
    impl FilesSource for Dialing {
        async fn dialer(&self) -> Option<FilesDialer> {
            Some(self.0.clone())
        }
    }

    type Closes = Arc<Mutex<Vec<(String, Option<ErrorCode>)>>>;

    fn link_over(source: Arc<dyn FilesSource>) -> (DeviceLink, Closes) {
        let closes = Closes::default();
        let seen = closes.clone();
        let link = DeviceLink::new(
            source,
            "dev".into(),
            Pass::default(),
            CancellationToken::new(),
            LinkEvents {
                closed: Box::new(move |id, code| seen.lock().unwrap().push((id.into(), code))),
                read_only: Box::new(|_, _| {}),
            },
        );
        (link, closes)
    }

    async fn lan(me: LocalIdentity, store: PeerStore, policy: PinPolicy) -> Manager {
        let keys = zeroize::Zeroizing::new(vec![derive_auth_key(&[1; 32])]);
        let events = tokio::sync::mpsc::channel(64).0;
        manager::start(me, keys, false, false, store, policy, events)
            .await
            .unwrap()
    }

    fn knowing(addrs: &[SocketAddr]) -> PeerStore {
        let mut store = PeerStore::memory();
        let key = test_identity("dev").key.public;
        let now = now_secs();
        store.decide("dev", &key, now, PinPolicy::Repin);
        for (age, addr) in addrs.iter().enumerate() {
            store.record_addrs("dev", &[*addr], now - age as u64);
        }
        store
    }

    fn local(m: &Manager) -> SocketAddr {
        SocketAddr::from((Ipv4Addr::LOCALHOST, m.port()))
    }

    #[tokio::test]
    async fn pin_refused_file_dial_is_access_denied_not_retried() {
        let rekeyed = LocalIdentity {
            key: DeviceKey::from_private(derive_auth_key(b"rekeyed")),
            ..test_identity("dev")
        };
        let device = lan(rekeyed, PeerStore::memory(), PinPolicy::Repin).await;
        let addr = local(&device);
        let mut forgotten = knowing(&[addr]);
        forgotten.forget("dev", now_secs());
        for (store, policy) in [
            (knowing(&[addr]), PinPolicy::Refuse),
            (forgotten, PinPolicy::Repin),
        ] {
            let me = lan(test_identity("me"), store, policy).await;
            let (link, closes) = link_over(Arc::new(Dialing(me.files_dialer())));
            link.bind("sftp-1".into());
            let err = link.dial().await.err().unwrap();
            assert_eq!(
                err.code(),
                Some(ErrorCode::DeviceAccessDenied),
                "{policy:?}"
            );
            assert!(link.closed_now(), "{policy:?}");
            assert_eq!(
                closes.lock().unwrap()[..],
                [("sftp-1".to_string(), Some(ErrorCode::DeviceAccessDenied))]
            );
        }
    }

    #[tokio::test]
    async fn reopen_past_a_different_device_stays_retryable() {
        let other = lan(
            test_identity("other"),
            PeerStore::memory(),
            PinPolicy::Repin,
        )
        .await;
        let (_socket, refusing) = crate::lan_sync::reserved();
        for blocked in [false, true] {
            let mut store = knowing(&[refusing, local(&other)]);
            if blocked {
                let key = test_identity("other").key.public;
                store.decide("other", &key, now_secs(), PinPolicy::Repin);
                store.forget("other", now_secs());
            }
            let me = lan(test_identity("me"), store, PinPolicy::Repin).await;
            let (link, closes) = link_over(Arc::new(Dialing(me.files_dialer())));
            link.lock().key = Some(crate::crypto::hex(&test_identity("dev").key.public));
            link.bind("sftp-1".into());
            let err = link.dial().await.err().unwrap();
            assert_eq!(err.code(), Some(ErrorCode::DeviceUnreachable), "{blocked}");
            assert!(!link.closed_now(), "{blocked}");
            assert!(closes.lock().unwrap().is_empty(), "{blocked}");
        }
    }

    #[tokio::test(start_paused = true)]
    async fn a_reopen_that_times_out_is_unreachable() {
        let err = link_over(Arc::new(Silent))
            .0
            .open_bounded()
            .await
            .err()
            .unwrap();
        assert_eq!(err.code(), Some(ErrorCode::DeviceUnreachable));
    }

    #[tokio::test]
    async fn a_failed_reopen_keeps_the_unreachable_code() {
        let (link, _) = link_over(Arc::new(NoSync));
        let err = link.open_bounded().await.err().unwrap();
        assert_eq!(err.code(), Some(ErrorCode::DeviceUnreachable));
    }
}
