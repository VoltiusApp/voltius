use crate::commands::host_exec::HostExecs;
use crate::ssh::client::SshClient;
use crate::ssh::session::SessionManager;
use crate::ssh::tmux_install::{self, Progress, Step, TmuxHostStatus, CANCELLED, INSIDE};
use crate::tmux_pin::pin;
use russh::client::Handle;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

type Host = Arc<Handle<SshClient>>;

fn on_host(inside: Option<&str>) -> Result<(), String> {
    match inside {
        Some(_) => Err(INSIDE.into()),
        None => Ok(()),
    }
}

async fn host(sessions: &SessionManager, session_id: &str) -> Result<Host, String> {
    let machine = sessions.get_machine(session_id).await?;
    on_host(machine.inside.as_deref())?;
    Ok(machine.handle)
}

async fn sweep(
    sessions: &SessionManager,
    session_id: &str,
    script: String,
) -> Result<TmuxHostStatus, String> {
    let handle = host(sessions, session_id).await?;
    tmux_install::host_asset(&handle).await?;
    tmux_install::run_script(&handle, &script).await?;
    tmux_install::status(&handle).await
}

#[tauri::command]
pub fn ssh_tmux_pin_version() -> &'static str {
    &pin().version
}

#[tauri::command]
pub async fn ssh_tmux_status(
    sessions: State<'_, SessionManager>,
    session_id: String,
) -> Result<TmuxHostStatus, String> {
    tmux_install::status(&host(&sessions, &session_id).await?).await
}

#[tauri::command]
pub async fn ssh_tmux_install(
    app: AppHandle,
    sessions: State<'_, SessionManager>,
    execs: State<'_, HostExecs>,
    session_id: String,
    install_id: String,
) -> Result<TmuxHostStatus, String> {
    let registration = execs.register(&install_id)?;
    let token = &registration.token;
    let handle = host(&sessions, &session_id).await?;
    let asset = tmux_install::host_asset(&handle).await?;
    let Some(_permit) = execs.slot(&session_id, token).await? else {
        return Err(CANCELLED.into());
    };
    let event = format!("tmux-install-{install_id}");
    let emit = |step: Step, progress: u8| {
        let _ = app.emit(&event, Progress { step, progress });
    };
    // Boxed: Tauri builds a command's future on the main thread, whose stack is 1 MiB on Windows.
    Box::pin(tmux_install::install(
        &handle,
        asset,
        &pin().version,
        token,
        &emit,
    ))
    .await?;
    tmux_install::status(&handle).await
}

#[tauri::command]
pub fn ssh_tmux_cancel(execs: State<'_, HostExecs>, install_id: String) {
    execs.cancel(&install_id);
}

#[tauri::command]
pub async fn ssh_tmux_remove(
    sessions: State<'_, SessionManager>,
    session_id: String,
) -> Result<TmuxHostStatus, String> {
    sweep(&sessions, &session_id, tmux_install::remove_script()).await
}

#[tauri::command]
pub async fn ssh_tmux_prune(
    sessions: State<'_, SessionManager>,
    session_id: String,
) -> Result<TmuxHostStatus, String> {
    sweep(&sessions, &session_id, tmux_install::prune_script()).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn install_refuses_inside_machine() {
        assert_eq!(on_host(Some("docker exec -i 'c'")), Err(INSIDE.to_string()));
        assert_eq!(on_host(Some("pct exec 7 --")), Err(INSIDE.to_string()));
        assert_eq!(on_host(None), Ok(()));
    }
}
