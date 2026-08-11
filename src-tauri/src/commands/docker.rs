use russh::client::Handle;
use tauri::{AppHandle, State};
use tokio::io::AsyncReadExt;
use uuid::Uuid;

use crate::ssh::client::SshClient;

use crate::{
    commands::host_command::host_command,
    docker::{
        local, remote,
        stream::DockerLogStreamManager,
        types::{
            ContainerAction, DockerContainer, DockerImage, DockerNetwork, DockerStack,
            DockerStackService, DockerVolume, ImageUpdateStatus, RecreateResult, StackAction,
        },
    },
    sftp::SftpManager,
    ssh::{channel_io::open_exec_session, session::SessionManager},
};

host_command!(docker_list_containers, Vec<DockerContainer>, remote::list_containers, local::list_containers, all: bool => all);
host_command!(
    docker_list_images,
    Vec<DockerImage>,
    remote::list_images,
    local::list_images
);
host_command!(
    docker_list_volumes,
    Vec<DockerVolume>,
    remote::list_volumes,
    local::list_volumes
);
host_command!(
    docker_list_networks,
    Vec<DockerNetwork>,
    remote::list_networks,
    local::list_networks
);
host_command!(docker_container_action, (), remote::container_action, local::container_action, container_id: String => &container_id, action: ContainerAction => &action);

/// Spawn a `docker logs -f` reader on the chosen host and register the task so
/// `docker_stop_log_stream` can abort it. Container and stack streams differ
/// only in what they name and which backend function they call.
macro_rules! log_stream_command {
    ($name:ident, $subject:ident, $remote:path, $local:path) => {
        #[tauri::command]
        pub async fn $name(
            app: AppHandle,
            session_manager: State<'_, SessionManager>,
            stream_manager: State<'_, DockerLogStreamManager>,
            session_id: String,
            is_remote: bool,
            local_shell: Option<String>,
            $subject: String,
            tail: u32,
        ) -> Result<String, String> {
            let stream_id = Uuid::new_v4().to_string();
            let sid = stream_id.clone();

            let join_handle = if is_remote {
                let handle = session_manager.get_handle(&session_id).await?;
                tokio::spawn(async move {
                    $remote(app, sid, $subject, tail, handle).await;
                })
            } else {
                tokio::spawn(async move {
                    $local(app, sid, $subject, tail, local_shell).await;
                })
            };

            stream_manager
                .streams
                .lock()
                .await
                .insert(stream_id.clone(), join_handle);

            Ok(stream_id)
        }
    };
}

log_stream_command!(
    docker_start_log_stream,
    container_id,
    remote::stream_logs,
    local::stream_logs
);
log_stream_command!(
    docker_start_stack_log_stream,
    stack_name,
    remote::stream_stack_logs,
    local::stream_stack_logs
);

#[tauri::command]
pub async fn docker_stop_log_stream(
    stream_manager: State<'_, DockerLogStreamManager>,
    stream_id: String,
) -> Result<(), String> {
    stream_manager.stop(&stream_id).await;
    Ok(())
}

host_command!(docker_remove_image, (), remote::remove_image, local::remove_image, image_id: String => &image_id);

#[tauri::command]
pub async fn docker_check_image_update(
    session_manager: State<'_, SessionManager>,
    session_id: String,
    is_remote: bool,
    local_shell: Option<String>,
    image: String,
) -> Result<ImageUpdateStatus, String> {
    // Local "current" digest comes from the host the image lives on.
    let local_digest = if is_remote {
        let handle = session_manager.get_handle(&session_id).await?;
        remote::local_image_digest(&handle, &image).await
    } else {
        local::local_image_digest(local_shell.as_deref(), &image).await
    };

    // Registry digest via a quota-free HEAD (host-independent), so this never
    // touches the Docker Hub pull rate limit.
    let (remote_digest, error) = match crate::docker::registry::manifest_digest(&image).await {
        Ok(digest) => (Some(digest), None),
        Err(e) => (None, Some(e)),
    };

    Ok(crate::docker::types::build_update_status(
        image,
        local_digest,
        remote_digest,
        error,
    ))
}

host_command!(docker_pull_image, String, remote::pull_image, local::pull_image, image: String => &image);
host_command!(docker_stack_update, (), remote::stack_update, local::stack_update, stack_name: String => &stack_name);
host_command!(docker_container_run_command, String, remote::container_run_command, local::container_run_command, container_id: String => &container_id, image: String => &image);
host_command!(docker_update_image, RecreateResult, remote::pull_and_recreate, local::pull_and_recreate, image: String => &image, recreate: bool => recreate);
host_command!(docker_recreate_image_containers, RecreateResult, remote::recreate_image_containers, local::recreate_image_containers, image: String => &image);
host_command!(docker_remove_volume, (), remote::remove_volume, local::remove_volume, volume_name: String => &volume_name);
host_command!(docker_remove_network, (), remote::remove_network, local::remove_network, network_id: String => &network_id);
host_command!(
    docker_prune_images,
    String,
    remote::prune_images,
    local::prune_images
);
host_command!(
    docker_prune_volumes,
    String,
    remote::prune_volumes,
    local::prune_volumes
);
host_command!(
    docker_prune_networks,
    String,
    remote::prune_networks,
    local::prune_networks
);

#[tauri::command]
pub async fn docker_open_exec_session(
    app: AppHandle,
    session_manager: State<'_, SessionManager>,
    source_session_id: String,
    container_id: String,
) -> Result<String, String> {
    let handle = session_manager.get_handle(&source_session_id).await?;
    // Launch the container shell with OSC 7 cwd reporting injected, so the
    // SFTP panel's "follow cwd" works inside the container too.
    let cmd = format!(
        "docker exec -it {container_id} sh -c '{}'",
        crate::shell_integration::container_exec_payload()
    );
    open_exec_session(app, &session_manager, handle, &cmd).await
}

host_command!(
    docker_system_prune,
    String,
    remote::system_prune,
    local::system_prune
);
host_command!(
    docker_list_stacks,
    Vec<DockerStack>,
    remote::list_stacks,
    local::list_stacks
);
host_command!(docker_list_stack_services, Vec<DockerStackService>, remote::list_stack_services, local::list_stack_services, stack_name: String => &stack_name);
host_command!(docker_stack_action, (), remote::stack_action, local::stack_action, stack_name: String => &stack_name, action: StackAction => &action);

/// Run a command on the SSH host and capture its stdout (stderr is dropped unless the
/// command redirects it). Used to probe the container before opening an SFTP session.
async fn exec_capture(handle: &Handle<SshClient>, cmd: &str) -> Result<String, String> {
    let channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("channel error: {e}"))?;
    channel
        .exec(true, cmd)
        .await
        .map_err(|e| format!("exec error: {e}"))?;
    let mut stream = channel.into_stream();
    let mut out = Vec::new();
    let mut buf = vec![0u8; 4096];
    let _ = tokio::time::timeout(std::time::Duration::from_secs(15), async {
        loop {
            match stream.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => out.extend_from_slice(&buf[..n]),
            }
        }
    })
    .await;
    Ok(String::from_utf8_lossy(&out).to_string())
}

/// Open an SFTP session rooted inside a Docker container.
///
/// Uses nsenter to enter the container's mount namespace directly from the host SSH
/// connection, bypassing docker exec's I/O multiplexing layer which corrupts the binary
/// SFTP protocol. Falls back to docker exec if nsenter is unavailable.
#[tauri::command]
pub async fn docker_sftp_open(
    session_manager: State<'_, SessionManager>,
    sftp_state: State<'_, SftpManager>,
    session_id: String,
    container_id: String,
) -> Result<String, String> {
    let handle = session_manager.get_handle(&session_id).await?;
    let live_handle = session_manager.get_session_handle(&session_id).await?;

    // A "Timeout" from SftpSession::new means the command we exec'd never spoke the SFTP
    // protocol (no SSH_FXP_VERSION on stdout). The two usual causes are: (a) the container
    // has no sftp-server binary at all, or (b) the chosen entry method (nsenter vs docker
    // exec) silently failed. Both produce an identical, opaque timeout. So we *probe* first
    // — discover CPID, whether nsenter is usable, and which sftp-server path exists — then
    // exec exactly the method we confirmed works, or return a precise error.
    let paths = "/usr/lib/openssh/sftp-server /usr/lib/ssh/sftp-server /usr/libexec/openssh/sftp-server /usr/sbin/sftp-server /usr/libexec/sftp-server";
    let find_sftp =
        format!("for p in {paths}; do [ -x \"$p\" ] && echo \"SFTP=$p\" && break; done");
    let probe = format!(
        "CPID=$(docker inspect --format '{{{{.State.Pid}}}}' {cid} 2>/dev/null); \
         echo \"CPID=$CPID\"; \
         if [ -n \"$CPID\" ] && nsenter --target \"$CPID\" --mount -- sh -c 'exit 0' 2>/dev/null; then \
           echo NSENTER=ok; \
           nsenter --target \"$CPID\" --mount -- sh -c '{find_sftp}' 2>&1; \
         else \
           echo NSENTER=no; \
           docker exec -i {cid} sh -c '{find_sftp}' 2>&1; \
         fi; \
         echo PROBE_DONE",
        cid = container_id,
    );

    let report = exec_capture(&handle, &probe).await?;
    let nsenter_ok = report.lines().any(|l| l.trim() == "NSENTER=ok");
    let sftp_path = report
        .lines()
        .find_map(|l| l.trim().strip_prefix("SFTP=").map(str::to_string));

    let sftp_path = match sftp_path {
        Some(p) => p,
        None => {
            // No sftp-server binary in the container (the common case for slim
            // images). Fall back to the `docker exec` filesystem shim, which needs
            // only docker access — no binary, no nsenter, no root.
            return sftp_state.open_docker(live_handle, container_id).await;
        }
    };

    // Run the confirmed method directly (no fallback loop needed — we already know what works).
    let cmd = if nsenter_ok {
        format!(
            "CPID=$(docker inspect --format '{{{{.State.Pid}}}}' {cid} 2>/dev/null); \
             exec nsenter --target \"$CPID\" --mount -- {path}",
            cid = container_id,
            path = sftp_path,
        )
    } else {
        format!(
            "exec docker exec -i {cid} {path}",
            cid = container_id,
            path = sftp_path
        )
    };
    sftp_state.open_exec(live_handle, &cmd).await
}
