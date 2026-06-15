pub mod connections;
pub mod crypto;
pub mod docker;
pub mod downloads;
pub mod folders;
pub mod fs;
pub mod http;
pub mod identities;
pub mod keychain;
pub mod keygen;
pub mod keys;
pub mod known_hosts;
pub mod local;
pub mod metrics;
pub mod mobaxterm;
pub mod ping;
pub mod plugin_registry;
pub mod plugin_storage;
pub mod plugins;
pub mod port_forwarding_rules;
pub mod port_forwarding_tunnels;
pub mod processes;
pub mod proxmox;
pub mod sftp;
pub mod snippets;
pub mod ssh;
pub mod sync;
pub mod sysinfo;
pub mod team_crypto;
pub mod termius;
pub mod vault;
pub mod win_proc;
pub mod wsl;

#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to Voltius.", name)
}

/// Host OS the client is running on: "android" | "ios" | "linux" | "macos" |
/// "windows". Lets the frontend hide host-integration features the platform
/// sandbox can't support (local terminal, serial, local Docker — UX only).
#[tauri::command]
pub fn get_platform() -> &'static str {
    std::env::consts::OS
}
