use tauri::{AppHandle, State};

use crate::{
    commands::host_command::host_command,
    proxmox::{
        remote,
        types::{LxcAction, LxcContainer, LxcSnapshot},
    },
    sftp::SftpManager,
    ssh::{channel_io::open_exec_session, session::SessionManager},
};

fn local_err() -> String {
    "Proxmox LXC management requires an SSH session to a Proxmox VE host".to_string()
}

host_command!(
    proxmox_lxc_list,
    Vec<LxcContainer>,
    remote::list_containers,
    unsupported = local_err()
);
host_command!(proxmox_lxc_action, (), remote::container_action, unsupported = local_err(), vmid: u32 => vmid, action: LxcAction => &action);
host_command!(proxmox_lxc_list_snapshots, Vec<LxcSnapshot>, remote::list_snapshots, unsupported = local_err(), vmid: u32 => vmid);
host_command!(proxmox_lxc_snapshot_create, (), remote::snapshot_create, unsupported = local_err(), vmid: u32 => vmid, snapname: String => &snapname, description: Option<String> => description.as_deref());
host_command!(proxmox_lxc_snapshot_rollback, (), remote::snapshot_rollback, unsupported = local_err(), vmid: u32 => vmid, snapname: String => &snapname);
host_command!(proxmox_lxc_snapshot_delete, (), remote::snapshot_delete, unsupported = local_err(), vmid: u32 => vmid, snapname: String => &snapname);

#[tauri::command]
pub async fn proxmox_lxc_open_shell(
    app: AppHandle,
    session_manager: State<'_, SessionManager>,
    session_id: String,
    vmid: u32,
) -> Result<String, String> {
    let handle = session_manager.get_handle(&session_id).await?;
    // Use `pct exec … -- sh -c` (instead of `pct enter`) so we can inject OSC 7
    // cwd reporting into the LXC shell, enabling the SFTP panel's "follow cwd".
    let cmd = format!(
        "pct exec {vmid} -- sh -c '{}'",
        crate::shell_integration::container_exec_payload()
    );
    open_exec_session(app, &session_manager, handle, &cmd).await
}

/// Open an SFTP session rooted inside an LXC container by exec-ing sftp-server via pct.
#[tauri::command]
pub async fn proxmox_lxc_sftp_open(
    session_manager: State<'_, SessionManager>,
    sftp_state: State<'_, SftpManager>,
    session_id: String,
    vmid: u32,
) -> Result<String, String> {
    let handle = session_manager.get_session_handle(&session_id).await?;
    let cmd = format!(
        "pct exec {} -- sh -c 'for p in /usr/lib/openssh/sftp-server /usr/lib/ssh/sftp-server /usr/libexec/openssh/sftp-server /usr/sbin/sftp-server; do [ -x \"$p\" ] && exec \"$p\"; done; exit 127'",
        vmid
    );
    sftp_state.open_exec(handle, &cmd).await
}
