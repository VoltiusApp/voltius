use crate::known_hosts::{KnownHostsStore, PendingConflicts};
use crate::port_forward::PortForwardManager;
use crate::ssh::{
    client::{self, JumpHostConnect},
    session::SessionManager,
};
use std::sync::Arc;
use tauri::AppHandle;

#[tauri::command]
pub async fn ssh_connect(
    app: AppHandle,
    state: tauri::State<'_, SessionManager>,
    pf: tauri::State<'_, PortForwardManager>,
    known_hosts: tauri::State<'_, Arc<KnownHostsStore>>,
    pending_conflicts: tauri::State<'_, Arc<PendingConflicts>>,
    session_id: String,
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
    passphrase: Option<String>,
    connection_id: Option<String>,
    jump_hosts: Option<Vec<JumpHostConnect>>,
    env_vars: Option<Vec<(String, String)>>,
    agent_forwarding: bool,
    pre_command: Option<String>,
) -> Result<(), String> {
    let connected = client::connect(
        app,
        session_id.clone(),
        &host,
        port,
        &username,
        password.as_deref(),
        private_key.as_deref(),
        passphrase.as_deref(),
        jump_hosts.unwrap_or_default(),
        env_vars.unwrap_or_default(),
        agent_forwarding,
        pre_command,
        Arc::clone(&*known_hosts),
        Arc::clone(&*pending_conflicts),
    )
    .await?;

    state.add(session_id.clone(), connected).await;

    if let Ok(handle) = state.get_handle(&session_id).await {
        let routes = state
            .get_remote_routes(&session_id)
            .await
            .unwrap_or_else(|_| {
                Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new()))
            });
        let cid = connection_id.as_deref().unwrap_or("");
        pf.auto_activate_rules(&session_id, cid, Arc::clone(&handle), routes)
            .await;
        let _ = pf.set_auto_detect(&session_id, true, handle).await;
    }

    Ok(())
}

#[tauri::command]
pub async fn ssh_disconnect(
    state: tauri::State<'_, SessionManager>,
    pf: tauri::State<'_, PortForwardManager>,
    session_id: String,
    post_command: Option<String>,
) -> Result<(), String> {
    pf.on_session_disconnect(&session_id).await;
    state.disconnect(&session_id, post_command).await
}

#[tauri::command]
pub async fn ssh_send_input(
    state: tauri::State<'_, SessionManager>,
    session_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    state.send_data(&session_id, &data).await
}

#[tauri::command]
pub async fn ssh_detect_distro(
    state: tauri::State<'_, SessionManager>,
    session_id: String,
) -> Result<String, String> {
    state.detect_distro(&session_id).await
}

#[tauri::command]
pub async fn ssh_get_system_info(
    state: tauri::State<'_, SessionManager>,
    session_id: String,
) -> Result<crate::ssh::session::SystemInfo, String> {
    state.get_system_info(&session_id).await
}

#[tauri::command]
pub async fn ssh_resize(
    state: tauri::State<'_, SessionManager>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    state.resize(&session_id, cols, rows).await
}

#[tauri::command]
pub async fn ssh_exec_command(
    known_hosts: tauri::State<'_, Arc<KnownHostsStore>>,
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
    passphrase: Option<String>,
    command: String,
) -> Result<String, String> {
    use russh::client as russh_client;
    use tokio::io::AsyncReadExt;
    use tokio::time::{timeout, Duration};

    let config = russh_client::Config {
        ..Default::default()
    };
    let (ssh_client, rejection_reason) =
        client::SshClient::new(host.clone(), port, Arc::clone(&*known_hosts));
    let mut handle =
        match russh_client::connect(Arc::new(config), (host.as_str(), port), ssh_client).await {
            Ok(h) => h,
            Err(e) => {
                let reason = rejection_reason.lock().await.take();
                return Err(reason.unwrap_or_else(|| format!("Connection failed: {}", e)));
            }
        };

    let authenticated = if let Some(key_str) = private_key {
        let key_pair = russh::keys::decode_secret_key(&key_str, passphrase.as_deref())
            .map_err(|e| format!("Invalid private key: {}", e))?;
        let key = russh::keys::PrivateKeyWithHashAlg::new(
            Arc::new(key_pair),
            Some(russh::keys::ssh_key::HashAlg::Sha256),
        );
        handle
            .authenticate_publickey(&username, key)
            .await
            .map_err(|e| format!("Auth failed: {}", e))?
    } else if let Some(pwd) = password {
        handle
            .authenticate_password(&username, &pwd)
            .await
            .map_err(|e| format!("Auth failed: {}", e))?
    } else {
        return Err("No authentication method provided".into());
    };

    if !authenticated.success() {
        return Err("Authentication failed".into());
    }

    let channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("Channel error: {}", e))?;

    channel
        .exec(true, command.as_str())
        .await
        .map_err(|e| format!("Exec error: {}", e))?;

    let mut stream = channel.into_stream();
    let mut output = Vec::new();

    let _ = timeout(Duration::from_secs(30), async {
        let mut buf = [0u8; 4096];
        loop {
            match stream.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => output.extend_from_slice(&buf[..n]),
            }
        }
    })
    .await;

    let _ = handle
        .disconnect(russh::Disconnect::ByApplication, "Done", "en")
        .await;

    Ok(String::from_utf8_lossy(&output).to_string())
}
