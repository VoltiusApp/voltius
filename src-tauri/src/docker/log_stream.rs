//! What every Docker log stream — local daemon, WSL CLI, or SSH — does with the
//! lines it reads: stamp them and emit them on the stream's own event.

use super::types::DockerLogLine;
use crate::clock::now_ms;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::process::{Child, Command};

/// The event a log stream emits on.
pub(super) fn log_event(stream_id: &str) -> String {
    format!("docker:log:{stream_id}")
}

pub(super) fn emit_line(app: &AppHandle, event: &str, line: String, stream: &str) {
    let _ = app.emit(
        event,
        &DockerLogLine {
            line,
            stream: stream.to_string(),
            ts: now_ms(),
        },
    );
}

pub(super) fn emit_error(app: &AppHandle, event: &str, message: String) {
    emit_line(app, event, message, "stderr");
}

/// Forward every line `reader` produces to `event`, on its own task.
fn pump_reader<R>(app: AppHandle, event: String, reader: R, stream: &'static str)
where
    R: AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            emit_line(&app, &event, line, stream);
        }
    });
}

/// Pipe a CLI child's stdout and stderr into `event` and wait for it to exit.
/// A child that will not spawn reports `{spawn_error}{e}` on the stderr stream.
pub(super) async fn stream_child(
    app: &AppHandle,
    event: &str,
    mut command: Command,
    spawn_error: &str,
) {
    command
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    crate::commands::win_proc::prevent_visible_child_window(&mut command);

    let mut child: Child = match command.spawn() {
        Ok(child) => child,
        Err(e) => return emit_error(app, event, format!("{spawn_error}{e}")),
    };

    if let Some(stdout) = child.stdout.take() {
        pump_reader(app.clone(), event.to_string(), stdout, "stdout");
    }
    if let Some(stderr) = child.stderr.take() {
        pump_reader(app.clone(), event.to_string(), stderr, "stderr");
    }
    let _ = child.wait().await;
}
