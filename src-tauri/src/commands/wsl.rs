//! WSL distro discovery. Distros are browsed via the Windows filesystem at
//! `\\wsl.localhost\<Distro>`; only the bare root can't be read_dir'd (Windows
//! returns ERROR_LOGON_FAILURE 1326), so we list distros via `wsl.exe`.

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Canonical UNC prefix if `path` is the bare WSL root (`\\wsl.localhost` or `\\wsl$`), else `None`.
pub fn root_prefix(path: &str) -> Option<&'static str> {
    let trimmed = path.replace('/', "\\");
    match trimmed.trim_end_matches('\\').to_ascii_lowercase().as_str() {
        r"\\wsl.localhost" => Some(r"\\wsl.localhost"),
        r"\\wsl$" => Some(r"\\wsl$"),
        _ => None,
    }
}

/// Installed WSL distros, excluding Docker's internal ones. Empty if WSL is unavailable.
#[cfg(target_os = "windows")]
pub fn list_distros() -> Vec<String> {
    use std::os::windows::process::CommandExt;
    let output = match std::process::Command::new("wsl.exe")
        .args(["--list", "--quiet"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
    {
        Ok(o) if o.status.success() => o,
        _ => return Vec::new(),
    };
    // wsl.exe emits UTF-16LE with a BOM.
    let utf16: Vec<u16> = output
        .stdout
        .chunks_exact(2)
        .map(|c| u16::from_le_bytes([c[0], c[1]]))
        .collect();
    String::from_utf16_lossy(&utf16)
        .lines()
        .map(|l| l.trim_start_matches('\u{feff}').trim_matches('\0').trim().to_string())
        .filter(|l| !l.is_empty() && l != "docker-desktop" && l != "docker-desktop-data")
        .collect()
}

#[cfg(not(target_os = "windows"))]
pub fn list_distros() -> Vec<String> {
    Vec::new()
}

#[tauri::command]
pub fn wsl_list_distros() -> Vec<String> {
    list_distros()
}
