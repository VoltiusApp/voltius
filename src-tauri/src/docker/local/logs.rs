use super::exec::{connect, should_use_wsl_cli};
use crate::docker::log_stream::{emit_error, emit_line, log_event, stream_child};
use bollard::query_parameters::LogsOptionsBuilder;
use futures_util::StreamExt;
use tauri::AppHandle;
use tokio::process::Command;

/// `docker` invoked either directly or through the WSL shell, which takes it as
/// its first argument.
fn docker_cli(local_shell: Option<String>) -> Command {
    match local_shell {
        Some(shell) if should_use_wsl_cli(Some(&shell)) => {
            let mut cmd = Command::new(shell);
            cmd.arg("docker");
            cmd
        }
        Some(_) | None => Command::new("docker"),
    }
}

pub async fn stream_stack_logs(
    app: AppHandle,
    stream_id: String,
    stack_name: String,
    tail: u32,
    local_shell: Option<String>,
) {
    let event = log_event(&stream_id);
    let mut command = docker_cli(local_shell);
    command.args([
        "compose",
        "-p",
        &stack_name,
        "logs",
        "--follow",
        "--tail",
        &tail.to_string(),
    ]);

    stream_child(&app, &event, command, "Error: ").await;
}

pub async fn stream_logs(
    app: AppHandle,
    stream_id: String,
    container_id: String,
    tail: u32,
    local_shell: Option<String>,
) {
    if should_use_wsl_cli(local_shell.as_deref()) {
        stream_logs_cli(app, stream_id, container_id, tail, local_shell).await;
        return;
    }

    let event = log_event(&stream_id);
    let docker = match connect() {
        Ok(d) => d,
        Err(e) => return emit_error(&app, &event, format!("Error: {e}")),
    };

    let mut log_stream = docker.logs(
        &container_id,
        Some(
            LogsOptionsBuilder::new()
                .follow(true)
                .stdout(true)
                .stderr(true)
                .since(0)
                .until(0)
                .timestamps(false)
                .tail(&tail.to_string())
                .build(),
        ),
    );

    while let Some(result) = log_stream.next().await {
        match result {
            Ok(output) => {
                use bollard::container::LogOutput;
                let (message, stream_name) = match output {
                    LogOutput::StdErr { message } => (message, "stderr"),
                    LogOutput::StdOut { message }
                    | LogOutput::Console { message }
                    | LogOutput::StdIn { message } => (message, "stdout"),
                };
                let line = String::from_utf8_lossy(&message).trim_end().to_string();
                emit_line(&app, &event, line, stream_name);
            }
            Err(_) => break,
        }
    }
}

async fn stream_logs_cli(
    app: AppHandle,
    stream_id: String,
    container_id: String,
    tail: u32,
    local_shell: Option<String>,
) {
    let event = log_event(&stream_id);
    let mut command = Command::new(local_shell.unwrap_or_else(|| "wsl.exe".to_string()));
    command
        .arg("docker")
        .args(["logs", "-f", "--tail", &tail.to_string(), &container_id]);

    stream_child(
        &app,
        &event,
        command,
        "Error: Docker not available in WSL: ",
    )
    .await;
}
