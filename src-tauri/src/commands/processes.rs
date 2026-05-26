use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::{
    processes::{local::LocalProcesses, remote::RemoteProcesses, stream::ProcessStreamManager},
    ssh::session::SessionManager,
};

#[tauri::command]
pub async fn processes_start(
    app: AppHandle,
    stream_manager: State<'_, ProcessStreamManager>,
    session_manager: State<'_, SessionManager>,
    session_id: String,
    is_remote: bool,
) -> Result<String, String> {
    let stream_id = Uuid::new_v4().to_string();
    let event = format!("processes:snapshot:{}", stream_id);

    let join_handle = if is_remote {
        let handle = session_manager.get_handle(&session_id).await?;
        let app = app.clone();
        tokio::spawn(async move {
            loop {
                match RemoteProcesses::snapshot(&handle).await {
                    Ok(snap) => {
                        let _ = app.emit(&event, &snap);
                    }
                    Err(_) => break,
                }
                tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
            }
        })
    } else {
        let app = app.clone();
        tokio::spawn(async move {
            let mut local = LocalProcesses::new();
            loop {
                let snap = local.snapshot();
                let _ = app.emit(&event, &snap);
                tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
            }
        })
    };

    stream_manager
        .streams
        .lock()
        .await
        .insert(stream_id.clone(), join_handle);

    Ok(stream_id)
}

#[tauri::command]
pub async fn processes_stop(
    stream_manager: State<'_, ProcessStreamManager>,
    stream_id: String,
) -> Result<(), String> {
    stream_manager.stop(&stream_id).await;
    Ok(())
}

#[tauri::command]
pub async fn process_kill(
    session_manager: State<'_, SessionManager>,
    pid: u32,
    session_id: String,
    is_remote: bool,
    force: bool,
) -> Result<(), String> {
    if is_remote {
        let handle = session_manager.get_handle(&session_id).await?;
        RemoteProcesses::kill(&handle, pid, force).await
    } else {
        // Spin up a fresh System to locate the process at kill time
        let local = LocalProcesses::new();
        local.kill(pid, force)
    }
}
