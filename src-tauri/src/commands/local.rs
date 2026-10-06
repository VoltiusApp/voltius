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
    std::env::var("PATH")
        .ok()?
        .split(separator)
        .find_map(|dir| {
            let candidate = std::path::Path::new(dir).join(name);
            candidate
                .exists()
                .then(|| candidate.to_string_lossy().into_owned())
        })
}

#[cfg(windows)]
fn first_existing<'a>(paths: impl IntoIterator<Item = &'a str>) -> Option<String> {
    paths
        .into_iter()
        .find(|p| std::path::Path::new(p).exists())
        .map(|p| p.to_string())
}

/// `rel` resolved against the directory of `exe` as found on PATH. Git Bash,
/// Cygwin and Cmder each ship a distinctive launcher next to their `bash.exe`,
/// so we locate that instead of `bash.exe` itself — a bare `bash.exe` on PATH
/// is usually WSL's System32 stub, which would be mislabelled.
#[cfg(windows)]
fn relative_to_path_exe(exe: &str, rel: &str) -> Option<String> {
    let exe_path = find_in_path(exe)?;
    let candidate = std::path::Path::new(&exe_path).parent()?.join(rel);
    candidate
        .exists()
        .then(|| candidate.to_string_lossy().into_owned())
}

#[cfg(windows)]
fn push_shell(shells: &mut Vec<ShellOption>, name: &str, path: Option<String>) {
    if let Some(path) = path {
        shells.push(ShellOption {
            name: name.into(),
            path,
        });
    }
}

#[tauri::command]
pub async fn local_list_shells() -> Vec<ShellOption> {
    let mut shells: Vec<ShellOption> = Vec::new();

    #[cfg(windows)]
    {
        push_shell(
            &mut shells,
            "PowerShell 7+",
            first_existing([
                r"C:\Program Files\PowerShell\7\pwsh.exe",
                r"C:\Program Files\PowerShell\6\pwsh.exe",
            ])
            .or_else(|| find_in_path("pwsh.exe")),
        );

        push_shell(
            &mut shells,
            "Windows PowerShell",
            first_existing([r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"])
                .or_else(|| find_in_path("powershell.exe")),
        );

        push_shell(
            &mut shells,
            "Git Bash",
            first_existing([
                r"C:\Program Files\Git\bin\bash.exe",
                r"C:\Program Files (x86)\Git\bin\bash.exe",
            ])
            .or_else(|| relative_to_path_exe("git.exe", r"..\bin\bash.exe")),
        );

        // wsl.exe ships with stock Windows 10/11 even when the feature is off,
        // so its presence proves nothing — require an installed distro. The
        // probe spawns wsl.exe, so cache it: every surface listing shells calls
        // this command on mount.
        static HAS_DISTRO: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
        if *HAS_DISTRO.get_or_init(|| !crate::commands::wsl::list_distros().is_empty()) {
            push_shell(
                &mut shells,
                "WSL",
                first_existing([r"C:\Windows\System32\wsl.exe"])
                    .or_else(|| find_in_path("wsl.exe")),
            );
        }

        push_shell(
            &mut shells,
            "Cygwin",
            first_existing([r"C:\cygwin64\bin\bash.exe", r"C:\cygwin\bin\bash.exe"])
                .or_else(|| relative_to_path_exe("cygpath.exe", "bash.exe")),
        );

        let cmder_root_bash = std::env::var("CMDER_ROOT")
            .ok()
            .map(|root| format!(r"{root}\vendor\git-for-windows\bin\bash.exe"))
            .filter(|p| std::path::Path::new(p).exists());
        push_shell(
            &mut shells,
            "Cmder",
            cmder_root_bash
                .or_else(|| {
                    first_existing([
                        r"C:\tools\cmder\vendor\git-for-windows\bin\bash.exe",
                        r"C:\cmder\vendor\git-for-windows\bin\bash.exe",
                    ])
                })
                .or_else(|| {
                    relative_to_path_exe("cmder.exe", r"vendor\git-for-windows\bin\bash.exe")
                }),
        );

        // Command Prompt always exists.
        push_shell(
            &mut shells,
            "Command Prompt",
            Some(
                std::env::var("COMSPEC").unwrap_or_else(|_| r"C:\Windows\System32\cmd.exe".into()),
            ),
        );
    }

    #[cfg(not(windows))]
    {
        use crate::local::{flatpak, ShellPath};

        let candidates = unix_shell_candidates();
        let (login, installed) = if flatpak::spawns_on_host() {
            let refs: Vec<&str> = candidates.iter().map(String::as_str).collect();
            let host = flatpak::probe_host_shells(&refs);
            (host.login, host.installed)
        } else {
            let resolve = |path: String| {
                let target = std::fs::canonicalize(&path)
                    .map(|t| t.to_string_lossy().into_owned())
                    .unwrap_or_default();
                ShellPath::new(&path, &target)
            };
            let installed = candidates
                .into_iter()
                .filter(|p| std::path::Path::new(p).exists())
                .map(resolve)
                .collect();
            (std::env::var("SHELL").ok().map(resolve), installed)
        };
        shells.extend(unique_shells(login.into_iter().chain(installed)));
    }

    shells
}

#[cfg(not(windows))]
const UNIX_SHELLS: [&str; 4] = ["zsh", "bash", "fish", "pwsh"];
#[cfg(not(windows))]
const UNIX_SHELL_DIRS: [&str; 4] = ["/bin", "/usr/bin", "/usr/local/bin", "/opt/homebrew/bin"];

#[cfg(not(windows))]
fn unix_shell_candidates() -> Vec<String> {
    UNIX_SHELLS
        .iter()
        .flat_map(|name| {
            UNIX_SHELL_DIRS
                .iter()
                .map(move |dir| format!("{dir}/{name}"))
        })
        .chain([
            "/opt/microsoft/powershell/7/pwsh".into(),
            "/snap/bin/pwsh".into(),
        ])
        .collect()
}

// Spawn by the path found, not the resolved target: a busybox-style link needs its own name.
#[cfg(not(windows))]
fn unique_shells(found: impl IntoIterator<Item = crate::local::ShellPath>) -> Vec<ShellOption> {
    let mut seen = std::collections::HashSet::new();
    found
        .into_iter()
        .filter(|s| seen.insert(s.target.clone()))
        .map(|s| {
            let file = std::path::Path::new(&s.path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("shell");
            let name = if file == "pwsh" { "PowerShell" } else { file };
            ShellOption {
                name: name.to_string(),
                path: s.path,
            }
        })
        .collect()
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
    shell_integration: Option<bool>,
) -> Result<(), String> {
    state
        .spawn(
            app,
            session_id,
            cols,
            rows,
            shell,
            cwd,
            shell_integration.unwrap_or(true),
        )
        .await
}

/// The frontend's `local-output-<id>` / `local-closed-<id>` listeners are
/// registered. Releases the startup gate so the shell's banner and first
/// prompt are replayed instead of dropped.
#[tauri::command]
pub async fn local_ready(
    app: AppHandle,
    state: tauri::State<'_, LocalSessionManager>,
    session_id: String,
) -> Result<(), String> {
    state.mark_ready(&app, &session_id);
    Ok(())
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

#[cfg(all(test, not(windows)))]
mod tests {
    use super::*;
    use crate::local::ShellPath;

    #[test]
    fn unique_shells_keeps_one_entry_per_resolved_file() {
        let shells = unique_shells([
            ShellPath::new("/bin/bash", "/usr/bin/bash"),
            ShellPath::new("/bin/fish", "/usr/bin/fish"),
            ShellPath::new("/usr/bin/fish", "/usr/bin/fish"),
            ShellPath::new("/usr/bin/bash", "/usr/bin/bash"),
            ShellPath::new(
                "/opt/homebrew/bin/bash",
                "/opt/homebrew/Cellar/bash/5.2/bin/bash",
            ),
        ]);
        let paths: Vec<_> = shells.iter().map(|s| s.path.as_str()).collect();
        assert_eq!(paths, ["/bin/bash", "/bin/fish", "/opt/homebrew/bin/bash"]);
    }

    #[test]
    fn unique_shells_names_pwsh_powershell() {
        let shells = unique_shells([ShellPath::new(
            "/usr/bin/pwsh",
            "/opt/microsoft/powershell/7/pwsh",
        )]);
        assert_eq!(shells[0].name, "PowerShell");
        assert_eq!(shells[0].path, "/usr/bin/pwsh");
    }

    #[test]
    fn candidates_cover_pwsh_and_homebrew() {
        let candidates = unix_shell_candidates();
        for p in [
            "/usr/bin/pwsh",
            "/opt/homebrew/bin/fish",
            "/bin/zsh",
            "/opt/microsoft/powershell/7/pwsh",
        ] {
            assert!(candidates.iter().any(|c| c == p), "{p} missing");
        }
    }
}
