//! WSL distro discovery. Distros are browsed via the Windows filesystem at
//! `\\wsl.localhost\<Distro>`; only the bare root can't be read_dir'd (Windows
//! returns ERROR_LOGON_FAILURE 1326), so we list distros via `wsl.exe`.

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const ROOTS: [&str; 2] = [r"\\wsl.localhost", r"\\wsl$"];

/// Canonical UNC prefix if `path` is the bare WSL root (`\\wsl.localhost` or `\\wsl$`), else `None`.
pub fn root_prefix(path: &str) -> Option<&'static str> {
    let trimmed = path.replace('/', "\\");
    let trimmed = trimmed.trim_end_matches('\\');
    ROOTS.into_iter().find(|r| trimmed.eq_ignore_ascii_case(r))
}

/// `\\wsl.localhost\<Distro>\a\b` as `("<Distro>", "/a/b")`.
fn split_unc(path: &str) -> Option<(String, String)> {
    let path = path.replace('/', "\\");
    let rest = ROOTS.into_iter().find_map(|r| {
        path.get(..r.len())
            .filter(|head| head.eq_ignore_ascii_case(r))
            .and_then(|_| path[r.len()..].strip_prefix('\\'))
    })?;
    let (distro, inner) = rest.split_once('\\').unwrap_or((rest, ""));
    if distro.is_empty() {
        return None;
    }
    let inner = inner.trim_end_matches('\\').replace('\\', "/");
    Some((distro.to_string(), format!("/{inner}")))
}

/// The distro a Windows path lives in and the path inside it; None off Windows or outside WSL.
pub fn distro_path(path: &str) -> Option<(String, String)> {
    if cfg!(target_os = "windows") {
        split_unc(path)
    } else {
        None
    }
}

/// `program` run directly (no login shell re-parsing its args) inside `distro`.
#[cfg(target_os = "windows")]
pub fn exec_command(distro: &str, program: &str) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new("wsl.exe");
    cmd.args(["-d", distro, "--exec", program])
        .creation_flags(CREATE_NO_WINDOW);
    cmd
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
        .map(|l| {
            l.trim_start_matches('\u{feff}')
                .trim_matches('\0')
                .trim()
                .to_string()
        })
        .filter(|l| !l.is_empty() && l != "docker-desktop" && l != "docker-desktop-data")
        .collect()
}

#[cfg(not(target_os = "windows"))]
pub fn list_distros() -> Vec<String> {
    Vec::new()
}

/// Windows UNC path of the distro's home dir. The bare distro root maps to `/`,
/// which is root-owned and not writable, so transfers must land in `$HOME`.
#[cfg(target_os = "windows")]
pub fn home_dir(distro: &str) -> Option<String> {
    use std::os::windows::process::CommandExt;
    let output = std::process::Command::new("wsl.exe")
        .args(["-d", distro, "--", "sh", "-lc", r#"wslpath -w "$HOME""#])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    // Commands run inside the distro emit UTF-8 (unlike `wsl --list`).
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() {
        None
    } else {
        Some(path)
    }
}

#[cfg(not(target_os = "windows"))]
pub fn home_dir(_distro: &str) -> Option<String> {
    None
}

#[tauri::command]
pub fn wsl_list_distros() -> Vec<String> {
    list_distros()
}

/// Home directory of a WSL distro as a Windows path. Falls back to the distro
/// root if resolution fails.
#[tauri::command]
pub fn wsl_home_dir(distro: String) -> String {
    home_dir(&distro).unwrap_or_else(|| format!(r"\\wsl.localhost\{distro}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unc_paths_map_into_their_distro() {
        assert_eq!(
            split_unc(r"\\wsl.localhost\Ubuntu\home\me\a b"),
            Some(("Ubuntu".into(), "/home/me/a b".into()))
        );
        assert_eq!(
            split_unc("//WSL$/Debian/"),
            Some(("Debian".into(), "/".into()))
        );
        assert_eq!(
            split_unc(r"\\wsl.localhost\Arch"),
            Some(("Arch".into(), "/".into()))
        );
        assert_eq!(split_unc(r"\\wsl.localhost"), None);
        assert_eq!(split_unc(r"\\wsl.localhostX\a"), None);
        assert_eq!(split_unc(r"C:\Users\me"), None);
    }

    #[test]
    fn only_the_bare_root_is_a_root() {
        assert_eq!(root_prefix("//WSL.localhost/"), Some(r"\\wsl.localhost"));
        assert_eq!(root_prefix(r"\\wsl$"), Some(r"\\wsl$"));
        assert_eq!(root_prefix(r"\\wsl$\Ubuntu"), None);
    }
}
