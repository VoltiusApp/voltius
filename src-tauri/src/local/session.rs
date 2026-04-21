use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::sync;

pub struct LocalSession {
    pub input_tx: std::sync::mpsc::SyncSender<Vec<u8>>,
    pub master: Arc<Mutex<Box<dyn portable_pty::MasterPty + Send>>>,
    pub child: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>,
}

pub struct LocalSessionManager {
    sessions: Arc<sync::Mutex<HashMap<String, LocalSession>>>,
}

impl LocalSessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(sync::Mutex::new(HashMap::new())),
        }
    }

    pub async fn spawn(
        &self,
        app: AppHandle,
        session_id: String,
        cols: u16,
        rows: u16,
        shell: Option<String>,
        cwd: Option<String>,
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
            { std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string()) }
            #[cfg(not(windows))]
            { std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string()) }
        });
        let mut cmd = CommandBuilder::new(&shell);
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

        let output_event = format!("local-output-{}", session_id);
        let close_event = format!("local-closed-{}", session_id);

        // Reader thread — PTY output → Tauri event
        let app_r = app.clone();
        let close_event_r = close_event.clone();
        std::thread::spawn(move || {
            let mut buf = vec![0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => {
                        let _ = app_r.emit(&close_event_r, ());
                        break;
                    }
                    Ok(n) => {
                        let _ = app_r.emit(&output_event, &buf[..n]);
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
        let child = {
            let mut sessions = self.sessions.lock().await;
            sessions.remove(id).map(|s| s.child)
        };
        if let Some(child) = child {
            let _ = child.lock().unwrap().kill();
        }
        Ok(())
    }
}
