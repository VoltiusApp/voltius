#[cfg(desktop)]
use std::path::{Path, PathBuf};
#[cfg(desktop)]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(desktop)]
use std::sync::Mutex;
use tauri::AppHandle;
#[cfg(desktop)]
use tauri::{Emitter, Manager};
#[cfg(desktop)]
use tauri_plugin_updater::Update;

#[derive(Clone, Default, serde::Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
#[cfg_attr(not(desktop), allow(dead_code))]
pub enum UpdaterEvent {
    #[default]
    Idle,
    Checking,
    UpToDate,
    Available {
        version: String,
    },
    Downloading {
        version: String,
        progress: u8,
    },
    Ready {
        version: String,
    },
    ExternalUpdate {
        version: String,
    },
    Error {
        message: String,
    },
}

#[cfg(desktop)]
#[derive(Default)]
pub struct UpdaterState {
    status: Mutex<UpdaterEvent>,
    pending: Mutex<Option<(Update, Vec<u8>)>>,
    busy: AtomicBool,
}

#[cfg(desktop)]
impl UpdaterState {
    fn set(&self, handle: &AppHandle, status: UpdaterEvent) {
        *self.status.lock().unwrap() = status.clone();
        let _ = handle.emit("updater-status", status);
    }

    fn pending_version(&self) -> Option<String> {
        self.pending
            .lock()
            .unwrap()
            .as_ref()
            .map(|(update, _)| update.version.clone())
    }
}

#[cfg(desktop)]
struct BusyGuard<'a>(&'a AtomicBool);

#[cfg(desktop)]
impl Drop for BusyGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

#[cfg(desktop)]
#[allow(dead_code)] // not every variant is constructed on every target
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Os {
    Linux,
    Macos,
    Windows,
}

#[cfg(desktop)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum InstallKind {
    SelfUpdate,
    External,
}

/// Decide whether the running install can replace itself in place.
/// Pure so it can be unit-tested across every platform from one host.
#[cfg(desktop)]
fn classify_install(
    os: Os,
    appimage_env: bool,
    exe_path: &std::path::Path,
    bundle_writable: bool,
) -> InstallKind {
    match os {
        // Tauri's Linux updater only replaces an AppImage (APPIMAGE env set).
        Os::Linux => {
            if appimage_env {
                InstallKind::SelfUpdate
            } else {
                InstallKind::External
            }
        }
        // macOS replaces the .app bundle: impossible from a read-only dmg
        // mount, from a Gatekeeper-translocated path, or when the install
        // location isn't writable.
        Os::Macos => {
            let p_str = exe_path.to_str().unwrap_or("");
            if exe_path.starts_with("/Volumes/")
                || p_str.contains("AppTranslocation")
                || !bundle_writable
            {
                InstallKind::External
            } else {
                InstallKind::SelfUpdate
            }
        }
        // Per-user NSIS self-updates. A per-machine install still attempts the
        // update and surfaces any UAC-elevation failure via the error path;
        // no proactive install-scope detection here.
        //
        // The exception is an MSIX package from the Microsoft Store, which
        // lands under C:\Program Files\WindowsApps. That tree is locked down
        // even for administrators, so the download would always fail at the
        // install step; the Store owns updates for that install anyway.
        //
        // Matched on the raw string rather than on Path components: this
        // function is unit-tested for every platform from one host, and a
        // Linux Path does not split a Windows path on its backslashes.
        Os::Windows => {
            let p = exe_path.to_string_lossy().to_ascii_lowercase();
            if p.contains("\\windowsapps\\") || p.contains("/windowsapps/") {
                InstallKind::External
            } else {
                InstallKind::SelfUpdate
            }
        }
    }
}

/// Probe whether the directory containing the `.app` bundle is writable —
/// i.e. whether the updater could replace the bundle. Writes and removes a
/// temp file in the bundle's parent (e.g. /Applications). macOS only.
#[cfg(target_os = "macos")]
fn mac_install_writable(exe_path: &std::path::Path) -> bool {
    let bundle = exe_path
        .ancestors()
        .find(|p| p.extension().map(|e| e == "app").unwrap_or(false));
    let Some(parent) = bundle.and_then(|b| b.parent()) else {
        return false;
    };
    let probe = parent.join(".voltius_write_probe");
    let ok = std::fs::File::create(&probe).is_ok();
    let _ = std::fs::remove_file(&probe);
    ok
}

/// Whether the currently running install can self-update.
#[cfg(desktop)]
fn self_update_capable() -> bool {
    let os = if cfg!(target_os = "linux") {
        Os::Linux
    } else if cfg!(target_os = "macos") {
        Os::Macos
    } else {
        Os::Windows
    };
    let appimage_env = std::env::var_os("APPIMAGE").is_some();
    let exe = std::env::current_exe().unwrap_or_default();
    #[cfg(target_os = "macos")]
    let bundle_writable = mac_install_writable(&exe);
    #[cfg(not(target_os = "macos"))]
    let bundle_writable = true;
    classify_install(os, appimage_env, &exe, bundle_writable) == InstallKind::SelfUpdate
}

#[cfg(desktop)]
const CACHE_BYTES: &str = "update.bin";
#[cfg(desktop)]
const CACHE_VERSION: &str = "update.version";

#[cfg(desktop)]
fn cache_dir(handle: &AppHandle) -> Option<PathBuf> {
    crate::scratch::app_scratch_dir(handle)
        .ok()
        .map(|dir| dir.join("updater"))
}

#[cfg(desktop)]
fn updater_pubkey(handle: &AppHandle) -> Option<String> {
    let config = handle.config().plugins.0.get("updater")?;
    Some(config.get("pubkey")?.as_str()?.to_owned())
}

/// The cached download for `version`, re-verified: the cache dir is user-writable.
#[cfg(desktop)]
fn read_cache(dir: &Path, version: &str, signature: &str, pubkey: &str) -> Option<Vec<u8>> {
    if std::fs::read_to_string(dir.join(CACHE_VERSION)).ok()? != version {
        return None;
    }
    let bytes = std::fs::read(dir.join(CACHE_BYTES)).ok()?;
    signature_valid(&bytes, signature, pubkey).then_some(bytes)
}

#[cfg(desktop)]
fn write_cache(dir: &Path, version: &str, bytes: &[u8]) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    // Version file goes last so a torn write never matches a version.
    let _ = std::fs::remove_file(dir.join(CACHE_VERSION));
    std::fs::write(dir.join(CACHE_BYTES), bytes)?;
    std::fs::write(dir.join(CACHE_VERSION), version)
}

#[cfg(desktop)]
fn signature_valid(bytes: &[u8], signature: &str, pubkey: &str) -> bool {
    use base64::Engine;
    let decode = |s: &str| {
        base64::engine::general_purpose::STANDARD
            .decode(s)
            .ok()
            .and_then(|raw| String::from_utf8(raw).ok())
    };
    let (Some(pubkey), Some(signature)) = (decode(pubkey), decode(signature)) else {
        return false;
    };
    let (Ok(pubkey), Ok(signature)) = (
        minisign_verify::PublicKey::decode(&pubkey),
        minisign_verify::Signature::decode(&signature),
    ) else {
        return false;
    };
    pubkey.verify(bytes, &signature, true).is_ok()
}

#[cfg(desktop)]
async fn check_for_update(handle: &AppHandle, download: bool) {
    let state = handle.state::<UpdaterState>();
    if state
        .busy
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }
    let _busy = BusyGuard(&state.busy);
    if let Err(message) = run_check(handle, &state, download).await {
        let status = match state.pending_version() {
            Some(version) => UpdaterEvent::Ready { version },
            None => UpdaterEvent::Error { message },
        };
        state.set(handle, status);
    }
}

#[cfg(desktop)]
async fn run_check(handle: &AppHandle, state: &UpdaterState, download: bool) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;

    if state.pending_version().is_none() {
        state.set(handle, UpdaterEvent::Checking);
    }
    let update = handle
        .updater_builder()
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;
    let cache = cache_dir(handle);
    let Some(update) = update else {
        if let Some(dir) = &cache {
            let _ = std::fs::remove_dir_all(dir);
        }
        state.set(handle, UpdaterEvent::UpToDate);
        return Ok(());
    };
    let version = update.version.clone();

    // Installs that can't self-update (Linux deb/rpm, macOS from dmg /
    // translocated, etc.) must not download/install — notify instead.
    if !self_update_capable() {
        state.set(handle, UpdaterEvent::ExternalUpdate { version });
        return Ok(());
    }
    if state.pending_version().as_deref() == Some(version.as_str()) {
        state.set(handle, UpdaterEvent::Ready { version });
        return Ok(());
    }

    let cached = cache
        .as_deref()
        .zip(updater_pubkey(handle))
        .and_then(|(dir, pubkey)| read_cache(dir, &version, &update.signature, &pubkey));
    let bytes = match cached {
        Some(bytes) => bytes,
        None if !download => {
            state.set(handle, UpdaterEvent::Available { version });
            return Ok(());
        }
        None => {
            state.set(
                handle,
                UpdaterEvent::Downloading {
                    version: version.clone(),
                    progress: 0,
                },
            );
            let progress_handle = handle.clone();
            let progress_version = version.clone();
            let (mut downloaded, mut total) = (0u64, 0u64);
            let bytes = update
                .download(
                    move |chunk_len, content_length| {
                        downloaded += chunk_len as u64;
                        if let Some(len) = content_length {
                            total = len;
                        }
                        let progress = (downloaded * 100)
                            .checked_div(total)
                            .map(|p| p.min(99) as u8)
                            .unwrap_or(0);
                        progress_handle.state::<UpdaterState>().set(
                            &progress_handle,
                            UpdaterEvent::Downloading {
                                version: progress_version.clone(),
                                progress,
                            },
                        );
                    },
                    || {},
                )
                .await
                .map_err(|e| e.to_string())?;
            if let Some(dir) = &cache {
                if let Err(e) = write_cache(dir, &version, &bytes) {
                    log::warn!("[updater] could not cache the download: {e}");
                }
            }
            bytes
        }
    };

    *state.pending.lock().unwrap() = Some((update, bytes));
    state.set(handle, UpdaterEvent::Ready { version });
    Ok(())
}

#[cfg(all(desktop, not(debug_assertions)))]
pub fn spawn_background_checks(handle: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // Short delay so the window is visible before we start network I/O
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(4 * 60 * 60));
        loop {
            interval.tick().await;
            if crate::commands::sync::updater_auto_enabled() {
                check_for_update(&handle, true).await;
            }
        }
    });
}

#[cfg(desktop)]
pub fn install_pending_on_exit(app: &AppHandle) {
    // Tauri runs the NSIS updater with /R, which would relaunch the app the user just quit;
    // Windows keeps the cached download for the next launch instead.
    if cfg!(target_os = "windows") {
        return;
    }
    let Some((update, bytes)) = app.state::<UpdaterState>().pending.lock().unwrap().take() else {
        return;
    };
    if let Err(e) = update.install(bytes) {
        log::warn!("[updater] install on exit failed: {e}");
    }
}

#[tauri::command]
pub fn updater_restart(app: AppHandle) {
    #[cfg(desktop)]
    {
        let state = app.state::<UpdaterState>();
        let taken = state.pending.lock().unwrap().take();
        if let Some((update, bytes)) = taken {
            if let Err(e) = update.install(bytes) {
                state.set(
                    &app,
                    UpdaterEvent::Error {
                        message: e.to_string(),
                    },
                );
                return; // do not restart into an unchanged/broken state
            }
        }
    }
    app.restart();
}

/// Downloads when asked to or when auto-download is on.
#[tauri::command]
pub async fn updater_check(app: AppHandle, download: bool) {
    #[cfg(desktop)]
    check_for_update(
        &app,
        download || crate::commands::sync::updater_auto_enabled(),
    )
    .await;
    #[cfg(not(desktop))]
    let _ = (app, download);
}

#[cfg(desktop)]
#[tauri::command]
pub fn updater_get_state(app: AppHandle) -> UpdaterEvent {
    app.state::<UpdaterState>().status.lock().unwrap().clone()
}

#[cfg(not(desktop))]
#[tauri::command]
pub fn updater_get_state() -> UpdaterEvent {
    UpdaterEvent::Idle
}

#[cfg(all(test, desktop))]
mod tests {
    use super::{classify_install, read_cache, write_cache, InstallKind, Os};
    use std::path::Path;

    const PUBKEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDU3OUE4NjIxNjAyMUU2QTYKUldTbTVpRmdJWWFhVjlac1NqT3VEUUcvb2lLQUF2Nnl2MHEzR2dRMVdpRStKWWJFTjZFWVkybE0K";
    const PAYLOAD: &[u8] = b"voltius-update-payload";
    const SIGNATURE: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVTbTVpRmdJWWFhVi9Cdm9pTFNLbENvb3Q3MlkvOTJGYkV2dkhhYWdqU3dTVHRFMlM5MnI5clk3ZWlNZVEwUEJUR1cvWjVTYXNzWFY1S0lhVVA3VUhESWM0elJqWW9nZndJPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkwNDY4MTYyCWZpbGU6cGF5bG9hZC5iaW4KRTZOMW9xOWR6cFkyR1U5elVzZ2M4c3ZQY01kbDE0RjVaU0lOazhZL2J5RkZPSnk2OElaNTN3K1RiaUNxNUtKSFVSUXRVWGdYMkszSWg1clc5Q1ZCQXc9PQo=";

    #[test]
    fn cached_download_round_trips_for_its_version() {
        let dir = tempfile::tempdir().unwrap();
        write_cache(dir.path(), "1.2.3", PAYLOAD).unwrap();
        assert_eq!(
            read_cache(dir.path(), "1.2.3", SIGNATURE, PUBKEY).as_deref(),
            Some(PAYLOAD)
        );
    }

    #[test]
    fn cached_download_is_ignored_for_another_version() {
        let dir = tempfile::tempdir().unwrap();
        write_cache(dir.path(), "1.2.3", PAYLOAD).unwrap();
        assert_eq!(read_cache(dir.path(), "1.2.4", SIGNATURE, PUBKEY), None);
    }

    #[test]
    fn tampered_cached_download_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        write_cache(dir.path(), "1.2.3", b"voltius-update-payloaX").unwrap();
        assert_eq!(read_cache(dir.path(), "1.2.3", SIGNATURE, PUBKEY), None);
    }

    #[test]
    fn missing_cache_reads_as_nothing() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read_cache(dir.path(), "1.2.3", SIGNATURE, PUBKEY), None);
    }

    #[test]
    fn rewriting_the_cache_replaces_the_previous_version() {
        let dir = tempfile::tempdir().unwrap();
        write_cache(dir.path(), "1.2.2", b"old").unwrap();
        write_cache(dir.path(), "1.2.3", PAYLOAD).unwrap();
        assert_eq!(read_cache(dir.path(), "1.2.2", SIGNATURE, PUBKEY), None);
        assert!(read_cache(dir.path(), "1.2.3", SIGNATURE, PUBKEY).is_some());
    }

    #[test]
    fn linux_appimage_self_updates() {
        assert_eq!(
            classify_install(Os::Linux, true, Path::new("/tmp/Voltius.AppImage"), true),
            InstallKind::SelfUpdate
        );
    }

    #[test]
    fn linux_package_is_external() {
        assert_eq!(
            classify_install(Os::Linux, false, Path::new("/usr/bin/voltius"), true),
            InstallKind::External
        );
    }

    #[test]
    fn macos_in_applications_self_updates() {
        assert_eq!(
            classify_install(
                Os::Macos,
                false,
                Path::new("/Applications/Voltius.app/Contents/MacOS/Voltius"),
                true
            ),
            InstallKind::SelfUpdate
        );
    }

    #[test]
    fn macos_from_dmg_is_external() {
        assert_eq!(
            classify_install(
                Os::Macos,
                false,
                Path::new("/Volumes/Voltius/Voltius.app/Contents/MacOS/Voltius"),
                true
            ),
            InstallKind::External
        );
    }

    #[test]
    fn macos_translocated_is_external() {
        assert_eq!(
            classify_install(
                Os::Macos,
                false,
                Path::new("/private/var/folders/x/AppTranslocation/ABC/d/Voltius.app/Contents/MacOS/Voltius"),
                true
            ),
            InstallKind::External
        );
    }

    #[test]
    fn macos_unwritable_bundle_is_external() {
        assert_eq!(
            classify_install(
                Os::Macos,
                false,
                Path::new("/Applications/Voltius.app/Contents/MacOS/Voltius"),
                false
            ),
            InstallKind::External
        );
    }

    #[test]
    fn windows_self_updates() {
        assert_eq!(
            classify_install(
                Os::Windows,
                false,
                Path::new(r"C:\Program Files\Voltius\voltius.exe"),
                true
            ),
            InstallKind::SelfUpdate
        );
    }

    #[test]
    fn windows_msix_package_is_external() {
        assert_eq!(
            classify_install(
                Os::Windows,
                false,
                Path::new(
                    r"C:\Program Files\WindowsApps\Voltius_0.27.0.0_x64__abcdefg\voltius.exe"
                ),
                true
            ),
            InstallKind::External
        );
    }
}
