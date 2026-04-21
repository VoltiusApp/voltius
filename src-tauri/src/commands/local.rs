use crate::local::session::LocalSessionManager;
use serde::Serialize;
use tauri::AppHandle;

#[derive(Serialize)]
pub struct ShellOption {
    pub name: String,
    pub path: String,
}

#[cfg(windows)]
fn find_in_path(name: &str) -> Option<String> {
    let separator = if cfg!(windows) { ';' } else { ':' };
    std::env::var("PATH").ok()?.split(separator).find_map(|dir| {
        let candidate = std::path::Path::new(dir).join(name);
        candidate.exists().then(|| candidate.to_string_lossy().into_owned())
    })
}

#[tauri::command]
pub fn local_list_shells() -> Vec<ShellOption> {
    let mut shells: Vec<ShellOption> = Vec::new();

    #[cfg(windows)]
    {
        // PowerShell Core (pwsh.exe) — check common install paths then PATH
        let pwsh_paths = [
            r"C:\Program Files\PowerShell\7\pwsh.exe",
            r"C:\Program Files\PowerShell\6\pwsh.exe",
        ];
        let mut found_pwsh = false;
        for p in &pwsh_paths {
            if std::path::Path::new(p).exists() {
                shells.push(ShellOption { name: "PowerShell 7+".into(), path: p.to_string() });
                found_pwsh = true;
                break;
            }
        }
        if !found_pwsh {
            if let Some(p) = find_in_path("pwsh.exe") {
                shells.push(ShellOption { name: "PowerShell 7+".into(), path: p });
            }
        }

        // Windows PowerShell (powershell.exe)
        let ps = r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe";
        if std::path::Path::new(ps).exists() {
            shells.push(ShellOption { name: "Windows PowerShell".into(), path: ps.into() });
        } else if let Some(p) = find_in_path("powershell.exe") {
            shells.push(ShellOption { name: "Windows PowerShell".into(), path: p });
        }

        // Git Bash (common install)
        let git_bash_paths = [
            r"C:\Program Files\Git\bin\bash.exe",
            r"C:\Program Files (x86)\Git\bin\bash.exe",
        ];
        for p in &git_bash_paths {
            if std::path::Path::new(p).exists() {
                shells.push(ShellOption { name: "Git Bash".into(), path: p.to_string() });
                break;
            }
        }

        // WSL
        let wsl = r"C:\Windows\System32\wsl.exe";
        if std::path::Path::new(wsl).exists() {
            shells.push(ShellOption { name: "WSL".into(), path: wsl.into() });
        } else if let Some(p) = find_in_path("wsl.exe") {
            shells.push(ShellOption { name: "WSL".into(), path: p });
        }

        // Cygwin
        let cygwin_paths = [
            r"C:\cygwin64\bin\bash.exe",
            r"C:\cygwin\bin\bash.exe",
        ];
        for p in &cygwin_paths {
            if std::path::Path::new(p).exists() {
                shells.push(ShellOption { name: "Cygwin".into(), path: p.to_string() });
                break;
            }
        }

        // Cmder — detect via CMDER_ROOT env or common install paths
        let cmder_bash = std::env::var("CMDER_ROOT")
            .ok()
            .map(|root| format!(r"{}\vendor\git-for-windows\bin\bash.exe", root))
            .filter(|p| std::path::Path::new(p).exists())
            .or_else(|| {
                let common = [
                    r"C:\tools\cmder\vendor\git-for-windows\bin\bash.exe",
                    r"C:\cmder\vendor\git-for-windows\bin\bash.exe",
                ];
                common.iter().find(|p| std::path::Path::new(p).exists()).map(|p| p.to_string())
            });
        if let Some(p) = cmder_bash {
            shells.push(ShellOption { name: "Cmder".into(), path: p });
        }

        // Command Prompt
        let cmd = std::env::var("COMSPEC").unwrap_or_else(|_| r"C:\Windows\System32\cmd.exe".into());
        shells.push(ShellOption { name: "Command Prompt".into(), path: cmd });
    }

    #[cfg(not(windows))]
    {
        let mut seen = std::collections::HashSet::new();

        // Current $SHELL first
        if let Ok(shell) = std::env::var("SHELL") {
            let name = std::path::Path::new(&shell)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("shell")
                .to_string();
            seen.insert(shell.clone());
            shells.push(ShellOption { name, path: shell });
        }

        // Common shells
        for path in &["/bin/zsh", "/bin/bash", "/bin/fish", "/usr/bin/fish", "/usr/local/bin/fish"] {
            if std::path::Path::new(path).exists() && seen.insert(path.to_string()) {
                let name = std::path::Path::new(path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("shell")
                    .to_string();
                shells.push(ShellOption { name, path: path.to_string() });
            }
        }
    }

    shells
}

#[tauri::command]
pub async fn local_connect(
    app: AppHandle,
    state: tauri::State<'_, LocalSessionManager>,
    session_id: String,
    cols: u16,
    rows: u16,
    shell: Option<String>,
    cwd: Option<String>,
) -> Result<(), String> {
    state.spawn(app, session_id, cols, rows, shell, cwd).await
}

#[tauri::command]
pub async fn local_disconnect(
    state: tauri::State<'_, LocalSessionManager>,
    session_id: String,
) -> Result<(), String> {
    state.disconnect(&session_id).await
}

#[tauri::command]
pub async fn local_send_input(
    state: tauri::State<'_, LocalSessionManager>,
    session_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    state.send_data(&session_id, data).await
}

#[tauri::command]
pub async fn local_resize(
    state: tauri::State<'_, LocalSessionManager>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state.resize(&session_id, cols, rows).await
}
