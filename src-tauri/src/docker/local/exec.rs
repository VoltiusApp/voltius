use bollard::Docker;
use tokio::process::Command;

pub(super) fn connect() -> Result<Docker, String> {
    Docker::connect_with_local_defaults().map_err(|e| format!("Docker not available: {e}"))
}

pub(super) fn should_use_wsl_cli(local_shell: Option<&str>) -> bool {
    local_shell
        .and_then(|shell| shell.rsplit(['\\', '/']).next())
        .map(|name| name.eq_ignore_ascii_case("wsl") || name.eq_ignore_ascii_case("wsl.exe"))
        .unwrap_or(false)
}

pub(super) use crate::commands::win_proc::prevent_visible_child_window;

pub(super) async fn run_wsl_docker(
    local_shell: Option<&str>,
    args: &[&str],
) -> Result<String, String> {
    let shell = local_shell.unwrap_or("wsl.exe");
    let mut command = Command::new(shell);
    command.arg("docker").args(args);
    prevent_visible_child_window(&mut command);

    let output = command
        .output()
        .await
        .map_err(|e| format!("Docker not available in WSL: {e}"))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Err(if stderr.is_empty() { stdout } else { stderr })
    }
}

async fn run_local_docker(args: &[&str]) -> Result<String, String> {
    let mut command = Command::new("docker");
    command.args(args);
    prevent_visible_child_window(&mut command);

    let output = command
        .output()
        .await
        .map_err(|e| format!("Docker not available: {e}"))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Err(if stderr.is_empty() { stdout } else { stderr })
    }
}

pub(super) async fn run_compose(
    local_shell: Option<&str>,
    args: &[&str],
) -> Result<String, String> {
    let mut docker_args = vec!["compose"];
    docker_args.extend_from_slice(args);

    if should_use_wsl_cli(local_shell) {
        run_wsl_docker(local_shell, &docker_args).await
    } else {
        run_local_docker(&docker_args).await
    }
}

/// Run a `docker` CLI command, transparently routing through WSL when needed.
pub(super) async fn run_docker(local_shell: Option<&str>, args: &[&str]) -> Result<String, String> {
    if should_use_wsl_cli(local_shell) {
        run_wsl_docker(local_shell, args).await
    } else {
        run_local_docker(args).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_wsl_shell_path() {
        assert!(should_use_wsl_cli(Some(r"C:\Windows\System32\wsl.exe")));
        assert!(should_use_wsl_cli(Some(r"C:\Windows\Sysnative\wsl.exe")));
        assert!(!should_use_wsl_cli(Some(r"C:\Windows\System32\cmd.exe")));
        assert!(!should_use_wsl_cli(None));
    }
}
