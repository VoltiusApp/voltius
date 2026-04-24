mod commands;
mod crypto;
mod docker;
mod metrics;
mod known_hosts;
mod local;
mod port_forward;
mod sftp;
mod ssh;
mod storage;
mod vault_auth;

use docker::stream::DockerLogStreamManager;
use known_hosts::{KnownHostsStore, PendingConflicts};
use metrics::stream::MetricsStreamManager;
use port_forward::PortForwardManager;
use std::sync::{Arc, Mutex};
use local::session::LocalSessionManager;
use sftp::SftpManager;
use ssh::session::SessionManager;
use storage::secrets::SecretsStore;

#[cfg(desktop)]
struct PendingUpdate(Mutex<Option<(tauri_plugin_updater::Update, Vec<u8>)>>);

#[cfg(desktop)]
fn update_cache_dir(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    use tauri::Manager;
    app.path().app_data_dir().ok().map(|d| d.join("pending_update"))
}

#[cfg(desktop)]
fn cached_update_version(app: &tauri::AppHandle) -> Option<String> {
    std::fs::read_to_string(update_cache_dir(app)?.join("version"))
        .ok()
        .map(|s| s.trim().to_string())
}

#[cfg(desktop)]
fn save_update_cache(app: &tauri::AppHandle, version: &str, bytes: &[u8]) {
    if let Some(dir) = update_cache_dir(app) {
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::write(dir.join("update.bin"), bytes);
        let _ = std::fs::write(dir.join("version"), version);
    }
}

#[cfg(desktop)]
fn clear_update_cache(app: &tauri::AppHandle) {
    if let Some(dir) = update_cache_dir(app) {
        let _ = std::fs::remove_dir_all(dir);
    }
}

#[derive(Clone, serde::Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
enum UpdaterEvent {
    Checking,
    UpToDate,
    Downloading { version: String, progress: u8 },
    Ready { version: String },
    Error { message: String },
}

#[cfg(desktop)]
async fn check_for_update(handle: tauri::AppHandle) {
    use tauri::{Emitter, Manager};
    use tauri_plugin_updater::UpdaterExt;

    let _ = handle.emit("updater-status", UpdaterEvent::Checking);

    let updater = match handle.updater_builder().build() {
        Ok(u) => u,
        Err(e) => {
            let _ = handle.emit("updater-status", UpdaterEvent::Error { message: e.to_string() });
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
            let _ = handle.emit("updater-status", UpdaterEvent::Error { message: e.to_string() });
            return;
        }
    };

    let version = update.version.clone();
    let pending = handle.state::<PendingUpdate>();

    // Skip re-download if we already have this version cached on disk
    if cached_update_version(&handle).as_deref() == Some(version.as_str()) {
        if let Some(dir) = update_cache_dir(&handle) {
            if let Ok(bytes) = std::fs::read(dir.join("update.bin")) {
                *pending.0.lock().unwrap() = Some((update, bytes));
                let _ = handle.emit("updater-status", UpdaterEvent::Ready { version });
                return;
            }
        }
    }
    clear_update_cache(&handle);

    let _ = handle.emit("updater-status", UpdaterEvent::Downloading { version: version.clone(), progress: 0 });

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
                let progress = if total > 0 {
                    ((downloaded * 100) / total).min(99) as u8
                } else {
                    0
                };
                let _ = handle_clone.emit(
                    "updater-status",
                    UpdaterEvent::Downloading { version: version_clone.clone(), progress },
                );
            },
            || {},
        )
        .await
    {
        Ok(b) => b,
        Err(e) => {
            let _ = handle.emit("updater-status", UpdaterEvent::Error { message: e.to_string() });
            return;
        }
    };

    save_update_cache(&handle, &version, &bytes);
    *pending.0.lock().unwrap() = Some((update, bytes));
    let _ = handle.emit("updater-status", UpdaterEvent::Ready { version });
}

#[tauri::command]
fn updater_restart(app: tauri::AppHandle) {
    #[cfg(desktop)]
    {
        use tauri::Manager;
        let pending = app.state::<PendingUpdate>();
        if let Some((update, bytes)) = pending.0.lock().unwrap().take() {
            let _ = update.install(bytes);
            clear_update_cache(&app);
        };
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init());

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .setup(|app| {
            use tauri::Manager;
            #[cfg(desktop)]
            app.manage(PendingUpdate(Mutex::new(None)));
            app.manage(KnownHostsStore::load());
            app.manage(Arc::new(PendingConflicts::new()));
            app.manage(PortForwardManager::new(app.handle().clone()));

            #[cfg(all(desktop, not(debug_assertions)))]
            {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    // Short delay so the window is visible before we start network I/O
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                    check_for_update(handle.clone()).await;
                    // Re-check every 4 hours while the app is running
                    let mut interval = tokio::time::interval(std::time::Duration::from_secs(4 * 60 * 60));
                    interval.tick().await; // consume the immediate first tick
                    loop {
                        interval.tick().await;
                        check_for_update(handle.clone()).await;
                    }
                });
            }

            Ok(())
        })
        .manage(DockerLogStreamManager::new())
        .manage(MetricsStreamManager::new())
        .manage(SessionManager::new())
        .manage(LocalSessionManager::new())
        .manage(SecretsStore::new())
        .manage(SftpManager::new())
        .invoke_handler(tauri::generate_handler![
            updater_restart,
            updater_check,
            commands::greet,
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
            commands::crypto::derive_keys,
            commands::crypto::generate_keypair,
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
            commands::ssh::ssh_connect,
            commands::ssh::ssh_disconnect,
            commands::ssh::ssh_send_input,
            commands::ssh::ssh_resize,
            commands::ssh::ssh_detect_distro,
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
            commands::fs::fs_home_dir,
            commands::fs::fs_list_dir,
            commands::fs::fs_read_text_home,
            commands::fs::fs_write_text_home,
            commands::fs::fs_exists_home,
            commands::fs::fs_stat,
            commands::fs::fs_mkdir,
            commands::fs::fs_rename,
            commands::fs::fs_delete,
            commands::fs::fs_touch,
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
            commands::sftp::sftp_upload_batch_tar,
            commands::sftp::sftp_download_batch_tar,
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
            commands::docker::docker_list_containers,
            commands::docker::docker_list_images,
            commands::docker::docker_list_volumes,
            commands::docker::docker_list_networks,
            commands::docker::docker_container_action,
            commands::docker::docker_start_log_stream,
            commands::docker::docker_stop_log_stream,
            commands::docker::docker_remove_image,
            commands::docker::docker_remove_volume,
            commands::docker::docker_remove_network,
            commands::docker::docker_prune_images,
            commands::docker::docker_prune_volumes,
            commands::docker::docker_prune_networks,
            commands::docker::docker_system_prune,
            commands::docker::docker_open_exec_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
