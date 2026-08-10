use tauri::{AppHandle, State};

use crate::{
    proxmox::{
        remote,
        types::{LxcAction, LxcContainer, LxcSnapshot},
    },
    sftp::SftpManager,
    ssh::{channel_io::open_exec_session, session::SessionManager},
};

fn local_err() -> String {
    "Proxmox LXC management requires an SSH session to a Proxmox VE host".to_string()
}

#[tauri::command]
pub async fn proxmox_lxc_list(
    session_manager: State<'_, SessionManager>,
    session_id: String,
    is_remote: bool,
    _local_shell: Option<String>,
) -> Result<Vec<LxcContainer>, String> {
    if is_remote {
        let handle = session_manager.get_handle(&session_id).await?;
        remote::list_containers(&handle).await
    } else {
        Err(local_err())
    }
}

#[tauri::command]
pub async fn proxmox_lxc_action(
    session_manager: State<'_, SessionManager>,
    session_id: String,
    is_remote: bool,
    _local_shell: Option<String>,
    vmid: u32,
    action: LxcAction,
) -> Result<(), String> {
    if is_remote {
        let handle = session_manager.get_handle(&session_id).await?;
        remote::container_action(&handle, vmid, &action).await
    } else {
        Err(local_err())
    }
}

#[tauri::command]
pub async fn proxmox_lxc_list_snapshots(
    session_manager: State<'_, SessionManager>,
    session_id: String,
    is_remote: bool,
    _local_shell: Option<String>,
    vmid: u32,
) -> Result<Vec<LxcSnapshot>, String> {
    if is_remote {
        let handle = session_manager.get_handle(&session_id).await?;
        remote::list_snapshots(&handle, vmid).await
    } else {
        Err(local_err())
    }
}

#[tauri::command]
pub async fn proxmox_lxc_snapshot_create(
    session_manager: State<'_, SessionManager>,
    session_id: String,
    is_remote: bool,
    _local_shell: Option<String>,
    vmid: u32,
    snapname: String,
    description: Option<String>,
) -> Result<(), String> {
    if is_remote {
        let handle = session_manager.get_handle(&session_id).await?;
        remote::snapshot_create(&handle, vmid, &snapname, description.as_deref()).await
    } else {
        Err(local_err())
    }
}

#[tauri::command]
pub async fn proxmox_lxc_snapshot_rollback(
    session_manager: State<'_, SessionManager>,
    session_id: String,
    is_remote: bool,
    _local_shell: Option<String>,
    vmid: u32,
    snapname: String,
) -> Result<(), String> {
    if is_remote {
        let handle = session_manager.get_handle(&session_id).await?;
        remote::snapshot_rollback(&handle, vmid, &snapname).await
    } else {
        Err(local_err())
    }
}

#[tauri::command]
pub async fn proxmox_lxc_snapshot_delete(
    session_manager: State<'_, SessionManager>,
    session_id: String,
    is_remote: bool,
    _local_shell: Option<String>,
    vmid: u32,
    snapname: String,
) -> Result<(), String> {
    if is_remote {
        let handle = session_manager.get_handle(&session_id).await?;
        remote::snapshot_delete(&handle, vmid, &snapname).await
    } else {
        Err(local_err())
    }
}

#[tauri::command]
pub async fn proxmox_lxc_open_shell(
    app: AppHandle,
    session_manager: State<'_, SessionManager>,
    session_id: String,
    vmid: u32,
) -> Result<String, String> {
    let handle = session_manager.get_handle(&session_id).await?;
    // Use `pct exec … -- sh -c` (instead of `pct enter`) so we can inject OSC 7
    // cwd reporting into the LXC shell, enabling the SFTP panel's "follow cwd".
    let cmd = format!(
        "pct exec {vmid} -- sh -c '{}'",
        crate::shell_integration::container_exec_payload()
    );
    open_exec_session(app, &session_manager, handle, &cmd).await
}

/// Open an SFTP session rooted inside an LXC container by exec-ing sftp-server via pct.
#[tauri::command]
pub async fn proxmox_lxc_sftp_open(
    session_manager: State<'_, SessionManager>,
    sftp_state: State<'_, SftpManager>,
    session_id: String,
    vmid: u32,
) -> Result<String, String> {
    let handle = session_manager.get_session_handle(&session_id).await?;
    let cmd = format!(
        "pct exec {} -- sh -c 'for p in /usr/lib/openssh/sftp-server /usr/lib/ssh/sftp-server /usr/libexec/openssh/sftp-server /usr/sbin/sftp-server; do [ -x \"$p\" ] && exec \"$p\"; done; exit 127'",
        vmid
    );
    sftp_state.open_exec(handle, &cmd).await
}
