use russh::ChannelMsg;
use tauri::{AppHandle, Emitter, State};
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

use crate::{
    proxmox::{
        remote,
        types::{LxcAction, LxcContainer, LxcSnapshot},
    },
    ssh::{
        client::{ConnectedSession, SessionInput},
        session::SessionManager,
    },
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
    let new_session_id = Uuid::new_v4().to_string();

    let channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("channel error: {e}"))?;

    channel
        .request_pty(false, "xterm-256color", 80, 24, 0, 0, &[])
        .await
        .map_err(|e| format!("PTY error: {e}"))?;

    let cmd = format!("pct enter {vmid}");
    channel
        .exec(false, cmd.as_str())
        .await
        .map_err(|e| format!("exec error: {e}"))?;

    let (input_tx, mut input_rx) = tokio::sync::mpsc::channel::<SessionInput>(256);
    let (shutdown_tx, mut shutdown_rx) = tokio::sync::mpsc::channel::<()>(1);

    let event_name = format!("ssh-output-{}", new_session_id);
    let close_event = format!("ssh-closed-{}", new_session_id);

    let (mut read_half, write_half) = channel.split();
    let mut writer = write_half.make_writer();

    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = shutdown_rx.recv() => break,
                input = input_rx.recv() => {
                    match input {
                        Some(SessionInput::Data(data)) => {
                            if writer.write_all(&data).await.is_err() { break; }
                        }
                        Some(SessionInput::Resize(cols, rows)) => {
                            let _ = write_half.window_change(cols, rows, 0, 0).await;
                        }
                        None => break,
                    }
                }
                msg = read_half.wait() => {
                    match msg {
                        Some(ChannelMsg::Data { data }) | Some(ChannelMsg::ExtendedData { data, .. }) => {
                            let _ = app.emit(&event_name, data.as_ref());
                        }
                        Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => {
                            let _ = app.emit(&close_event, ());
                            break;
                        }
                        _ => {}
                    }
                }
            }
        }
    });

    session_manager
        .add(
            new_session_id.clone(),
            ConnectedSession {
                handle,
                input_tx,
                shutdown_tx,
                channel_only: true,
                _jump_handles: vec![],
                remote_routes: std::sync::Arc::new(tokio::sync::Mutex::new(
                    std::collections::HashMap::new(),
                )),
            },
        )
        .await;

    Ok(new_session_id)
}
