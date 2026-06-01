use crate::known_hosts::KnownHostsStore;
use crate::ssh::client::{authenticate_handle, JumpHostConnect, SshClient};
use russh::client;
use std::sync::Arc;
use std::time::Duration;

#[tauri::command]
pub async fn ping_host(host: String, port: u16) -> Option<u32> {
    let start = std::time::Instant::now();
    tokio::time::timeout(
        Duration::from_millis(1500),
        tokio::net::TcpStream::connect(format!("{}:{}", host, port)),
    )
    .await
    .ok()
    .and_then(|r| r.ok())
    .map(|_| start.elapsed().as_millis() as u32)
}

#[tauri::command]
pub async fn ping_host_via_jumps(
    host: String,
    port: u16,
    jump_hosts: Vec<JumpHostConnect>,
    known_hosts: tauri::State<'_, Arc<KnownHostsStore>>,
) -> Result<Option<u32>, ()> {
    let kh = Arc::clone(&*known_hosts);
    let start = std::time::Instant::now();
    let reachable = tokio::time::timeout(
        Duration::from_secs(8),
        ping_via_chain(host, port, jump_hosts, kh),
    )
    .await
    .unwrap_or(false);
    Ok(reachable.then(|| start.elapsed().as_millis() as u32))
}

async fn ping_via_chain(
    host: String,
    port: u16,
    jump_hosts: Vec<JumpHostConnect>,
    known_hosts: Arc<KnownHostsStore>,
) -> bool {
    let config = Arc::new(client::Config::default());

    // No jumps — plain TCP
    if jump_hosts.is_empty() {
        return tokio::net::TcpStream::connect(format!("{}:{}", host, port))
            .await
            .is_ok();
    }

    // Connect + auth through the first jump host
    let first = &jump_hosts[0];
    let (first_client, _) =
        SshClient::new(first.host.clone(), first.port, Arc::clone(&known_hosts));
    let mut current = match client::connect(
        Arc::clone(&config),
        (first.host.as_str(), first.port),
        first_client,
    )
    .await
    {
        Ok(h) => h,
        Err(_) => return false,
    };
    if authenticate_handle(
        &mut current,
        &first.username,
        first.password.as_deref(),
        first.private_key.as_deref(),
        first.passphrase.as_deref(),
    )
    .await
    .is_err()
    {
        return false;
    }

    // Chain remaining jump hosts
    for jump in &jump_hosts[1..] {
        let channel = match current
            .channel_open_direct_tcpip(jump.host.as_str(), jump.port as u32, "127.0.0.1", 0)
            .await
        {
            Ok(c) => c,
            Err(_) => return false,
        };
        let (next_client, _) =
            SshClient::new(jump.host.clone(), jump.port, Arc::clone(&known_hosts));
        let mut next =
            match client::connect_stream(Arc::clone(&config), channel.into_stream(), next_client)
                .await
            {
                Ok(h) => h,
                Err(_) => return false,
            };
        if authenticate_handle(
            &mut next,
            &jump.username,
            jump.password.as_deref(),
            jump.private_key.as_deref(),
            jump.passphrase.as_deref(),
        )
        .await
        .is_err()
        {
            return false;
        }
        current = next;
    }

    // Probe the final host via direct-tcpip — success means it's reachable
    current
        .channel_open_direct_tcpip(host.as_str(), port as u32, "127.0.0.1", 0)
        .await
        .is_ok()
}
