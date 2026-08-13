use crate::local::gate::OutputGate;
use crate::shell_integration;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::AppHandle;
use tokio::sync;

pub struct LocalSession {
    pub input_tx: std::sync::mpsc::SyncSender<Vec<u8>>,
    pub master: Arc<Mutex<Box<dyn portable_pty::MasterPty + Send>>>,
    pub child: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>,
    pub tempfiles: Vec<PathBuf>,
}

pub struct LocalSessionManager {
    sessions: Arc<sync::Mutex<HashMap<String, LocalSession>>>,
    /// Startup-output gates, keyed by session id. Created by whichever of
    /// `spawn` and `mark_ready` runs first — the frontend registers its
    /// listeners concurrently with the spawn, so either order happens.
    gates: Mutex<HashMap<String, Arc<OutputGate>>>,
}

/// Boot the default WSL distro synchronously so an interactive session doesn't
/// race its cold start. Runs hidden (no console window) and ignores failures.
#[cfg(windows)]
fn prewarm_wsl(wsl_path: &str) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let _ = std::process::Command::new(wsl_path)
        .args(["--", "true"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
}

impl LocalSessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(sync::Mutex::new(HashMap::new())),
            gates: Mutex::new(HashMap::new()),
        }
    }

    /// The gate for a session id, creating it on first use. Both event names
    /// are derived here so the spawn and the readiness ack can never disagree.
    fn gate(&self, session_id: &str) -> Arc<OutputGate> {
        Arc::clone(
            self.gates
                .lock()
                .unwrap()
                .entry(session_id.to_string())
                .or_insert_with(|| {
                    Arc::new(OutputGate::new(
                        format!("local-output-{}", session_id),
                        format!("local-closed-{}", session_id),
                    ))
                }),
        )
    }

    /// The frontend has registered its output listeners: replay whatever the
    /// shell wrote before that and go live.
    pub fn mark_ready(&self, app: &AppHandle, session_id: &str) {
        self.gate(session_id).release(app);
    }

    pub async fn spawn(
        &self,
        app: AppHandle,
        session_id: String,
        cols: u16,
        rows: u16,
        shell: Option<String>,
        cwd: Option<String>,
        shell_integration_enabled: bool,
    ) -> Result<(), String> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {e}"))?;

        let shell = shell.unwrap_or_else(|| {
            #[cfg(windows)]
            {
                std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
            }
            #[cfg(not(windows))]
            {
                std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
            }
        });

        // A Stopped WSL distro cold-boots on its first invocation; the
        // interactive `</dev/tty` attach can race that boot and hang with a
        // blank terminal. Pre-warm the default distro with a throwaway command
        // (the equivalent of a manual `wsl -- true`) so the PTY session below
        // attaches to an already-running distro. Best-effort: a failure here is
        // surfaced by the real launch instead.
        #[cfg(windows)]
        {
            let is_wsl = std::path::Path::new(&shell)
                .file_stem()
                .and_then(|s| s.to_str())
                .map(|s| s.eq_ignore_ascii_case("wsl"))
                .unwrap_or(false);
            if is_wsl {
                let wsl = shell.clone();
                let _ = tokio::task::spawn_blocking(move || prewarm_wsl(&wsl)).await;
            }
        }

        // Optional invisible OSC 7 injection via per-shell rcfile + custom
        // args. Falls back silently if the rcfile can't be written.
        let integration = if shell_integration_enabled {
            shell_integration::prepare_local(&shell, &session_id)
                .ok()
                .flatten()
        } else {
            None
        };

        let mut cmd = if let Some(ref info) = integration {
            let mut c = CommandBuilder::new(&info.program);
            for arg in &info.args {
                c.arg(arg);
            }
            for (k, v) in &info.env {
                c.env(k, v);
            }
            c
        } else {
            CommandBuilder::new(&shell)
        };
        cmd.env("TERM", "xterm-256color");
        if let Some(dir) = cwd {
            cmd.cwd(dir);
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn shell: {e}"))?;

        // Drop slave in parent so EOF propagates when child exits
        drop(pair.slave);

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone PTY reader: {e}"))?;

        let mut writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to take PTY writer: {e}"))?;

        let master = Arc::new(Mutex::new(pair.master));
        let child = Arc::new(Mutex::new(child));

        let (input_tx, input_rx) = std::sync::mpsc::sync_channel::<Vec<u8>>(256);

        // Reader thread — PTY output → Tauri event, through the startup gate so
        // the banner and first prompt survive a listener that isn't up yet.
        let gate = self.gate(&session_id);
        let app_r = app.clone();
        std::thread::spawn(move || {
            let mut buf = vec![0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => {
                        gate.closed(&app_r);
                        break;
                    }
                    Ok(n) => {
                        gate.output(&app_r, &buf[..n]);
                    }
                }
            }
        });

        // Writer thread — channel input → PTY
        std::thread::spawn(move || {
            while let Ok(data) = input_rx.recv() {
                if writer.write_all(&data).is_err() {
                    break;
                }
            }
        });

        let session = LocalSession {
            input_tx,
            master,
            child,
            tempfiles: integration.map(|i| i.tempfiles).unwrap_or_default(),
        };
        self.sessions.lock().await.insert(session_id, session);
        Ok(())
    }

    pub async fn send_data(&self, id: &str, data: Vec<u8>) -> Result<(), String> {
        let sessions = self.sessions.lock().await;
        let session = sessions.get(id).ok_or("Session not found")?;
        session
            .input_tx
            .try_send(data)
            .map_err(|e| format!("Send failed: {e}"))
    }

    pub async fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let master = {
            let sessions = self.sessions.lock().await;
            let session = sessions.get(id).ok_or("Session not found")?;
            Arc::clone(&session.master)
        };
        let result = master
            .lock()
            .unwrap()
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string());
        result
    }

    pub async fn disconnect(&self, id: &str) -> Result<(), String> {
        let removed = {
            let mut sessions = self.sessions.lock().await;
            sessions.remove(id)
        };
        self.gates.lock().unwrap().remove(id);
        if let Some(s) = removed {
            let _ = s.child.lock().unwrap().kill();
            shell_integration::cleanup(&s.tempfiles);
        }
        Ok(())
    }
}
