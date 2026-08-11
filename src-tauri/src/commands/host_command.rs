//! The shape every host-scoped tool command shares: take a session id plus an
//! `is_remote` flag, then either resolve the SSH handle and call the `remote`
//! implementation or hand the local shell to the `local` one. Docker, Proxmox,
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
                let handle = session_manager.get_handle(&session_id).await?;
                $remote(&handle $(, $pass)*).await
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
                let handle = session_manager.get_handle(&session_id).await?;
                $remote(&handle $(, $pass)*).await
            } else {
                $local(local_shell.as_deref() $(, $pass)*).await
            }
        }
    };
}

pub(crate) use host_command;
