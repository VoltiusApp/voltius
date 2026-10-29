use super::link::Wire;
use super::policy::{
    self, decide, hex, AllowedDevice, Answer, ApprovalPrompt, Broker, Decision, FileAccessConfig,
    Grants, APPROVAL_WAIT,
};
use super::roots::SharedRoots;
use super::server::SharedFs;
use crate::commands::lan_sync::Emit;
use crate::lan_sync::handshake::Session;
use crate::lan_sync::manager::InboundFiles;
use crate::lan_sync::protocol::{FilesReply, FilesRequest, Frame, Hello, Refusal, MAX_FRAME};
use crate::lan_sync::route::Route;
use crate::lan_sync::stream::SessionStream;
use serde::Serialize;
use serde_json::json;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

pub const REQUEST: &str = "device-files://request";
pub const SESSIONS: &str = "device-files://sessions";
pub const CONFIG: &str = "device-files://config";
const MAX_SESSIONS: usize = 8;
const MAX_PENDING: usize = 4;

pub type Alert = Arc<dyn Fn(&ApprovalPrompt) + Send + Sync>;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ActiveSession {
    pub device_key: String,
    pub device_name: String,
    pub since: String,
}

struct Live {
    info: ActiveSession,
    grant: Option<String>,
    stop: CancellationToken,
}

#[derive(Default)]
struct Book {
    cfg: FileAccessConfig,
    grants: Grants,
    sessions: HashMap<u64, Live>,
    next: u64,
    withdraw: CancellationToken,
}

impl Book {
    fn close(&self, which: impl Fn(&Live) -> bool) {
        for live in self.sessions.values().filter(|l| which(l)) {
            live.stop.cancel();
        }
    }

    fn forget(&mut self, key: &str) {
        self.grants.revoke_key(key);
        self.close(|l| l.info.device_key == key);
    }

    fn forget_all(&mut self) {
        self.grants.clear();
        self.close(|_| true);
        std::mem::take(&mut self.withdraw).cancel();
    }

    fn listing(&self) -> Vec<ActiveSession> {
        let mut list: Vec<ActiveSession> = self.sessions.values().map(|l| l.info.clone()).collect();
        list.sort_by(|a, b| a.since.cmp(&b.since));
        list
    }
}

struct Core {
    book: Mutex<Book>,
    emit: Emit,
}

impl Core {
    fn lock(&self) -> MutexGuard<'_, Book> {
        self.book.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn publish(&self, book: MutexGuard<'_, Book>) {
        let list = book.listing();
        drop(book);
        (self.emit)(SESSIONS, json!(list));
    }

    fn end(&self, id: u64) {
        let mut book = self.lock();
        let Some(live) = book.sessions.remove(&id) else {
            return;
        };
        if let Some(grant) = &live.grant {
            book.grants.touch(grant, Instant::now());
        }
        self.publish(book);
    }
}

struct Ending {
    core: Arc<Core>,
    id: u64,
}

impl Drop for Ending {
    fn drop(&mut self) {
        self.core.end(self.id);
    }
}

struct Admitted {
    read_only: bool,
    grant: Option<String>,
    roots: SharedRoots,
    stop: CancellationToken,
    ending: Ending,
}

pub struct FileService {
    core: Arc<Core>,
    broker: Broker,
    dir: PathBuf,
    account: String,
    alert: Alert,
    stopped: CancellationToken,
}

fn offers(cfg: &FileAccessConfig) -> bool {
    cfg.enabled && !cfg.folders.is_empty()
}

fn remember(cfg: &mut FileAccessConfig, key: &str, name: &str, always: bool) {
    if !cfg.seen_keys.iter().any(|k| k == key) {
        cfg.seen_keys.push(key.to_string());
    }
    if !always {
        return;
    }
    match cfg.allowed.iter_mut().find(|d| d.device_key == key) {
        Some(device) => {
            device.always = true;
            device.name = name.to_string();
        }
        None => cfg.allowed.push(AllowedDevice {
            device_key: key.to_string(),
            name: name.to_string(),
            always: true,
            last_opened: None,
        }),
    }
}

impl FileService {
    pub fn new(dir: PathBuf, account: String, emit: Emit, alert: Alert) -> Self {
        let cfg = policy::load(&dir, &account);
        Self {
            core: Arc::new(Core {
                book: Mutex::new(Book {
                    cfg,
                    ..Book::default()
                }),
                emit,
            }),
            broker: Broker::default(),
            dir,
            account,
            alert,
            stopped: CancellationToken::new(),
        }
    }

    pub fn account(&self) -> &str {
        &self.account
    }

    pub fn config(&self) -> FileAccessConfig {
        self.core.lock().cfg.clone()
    }

    pub fn offers(&self) -> bool {
        offers(&self.core.lock().cfg)
    }

    pub fn pending(&self) -> Vec<ApprovalPrompt> {
        self.broker.pending()
    }

    pub fn answer(&self, request_id: &str, answer: Answer) -> bool {
        self.broker.answer(request_id, answer)
    }

    pub fn set_config(&self, mut cfg: FileAccessConfig) -> Result<(), String> {
        let mut guard = self.core.lock();
        let book = &mut *guard;
        cfg.keep_seen_from(&book.cfg);
        policy::save(&self.dir, &self.account, &cfg)?;
        let old = std::mem::replace(&mut book.cfg, cfg);
        let new = &book.cfg;
        if !offers(new) {
            book.forget_all();
            return Ok(());
        }
        if old.folders != new.folders || old.read_only != new.read_only {
            book.close(|_| true);
        }
        let revoked: Vec<String> = old
            .allowed
            .iter()
            .filter(|d| {
                let listed = new.allowed.iter().any(|n| n.device_key == d.device_key);
                !listed || (d.always && !new.always_allows(&d.device_key))
            })
            .map(|d| d.device_key.clone())
            .collect();
        for key in &revoked {
            book.forget(key);
        }
        Ok(())
    }

    pub fn disconnect(&self, key: &str) {
        self.core.lock().forget(key);
    }

    pub fn stop(&self) {
        self.stopped.cancel();
        self.core.lock().forget_all();
    }

    fn check(&self, book: &mut Book, key: &str, req: &FilesRequest) -> Result<Decision, Refusal> {
        if self.stopped.is_cancelled() {
            return Err(Refusal::Off);
        }
        let now = Instant::now();
        for grant in book.sessions.values().filter_map(|l| l.grant.as_ref()) {
            book.grants.touch(grant, now);
        }
        let open = book
            .sessions
            .values()
            .filter(|l| l.info.device_key == key)
            .count();
        match decide(&book.cfg, &book.grants, key, req, open, now) {
            Decision::Refuse(reason) => Err(reason),
            _ if book.sessions.len() >= MAX_SESSIONS => Err(Refusal::Busy),
            decision => Ok(decision),
        }
    }

    async fn ask(
        &self,
        session: &mut Session,
        peer: &Hello,
        key: &str,
        route: Route,
        new_device: bool,
    ) -> Result<Option<String>, Refusal> {
        let prompt = ApprovalPrompt {
            request_id: policy::new_request_id(),
            device_key: key.to_string(),
            device_name: peer.device_name.clone(),
            platform: peer.platform.clone(),
            route,
            new_device,
        };
        let (pending, withdraw) = {
            let book = self.core.lock();
            if self.broker.pending().len() >= MAX_PENDING {
                return Err(Refusal::Busy);
            }
            (self.broker.register(prompt.clone()), book.withdraw.clone())
        };
        (self.core.emit)(REQUEST, json!(prompt));
        (self.alert)(&prompt);
        // The requester sends nothing before the reply, so any read result means it hung up.
        let outcome = tokio::select! {
            answer = pending.wait(APPROVAL_WAIT) => Ok(answer),
            _ = withdraw.cancelled() => Err(Refusal::Off),
            _ = session.recv_max(MAX_FRAME) => Err(Refusal::Denied),
        };
        (self.core.emit)(REQUEST, json!(null));
        let always = match outcome? {
            None => return Err(Refusal::TimedOut),
            Some(Answer::Deny) => return Err(Refusal::Denied),
            Some(Answer::Once) => false,
            Some(Answer::Always) => true,
        };
        let mut book = self.core.lock();
        remember(&mut book.cfg, key, &peer.device_name, always);
        if let Err(e) = policy::save(&self.dir, &self.account, &book.cfg) {
            log::warn!("device-files: saving the approval failed: {e}");
        }
        let grant = (!always).then(|| book.grants.issue(key));
        let cfg = book.cfg.clone();
        drop(book);
        (self.core.emit)(CONFIG, json!(cfg));
        Ok(grant)
    }

    fn admit(&self, key: &str, name: &str, req: &FilesRequest) -> Result<Admitted, Refusal> {
        let mut book = self.core.lock();
        let Decision::Accept { read_only, grant } = self.check(&mut book, key, req)? else {
            return Err(Refusal::Denied);
        };
        if let Some(grant) = &grant {
            book.grants.touch(grant, Instant::now());
        }
        book.next += 1;
        let id = book.next;
        let stop = CancellationToken::new();
        let info = ActiveSession {
            device_key: key.to_string(),
            device_name: name.to_string(),
            since: chrono::Utc::now().to_rfc3339(),
        };
        book.sessions.insert(
            id,
            Live {
                info,
                grant: grant.clone(),
                stop: stop.clone(),
            },
        );
        let folders: Vec<PathBuf> = book.cfg.folders.iter().map(PathBuf::from).collect();
        self.core.publish(book);
        Ok(Admitted {
            read_only,
            grant,
            roots: SharedRoots::new(&folders),
            stop,
            ending: Ending {
                core: self.core.clone(),
                id,
            },
        })
    }

    async fn authorize(
        &self,
        peer: &Hello,
        route: Route,
        session: &mut Session,
        mut req: FilesRequest,
    ) -> Result<Admitted, Refusal> {
        let key = hex(&peer.device_key);
        let decision = self.check(&mut self.core.lock(), &key, &req)?;
        if let Decision::Ask { new_device } = decision {
            req.grant = self.ask(session, peer, &key, route, new_device).await?;
        }
        self.admit(&key, &peer.device_name, &req)
    }
}

#[cfg(test)]
impl FileService {
    pub(crate) fn cut(&self) {
        self.core.lock().close(|_| true);
    }

    pub(crate) fn admitted(&self) -> u64 {
        self.core.lock().next
    }
}

#[async_trait::async_trait]
impl InboundFiles for FileService {
    async fn serve(&self, mut session: Session, peer: Hello, route: Route, req: FilesRequest) {
        let admitted = self.authorize(&peer, route, &mut session, req).await;
        let reply = match &admitted {
            Ok(a) => FilesReply::Accepted {
                read_only: a.read_only,
                grant: a.grant.clone(),
            },
            Err(reason) => FilesReply::Refused { reason: *reason },
        };
        if session.send(&Frame::FilesReply(reply)).await.is_err() {
            return;
        }
        let Ok(a) = admitted else {
            return;
        };
        let wire = Wire::new(SessionStream::new(session), a.stop, a.ending);
        russh_sftp::server::run(wire, SharedFs::new(a.roots, a.read_only)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::device_files::policy::AllowedDevice;
    use crate::lan_sync::identity::test_identity;
    use crate::lan_sync::stream::tests::sessions;
    use std::time::Duration;

    fn hello(id: &str) -> Hello {
        let me = test_identity(id);
        Hello {
            device_id: me.device_id,
            device_name: me.device_name,
            platform: me.platform,
            device_key: me.key.public,
            device_sig: vec![],
        }
    }

    fn service(always: &[&str]) -> (Arc<FileService>, tempfile::TempDir) {
        service_emitting(always, Arc::new(|_, _| {}))
    }

    fn service_emitting(always: &[&str], emit: Emit) -> (Arc<FileService>, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let cfg = FileAccessConfig {
            enabled: true,
            folders: vec![dir.path().to_string_lossy().into_owned()],
            allowed: always
                .iter()
                .map(|id| AllowedDevice {
                    device_key: hex(&test_identity(id).key.public),
                    always: true,
                    ..AllowedDevice::default()
                })
                .collect(),
            ..FileAccessConfig::default()
        };
        policy::save(dir.path(), "acct", &cfg).unwrap();
        let svc = FileService::new(
            dir.path().to_path_buf(),
            "acct".into(),
            emit,
            Arc::new(|_| {}),
        );
        (Arc::new(svc), dir)
    }

    async fn request(svc: &Arc<FileService>, id: &str) -> Session {
        let (client, server) = sessions().await;
        let (svc, peer) = (svc.clone(), hello(id));
        tokio::spawn(async move {
            svc.serve(server, peer, Route::Lan, FilesRequest::default())
                .await
        });
        client
    }

    async fn reply(client: &mut Session) -> FilesReply {
        match client.recv().await.unwrap() {
            Frame::FilesReply(reply) => reply,
            other => panic!("expected a reply, got {other:?}"),
        }
    }

    fn busy() -> FilesReply {
        FilesReply::Refused {
            reason: Refusal::Busy,
        }
    }

    #[tokio::test]
    async fn ninth_session_is_busy() {
        let (svc, _dir) = service(&["d0", "d1", "d2"]);
        let mut open = Vec::new();
        for id in ["d0", "d1"] {
            for _ in 0..4 {
                let mut client = request(&svc, id).await;
                assert!(matches!(
                    reply(&mut client).await,
                    FilesReply::Accepted { .. }
                ));
                open.push(client);
            }
        }
        let mut ninth = request(&svc, "d2").await;
        assert_eq!(reply(&mut ninth).await, busy());
    }

    #[tokio::test]
    async fn fifth_pending_approval_is_busy() {
        let (svc, _dir) = service(&[]);
        let mut waiting = Vec::new();
        for _ in 0..4 {
            waiting.push(request(&svc, "d0").await);
        }
        while svc.pending().len() < 4 {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        let mut fifth = request(&svc, "d1").await;
        assert_eq!(reply(&mut fifth).await, busy());
        svc.stop();
        for client in &mut waiting {
            assert_eq!(
                reply(client).await,
                FilesReply::Refused {
                    reason: Refusal::Off
                }
            );
        }
        assert!(svc.pending().is_empty());
    }

    #[tokio::test]
    async fn pending_request_ending_emits_a_request_event() {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let sink = seen.clone();
        let (svc, _dir) = service_emitting(
            &[],
            Arc::new(move |name, payload| {
                sink.lock().unwrap().push((name.to_string(), payload));
            }),
        );
        let mut client = request(&svc, "d0").await;
        while svc.pending().is_empty() {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        svc.set_config(FileAccessConfig {
            enabled: false,
            ..svc.config()
        })
        .unwrap();
        assert_eq!(
            reply(&mut client).await,
            FilesReply::Refused {
                reason: Refusal::Off
            }
        );
        let requests: Vec<_> = seen
            .lock()
            .unwrap()
            .iter()
            .filter(|(n, _)| n == REQUEST)
            .map(|(_, v)| v.is_null())
            .collect();
        assert_eq!(requests, [false, true]);
        assert!(svc.pending().is_empty());
    }

    #[tokio::test]
    async fn revoking_a_once_allowed_entry_closes_its_session() {
        let (svc, _dir) = service(&[]);
        let mut client = request(&svc, "d0").await;
        while svc.pending().is_empty() {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        let key = hex(&test_identity("d0").key.public);
        assert!(svc.answer(&svc.pending()[0].request_id, Answer::Once));
        assert!(matches!(
            reply(&mut client).await,
            FilesReply::Accepted { .. }
        ));
        let mut cfg = svc.config();
        if !cfg.allowed.iter().any(|d| d.device_key == key) {
            cfg.allowed.push(AllowedDevice {
                device_key: key.clone(),
                ..AllowedDevice::default()
            });
        }
        assert!(cfg.allowed.iter().all(|d| !d.always));
        svc.set_config(cfg.clone()).unwrap();
        cfg.allowed.retain(|d| d.device_key != key);
        svc.set_config(cfg).unwrap();
        let closed = tokio::time::timeout(Duration::from_secs(2), client.recv()).await;
        assert!(matches!(closed, Ok(Err(_))), "session still open");
    }
}
