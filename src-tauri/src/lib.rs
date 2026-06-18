// Many Tauri command handlers take a wide parameter list that mirrors the
// JS-side `invoke` call (host, port, user, key, …). Bundling these into param
// structs would change the JS-facing API, so the lint is allowed crate-wide
// rather than worked around per-call.
#![allow(clippy::too_many_arguments)]

#[cfg(target_os = "android")]
mod android_ctx;
mod commands;
mod crypto;
mod docker;
mod error;
#[cfg(target_os = "android")]
mod keychain_android;
mod known_hosts;
mod local;
mod metrics;
mod port_forward;
mod processes;
mod proxmox;
mod serial;
mod sftp;
mod shell_integration;
mod ssh;
mod storage;
mod vault_auth;

use commands::http::HttpSseStreamManager;
use docker::stream::DockerLogStreamManager;
use known_hosts::{KnownHostsStore, PendingConflicts};
use local::session::LocalSessionManager;
use metrics::stream::MetricsStreamManager;
use port_forward::PortForwardManager;
use processes::stream::ProcessStreamManager;
use serial::connect::SerialSessionManager;
use sftp::SftpManager;
use ssh::session::SessionManager;
use std::sync::{Arc, Mutex};
use storage::secrets::SecretsStore;

#[cfg(desktop)]
struct PendingUpdate(Mutex<Option<(tauri_plugin_updater::Update, Vec<u8>)>>);

#[cfg(desktop)]
struct UpdaterBusy(std::sync::Arc<std::sync::atomic::AtomicBool>);

#[cfg(desktop)]
struct BusyGuard(std::sync::Arc<std::sync::atomic::AtomicBool>);

#[cfg(desktop)]
impl Drop for BusyGuard {
    fn drop(&mut self) {
        self.0.store(false, std::sync::atomic::Ordering::SeqCst);
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
        Os::Windows => InstallKind::SelfUpdate,
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

#[derive(Clone, serde::Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
enum UpdaterEvent {
    Checking,
    UpToDate,
    Downloading { version: String, progress: u8 },
    Ready { version: String },
    ExternalUpdate { version: String },
    Error { message: String },
}

#[cfg(desktop)]
async fn check_for_update(handle: tauri::AppHandle) {
    use tauri::{Emitter, Manager};
    use tauri_plugin_updater::UpdaterExt;

    use std::sync::atomic::Ordering;
    let flag = handle.state::<UpdaterBusy>().0.clone();
    if flag
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return; // a check is already running
    }
    let _busy = BusyGuard(flag); // released on every return path

    let _ = handle.emit("updater-status", UpdaterEvent::Checking);

    let updater = match handle.updater_builder().build() {
        Ok(u) => u,
        Err(e) => {
            let _ = handle.emit(
                "updater-status",
                UpdaterEvent::Error {
                    message: e.to_string(),
                },
            );
            return;
        }
    };

    let update = match updater.check().await {
        Ok(Some(u)) => u,
        Ok(None) => {
            let _ = handle.emit("updater-status", UpdaterEvent::UpToDate);
            return;
        }
        Err(e) => {
            let _ = handle.emit(
                "updater-status",
                UpdaterEvent::Error {
                    message: e.to_string(),
                },
            );
            return;
        }
    };

    // Installs that can't self-update (Linux deb/rpm, macOS from dmg /
    // translocated, etc.) must not download/install — notify instead.
    if !self_update_capable() {
        let _ = handle.emit(
            "updater-status",
            UpdaterEvent::ExternalUpdate {
                version: update.version.clone(),
            },
        );
        return;
    }

    let version = update.version.clone();
    let pending = handle.state::<PendingUpdate>();

    let _ = handle.emit(
        "updater-status",
        UpdaterEvent::Downloading {
            version: version.clone(),
            progress: 0,
        },
    );

    let mut downloaded: u64 = 0;
    let mut total: u64 = 0;
    let handle_clone = handle.clone();
    let version_clone = version.clone();

    let bytes = match update
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
                let _ = handle_clone.emit(
                    "updater-status",
                    UpdaterEvent::Downloading {
                        version: version_clone.clone(),
                        progress,
                    },
                );
            },
            || {},
        )
        .await
    {
        Ok(b) => b,
        Err(e) => {
            let _ = handle.emit(
                "updater-status",
                UpdaterEvent::Error {
                    message: e.to_string(),
                },
            );
            return;
        }
    };

    *pending.0.lock().unwrap() = Some((update, bytes));
    let _ = handle.emit("updater-status", UpdaterEvent::Ready { version });
}

#[tauri::command]
fn force_quit(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn updater_restart(app: tauri::AppHandle) {
    #[cfg(desktop)]
    {
        use tauri::{Emitter, Manager};
        let pending = app.state::<PendingUpdate>();
        let taken = pending.0.lock().unwrap().take();
        if let Some((update, bytes)) = taken {
            if let Err(e) = update.install(bytes) {
                let _ = app.emit(
                    "updater-status",
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

#[tauri::command]
async fn updater_check(app: tauri::AppHandle) {
    #[cfg(desktop)]
    check_for_update(app).await;
    #[cfg(not(desktop))]
    let _ = app;
}

/// Register the OS-native credential store as keyring-core's default. Exactly one
/// branch is active per target; other platforms get a no-op (keychain unavailable).
fn init_keychain_store() -> keyring_core::Result<()> {
    #[cfg(target_os = "linux")]
    keyring_core::set_default_store(linux_keyutils_keyring_store::Store::new_with_configuration(
        &std::collections::HashMap::<&str, &str>::new(),
    )?);
    #[cfg(target_os = "macos")]
    keyring_core::set_default_store(
        apple_native_keyring_store::keychain::Store::new_with_configuration(
            &std::collections::HashMap::<&str, &str>::new(),
        )?,
    );
    #[cfg(target_os = "windows")]
    keyring_core::set_default_store(windows_native_keyring_store::Store::new_with_configuration(
        &std::collections::HashMap::<&str, &str>::new(),
    )?);
    #[cfg(target_os = "android")]
    keyring_core::set_default_store(crate::keychain_android::Store::new());
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Tauri's default async runtime uses tokio's default worker-thread stack,
    // which on Windows is too small for process_kill's call chain (sysinfo
    // refresh / russh channel I/O) and overflows the stack
    // (STATUS_STACK_OVERFLOW, 0xc00000fd), aborting the whole process. Register
    // a runtime with a generous stack so commands get the headroom Linux gives
    // by default. Must run before any async_runtime use.
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .thread_stack_size(8 * 1024 * 1024)
        .build()
        .expect("failed to build tokio runtime");
    tauri::async_runtime::set(runtime.handle().clone());
    std::mem::forget(runtime); // runtime must outlive the app

    // keyring-core requires registering a platform credential store before any
    // `Entry` use. We register only the native store per-OS (keyutils on Linux,
    // Keychain on macOS, Credential Manager on Windows) to avoid the `keyring`
    // umbrella crate, which also pulls in a SQLite (turso) keystore we don't use.
    if let Err(e) = init_keychain_store() {
        log::error!("Failed to initialize OS keychain store: {e}");
    }

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init());

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .setup(|app| {
            use tauri::Manager;

            // On Android `dirs::config_dir()` resolves to an unwritable cwd, so
            // pin generic file storage (connections, plugins, identities, …) to
            // the app's scoped data dir — the same dir the vault already uses.
            #[cfg(target_os = "android")]
            if let Ok(dir) = app.path().app_data_dir() {
                crate::storage::config::set_config_dir(dir.join("voltius"));
            }

            #[cfg(desktop)]
            app.manage(PendingUpdate(Mutex::new(None)));
            #[cfg(desktop)]
            app.manage(UpdaterBusy(std::sync::Arc::new(
                std::sync::atomic::AtomicBool::new(false),
            )));
            app.manage(KnownHostsStore::load());
            app.manage(Arc::new(PendingConflicts::new()));
            app.manage(PortForwardManager::new(app.handle().clone()));

            #[cfg(all(desktop, not(debug_assertions)))]
            {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    // Short delay so the window is visible before we start network I/O
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                    if commands::sync::updater_auto_enabled() {
                        check_for_update(handle.clone()).await;
                    }
                    // Re-check every 4 hours while the app is running
                    let mut interval =
                        tokio::time::interval(std::time::Duration::from_secs(4 * 60 * 60));
                    interval.tick().await; // consume the immediate first tick
                    loop {
                        interval.tick().await;
                        if commands::sync::updater_auto_enabled() {
                            check_for_update(handle.clone()).await;
                        }
                    }
                });
            }

            Ok(())
        })
        .manage(DockerLogStreamManager::new())
        .manage(HttpSseStreamManager::new())
        .manage(MetricsStreamManager::new())
        .manage(ProcessStreamManager::new())
        .manage(SessionManager::new())
        .manage(LocalSessionManager::new())
        .manage(SecretsStore::new())
        .manage(SftpManager::new())
        .manage(SerialSessionManager::new())
        .invoke_handler(tauri::generate_handler![
            force_quit,
            updater_restart,
            updater_check,
            commands::greet,
            commands::get_platform,
            commands::ping::ping_host,
            commands::ping::ping_host_via_jumps,
            commands::connections::connection_list,
            commands::connections::connection_save,
            commands::connections::connection_update,
            commands::connections::connection_delete,
            commands::connections::connection_set_distro,
            commands::connections::connection_set_last_used,
            commands::folders::folder_list,
            commands::folders::folder_save,
            commands::folders::folder_update,
            commands::folders::folder_delete,
            commands::folders::folder_move_objects,
            commands::identities::identity_list,
            commands::identities::identity_save,
            commands::identities::identity_update,
            commands::identities::identity_delete,
            commands::keys::key_list,
            commands::keys::key_save,
            commands::keys::key_update,
            commands::keys::key_delete,
            commands::keygen::generate_ssh_keypair,
            commands::vault::vault_status,
            commands::vault::vault_reset,
            commands::vault::config_wipe,
            commands::vault::get_machine_fingerprint,
            commands::crypto::derive_keys,
            commands::crypto::derive_gist_key,
            commands::crypto::generate_keypair,
            commands::crypto::wrap_user_secrets_cmd,
            commands::crypto::unwrap_user_secrets_cmd,
            commands::crypto::generate_user_secrets_cmd,
            commands::team_crypto::derive_x25519_keypair,
            commands::team_crypto::generate_session_key,
            commands::team_crypto::x25519_wrap_key,
            commands::team_crypto::x25519_unwrap_key,
            commands::keychain::keychain_get,
            commands::keychain::keychain_set,
            commands::keychain::keychain_delete,
            storage::secrets::secrets_unlock,
            storage::secrets::secrets_verify,
            storage::secrets::secrets_exists,
            storage::secrets::secrets_lock,
            storage::secrets::secrets_reencrypt,
            storage::secrets::secrets_rekey,
            storage::secrets::secrets_get,
            storage::secrets::secrets_set,
            storage::secrets::secrets_delete,
            storage::secrets::secrets_wipe,
            commands::sync::backup_export,
            commands::sync::backup_import,
            commands::sync::backup_decrypt,
            commands::sync::state_export_raw,
            commands::sync::state_import,
            commands::sync::encrypt_payload,
            commands::sync::theme_load,
            commands::sync::theme_save,
            commands::sync::settings_load,
            commands::sync::updater_get_auto,
            commands::sync::updater_set_auto,
            commands::sync::settings_save,
            commands::sync::live_sessions_load,
            commands::sync::live_sessions_save,
            commands::sync::device_hostname,
            commands::ssh::ssh_connect,
            commands::ssh::ssh_disconnect,
            commands::ssh::ssh_send_input,
            commands::ssh::ssh_resize,
            commands::ssh::ssh_detect_distro,
            commands::ssh::ssh_get_system_info,
            commands::ssh::ssh_exec_command,
            commands::known_hosts::known_host_list,
            commands::known_hosts::known_host_delete,
            commands::known_hosts::known_host_move_vault,
            commands::known_hosts::known_host_copy_vault,
            commands::known_hosts::known_host_resolve,
            commands::local::local_list_shells,
            commands::local::local_connect,
            commands::local::local_disconnect,
            commands::local::local_send_input,
            commands::local::local_resize,
            commands::http::http_request,
            commands::http::http_sse_start,
            commands::http::http_sse_stop,
            commands::termius::termius_extract,
            commands::termius::termius_extract_debug,
            commands::termius::termius_extract_leveldb_keys,
            commands::mobaxterm::mobaxterm_extract,
            commands::fs::fs_home_dir,
            commands::fs::fs_list_dir,
            commands::wsl::wsl_list_distros,
            commands::wsl::wsl_home_dir,
            commands::fs::fs_tar_available,
            commands::fs::fs_read_text_home,
            commands::fs::fs_write_text_home,
            commands::fs::fs_exists_home,
            commands::fs::fs_stat,
            commands::fs::fs_mkdir,
            commands::fs::fs_rename,
            commands::fs::fs_delete,
            commands::fs::fs_touch,
            commands::fs::fs_copy,
            commands::fs::fs_compress,
            commands::fs::fs_extract,
            commands::sftp::sftp_cancel_transfer,
            commands::sftp::sftp_stat,
            commands::sftp::sftp_connect,
            commands::sftp::sftp_open,
            commands::sftp::sftp_close,
            commands::sftp::sftp_list_dir,
            commands::sftp::sftp_canonicalize,
            commands::sftp::sftp_mkdir,
            commands::sftp::sftp_touch,
            commands::sftp::sftp_rename,
            commands::sftp::sftp_delete,
            commands::sftp::sftp_upload,
            commands::sftp::sftp_download,
            commands::sftp::sftp_upload_dir,
            commands::sftp::sftp_download_dir,
            commands::sftp::sftp_transfer,
            commands::sftp::sftp_transfer_dir,
            commands::sftp::sftp_compress,
            commands::sftp::sftp_extract,
            commands::sftp::sftp_upload_dir_tar,
            commands::sftp::sftp_download_dir_tar,
            commands::sftp::sftp_transfer_dir_tar,
            commands::sftp::sftp_tar_available,
            commands::sftp::sftp_upload_batch_tar,
            commands::sftp::sftp_download_batch_tar,
            commands::downloads::download_temp_path,
            commands::downloads::download_dir_get,
            commands::downloads::download_dir_pick,
            commands::downloads::download_dir_clear,
            commands::downloads::download_publish,
            commands::sftp::sftp_transfer_batch_tar,
            commands::plugin_storage::plugin_storage_get,
            commands::plugin_storage::plugin_storage_set,
            commands::plugin_storage::plugin_storage_delete,
            commands::plugin_registry::plugin_registry_load,
            commands::plugin_registry::plugin_registry_save,
            commands::plugins::plugins_list_installed,
            commands::plugins::plugin_read_file,
            commands::plugins::plugin_write_file,
            commands::plugins::plugin_delete,
            commands::plugins::plugin_resolve_path,
            commands::plugins::plugin_fetch_url,
            commands::snippets::snippet_list,
            commands::snippets::snippet_create,
            commands::snippets::snippet_update,
            commands::snippets::snippet_delete,
            commands::snippets::snippet_inject,
            commands::snippets::snippet_folder_list,
            commands::snippets::snippet_folder_create,
            commands::snippets::snippet_folder_update,
            commands::snippets::snippet_folder_delete,
            commands::port_forwarding_rules::pf_rule_list,
            commands::port_forwarding_rules::pf_rule_create,
            commands::port_forwarding_rules::pf_rule_update,
            commands::port_forwarding_rules::pf_rule_delete,
            commands::port_forwarding_rules::pf_rule_duplicate,
            commands::port_forwarding_rules::pf_rule_move_folder,
            commands::port_forwarding_tunnels::pf_get_state,
            commands::port_forwarding_tunnels::pf_tunnel_resume_auto,
            commands::port_forwarding_tunnels::pf_tunnel_list,
            commands::port_forwarding_tunnels::pf_tunnel_open,
            commands::port_forwarding_tunnels::pf_tunnel_close,
            commands::port_forwarding_tunnels::pf_tunnel_get_auto,
            commands::port_forwarding_tunnels::pf_tunnel_set_auto,
            commands::metrics::metrics_start,
            commands::metrics::metrics_stop,
            commands::processes::processes_start,
            commands::processes::processes_stop,
            commands::processes::process_kill,
            commands::sysinfo::get_system_info,
            commands::sysinfo::get_connected_system_info,
            commands::docker::docker_list_containers,
            commands::docker::docker_list_images,
            commands::docker::docker_list_volumes,
            commands::docker::docker_list_networks,
            commands::docker::docker_container_action,
            commands::docker::docker_start_log_stream,
            commands::docker::docker_start_stack_log_stream,
            commands::docker::docker_stop_log_stream,
            commands::docker::docker_remove_image,
            commands::docker::docker_check_image_update,
            commands::docker::docker_pull_image,
            commands::docker::docker_update_image,
            commands::docker::docker_recreate_image_containers,
            commands::docker::docker_container_run_command,
            commands::docker::docker_stack_update,
            commands::docker::docker_remove_volume,
            commands::docker::docker_remove_network,
            commands::docker::docker_prune_images,
            commands::docker::docker_prune_volumes,
            commands::docker::docker_prune_networks,
            commands::docker::docker_system_prune,
            commands::docker::docker_list_stacks,
            commands::docker::docker_list_stack_services,
            commands::docker::docker_stack_action,
            commands::docker::docker_open_exec_session,
            commands::docker::docker_sftp_open,
            commands::proxmox::proxmox_lxc_list,
            commands::proxmox::proxmox_lxc_action,
            commands::proxmox::proxmox_lxc_list_snapshots,
            commands::proxmox::proxmox_lxc_snapshot_create,
            commands::proxmox::proxmox_lxc_snapshot_rollback,
            commands::proxmox::proxmox_lxc_snapshot_delete,
            commands::proxmox::proxmox_lxc_open_shell,
            commands::proxmox::proxmox_lxc_sftp_open,
            serial::connect::serial_list_ports,
            serial::connect::serial_connect,
            serial::connect::serial_write,
            serial::connect::serial_disconnect,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(all(test, desktop))]
mod updater_tests {
    use super::{classify_install, InstallKind, Os};
    use std::path::Path;

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
}
