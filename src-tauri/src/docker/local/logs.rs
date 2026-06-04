use super::exec::{connect, now_ms, prevent_visible_child_window, should_use_wsl_cli};
use crate::docker::types::*;
use bollard::container::LogsOptions;
use futures_util::StreamExt;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

pub async fn stream_stack_logs(
    app: AppHandle,
    stream_id: String,
    stack_name: String,
    tail: u32,
    local_shell: Option<String>,
) {
    let event = format!("docker:log:{stream_id}");
    let tail_str = tail.to_string();

    let mut command = if should_use_wsl_cli(local_shell.as_deref()) {
        let shell = local_shell.unwrap_or_else(|| "wsl.exe".to_string());
        let mut cmd = Command::new(shell);
        cmd.arg("docker").args([
            "compose",
            "-p",
            &stack_name,
            "logs",
            "--follow",
            "--tail",
            &tail_str,
        ]);
        cmd
    } else {
        let mut cmd = Command::new("docker");
        cmd.args([
            "compose",
            "-p",
            &stack_name,
            "logs",
            "--follow",
            "--tail",
            &tail_str,
        ]);
        cmd
    };

    command
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    prevent_visible_child_window(&mut command);

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(e) => {
            let _ = app.emit(
                &event,
                &DockerLogLine {
                    line: format!("Error: {e}"),
                    stream: "stderr".to_string(),
                    ts: now_ms(),
                },
            );
            return;
        }
    };

    if let Some(stdout) = child.stdout.take() {
        let app = app.clone();
        let event = event.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app.emit(
                    &event,
                    &DockerLogLine {
                        line,
                        stream: "stdout".to_string(),
                        ts: now_ms(),
                    },
                );
            }
        });
    }

    if let Some(stderr) = child.stderr.take() {
        let app = app.clone();
        let event = event.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app.emit(
                    &event,
                    &DockerLogLine {
                        line,
                        stream: "stderr".to_string(),
                        ts: now_ms(),
                    },
                );
            }
        });
    }

    let _ = child.wait().await;
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

    let docker = match connect() {
        Ok(d) => d,
        Err(e) => {
            let _ = app.emit(
                &format!("docker:log:{stream_id}"),
                &DockerLogLine {
                    line: format!("Error: {e}"),
                    stream: "stderr".to_string(),
                    ts: now_ms(),
                },
            );
            return;
        }
    };

    let event = format!("docker:log:{stream_id}");

    let mut log_stream = docker.logs(
        &container_id,
        Some(LogsOptions::<String> {
            follow: true,
            stdout: true,
            stderr: true,
            since: 0,
            until: 0,
            timestamps: false,
            tail: tail.to_string(),
        }),
    );

    while let Some(result) = log_stream.next().await {
        match result {
            Ok(output) => {
                use bollard::container::LogOutput;
                let (line, stream_name) = match output {
                    LogOutput::StdOut { message } => (
                        String::from_utf8_lossy(&message).trim_end().to_string(),
                        "stdout",
                    ),
                    LogOutput::StdErr { message } => (
                        String::from_utf8_lossy(&message).trim_end().to_string(),
                        "stderr",
                    ),
                    LogOutput::Console { message } | LogOutput::StdIn { message } => (
                        String::from_utf8_lossy(&message).trim_end().to_string(),
                        "stdout",
                    ),
                };
                let _ = app.emit(
                    &event,
                    &DockerLogLine {
                        line,
                        stream: stream_name.to_string(),
                        ts: now_ms(),
                    },
                );
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
    let event = format!("docker:log:{stream_id}");
    let mut command = Command::new(local_shell.unwrap_or_else(|| "wsl.exe".to_string()));
    command
        .arg("docker")
        .args(["logs", "-f", "--tail", &tail.to_string(), &container_id])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    prevent_visible_child_window(&mut command);

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(e) => {
            let _ = app.emit(
                &event,
                &DockerLogLine {
                    line: format!("Error: Docker not available in WSL: {e}"),
                    stream: "stderr".to_string(),
                    ts: now_ms(),
                },
            );
            return;
        }
    };

    if let Some(stdout) = child.stdout.take() {
        let app = app.clone();
        let event = event.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app.emit(
                    &event,
                    &DockerLogLine {
                        line,
                        stream: "stdout".to_string(),
                        ts: now_ms(),
                    },
                );
            }
        });
    }

    if let Some(stderr) = child.stderr.take() {
        let app = app.clone();
        let event = event.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app.emit(
                    &event,
                    &DockerLogLine {
                        line,
                        stream: "stderr".to_string(),
                        ts: now_ms(),
                    },
                );
            }
        });
    }

    let _ = child.wait().await;
}
