//! The shape every host-scoped tool command shares: take a session id plus an
//! `is_remote` flag, then either resolve what the `remote` implementation runs on
//! ([`FromSession`]) and call it, or hand the local shell to the `local` one. Docker, Proxmox,
//! metrics and processes all spell it identically, so it lives here once.

/// Defines a `#[tauri::command]` that dispatches on `is_remote`.
///
/// Trailing arguments are declared as `name: Type => expr`, where `expr` is what
/// gets forwarded to the backend (usually `name` or `&name`).
///
/// ```ignore
/// host_command!(docker_list_images, Vec<DockerImage>, remote::list_images, local::list_images);
/// host_command!(docker_remove_image, (), remote::remove_image, local::remove_image, image_id: String => &image_id);
/// host_command!(proxmox_lxc_list, Vec<LxcContainer>, remote::list_containers, unsupported = local_err());
/// ```
macro_rules! host_command {
    // Transports with no local equivalent (Proxmox): the local branch is an error.
    ($name:ident, $ret:ty, $remote:path, unsupported = $err:expr $(, $arg:ident : $ty:ty => $pass:expr)* $(,)?) => {
        #[tauri::command]
        pub async fn $name(
            session_manager: tauri::State<'_, $crate::ssh::session::SessionManager>,
            session_id: String,
            is_remote: bool,
            _local_shell: Option<String>,
            $($arg: $ty,)*
        ) -> Result<$ret, String> {
            if is_remote {
                let target = $crate::commands::host_command::resolve(&session_manager, &session_id).await?;
                $remote(&target $(, $pass)*).await
            } else {
                Err($err)
            }
        }
    };
    ($name:ident, $ret:ty, $remote:path, $local:path $(, $arg:ident : $ty:ty => $pass:expr)* $(,)?) => {
        #[tauri::command]
        pub async fn $name(
            session_manager: tauri::State<'_, $crate::ssh::session::SessionManager>,
            session_id: String,
            is_remote: bool,
            local_shell: Option<String>,
            $($arg: $ty,)*
        ) -> Result<$ret, String> {
            if is_remote {
                let target = $crate::commands::host_command::resolve(&session_manager, &session_id).await?;
                $remote(&target $(, $pass)*).await
            } else {
                $local(local_shell.as_deref() $(, $pass)*).await
            }
        }
    };
}

pub(crate) use host_command;

use crate::ssh::client::SshClient;
use crate::ssh::session::{Machine, SessionManager};
use std::future::Future;
use std::sync::Arc;

/// What a host command's remote half takes, looked up from the session id.
pub trait FromSession: Sized {
    fn from_session(
        sm: &SessionManager,
        id: &str,
    ) -> impl Future<Output = Result<Self, String>> + Send;
}

/// The bare SSH connection: commands that must reach the host itself (`pct`).
impl FromSession for Arc<russh::client::Handle<SshClient>> {
    fn from_session(
        sm: &SessionManager,
        id: &str,
    ) -> impl Future<Output = Result<Self, String>> + Send {
        sm.get_handle(id)
    }
}

/// The machine the tab's shell is on: inside the LXC for a `pct exec` tab.
impl FromSession for Machine {
    fn from_session(
        sm: &SessionManager,
        id: &str,
    ) -> impl Future<Output = Result<Self, String>> + Send {
        sm.get_machine(id)
    }
}

pub async fn resolve<T: FromSession>(sm: &SessionManager, id: &str) -> Result<T, String> {
    T::from_session(sm, id).await
}
