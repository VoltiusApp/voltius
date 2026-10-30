use crate::commands::lan_sync::{with_manager, LanSyncState};
use crate::device_files::link::{DeviceLink, DeviceLinks, FilesSource, LinkEvents};
use crate::error::AppError;
use crate::lan_sync::manager::FilesDialer;
use crate::sftp::real::RealSftp;
use crate::sftp::{emit_closed, emit_read_only, emit_step, FileBackend, SftpManager, SftpStep};
use async_trait::async_trait;
use serde::Serialize;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};
use tokio_util::sync::CancellationToken;

#[cfg(desktop)]
pub use serving::*;

const APPROVAL_HINT: Duration = Duration::from_millis(300);

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceConnected {
    pub sftp_id: String,
    pub rtt_ms: u32,
    pub read_only: bool,
}

#[async_trait]
impl FilesSource for LanSyncState {
    async fn dialer(&self) -> Option<FilesDialer> {
        with_manager(self, |m| Some(m.files_dialer())).await
    }
}

struct Lan(AppHandle);

#[async_trait]
impl FilesSource for Lan {
    async fn dialer(&self) -> Option<FilesDialer> {
        self.0.state::<LanSyncState>().dialer().await
    }
}

pub(crate) async fn connect_inner(
    sftp: &SftpManager,
    links: &DeviceLinks,
    source: Arc<dyn FilesSource>,
    device_id: String,
    relink: Option<&str>,
    step: impl Fn(SftpStep),
    events: LinkEvents,
) -> Result<DeviceConnected, AppError> {
    let closed = CancellationToken::new();
    let pass = relink
        .map(|id| links.pass(id, &device_id))
        .unwrap_or_default();
    let link = Arc::new(DeviceLink::new(
        source,
        device_id,
        pass,
        closed.clone(),
        events,
    ));
    step(SftpStep::DeviceDialing);
    let dial = link.dial();
    tokio::pin!(dial);
    let session = tokio::select! {
        session = &mut dial => session,
        _ = tokio::time::sleep(APPROVAL_HINT) => {
            step(SftpStep::DeviceApproval);
            dial.await
        }
    }?;
    let started = Instant::now();
    session
        .canonicalize(".")
        .await
        .map_err(|e| AppError::caused("SFTP canonicalize failed", &e))?;
    let rtt_ms = u32::try_from(started.elapsed().as_millis()).unwrap_or(u32::MAX);
    let backend: Arc<dyn FileBackend> = Arc::new(RealSftp::over(link.clone(), session));
    let sftp_id = match relink {
        Some(id)
            if sftp
                .relink_standalone(id, backend.clone(), closed.clone())
                .await =>
        {
            id.to_string()
        }
        _ => sftp.register_standalone(backend, closed).await,
    };
    link.bind(sftp_id.clone());
    links.insert(sftp_id.clone(), &link);
    Ok(DeviceConnected {
        sftp_id,
        rtt_ms,
        read_only: link.read_only(),
    })
}

pub(crate) async fn close_device_sessions(sftp: &SftpManager, links: &DeviceLinks) {
    for sftp_id in links.drain() {
        sftp.close(&sftp_id).await;
    }
}

#[tauri::command]
pub async fn device_files_connect(
    app: AppHandle,
    sftp_state: State<'_, SftpManager>,
    links: State<'_, DeviceLinks>,
    device_id: String,
    connect_id: String,
    relink: Option<String>,
) -> Result<DeviceConnected, AppError> {
    let (closer, flipper) = (app.clone(), app.clone());
    connect_inner(
        &sftp_state,
        &links,
        Arc::new(Lan(app.clone())),
        device_id,
        relink.as_deref(),
        |step| emit_step(&app, &connect_id, step, ""),
        LinkEvents {
            closed: Box::new(move |id, code| emit_closed(&closer, id, code)),
            read_only: Box::new(move |id, read_only| emit_read_only(&flipper, id, read_only)),
        },
    )
    .await
}

#[cfg(desktop)]
mod serving {
    use crate::commands::lan_sync::{emitter, Emit, LanSyncState};
    use crate::device_files::policy::{self, Answer, ApprovalPrompt, FileAccessConfig};
    use crate::device_files::service::{Alert, FileService};
    use crate::device_files::{for_account, stop_running};
    use std::path::{Path, PathBuf};
    use std::sync::Arc;
    use tauri::{AppHandle, Manager, State};

    async fn running(lan: &LanSyncState) -> Option<Arc<FileService>> {
        lan.files.service.lock().await.clone()
    }

    pub(crate) async fn start_inner(
        lan: &LanSyncState,
        dir: PathBuf,
        account: String,
        emit: Emit,
        alert: Alert,
    ) {
        let mut slot = lan.files.service.lock().await;
        let svc = match for_account(&slot, &account) {
            Some(svc) => svc.clone(),
            None => {
                stop_running(&mut slot);
                let svc = Arc::new(FileService::new(dir, account, emit, alert));
                *slot = Some(svc.clone());
                svc
            }
        };
        lan.offer_files(Some(svc)).await;
    }

    pub(crate) async fn stop_inner(lan: &LanSyncState) {
        stop_running(&mut *lan.files.service.lock().await);
        lan.offer_files(None).await;
    }

    async fn running_for(lan: &LanSyncState, account: &str) -> Option<Arc<FileService>> {
        for_account(&*lan.files.service.lock().await, account).cloned()
    }

    pub(crate) async fn get_config_inner(
        lan: &LanSyncState,
        dir: &Path,
        account: &str,
    ) -> FileAccessConfig {
        match running_for(lan, account).await {
            Some(svc) => svc.config(),
            None => policy::load(dir, account),
        }
    }

    pub(crate) async fn set_config_inner(
        lan: &LanSyncState,
        dir: &Path,
        account: &str,
        mut config: FileAccessConfig,
    ) -> Result<(), String> {
        let slot = lan.files.service.lock().await;
        match for_account(&slot, account) {
            Some(svc) => {
                svc.set_config(config)?;
                lan.offer_files(Some(svc.clone())).await;
                Ok(())
            }
            None => {
                config.keep_seen_from(&policy::load(dir, account));
                policy::save(dir, account, &config)
            }
        }
    }

    fn alert(app: AppHandle, body: String) -> Alert {
        Arc::new(move |prompt: &ApprovalPrompt| {
            let focused = app
                .webview_windows()
                .values()
                .any(|w| w.is_focused().unwrap_or(false));
            if focused {
                return;
            }
            use tauri_plugin_notification::NotificationExt;
            let shown = app
                .notification()
                .builder()
                .title(&prompt.device_name)
                .body(body.replace("{name}", &prompt.device_name))
                .show();
            if let Err(e) = shown {
                log::warn!("device-files: notification failed: {e}");
            }
        })
    }

    #[tauri::command]
    pub async fn device_files_start(
        app: AppHandle,
        lan: State<'_, LanSyncState>,
        account_id: String,
        notify_body: String,
    ) -> Result<(), String> {
        let dir = crate::storage::config::config_dir();
        let (emit, alert) = (emitter(app.clone()), alert(app, notify_body));
        start_inner(&lan, dir, account_id, emit, alert).await;
        Ok(())
    }

    #[tauri::command]
    pub async fn device_files_stop(lan: State<'_, LanSyncState>) -> Result<(), String> {
        stop_inner(&lan).await;
        Ok(())
    }

    #[tauri::command]
    pub async fn device_files_get_config(
        lan: State<'_, LanSyncState>,
        account_id: String,
    ) -> Result<FileAccessConfig, String> {
        let dir = crate::storage::config::config_dir();
        Ok(get_config_inner(&lan, &dir, &account_id).await)
    }

    #[tauri::command]
    pub async fn device_files_set_config(
        lan: State<'_, LanSyncState>,
        account_id: String,
        config: FileAccessConfig,
    ) -> Result<(), String> {
        let dir = crate::storage::config::config_dir();
        set_config_inner(&lan, &dir, &account_id, config).await
    }

    #[tauri::command]
    pub async fn device_files_answer(
        lan: State<'_, LanSyncState>,
        request_id: String,
        answer: Answer,
    ) -> Result<bool, String> {
        Ok(running(&lan)
            .await
            .is_some_and(|s| s.answer(&request_id, answer)))
    }

    #[tauri::command]
    pub async fn device_files_disconnect(
        lan: State<'_, LanSyncState>,
        device_key: String,
    ) -> Result<(), String> {
        if let Some(svc) = running(&lan).await {
            svc.disconnect(&device_key);
        }
        Ok(())
    }

    #[tauri::command]
    pub async fn device_files_pending(
        lan: State<'_, LanSyncState>,
    ) -> Result<Vec<ApprovalPrompt>, String> {
        Ok(running(&lan).await.map(|s| s.pending()).unwrap_or_default())
    }
}

#[cfg(all(test, desktop))]
mod tests {
    use super::*;
    use crate::commands::lan_sync::{
        peers_inner, start_inner as lan_start, stop_inner as lan_stop, Emit,
    };
    use crate::commands::sftp::resume::copy_one;
    use crate::commands::sftp::resume::endpoint::LocalFs;
    use crate::commands::sftp::resume::engine_tests::noise;
    use crate::crypto::hex;
    use crate::device_files::policy::{self, AllowedDevice, Answer, FileAccessConfig, GRANT_IDLE};
    use crate::device_files::service::{FileService, REQUEST, SESSIONS};
    use crate::error::ErrorCode;
    use crate::lan_sync::identity::{derive_auth_key, test_identity, DeviceKey, LocalIdentity};
    use crate::sftp::backend::test_tree::Recorder;
    use serde_json::{json, Value};
    use std::future::Future;
    use std::path::PathBuf;
    use std::sync::Mutex;

    const ACCOUNT: &str = "acct";

    type Seen = Arc<Mutex<Vec<(&'static str, Value)>>>;
    type Closed = Arc<Mutex<Vec<(String, Option<ErrorCode>)>>>;

    fn key_of(id: &str) -> String {
        hex(&test_identity(id).key.public)
    }

    fn impostor() -> LocalIdentity {
        LocalIdentity {
            key: DeviceKey::from_private(derive_auth_key(b"impostor")),
            ..test_identity("dev-b")
        }
    }

    async fn until<F: Future<Output = bool>>(what: &str, mut cond: impl FnMut() -> F) {
        let poll = async {
            while !cond().await {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        };
        if tokio::time::timeout(Duration::from_secs(30), poll)
            .await
            .is_err()
        {
            panic!("timed out waiting for {what}");
        }
    }

    async fn lan(me: LocalIdentity) -> Arc<LanSyncState> {
        let state = Arc::new(LanSyncState::default());
        lan_start(
            &state,
            me,
            vec![vec![7; 32]],
            ACCOUNT,
            None,
            Arc::new(|_, _| {}),
        )
        .await
        .unwrap();
        state
    }

    struct Server {
        lan: Arc<LanSyncState>,
        dir: tempfile::TempDir,
        seen: Seen,
    }

    fn config(share: &std::path::Path, always: &[&str]) -> FileAccessConfig {
        FileAccessConfig {
            enabled: true,
            folders: vec![share.to_string_lossy().into_owned()],
            read_only: false,
            allowed: always
                .iter()
                .map(|id| AllowedDevice {
                    device_key: key_of(id),
                    name: format!("{id} name"),
                    always: true,
                    last_opened: None,
                })
                .collect(),
            seen_keys: vec![],
        }
    }

    async fn server_as(me: LocalIdentity, always: &[&str]) -> Server {
        let dir = tempfile::tempdir().unwrap();
        let share = dir.path().join("Shared");
        std::fs::create_dir(&share).unwrap();
        std::fs::write(share.join("hello.txt"), b"hi").unwrap();
        policy::save(dir.path(), ACCOUNT, &config(&share, always)).unwrap();
        let seen = Seen::default();
        let sink = seen.clone();
        let emit: Emit = Arc::new(move |name, payload| sink.lock().unwrap().push((name, payload)));
        let lan = lan(me).await;
        serving::start_inner(
            &lan,
            dir.path().to_path_buf(),
            ACCOUNT.into(),
            emit,
            Arc::new(|_| {}),
        )
        .await;
        Server { lan, dir, seen }
    }

    async fn server(always: &[&str]) -> Server {
        server_as(test_identity("dev-b"), always).await
    }

    impl Server {
        fn share(&self) -> PathBuf {
            self.dir.path().join("Shared")
        }

        async fn svc(&self) -> Arc<FileService> {
            self.lan.files.service.lock().await.clone().unwrap()
        }

        fn events(&self, name: &str) -> Vec<Value> {
            let seen = self.seen.lock().unwrap();
            seen.iter()
                .filter(|(n, _)| *n == name)
                .map(|(_, v)| v.clone())
                .collect()
        }

        fn prompts(&self) -> usize {
            self.events(REQUEST).iter().filter(|v| !v.is_null()).count()
        }

        fn open_keys(&self) -> Vec<String> {
            let last = self.events(SESSIONS).pop().unwrap_or(json!([]));
            let mut keys: Vec<String> = last
                .as_array()
                .unwrap()
                .iter()
                .map(|s| s["deviceKey"].as_str().unwrap().to_string())
                .collect();
            keys.sort();
            keys
        }

        async fn until_open(&self, ids: &[&str]) {
            let mut want: Vec<String> = ids.iter().map(|id| key_of(id)).collect();
            want.sort();
            until(&format!("open sessions {ids:?}"), || {
                let now = self.open_keys();
                let want = want.clone();
                async move { now == want }
            })
            .await;
        }

        async fn until_pending(&self, count: usize) -> Vec<String> {
            let svc = self.svc().await;
            until(&format!("{count} pending approvals"), || {
                let n = svc.pending().len();
                async move { n == count }
            })
            .await;
            svc.pending().into_iter().map(|p| p.request_id).collect()
        }

        async fn approve(&self, answer: Answer) {
            for id in self.until_pending(1).await {
                assert!(self.svc().await.answer(&id, answer));
            }
        }

        async fn set(&self, cfg: FileAccessConfig) {
            serving::set_config_inner(&self.lan, self.dir.path(), ACCOUNT, cfg)
                .await
                .unwrap();
        }
    }

    struct Browser {
        lan: Arc<LanSyncState>,
        sftp: SftpManager,
        links: DeviceLinks,
        steps: Arc<Mutex<Vec<Value>>>,
        closed: Closed,
        read_only: Arc<Mutex<Vec<(String, bool)>>>,
    }

    async fn browser(id: &'static str, server: &Server) -> Browser {
        let lan = lan(test_identity(id)).await;
        lan.meet(&server.lan).await;
        until("dev-b listed with files on", || {
            let lan = lan.clone();
            async move {
                peers_inner(&lan)
                    .await
                    .iter()
                    .any(|p| p.device_id == "dev-b" && p.files)
            }
        })
        .await;
        Browser {
            lan,
            sftp: SftpManager::new(),
            links: DeviceLinks::default(),
            steps: Arc::default(),
            closed: Arc::default(),
            read_only: Arc::default(),
        }
    }

    impl Browser {
        async fn relink(&self, relink: Option<&str>) -> Result<DeviceConnected, AppError> {
            let (steps, closed, flips) = (
                self.steps.clone(),
                self.closed.clone(),
                self.read_only.clone(),
            );
            connect_inner(
                &self.sftp,
                &self.links,
                self.lan.clone(),
                "dev-b".into(),
                relink,
                move |s| steps.lock().unwrap().push(json!(s)),
                LinkEvents {
                    closed: Box::new(move |id, code| {
                        closed.lock().unwrap().push((id.to_string(), code))
                    }),
                    read_only: Box::new(move |id, read_only| {
                        flips.lock().unwrap().push((id.to_string(), read_only))
                    }),
                },
            )
            .await
        }

        async fn connect(&self) -> Result<DeviceConnected, AppError> {
            self.relink(None).await
        }

        async fn approved(&self, s: &Server) -> DeviceConnected {
            let (connected, ()) = tokio::join!(self.connect(), s.approve(Answer::Once));
            connected.unwrap()
        }

        async fn list(&self, sftp_id: &str, path: &str) -> Result<Vec<String>, AppError> {
            let backend = self.sftp.backend(sftp_id).await.unwrap();
            let mut names: Vec<String> = backend
                .list_dir(path)
                .await?
                .into_iter()
                .map(|f| f.name)
                .collect();
            names.sort();
            Ok(names)
        }

        async fn closes(&self, c: &DeviceConnected, code: ErrorCode) {
            assert!(self.list(&c.sftp_id, "/").await.is_err());
            assert_eq!(
                *self.closed.lock().unwrap(),
                [(c.sftp_id.clone(), Some(code))]
            );
        }

        fn steps(&self) -> Vec<Value> {
            self.steps.lock().unwrap().clone()
        }
    }

    fn code(r: Result<DeviceConnected, AppError>) -> Option<ErrorCode> {
        r.expect_err("connected").code()
    }

    #[tokio::test]
    async fn always_allowed_device_lists_shared_folder() {
        let s = server(&["dev-a"]).await;
        let a = browser("dev-a", &s).await;
        let c = a.connect().await.unwrap();
        assert_eq!(a.steps()[0], json!("device_dialing"));
        assert_eq!(a.list(&c.sftp_id, "/").await.unwrap(), ["Shared"]);
        assert_eq!(a.list(&c.sftp_id, "/Shared").await.unwrap(), ["hello.txt"]);
        assert_eq!(s.prompts(), 0);
        s.until_open(&["dev-a"]).await;
    }

    #[tokio::test]
    async fn unknown_device_waits_for_approval_then_lists() {
        let s = server(&[]).await;
        let a = browser("dev-a", &s).await;
        let answer = async {
            let id = s.until_pending(1).await.remove(0);
            assert_eq!(s.events(REQUEST)[0]["requestId"], json!(id));
            assert_eq!(s.events(REQUEST)[0]["newDevice"], json!(true));
            until("the approval step", || {
                let shown = a.steps().contains(&json!("device_approval"));
                async move { shown }
            })
            .await;
            assert!(s.svc().await.answer(&id, Answer::Once));
        };
        let (connected, ()) = tokio::join!(a.connect(), answer);
        let c = connected.unwrap();
        assert_eq!(
            a.steps(),
            [json!("device_dialing"), json!("device_approval")]
        );
        assert_eq!(a.list(&c.sftp_id, "/Shared").await.unwrap(), ["hello.txt"]);
        let cfg = s.svc().await.config();
        assert_eq!(cfg.seen_keys, [key_of("dev-a")]);
        assert!(cfg.allowed.is_empty());
    }

    #[tokio::test]
    async fn connect_reports_whether_the_device_is_read_only() {
        let s = server(&["dev-a"]).await;
        let a = browser("dev-a", &s).await;
        assert!(!a.connect().await.unwrap().read_only);
        let mut cfg = s.svc().await.config();
        cfg.read_only = true;
        s.set(cfg).await;
        assert!(a.connect().await.unwrap().read_only);
    }

    #[tokio::test]
    async fn always_answer_is_persisted() {
        let s = server(&[]).await;
        let a = browser("dev-a", &s).await;
        let (connected, ()) = tokio::join!(a.connect(), s.approve(Answer::Always));
        connected.unwrap();
        let saved = policy::load(s.dir.path(), ACCOUNT);
        assert!(saved.always_allows(&key_of("dev-a")));
        assert_eq!(saved.seen_keys, [key_of("dev-a")]);
        a.connect().await.unwrap();
        assert_eq!(s.prompts(), 1);
    }

    #[tokio::test]
    async fn deny_maps_to_error_code() {
        let s = server(&[]).await;
        let a = browser("dev-a", &s).await;
        let (connected, ()) = tokio::join!(a.connect(), s.approve(Answer::Deny));
        assert_eq!(code(connected), Some(ErrorCode::DeviceAccessDenied));
        assert!(s.open_keys().is_empty());
    }

    #[tokio::test]
    async fn approval_timeout_maps_to_error_code() {
        let s = server(&[]).await;
        let a = browser("dev-a", &s).await;
        let pause = async {
            s.until_pending(1).await;
            tokio::time::pause();
        };
        let (connected, ()) = tokio::join!(a.connect(), pause);
        assert_eq!(code(connected), Some(ErrorCode::DeviceApprovalTimedOut));
        assert!(s.svc().await.pending().is_empty());
    }

    #[tokio::test]
    async fn reconnect_with_grant_skips_prompt() {
        let s = server(&[]).await;
        let big = noise(24 << 20);
        std::fs::write(s.share().join("big.bin"), &big).unwrap();
        let a = browser("dev-a", &s).await;
        let c = a.approved(&s).await;
        let src = a.sftp.backend(&c.sftp_id).await.unwrap().endpoint();
        let out = tempfile::tempdir().unwrap();
        let dst = out.path().join("big.bin");
        let (rec, token) = (Recorder::default(), CancellationToken::new());
        let copy = copy_one(
            &rec,
            &*src,
            "/Shared/big.bin",
            &LocalFs,
            dst.to_str().unwrap(),
            "device-reconnect",
            &token,
        );
        let svc = s.svc().await;
        let cut = async {
            until("a partial download", || {
                let started = std::fs::read_dir(out.path())
                    .unwrap()
                    .any(|e| e.unwrap().metadata().unwrap().len() > 0);
                async move { started }
            })
            .await;
            svc.cut();
        };
        let (copied, ()) = tokio::join!(copy, cut);
        copied.unwrap();
        assert!(std::fs::read(&dst).unwrap() == big);
        assert!(svc.admitted() >= 2, "the transfer never reconnected");
        assert_eq!(s.prompts(), 1);
    }

    #[tokio::test]
    async fn manual_reconnect_keeps_allow_once() {
        let s = server(&[]).await;
        let a = browser("dev-a", &s).await;
        let c = a.approved(&s).await;
        s.svc().await.cut();
        s.until_open(&[]).await;
        let again = a.relink(Some(&c.sftp_id)).await.unwrap();
        assert_eq!(again.sftp_id, c.sftp_id);
        assert_eq!(a.list(&c.sftp_id, "/").await.unwrap(), ["Shared"]);
        assert_eq!(s.prompts(), 1);
    }

    #[tokio::test]
    async fn turning_off_closes_open_sessions() {
        let s = server(&["dev-a"]).await;
        let a = browser("dev-a", &s).await;
        let c = a.connect().await.unwrap();
        s.until_open(&["dev-a"]).await;
        let mut off = s.svc().await.config();
        off.enabled = false;
        s.set(off).await;
        s.until_open(&[]).await;
        until("caps off", || {
            let lan = a.lan.clone();
            async move { peers_inner(&lan).await.iter().all(|p| !p.files) }
        })
        .await;
        a.closes(&c, ErrorCode::DeviceFileAccessOff).await;
        assert_eq!(
            code(a.connect().await),
            Some(ErrorCode::DeviceFileAccessOff)
        );
    }

    #[tokio::test]
    async fn turning_off_withdraws_pending_prompts() {
        let s = server(&[]).await;
        let a = browser("dev-a", &s).await;
        let off = async {
            s.until_pending(1).await;
            let mut cfg = s.svc().await.config();
            cfg.enabled = false;
            s.set(cfg).await;
            std::time::Instant::now()
        };
        let (waiting, at) = tokio::join!(a.connect(), off);
        assert!(at.elapsed() < Duration::from_secs(5));
        assert_eq!(code(waiting), Some(ErrorCode::DeviceFileAccessOff));
        assert!(s.svc().await.pending().is_empty());
        assert!(s.svc().await.config().seen_keys.is_empty());
    }

    #[tokio::test]
    async fn requester_hanging_up_withdraws_its_prompt() {
        let s = server(&[]).await;
        let a = browser("dev-a", &s).await;
        tokio::select! {
            _ = a.connect() => panic!("connected without an answer"),
            _ = s.until_pending(1) => {}
        }
        s.until_pending(0).await;
    }

    #[tokio::test]
    async fn revoke_closes_that_device_only() {
        let s = server(&["dev-a", "dev-c"]).await;
        let a = browser("dev-a", &s).await;
        let c = browser("dev-c", &s).await;
        let on_a = a.connect().await.unwrap();
        let on_c = c.connect().await.unwrap();
        s.until_open(&["dev-a", "dev-c"]).await;
        s.set(config(&s.share(), &["dev-c"])).await;
        s.until_open(&["dev-c"]).await;
        assert_eq!(c.list(&on_c.sftp_id, "/").await.unwrap(), ["Shared"]);
        a.closes(&on_a, ErrorCode::DeviceAccessExpired).await;
        assert_eq!(s.prompts(), 0);
    }

    #[tokio::test]
    async fn disconnect_closes_only_that_device() {
        let s = server(&[]).await;
        let a = browser("dev-a", &s).await;
        let c = browser("dev-c", &s).await;
        let on_a = a.approved(&s).await;
        let on_c = c.approved(&s).await;
        s.until_open(&["dev-a", "dev-c"]).await;
        s.svc().await.disconnect(&key_of("dev-a"));
        s.until_open(&["dev-c"]).await;
        assert_eq!(c.list(&on_c.sftp_id, "/").await.unwrap(), ["Shared"]);
        a.closes(&on_a, ErrorCode::DeviceAccessExpired).await;
        assert_eq!(s.prompts(), 2);
    }

    #[tokio::test]
    async fn idle_grant_expires_without_prompting() {
        let s = server(&[]).await;
        let a = browser("dev-a", &s).await;
        let c = a.approved(&s).await;
        s.svc().await.cut();
        s.until_open(&[]).await;
        tokio::time::pause();
        tokio::time::advance(GRANT_IDLE + Duration::from_secs(1)).await;
        tokio::time::resume();
        until("the pane closes", || async {
            let _ = a.list(&c.sftp_id, "/").await;
            !a.closed.lock().unwrap().is_empty()
        })
        .await;
        assert_eq!(
            *a.closed.lock().unwrap(),
            [(c.sftp_id.clone(), Some(ErrorCode::DeviceAccessExpired))]
        );
        assert_eq!(s.prompts(), 1);
    }

    #[tokio::test]
    async fn settings_change_closes_sessions_but_keeps_grants() {
        let s = server(&[]).await;
        let a = browser("dev-a", &s).await;
        let c = a.approved(&s).await;
        s.until_open(&["dev-a"]).await;
        let mut cfg = s.svc().await.config();
        cfg.read_only = true;
        s.set(cfg).await;
        s.until_open(&[]).await;
        assert_eq!(a.list(&c.sftp_id, "/").await.unwrap(), ["Shared"]);
        s.until_open(&["dev-a"]).await;
        assert_eq!(s.prompts(), 1);
        assert!(a.closed.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn reopen_refuses_a_different_device_key() {
        let s = server(&["dev-a"]).await;
        let a = browser("dev-a", &s).await;
        let c = a.connect().await.unwrap();
        lan_stop(&s.lan).await;
        s.until_open(&[]).await;
        let fake = server_as(impostor(), &["dev-a"]).await;
        fake.lan.meet(&a.lan).await;
        let fake_key = hex(&impostor().key.public);
        until("the impostor listed as dev-b", || {
            let (lan, fake_key) = (a.lan.clone(), fake_key.clone());
            async move {
                peers_inner(&lan)
                    .await
                    .iter()
                    .any(|p| p.device_id == "dev-b" && p.device_key == fake_key && p.files)
            }
        })
        .await;
        a.closes(&c, ErrorCode::DeviceUnreachable).await;
        assert_eq!(fake.svc().await.admitted(), 0);
        assert_eq!(fake.prompts(), 0);
    }

    #[tokio::test]
    async fn stopping_local_sync_ends_file_sessions() {
        let s = server(&["dev-a"]).await;
        let a = browser("dev-a", &s).await;
        a.connect().await.unwrap();
        s.until_open(&["dev-a"]).await;
        lan_stop(&s.lan).await;
        s.until_open(&[]).await;
        assert!(s.lan.files.service.lock().await.is_none());
    }

    #[tokio::test]
    async fn reopen_reports_read_only_flips_both_ways() {
        let s = server(&["dev-a"]).await;
        let a = browser("dev-a", &s).await;
        let c = a.connect().await.unwrap();
        s.until_open(&["dev-a"]).await;
        for flip in [true, false] {
            let mut cfg = s.svc().await.config();
            cfg.read_only = flip;
            s.set(cfg).await;
            s.until_open(&[]).await;
            a.list(&c.sftp_id, "/").await.unwrap();
            s.until_open(&["dev-a"]).await;
            assert_eq!(
                a.read_only.lock().unwrap().last(),
                Some(&(c.sftp_id.clone(), flip))
            );
        }
        assert_eq!(a.read_only.lock().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn listing_after_the_service_stops_is_unreachable_not_access_off() {
        let s = server(&["dev-a"]).await;
        let a = browser("dev-a", &s).await;
        let c = a.connect().await.unwrap();
        s.until_open(&["dev-a"]).await;
        serving::stop_inner(&s.lan).await;
        s.until_open(&[]).await;
        let err = a.list(&c.sftp_id, "/").await.unwrap_err();
        assert_eq!(err.code(), Some(ErrorCode::DeviceUnreachable));
    }

    #[tokio::test]
    async fn stop_closes_everything() {
        let s = server(&["dev-a"]).await;
        let a = browser("dev-a", &s).await;
        let c = browser("dev-c", &s).await;
        a.connect().await.unwrap();
        s.until_open(&["dev-a"]).await;
        let stop = async {
            s.until_pending(1).await;
            serving::stop_inner(&s.lan).await;
        };
        let (waiting, ()) = tokio::join!(c.connect(), stop);
        assert_eq!(code(waiting), Some(ErrorCode::DeviceUnreachable));
        s.until_open(&[]).await;
        assert!(s.lan.files.service.lock().await.is_none());
        until("caps off", || {
            let lan = a.lan.clone();
            async move { peers_inner(&lan).await.iter().all(|p| !p.files) }
        })
        .await;
    }

    #[tokio::test]
    async fn get_config_reads_saved_file_while_stopped() {
        let dir = tempfile::tempdir().unwrap();
        let saved = config(dir.path(), &["dev-a"]);
        policy::save(dir.path(), ACCOUNT, &saved).unwrap();
        let lan = LanSyncState::default();
        assert_eq!(
            serving::get_config_inner(&lan, dir.path(), ACCOUNT).await,
            saved
        );
        assert_eq!(
            serving::get_config_inner(&lan, dir.path(), "other").await,
            FileAccessConfig::default()
        );
    }

    #[tokio::test]
    async fn set_config_while_stopped_persists_and_next_start_uses_it() {
        let dir = tempfile::tempdir().unwrap();
        let lan = LanSyncState::default();
        let cfg = config(dir.path(), &["dev-a"]);
        serving::set_config_inner(&lan, dir.path(), ACCOUNT, cfg.clone())
            .await
            .unwrap();
        assert!(lan.files.service.lock().await.is_none());
        assert_eq!(policy::load(dir.path(), ACCOUNT), cfg);
        serving::start_inner(
            &lan,
            dir.path().to_path_buf(),
            ACCOUNT.into(),
            Arc::new(|_, _| {}),
            Arc::new(|_| {}),
        )
        .await;
        let svc = lan.files.service.lock().await.clone().unwrap();
        assert_eq!(svc.config(), cfg);
    }

    #[tokio::test]
    async fn another_accounts_config_bypasses_the_running_service() {
        let s = server(&["dev-a"]).await;
        let path = s.dir.path();
        let get_other = || serving::get_config_inner(&s.lan, path, "other");
        assert_eq!(get_other().await, FileAccessConfig::default());
        let other = config(&s.share(), &["dev-c"]);
        serving::set_config_inner(&s.lan, path, "other", other.clone())
            .await
            .unwrap();
        assert_eq!(policy::load(path, "other"), other);
        assert_eq!(get_other().await, other);
        let live = s.svc().await.config();
        assert!(live.always_allows(&key_of("dev-a")) && !live.always_allows(&key_of("dev-c")));
        assert_eq!(policy::load(path, ACCOUNT), live);
    }

    #[tokio::test]
    async fn reload_closes_open_device_sessions() {
        let s = server(&["dev-a"]).await;
        let a = browser("dev-a", &s).await;
        let c = a.connect().await.unwrap();
        s.until_open(&["dev-a"]).await;
        close_device_sessions(&a.sftp, &a.links).await;
        s.until_open(&[]).await;
        assert!(a.sftp.backend(&c.sftp_id).await.is_none());
    }
}
