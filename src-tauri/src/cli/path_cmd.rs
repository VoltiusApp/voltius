use super::{CliError, Ctx};
use clap::Subcommand;

#[derive(Subcommand, Debug)]
pub enum PathCmd {
    Add { dir: String },
    Remove { dir: String },
}

#[cfg(any(target_os = "windows", test))]
fn norm(entry: &str) -> String {
    entry.trim().trim_end_matches('\\').to_lowercase()
}

#[cfg(any(target_os = "windows", test))]
fn contains(current: &str, dir: &str) -> bool {
    let want = norm(dir);
    current.split(';').any(|e| norm(e) == want)
}

#[cfg(any(target_os = "windows", test))]
pub fn path_with(current: &str, dir: &str) -> Option<String> {
    if contains(current, dir) {
        return None;
    }
    let sep = if current.is_empty() || current.ends_with(';') {
        ""
    } else {
        ";"
    };
    Some(format!("{current}{sep}{dir}"))
}

#[cfg(any(target_os = "windows", test))]
pub fn path_without(current: &str, dir: &str) -> Option<String> {
    if !contains(current, dir) {
        return None;
    }
    let want = norm(dir);
    let kept: Vec<&str> = current.split(';').filter(|e| norm(e) != want).collect();
    Some(kept.join(";"))
}

#[cfg(any(target_os = "windows", test))]
fn is_not_found(hresult: i32) -> bool {
    hresult == 0x8007_0002_u32 as i32
}

#[cfg(target_os = "windows")]
pub fn run(cmd: PathCmd, _ctx: &mut Ctx) -> Result<(), CliError> {
    use windows_registry::{Type, CURRENT_USER};
    let (add, dir) = match &cmd {
        PathCmd::Add { dir } => (true, dir),
        PathCmd::Remove { dir } => (false, dir),
    };
    let io = |e: &dyn std::fmt::Display| CliError::io(e.to_string());
    let key = CURRENT_USER.create("Environment").map_err(|e| io(&e))?;
    let existing = match key.get_value("Path") {
        Ok(v) => Some(v),
        Err(e) if is_not_found(e.code().0) => None,
        Err(e) => return Err(io(&e)),
    };
    let expand = existing
        .as_ref()
        .is_none_or(|v| v.ty() == Type::ExpandString);
    let current = match existing {
        Some(v) => String::try_from(v).map_err(|e| io(&e))?,
        None => String::new(),
    };
    let next = if add {
        path_with(&current, dir)
    } else {
        path_without(&current, dir)
    };
    let Some(next) = next else {
        return Ok(());
    };
    if next.is_empty() {
        key.remove_value("Path").map_err(|e| io(&e))?;
    } else if expand {
        key.set_expand_string("Path", &next).map_err(|e| io(&e))?;
    } else {
        key.set_string("Path", &next).map_err(|e| io(&e))?;
    }
    broadcast_environment_change();
    Ok(())
}

#[cfg(target_os = "windows")]
fn broadcast_environment_change() {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE,
    };
    let env: Vec<u16> = "Environment\0".encode_utf16().collect();
    let mut result = 0usize;
    // SAFETY: `env` is a NUL-terminated UTF-16 string that outlives the call.
    unsafe {
        SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_SETTINGCHANGE,
            0,
            env.as_ptr() as isize,
            SMTO_ABORTIFHUNG,
            5000,
            &mut result,
        );
    }
}

#[cfg(not(target_os = "windows"))]
pub fn run(_cmd: PathCmd, _ctx: &mut Ctx) -> Result<(), CliError> {
    Err(CliError::Usage(
        "__path is only available on Windows".into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appends_to_empty_and_plain() {
        assert_eq!(path_with("", r"C:\V").as_deref(), Some(r"C:\V"));
        assert_eq!(path_with(r"C:\a", r"C:\V").as_deref(), Some(r"C:\a;C:\V"));
    }

    #[test]
    fn appends_after_trailing_semicolon() {
        assert_eq!(path_with(r"C:\a;", r"C:\V").as_deref(), Some(r"C:\a;C:\V"));
    }

    #[test]
    fn duplicate_is_none_ignoring_case_and_trailing_backslash() {
        assert_eq!(path_with(r"C:\a;c:\v\", r"C:\V"), None);
        assert_eq!(path_with(r"C:\a;C:\V", r"c:\v\"), None);
    }

    #[test]
    fn remove_keeps_the_rest_byte_identical() {
        assert_eq!(
            path_without(r"C:\a;C:\V;%SystemRoot%\x;", r"c:\v").as_deref(),
            Some(r"C:\a;%SystemRoot%\x;")
        );
        assert_eq!(path_without(r"C:\a", r"C:\V"), None);
    }

    #[test]
    fn long_path_survives_intact() {
        let long = (0..300)
            .map(|i| format!(r"C:\dir{i:04}\bin"))
            .collect::<Vec<_>>()
            .join(";");
        assert!(long.len() > 3000);
        let added = path_with(&long, r"C:\V").unwrap();
        assert_eq!(path_without(&added, r"C:\V").unwrap(), long);
    }

    #[test]
    fn only_file_not_found_means_absent() {
        assert!(is_not_found(0x8007_0002_u32 as i32));
        assert!(!is_not_found(0x8007_0005_u32 as i32));
        assert!(!is_not_found(0));
    }

    #[test]
    fn removing_the_only_entry_yields_empty() {
        assert_eq!(path_without(r"C:\V", r"C:\V").as_deref(), Some(""));
    }

    #[test]
    fn empty_middle_segment_is_preserved() {
        assert_eq!(
            path_without(r"C:\a;;C:\V;C:\b", r"C:\V").as_deref(),
            Some(r"C:\a;;C:\b")
        );
        assert_eq!(
            path_with(r"C:\a;;C:\b", r"C:\V").as_deref(),
            Some(r"C:\a;;C:\b;C:\V")
        );
    }
}
