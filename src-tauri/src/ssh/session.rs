use crate::ssh::client::{ConnectedSession, SessionInput};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::io::AsyncReadExt;
use tokio::sync::Mutex;
use tokio::time::{timeout, Duration};

pub struct SessionManager {
    sessions: Arc<Mutex<HashMap<String, ConnectedSession>>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn add(&self, id: String, session: ConnectedSession) {
        self.sessions.lock().await.insert(id, session);
    }

    pub async fn send_data(&self, id: &str, data: &[u8]) -> Result<(), String> {
        let sessions = self.sessions.lock().await;
        let session = sessions.get(id).ok_or("Session not found")?;
        session
            .input_tx
            .send(SessionInput::Data(data.to_vec()))
            .await
            .map_err(|e| format!("Failed to send data: {}", e))
    }

    pub async fn resize(&self, id: &str, cols: u32, rows: u32) -> Result<(), String> {
        let sessions = self.sessions.lock().await;
        let session = sessions.get(id).ok_or("Session not found")?;
        session
            .input_tx
            .send(SessionInput::Resize(cols, rows))
            .await
            .map_err(|e| format!("Failed to resize: {}", e))
    }

    pub async fn detect_distro(&self, id: &str) -> Result<String, String> {
        let handle = {
            let sessions = self.sessions.lock().await;
            let session = sessions.get(id).ok_or("Session not found")?;
            Arc::clone(&session.handle)
        };

        let channel: russh::Channel<russh::client::Msg> = handle
            .channel_open_session()
            .await
            .map_err(|e| format!("Channel error: {}", e))?;

        channel
            .exec(true, "cat /etc/os-release 2>/dev/null || echo 'ID=linux'")
            .await
            .map_err(|e| format!("Exec error: {}", e))?;

        let mut stream = channel.into_stream();
        let mut output = Vec::new();

        let read_result = timeout(Duration::from_secs(5), async {
            let mut buf = [0u8; 4096];
            loop {
                match stream.read(&mut buf).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => output.extend_from_slice(&buf[..n]),
                }
            }
        })
        .await;

        if read_result.is_err() {
            return Ok("linux".to_string());
        }

        let text = String::from_utf8_lossy(&output);
        for line in text.lines() {
            if let Some(rest) = line.strip_prefix("ID=") {
                let distro = rest.trim().trim_matches('"').to_lowercase();
                if !distro.is_empty() {
                    return Ok(normalize_distro(&distro));
                }
            }
        }

        Ok("linux".to_string())
    }

    pub async fn get_handle(
        &self,
        id: &str,
    ) -> Result<std::sync::Arc<russh::client::Handle<super::client::SshClient>>, String> {
        let sessions = self.sessions.lock().await;
        sessions
            .get(id)
            .map(|s| std::sync::Arc::clone(&s.handle))
            .ok_or_else(|| "Session not found".into())
    }

    pub async fn disconnect(&self, id: &str, post_command: Option<String>) -> Result<(), String> {
        let mut sessions = self.sessions.lock().await;
        if let Some(session) = sessions.remove(id) {
            if let Some(cmd) = post_command {
                let data = format!("{}\n", cmd).into_bytes();
                let _ = session.input_tx.send(SessionInput::Data(data)).await;
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
            let _ = session.shutdown_tx.send(()).await;
            if !session.channel_only {
                let _ = session
                    .handle
                    .disconnect(russh::Disconnect::ByApplication, "User disconnected", "en")
                    .await;
            }
        }
        Ok(())
    }
}

fn normalize_distro(id: &str) -> String {
    match id {
        "ubuntu" => "ubuntu",
        "debian" => "debian",
        "fedora" => "fedora",
        "centos" => "centos",
        "rhel" | "redhatenterprise" | "redhat" => "rhel",
        "arch" | "archlinux" => "arch",
        "opensuse" | "opensuse-leap" | "opensuse-tumbleweed" | "sles" => "opensuse",
        "alpine" => "alpine",
        "kali" => "kali",
        "manjaro" => "manjaro",
        "raspbian" => "raspbian",
        "pop" => "pop",
        "mint" | "linuxmint" => "mint",
        "elementary" => "elementary",
        "zorin" => "zorin",
        "nixos" => "nixos",
        "void" => "void",
        "gentoo" => "gentoo",
        _ => "linux",
    }
    .to_string()
}
