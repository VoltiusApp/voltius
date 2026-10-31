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

fn device_forgotten() -> AppError {
    AppError::coded(ErrorCode::DeviceForgotten, "This device was forgotten")
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
        let (stream, reply, _) = match dialer.open_files(&self.device_id, req).await {
            Ok(opened) => opened,
            Err(e) => {
                let fatal = match e {
                    FilesDialError::Refused(reason) => refused(reason),
                    e if matches!(e, FilesDialError::NotListed) || e.refused_peer().is_some() => {
                        refused(Refusal::Denied)
                    }
                    e => return Err(unreachable(e)),
                };
                return Err(self.close_with(fatal));
            }
        };
        let mut flipped = None;
        {
            let mut pass = self.lock();
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
struct Table {
    links: HashMap<String, Weak<DeviceLink>>,
    reloads: u64,
    forgets: HashMap<String, u64>,
}

impl Table {
    fn ticket(&self, device_id: &str) -> Ticket {
        Ticket {
            reloads: self.reloads,
            forgets: self.forgets.get(device_id).copied().unwrap_or_default(),
        }
    }
}

#[derive(Clone, Copy)]
pub struct Ticket {
    reloads: u64,
    forgets: u64,
}

#[derive(Default)]
pub struct DeviceLinks(Mutex<Table>);

impl DeviceLinks {
    fn lock(&self) -> std::sync::MutexGuard<'_, Table> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn pass(&self, sftp_id: &str, device_id: &str) -> Pass {
        self.lock()
            .links
            .get(sftp_id)
            .and_then(Weak::upgrade)
            .filter(|link| link.device_id == device_id)
            .map(|link| link.pass())
            .unwrap_or_default()
    }

    pub fn ticket(&self, device_id: &str) -> Ticket {
        self.lock().ticket(device_id)
    }

    pub fn drain(&self) -> Vec<String> {
        let mut table = self.lock();
        table.reloads += 1;
        table
            .links
            .drain()
            .filter(|(_, l)| l.strong_count() > 0)
            .map(|(id, _)| id)
            .collect()
    }

    /// Refuses a link whose page reloaded or whose device was forgotten since `ticket` was taken.
    pub fn insert(
        &self,
        ticket: Ticket,
        sftp_id: String,
        link: &Arc<DeviceLink>,
    ) -> Result<(), AppError> {
        let mut table = self.lock();
        let now = table.ticket(&link.device_id);
        if now.forgets != ticket.forgets {
            return Err(device_forgotten());
        }
        if now.reloads != ticket.reloads {
            return Err(AppError::Msg("The app reloaded while connecting".into()));
        }
        table.links.retain(|_, l| l.strong_count() > 0);
        table.links.insert(sftp_id, Arc::downgrade(link));
        Ok(())
    }

    pub fn forget(&self, device_id: &str) {
        let ended: Vec<Arc<DeviceLink>> = {
            let mut table = self.lock();
            *table.forgets.entry(device_id.to_string()).or_default() += 1;
            let mut ended = Vec::new();
            table.links.retain(|_, l| match l.upgrade() {
                Some(link) if link.device_id == device_id => {
                    ended.push(link);
                    false
                }
                live => live.is_some(),
            });
            ended
        };
        for link in ended {
            link.close_with(device_forgotten());
        }
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
    use crate::lan_sync::manager::{self, Manager, Trust};
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

    async fn lan_with(me: LocalIdentity, store: PeerStore, trust: manager::Trust) -> Manager {
        let events = tokio::sync::mpsc::channel(64).0;
        manager::start(me, trust, false, false, store, events)
            .await
            .unwrap()
    }

    async fn lan(me: LocalIdentity, store: PeerStore, policy: PinPolicy) -> Manager {
        lan_with(
            me,
            store,
            manager::Trust::policed(manager::test_keys(&[1]), policy),
        )
        .await
    }

    fn knowing(addrs: &[SocketAddr]) -> PeerStore {
        let mut store = PeerStore::memory();
        store.seed("dev", &[], now_secs());
        for (age, addr) in addrs.iter().enumerate() {
            store.seed("dev", &[*addr], now_secs() - age as u64);
        }
        store
    }

    fn block(store: &mut PeerStore, id: &str) {
        store.seed(id, &[], now_secs());
        store.forget(id, now_secs());
    }

    fn local(m: &Manager) -> SocketAddr {
        SocketAddr::from((Ipv4Addr::LOCALHOST, m.port()))
    }

    type Outcome = (Option<ErrorCode>, Vec<(String, Option<ErrorCode>)>);

    async fn failed_dial(me: &Manager) -> Outcome {
        let (link, closes) = link_over(Arc::new(Dialing(me.files_dialer())));
        link.bind("sftp-1".into());
        let code = link.dial().await.err().unwrap().code();
        let closed = closes.lock().unwrap().clone();
        assert_eq!(link.closed_now(), !closed.is_empty());
        (code, closed)
    }

    fn denied() -> Outcome {
        let code = Some(ErrorCode::DeviceAccessDenied);
        (code, vec![("sftp-1".into(), code)])
    }

    fn rekeyed() -> LocalIdentity {
        LocalIdentity {
            key: DeviceKey::from_private(derive_auth_key(b"rekeyed")),
            ..test_identity("dev")
        }
    }

    #[cfg(desktop)]
    async fn sharing(me: LocalIdentity, dir: &std::path::Path) -> Manager {
        use crate::device_files::policy::{self, AllowedDevice, FileAccessConfig};
        use crate::device_files::service::FileService;
        let cfg = FileAccessConfig {
            enabled: true,
            folders: vec![dir.to_string_lossy().into_owned()],
            allowed: vec![AllowedDevice {
                device_key: crate::crypto::hex(&test_identity("me").key.public),
                always: true,
                ..AllowedDevice::default()
            }],
            ..FileAccessConfig::default()
        };
        policy::save(dir, "acct", &cfg).unwrap();
        let svc = FileService::new(
            dir.to_path_buf(),
            "acct".into(),
            Arc::new(|_, _| {}),
            Arc::new(|_| {}),
        );
        let device = lan(me, PeerStore::memory(), PinPolicy::Repin).await;
        device.set_file_service(Some(Arc::new(svc)));
        device
    }

    #[cfg(desktop)]
    #[tokio::test]
    async fn reopen_after_the_device_rekeyed_follows_the_pin() {
        let dir = tempfile::tempdir().unwrap();
        let device = sharing(test_identity("dev"), dir.path()).await;
        let me = lan(test_identity("me"), knowing(&[]), PinPolicy::Repin).await;
        // Spent first so no sync link records the old device's advertised addresses.
        me.spend_budget();
        me.remember_at("dev", &[local(&device)]);
        let (link, closes) = link_over(Arc::new(Dialing(me.files_dialer())));
        link.bind("sftp-1".into());
        link.dial().await.unwrap();
        device.stop().await;
        let device = sharing(rekeyed(), dir.path()).await;
        me.remember_at("dev", &[local(&device)]);
        assert!(link.dial().await.is_ok());
        assert!(!link.closed_now());
        assert!(closes.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn pin_refused_file_dial_is_access_denied_not_retried() {
        let device = lan(rekeyed(), PeerStore::memory(), PinPolicy::Repin).await;
        let addr = local(&device);
        let forgotten = || {
            let mut store = knowing(&[addr]);
            store.forget("dev", now_secs());
            store
        };
        for (store, policy) in [
            (knowing(&[addr]), PinPolicy::Refuse),
            (forgotten(), PinPolicy::Repin),
            (forgotten(), PinPolicy::Refuse),
        ] {
            let me = lan(test_identity("me"), store, policy).await;
            assert_eq!(failed_dial(&me).await, denied(), "{policy:?}");
        }
    }

    #[tokio::test]
    async fn a_device_that_forgot_us_denies_access() {
        let mut forgot_me = PeerStore::memory();
        block(&mut forgot_me, "me");
        let device = lan(test_identity("dev"), forgot_me, PinPolicy::Repin).await;
        let me = lan(
            test_identity("me"),
            knowing(&[local(&device)]),
            PinPolicy::Repin,
        )
        .await;
        assert_eq!(failed_dial(&me).await, denied());
    }

    #[tokio::test]
    async fn a_group_session_is_denied_file_access() {
        let device = lan_with(
            test_identity("dev"),
            PeerStore::memory(),
            Trust::grouped(&[1], &["me"]),
        )
        .await;
        let store = knowing(&[local(&device)]);
        let me = lan_with(test_identity("me"), store, Trust::grouped(&[2, 1], &[])).await;
        assert_eq!(failed_dial(&me).await, denied());
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
                block(&mut store, "other");
            }
            let me = lan(test_identity("me"), store, PinPolicy::Repin).await;
            let unreachable = (Some(ErrorCode::DeviceUnreachable), vec![]);
            assert_eq!(failed_dial(&me).await, unreachable, "{blocked}");
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
