use russh::ChannelMsg;
use tauri::{AppHandle, Emitter, State};
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

use crate::{
    docker::{
        local, remote,
        stream::DockerLogStreamManager,
        types::{
            ContainerAction, DockerContainer, DockerImage, DockerNetwork, DockerStack,
            DockerStackService, DockerVolume, ImageUpdateStatus, RecreateResult, StackAction,
        },
    },
    ssh::{
        client::{ConnectedSession, SessionInput},
        session::SessionManager,
    },
};

#[tauri::command]
pub async fn docker_list_containers(
    session_manager: State<'_, SessionManager>,
    session_id: String,
    is_remote: bool,
    local_shell: Option<String>,
    all: bool,
) -> Result<Vec<DockerContainer>, String> {
    if is_remote {
        let handle = session_manager.get_handle(&session_id).await?;
        remote::list_containers(&handle, all).await
    } else {
        local::list_containers(local_shell.as_deref(), all).await
    }
}

#[tauri::command]
pub async fn docker_list_images(
    session_manager: State<'_, SessionManager>,
    session_id: String,
    is_remote: bool,
    local_shell: Option<String>,
) -> Result<Vec<DockerImage>, String> {
    if is_remote {
        let handle = session_manager.get_handle(&session_id).await?;
        remote::list_images(&handle).await
    } else {
        local::list_images(local_shell.as_deref()).await
    }
}

#[tauri::command]
pub async fn docker_list_volumes(
    session_manager: State<'_, SessionManager>,
    session_id: String,
    is_remote: bool,
    local_shell: Option<String>,
) -> Result<Vec<DockerVolume>, String> {
    if is_remote {
        let handle = session_manager.get_handle(&session_id).await?;
        remote::list_volumes(&handle).await
    } else {
        local::list_volumes(local_shell.as_deref()).await
    }
}

#[tauri::command]
pub async fn docker_list_networks(
    session_manager: State<'_, SessionManager>,
    session_id: String,
    is_remote: bool,
    local_shell: Option<String>,
) -> Result<Vec<DockerNetwork>, String> {
    if is_remote {
        let handle = session_manager.get_handle(&session_id).await?;
        remote::list_networks(&handle).await
    } else {
        local::list_networks(local_shell.as_deref()).await
    }
}

#[tauri::command]
pub async fn docker_container_action(
    session_manager: State<'_, SessionManager>,
    session_id: String,
    is_remote: bool,
    local_shell: Option<String>,
    container_id: String,
    action: ContainerAction,
) -> Result<(), String> {
    if is_remote {
        let handle = session_manager.get_handle(&session_id).await?;
        remote::container_action(&handle, &container_id, &action).await
    } else {
        local::container_action(local_shell.as_deref(), &container_id, &action).await
    }
}

#[tauri::command]
pub async fn docker_start_log_stream(
    app: AppHandle,
    session_manager: State<'_, SessionManager>,
    stream_manager: State<'_, DockerLogStreamManager>,
    session_id: String,
    is_remote: bool,
    local_shell: Option<String>,
    container_id: String,
    tail: u32,
) -> Result<String, String> {
    let stream_id = Uuid::new_v4().to_string();

    let join_handle = if is_remote {
        let handle = session_manager.get_handle(&session_id).await?;
        let app = app.clone();
        let sid = stream_id.clone();
        let cid = container_id.clone();
        tokio::spawn(async move {
            remote::stream_logs(app, sid, cid, tail, handle).await;
        })
    } else {
        let app = app.clone();
        let sid = stream_id.clone();
        let cid = container_id.clone();
        tokio::spawn(async move {
            local::stream_logs(app, sid, cid, tail, local_shell).await;
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
pub async fn docker_start_stack_log_stream(
    app: AppHandle,
    session_manager: State<'_, SessionManager>,
    stream_manager: State<'_, DockerLogStreamManager>,
    session_id: String,
    is_remote: bool,
    local_shell: Option<String>,
    stack_name: String,
    tail: u32,
) -> Result<String, String> {
    let stream_id = Uuid::new_v4().to_string();

    let join_handle = if is_remote {
        let handle = session_manager.get_handle(&session_id).await?;
        let app = app.clone();
        let sid = stream_id.clone();
        let name = stack_name.clone();
        tokio::spawn(async move {
            remote::stream_stack_logs(app, sid, name, tail, handle).await;
        })
    } else {
        let app = app.clone();
        let sid = stream_id.clone();
        let name = stack_name.clone();
        tokio::spawn(async move {
            local::stream_stack_logs(app, sid, name, tail, local_shell).await;
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
pub async fn docker_stop_log_stream(
    stream_manager: State<'_, DockerLogStreamManager>,
    stream_id: String,
) -> Result<(), String> {
    stream_manager.stop(&stream_id).await;
    Ok(())
}

#[tauri::command]
pub async fn docker_remove_image(
    session_manager: State<'_, SessionManager>,
    session_id: String,
    is_remote: bool,
    local_shell: Option<String>,
    image_id: String,
) -> Result<(), String> {
    if is_remote {
        let handle = session_manager.get_handle(&session_id).await?;
        remote::remove_image(&handle, &image_id).await
    } else {
        local::remove_image(local_shell.as_deref(), &image_id).await
    }
}

#[tauri::command]
pub async fn docker_check_image_update(
    session_manager: State<'_, SessionManager>,
    session_id: String,
    is_remote: bool,
    local_shell: Option<String>,
    image: String,
) -> Result<ImageUpdateStatus, String> {
    // Local "current" digest comes from the host the image lives on.
    let local_digest = if is_remote {
        let handle = session_manager.get_handle(&session_id).await?;
        remote::local_image_digest(&handle, &image).await
    } else {
        local::local_image_digest(local_shell.as_deref(), &image).await
    };

    // Registry digest via a quota-free HEAD (host-independent), so this never
    // touches the Docker Hub pull rate limit.
    let (remote_digest, error) = match crate::docker::registry::manifest_digest(&image).await {
        Ok(digest) => (Some(digest), None),
        Err(e) => (None, Some(e)),
    };

    Ok(crate::docker::types::build_update_status(
        image,
        local_digest,
        remote_digest,
        error,
    ))
}

#[tauri::command]
pub async fn docker_pull_image(
    session_manager: State<'_, SessionManager>,
    session_id: String,
    is_remote: bool,
    local_shell: Option<String>,
    image: String,
) -> Result<String, String> {
    if is_remote {
        let handle = session_manager.get_handle(&session_id).await?;
        remote::pull_image(&handle, &image).await
    } else {
        local::pull_image(local_shell.as_deref(), &image).await
    }
}

#[tauri::command]
pub async fn docker_stack_update(
    session_manager: State<'_, SessionManager>,
    session_id: String,
    is_remote: bool,
    local_shell: Option<String>,
    stack_name: String,
) -> Result<(), String> {
    if is_remote {
        let handle = session_manager.get_handle(&session_id).await?;
        remote::stack_update(&handle, &stack_name).await
    } else {
        local::stack_update(local_shell.as_deref(), &stack_name).await
    }
}

#[tauri::command]
pub async fn docker_container_run_command(
    session_manager: State<'_, SessionManager>,
    session_id: String,
    is_remote: bool,
    local_shell: Option<String>,
    container_id: String,
    image: String,
) -> Result<String, String> {
    if is_remote {
        let handle = session_manager.get_handle(&session_id).await?;
        remote::container_run_command(&handle, &container_id, &image).await
    } else {
        local::container_run_command(local_shell.as_deref(), &container_id, &image).await
    }
}

#[tauri::command]
pub async fn docker_update_image(
    session_manager: State<'_, SessionManager>,
    session_id: String,
    is_remote: bool,
    local_shell: Option<String>,
    image: String,
    recreate: bool,
) -> Result<RecreateResult, String> {
    if is_remote {
        let handle = session_manager.get_handle(&session_id).await?;
        remote::pull_and_recreate(&handle, &image, recreate).await
    } else {
        local::pull_and_recreate(local_shell.as_deref(), &image, recreate).await
    }
}

#[tauri::command]
pub async fn docker_recreate_image_containers(
    session_manager: State<'_, SessionManager>,
    session_id: String,
    is_remote: bool,
    local_shell: Option<String>,
    image: String,
) -> Result<RecreateResult, String> {
    if is_remote {
        let handle = session_manager.get_handle(&session_id).await?;
        remote::recreate_image_containers(&handle, &image).await
    } else {
        local::recreate_image_containers(local_shell.as_deref(), &image).await
    }
}

#[tauri::command]
pub async fn docker_remove_volume(
    session_manager: State<'_, SessionManager>,
    session_id: String,
    is_remote: bool,
    local_shell: Option<String>,
    volume_name: String,
) -> Result<(), String> {
    if is_remote {
        let handle = session_manager.get_handle(&session_id).await?;
        remote::remove_volume(&handle, &volume_name).await
    } else {
        local::remove_volume(local_shell.as_deref(), &volume_name).await
    }
}

#[tauri::command]
pub async fn docker_remove_network(
    session_manager: State<'_, SessionManager>,
    session_id: String,
    is_remote: bool,
    local_shell: Option<String>,
    network_id: String,
) -> Result<(), String> {
    if is_remote {
        let handle = session_manager.get_handle(&session_id).await?;
        remote::remove_network(&handle, &network_id).await
    } else {
        local::remove_network(local_shell.as_deref(), &network_id).await
    }
}

#[tauri::command]
pub async fn docker_prune_images(
    session_manager: State<'_, SessionManager>,
    session_id: String,
    is_remote: bool,
    local_shell: Option<String>,
) -> Result<String, String> {
    if is_remote {
        let handle = session_manager.get_handle(&session_id).await?;
        remote::prune_images(&handle).await
    } else {
        local::prune_images(local_shell.as_deref()).await
    }
}

#[tauri::command]
pub async fn docker_prune_volumes(
    session_manager: State<'_, SessionManager>,
    session_id: String,
    is_remote: bool,
    local_shell: Option<String>,
) -> Result<String, String> {
    if is_remote {
        let handle = session_manager.get_handle(&session_id).await?;
        remote::prune_volumes(&handle).await
    } else {
        local::prune_volumes(local_shell.as_deref()).await
    }
}

#[tauri::command]
pub async fn docker_prune_networks(
    session_manager: State<'_, SessionManager>,
    session_id: String,
    is_remote: bool,
    local_shell: Option<String>,
) -> Result<String, String> {
    if is_remote {
        let handle = session_manager.get_handle(&session_id).await?;
        remote::prune_networks(&handle).await
    } else {
        local::prune_networks(local_shell.as_deref()).await
    }
}

#[tauri::command]
pub async fn docker_open_exec_session(
    app: AppHandle,
    session_manager: State<'_, SessionManager>,
    source_session_id: String,
    container_id: String,
) -> Result<String, String> {
    let handle = session_manager.get_handle(&source_session_id).await?;
    let new_session_id = Uuid::new_v4().to_string();

    let channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("channel error: {e}"))?;

    channel
        .request_pty(false, "xterm-256color", 80, 24, 0, 0, &[])
        .await
        .map_err(|e| format!("PTY error: {e}"))?;

    let cmd = format!("docker exec -it {container_id} sh");
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

#[tauri::command]
pub async fn docker_system_prune(
    session_manager: State<'_, SessionManager>,
    session_id: String,
    is_remote: bool,
    local_shell: Option<String>,
) -> Result<String, String> {
    if is_remote {
        let handle = session_manager.get_handle(&session_id).await?;
        remote::system_prune(&handle).await
    } else {
        local::system_prune(local_shell.as_deref()).await
    }
}

#[tauri::command]
pub async fn docker_list_stacks(
    session_manager: State<'_, SessionManager>,
    session_id: String,
    is_remote: bool,
    local_shell: Option<String>,
) -> Result<Vec<DockerStack>, String> {
    if is_remote {
        let handle = session_manager.get_handle(&session_id).await?;
        remote::list_stacks(&handle).await
    } else {
        local::list_stacks(local_shell.as_deref()).await
    }
}

#[tauri::command]
pub async fn docker_list_stack_services(
    session_manager: State<'_, SessionManager>,
    session_id: String,
    is_remote: bool,
    local_shell: Option<String>,
    stack_name: String,
) -> Result<Vec<DockerStackService>, String> {
    if is_remote {
        let handle = session_manager.get_handle(&session_id).await?;
        remote::list_stack_services(&handle, &stack_name).await
    } else {
        local::list_stack_services(local_shell.as_deref(), &stack_name).await
    }
}

#[tauri::command]
pub async fn docker_stack_action(
    session_manager: State<'_, SessionManager>,
    session_id: String,
    is_remote: bool,
    local_shell: Option<String>,
    stack_name: String,
    action: StackAction,
) -> Result<(), String> {
    if is_remote {
        let handle = session_manager.get_handle(&session_id).await?;
        remote::stack_action(&handle, &stack_name, &action).await
    } else {
        local::stack_action(local_shell.as_deref(), &stack_name, &action).await
    }
}
