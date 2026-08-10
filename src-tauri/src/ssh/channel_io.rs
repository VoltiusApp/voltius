use russh::ChannelMsg;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::ssh::client::{ConnectedSession, SessionInput, SshClient};
use crate::ssh::session::SessionManager;

/// Channels the frontend drives a session's channel with.
pub struct ChannelIo {
    pub input_tx: mpsc::Sender<SessionInput>,
    pub shutdown_tx: mpsc::Sender<()>,
}

/// Spawn the I/O loop for an opened channel: forward input and resizes, emit the
/// channel's output as `ssh-output-<session_id>`, and emit `ssh-closed-<id>` when
/// the far side ends it.
pub fn spawn_channel_io(
    app: AppHandle,
    session_id: &str,
    channel: russh::Channel<russh::client::Msg>,
) -> ChannelIo {
    let (read_half, write_half) = channel.split();
    spawn_channel_io_split(app, session_id, read_half, write_half)
}

/// `spawn_channel_io` for callers that already split the channel — the terminal
/// session writes its env exports through the write half before the loop starts.
pub fn spawn_channel_io_split(
    app: AppHandle,
    session_id: &str,
    mut read_half: russh::ChannelReadHalf,
    write_half: russh::ChannelWriteHalf<russh::client::Msg>,
) -> ChannelIo {
    let (input_tx, mut input_rx) = mpsc::channel::<SessionInput>(256);
    let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);

    let event_name = format!("ssh-output-{}", session_id);
    let close_event = format!("ssh-closed-{}", session_id);

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

    ChannelIo {
        input_tx,
        shutdown_tx,
    }
}

/// Open a PTY channel on an existing SSH handle, run `command` in it, and
/// register the result as a channel-only session (docker exec, `pct exec`).
/// Returns the new session id.
pub async fn open_exec_session(
    app: AppHandle,
    session_manager: &SessionManager,
    handle: std::sync::Arc<russh::client::Handle<SshClient>>,
    command: &str,
) -> Result<String, String> {
    let new_session_id = Uuid::new_v4().to_string();

    let channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("channel error: {e}"))?;

    channel
        .request_pty(false, "xterm-256color", 80, 24, 0, 0, &[])
        .await
        .map_err(|e| format!("PTY error: {e}"))?;

    channel
        .exec(false, command)
        .await
        .map_err(|e| format!("exec error: {e}"))?;

    let io = spawn_channel_io(app, &new_session_id, channel);

    session_manager
        .add(
            new_session_id.clone(),
            ConnectedSession {
                handle,
                input_tx: io.input_tx,
                shutdown_tx: io.shutdown_tx,
                channel_only: true,
                persist: false,
                _jump_handles: vec![],
                remote_routes: std::sync::Arc::new(tokio::sync::Mutex::new(
                    std::collections::HashMap::new(),
                )),
            },
        )
        .await;

    Ok(new_session_id)
}
