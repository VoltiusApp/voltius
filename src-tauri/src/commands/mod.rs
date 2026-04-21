pub mod connections;
pub mod ping;
pub mod docker;
pub mod metrics;
pub mod crypto;
pub mod known_hosts;
pub mod folders;
pub mod fs;
pub mod identities;
pub mod keychain;
pub mod keygen;
pub mod keys;
pub mod local;
pub mod plugin_registry;
pub mod plugin_storage;
pub mod plugins;
pub mod sftp;
pub mod port_forwarding_rules;
pub mod port_forwarding_tunnels;
pub mod snippets;
pub mod ssh;
pub mod sync;
pub mod team_crypto;
pub mod vault;

#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to Voltius.", name)
}
