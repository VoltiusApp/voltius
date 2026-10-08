use russh::ChannelMsg;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::ssh::client::{persistent_session_present, ConnectedSession, SessionInput, SshClient};
use crate::ssh::control_mode::{Action, ControlSession};
use crate::ssh::session::SessionManager;
use crate::terminal_output::{emit_closed, emit_output};

/// Channels the frontend drives a session's channel with.
pub struct ChannelIo {
    pub input_tx: mpsc::Sender<SessionInput>,
    pub shutdown_tx: mpsc::Sender<()>,
}

/// A finished command reports exit-status/exit-signal, possibly after EOF but always
/// before CLOSE; a dropped link never reports one.
#[derive(Default)]
struct CloseWatch {
    remote_exit: bool,
}

impl CloseWatch {
    fn observe(&mut self, msg: Option<&ChannelMsg>) -> Option<bool> {
        match msg {
            Some(ChannelMsg::Close) | None => Some(self.remote_exit),
            Some(ChannelMsg::ExitStatus { .. } | ChannelMsg::ExitSignal { .. }) => {
                self.remote_exit = true;
                None
            }
            _ => None,
        }
    }
}

/// Spawn the I/O loop for an opened channel: forward input and resizes, stream the
/// channel's output to the session's terminal, and close that stream when the far
/// side ends it, carrying whether the session is over for good.
pub fn spawn_channel_io(
    app: AppHandle,
    session_id: &str,
    channel: russh::Channel<russh::client::Msg>,
) -> ChannelIo {
    let (read_half, write_half) = channel.split();
    spawn_channel_io_split(
        app,
        session_id,
        read_half,
        write_half,
        ControlSession::raw(),
        None,
    )
}

enum Write {
    Data(Vec<u8>),
    Resize(u32, u32),
}

/// `spawn_channel_io` for callers that already split the channel. A clean exit of the
/// `multiplexer` wrapper may be a detach, so it ends the session only once that is gone.
pub fn spawn_channel_io_split(
    app: AppHandle,
    session_id: &str,
    mut read_half: russh::ChannelReadHalf,
    write_half: russh::ChannelWriteHalf<russh::client::Msg>,
    mut session: ControlSession,
    multiplexer: Option<(std::sync::Arc<russh::client::Handle<SshClient>>, String)>,
) -> ChannelIo {
    let (input_tx, mut input_rx) = mpsc::channel::<SessionInput>(256);
    let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);
    let (writes_tx, mut writes_rx) = mpsc::unbounded_channel::<Write>();

    let session_id = session_id.to_string();
    let mux_event = format!("ssh-mux-mode-{}", session_id);

    // Writes wait on russh's session loop, which waits on this read loop while
    // output is paused, so the read loop must never await a write.
    tokio::spawn(async move {
        let mut writer = write_half.make_writer();
        while let Some(write) = writes_rx.recv().await {
            match write {
                Write::Data(data) => {
                    if writer.write_all(&data).await.is_err() {
                        break;
                    }
                }
                Write::Resize(cols, rows) => {
                    let _ = write_half.window_change(cols, rows, 0, 0).await;
                }
            }
        }
    });

    tokio::spawn(async move {
        let mut watch = CloseWatch::default();
        let mut paused = false;
        loop {
            tokio::select! {
                _ = shutdown_rx.recv() => break,
                input = input_rx.recv() => {
                    let actions = match input {
                        None => break,
                        Some(SessionInput::Data(data)) => session.on_input(data),
                        Some(SessionInput::Resize(cols, rows)) => session.on_resize(cols, rows),
                        Some(SessionInput::Colors(colors)) => session.on_colors(colors),
                        Some(SessionInput::PauseOutput(p)) => {
                            paused = p;
                            Vec::new()
                        }
                    };
                    apply(actions, &writes_tx, &app, &session_id, &mux_event);
                }
                msg = read_half.wait(), if !paused => {
                    match msg {
                        Some(ChannelMsg::Data { data }) | Some(ChannelMsg::ExtendedData { data, .. }) => {
                            apply(session.on_output(&data), &writes_tx, &app, &session_id, &mux_event);
                        }
                        other => {
                            let Some(remote_exit) = watch.observe(other.as_ref()) else {
                                continue;
                            };
                            let ended = remote_exit
                                && match &multiplexer {
                                    Some((handle, key)) => {
                                        persistent_session_present(handle, key).await == Some(false)
                                    }
                                    None => true,
                                };
                            emit_closed(&app, &session_id, ended);
                            break;
                        }
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

#[derive(Clone, serde::Serialize)]
struct MuxMode {
    control: bool,
    tmux: String,
}

fn apply(
    actions: Vec<Action>,
    writes: &mpsc::UnboundedSender<Write>,
    app: &AppHandle,
    session_id: &str,
    mux_event: &str,
) {
    for action in actions {
        match action {
            Action::Emit(data) => emit_output(app, session_id, &data),
            Action::Send(data) => {
                let _ = writes.send(Write::Data(data));
            }
            Action::WindowChange(cols, rows) => {
                let _ = writes.send(Write::Resize(cols, rows));
            }
            Action::Started { tmux } => {
                let _ = app.emit(
                    mux_event,
                    MuxMode {
                        control: true,
                        tmux,
                    },
                );
            }
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(msgs: &[Option<ChannelMsg>]) -> Vec<Option<bool>> {
        let mut watch = CloseWatch::default();
        msgs.iter().map(|m| watch.observe(m.as_ref())).collect()
    }

    #[test]
    fn exit_status_after_eof_still_counts() {
        // RouterOS sends EOF before the exit-status.
        assert_eq!(
            feed(&[
                Some(ChannelMsg::Eof),
                Some(ChannelMsg::ExitStatus { exit_status: 0 }),
                Some(ChannelMsg::Close),
            ]),
            [None, None, Some(true)]
        );
    }

    #[test]
    fn exit_status_before_eof_counts() {
        assert_eq!(
            feed(&[
                Some(ChannelMsg::ExitSignal {
                    signal_name: russh::Sig::TERM,
                    core_dumped: false,
                    error_message: String::new(),
                    lang_tag: String::new(),
                }),
                Some(ChannelMsg::Eof),
                Some(ChannelMsg::Close),
            ]),
            [None, None, Some(true)]
        );
    }

    #[test]
    fn a_close_without_an_exit_report_stays_reconnectable() {
        assert_eq!(
            feed(&[
                Some(ChannelMsg::WindowAdjusted { new_size: 4096 }),
                Some(ChannelMsg::Eof),
                None,
            ]),
            [None, None, Some(false)]
        );
        assert_eq!(feed(&[Some(ChannelMsg::Close)]), [Some(false)]);
    }
}
