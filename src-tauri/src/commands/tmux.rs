use crate::commands::host_exec::HostExecs;
use crate::ssh::client::SshClient;
use crate::ssh::session::SessionManager;
use crate::ssh::tmux_install::{
    self, Progress, Step, TmuxHostStatus, CANCELLED, INSIDE, NEWER, UNSUPPORTED,
};
use crate::tmux_pin::{pin, TmuxAsset};
use russh::client::Handle;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

fn on_host(inside: Option<&str>) -> Result<(), String> {
    match inside {
        Some(_) => Err(INSIDE.into()),
        None => Ok(()),
    }
}

async fn host(
    sessions: &SessionManager,
    session_id: &str,
) -> Result<Arc<Handle<SshClient>>, String> {
    let machine = sessions.get_machine(session_id).await?;
    on_host(machine.inside.as_deref())?;
    Ok(machine.handle)
}

/// The asset to install over `status`, refusing an unsupported host or a newer active copy.
fn installable(
    status: &TmuxHostStatus,
    asset: Option<&'static TmuxAsset>,
    pin: &str,
) -> Result<&'static TmuxAsset, String> {
    let asset = asset.ok_or(UNSUPPORTED)?;
    match &status.active {
        Some(active) if tmux_install::is_newer(active, pin) => Err(NEWER.into()),
        _ => Ok(asset),
    }
}

async fn sweep(host: &Handle<SshClient>, script: &str) -> Result<TmuxHostStatus, String> {
    tmux_install::run_script(host, script).await?;
    tmux_install::status(host).await
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
    let host = host(&sessions, &session_id).await?;
    let version = &pin().version;
    let (status, asset) = tmux_install::inspect(&host).await?;
    let asset = installable(&status, asset, version)?;
    let Some(_permit) = execs.slot(&session_id, token).await? else {
        return Err(CANCELLED.into());
    };
    let event = format!("tmux-install-{install_id}");
    let emit = |step: Step, progress: u8| {
        let _ = app.emit(&event, Progress { step, progress });
    };
    // Boxed: Tauri builds a command's future on the main thread, whose stack is 1 MiB on Windows.
    Box::pin(tmux_install::install(
        &host,
        asset,
        version,
        &install_id,
        token,
        &emit,
    ))
    .await?;
    tmux_install::status(&host).await
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
    sweep(
        &host(&sessions, &session_id).await?,
        &tmux_install::remove_script(),
    )
    .await
}

#[tauri::command]
pub async fn ssh_tmux_prune(
    sessions: State<'_, SessionManager>,
    session_id: String,
) -> Result<TmuxHostStatus, String> {
    let host = host(&sessions, &session_id).await?;
    let status = tmux_install::status(&host).await?;
    sweep(&host, &tmux_install::prune_script(&status)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tmux_pin::asset_for;

    #[test]
    fn install_refuses_inside_machine() {
        assert_eq!(on_host(Some("docker exec -i 'c'")), Err(INSIDE.to_string()));
        assert_eq!(on_host(Some("pct exec 7 --")), Err(INSIDE.to_string()));
        assert_eq!(on_host(None), Ok(()));
    }

    #[test]
    fn install_never_downgrades_a_newer_copy() {
        let asset = asset_for("Linux", "x86_64");
        let active = |v: Option<&str>| TmuxHostStatus {
            supported: true,
            active: v.map(str::to_string),
            ..Default::default()
        };
        let refused = |status, asset| installable(&status, asset, "3.8").err();
        assert_eq!(refused(active(Some("3.9")), asset).as_deref(), Some(NEWER));
        for ok in [None, Some("3.8"), Some("3.5a"), Some("next-3.9")] {
            assert!(installable(&active(ok), asset, "3.8").is_ok(), "{ok:?}");
        }
        assert_eq!(refused(active(None), None).as_deref(), Some(UNSUPPORTED));
    }
}
