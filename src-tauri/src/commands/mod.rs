pub mod clipboard;
pub mod connections;
pub mod crdt;
pub mod crypto;
pub mod diagnostics;
pub mod docker;
pub mod downloads;
pub mod folders;
pub mod fonts;
pub mod fs;
pub mod host_command;
pub mod http;
pub mod identities;
pub mod keychain;
pub mod keygen;
pub mod keys;
pub mod known_hosts;
pub mod lan_sync;
pub mod local;
pub mod mcp;
pub mod metrics;
pub mod mobaxterm;
pub mod openssh;
pub mod ping;
pub mod plugin_registry;
pub mod plugin_storage;
pub mod plugins;
pub mod port_forwarding_rules;
pub mod port_forwarding_tunnels;
pub mod processes;
pub mod proxmox;
pub mod putty;
pub mod securecrt;
pub mod sftp;
pub mod snippets;
pub mod ssh;
pub mod sync;
pub mod sysinfo;
pub mod team_crypto;
pub mod termius;
pub mod vault;
pub mod vault_object;
pub mod vault_secret;
pub mod win_proc;
pub mod wsl;
pub mod zoc;

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

pub fn raw_body<'a>(body: &'a tauri::ipc::InvokeBody, what: &str) -> Result<&'a [u8], String> {
    match body {
        tauri::ipc::InvokeBody::Raw(bytes) => Ok(bytes),
        _ => Err(format!("expected raw {what} bytes")),
    }
}

#[cfg(test)]
mod tests {
    use super::raw_body;
    use tauri::ipc::InvokeBody;

    #[test]
    fn raw_body_takes_bytes_and_refuses_json() {
        assert_eq!(
            raw_body(&InvokeBody::Raw(vec![1, 2]), "blob"),
            Ok(&[1u8, 2][..])
        );
        assert_eq!(
            raw_body(
                &InvokeBody::Json(serde_json::json!({ "blob": [1, 2] })),
                "blob"
            ),
            Err("expected raw blob bytes".to_string())
        );
    }
}
