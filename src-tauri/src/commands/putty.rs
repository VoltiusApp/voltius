// Saved PuTTY/KiTTY sessions as the text the TS importer parses: a .reg export on
// Windows, `tail -n +1` output of the sessions directory elsewhere.

use std::fmt::Write as _;
use std::path::{Path, PathBuf};

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
const REG_SESSION_KEYS: [&str; 2] = [
    r"Software\SimonTatham\PuTTY\Sessions",
    r"Software\9bis.com\KiTTY\Sessions",
];

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
enum RegValue {
    Str(String),
    Dword(u32),
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
struct RegSession {
    base: &'static str,
    name: String,
    values: Vec<(String, RegValue)>,
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn reg_escape(s: &str) -> String {
    s.replace('\\', r"\\").replace('"', "\\\"")
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn to_reg_text(sessions: &[RegSession]) -> String {
    if sessions.is_empty() {
        return String::new();
    }
    let mut out = String::from("Windows Registry Editor Version 5.00\r\n");
    for s in sessions {
        let _ = write!(out, "\r\n[HKEY_CURRENT_USER\\{}\\{}]\r\n", s.base, s.name);
        for (k, v) in &s.values {
            let _ = match v {
                RegValue::Str(v) => write!(out, "\"{}\"=\"{}\"\r\n", reg_escape(k), reg_escape(v)),
                RegValue::Dword(v) => write!(out, "\"{}\"=dword:{v:08x}\r\n", reg_escape(k)),
            };
        }
    }
    out
}

#[cfg(target_os = "windows")]
fn read_registry() -> Vec<RegSession> {
    use windows_registry::{Type, CURRENT_USER};
    let mut sessions = Vec::new();
    for base in REG_SESSION_KEYS {
        let Ok(root) = CURRENT_USER.open(base) else {
            continue;
        };
        let Ok(names) = root.keys() else {
            continue;
        };
        for name in names {
            let Ok(key) = root.open(&name) else {
                continue;
            };
            let Ok(values) = key.values() else {
                continue;
            };
            let values = values
                .filter_map(|(k, v)| match v.ty() {
                    Type::U32 => u32::try_from(v).ok().map(|n| (k, RegValue::Dword(n))),
                    Type::String | Type::ExpandString => {
                        String::try_from(v).ok().map(|s| (k, RegValue::Str(s)))
                    }
                    _ => None,
                })
                .collect();
            sessions.push(RegSession { base, name, values });
        }
    }
    sessions
}

/// PuTTY's own lookup order (unix/storage.c): $PUTTYSESSIONS, $PUTTYDIR/sessions,
/// then the XDG directory if it exists, else ~/.putty.
#[cfg_attr(target_os = "windows", allow(dead_code))]
fn sessions_dir(env: impl Fn(&str) -> Option<String>, home: &Path) -> PathBuf {
    if let Some(dir) = env("PUTTYSESSIONS") {
        return dir.into();
    }
    let config = env("PUTTYDIR").map(PathBuf::from).unwrap_or_else(|| {
        let xdg = env("XDG_CONFIG_HOME")
            .filter(|v| !v.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".config"))
            .join("putty");
        if xdg.exists() {
            xdg
        } else {
            home.join(".putty")
        }
    });
    config.join("sessions")
}

#[cfg_attr(target_os = "windows", allow(dead_code))]
fn to_tail_text(dir: &Path) -> String {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return String::new();
    };
    let mut files: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file())
        .collect();
    files.sort();
    let mut out = String::new();
    for path in files {
        let (Some(name), Ok(bytes)) = (path.file_name(), std::fs::read(&path)) else {
            continue;
        };
        let _ = write!(
            out,
            "==> {} <==\n{}\n",
            name.to_string_lossy(),
            String::from_utf8_lossy(&bytes)
        );
    }
    out
}

#[tauri::command]
pub fn putty_sessions() -> String {
    #[cfg(target_os = "windows")]
    {
        to_reg_text(&read_registry())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let home = dirs::home_dir().unwrap_or_default();
        to_tail_text(&sessions_dir(|k| std::env::var(k).ok(), &home))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn writes_registry_sessions_as_a_reg_export() {
        let sessions = [RegSession {
            base: REG_SESSION_KEYS[0],
            name: "Prod%20API".into(),
            values: vec![
                (
                    "HostName".into(),
                    RegValue::Str(r#"deploy@api "x"\y"#.into()),
                ),
                ("PortNumber".into(), RegValue::Dword(2222)),
            ],
        }];
        assert_eq!(
            to_reg_text(&sessions),
            "Windows Registry Editor Version 5.00\r\n\r\n\
             [HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\Prod%20API]\r\n\
             \"HostName\"=\"deploy@api \\\"x\\\"\\\\y\"\r\n\
             \"PortNumber\"=dword:000008ae\r\n"
        );
        assert_eq!(to_reg_text(&[]), "");
    }

    #[test]
    fn joins_session_files_under_tail_headers() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("b"), "HostName=b\n").unwrap();
        std::fs::write(dir.path().join("Caf%C3%A9"), "Present=1\nHostName=a\n").unwrap();
        assert_eq!(
            to_tail_text(dir.path()),
            "==> Caf%C3%A9 <==\nPresent=1\nHostName=a\n\n==> b <==\nHostName=b\n\n"
        );
        assert_eq!(to_tail_text(&dir.path().join("missing")), "");
    }

    #[test]
    fn finds_the_sessions_directory_the_way_putty_does() {
        let home = tempfile::tempdir().unwrap();
        let env = |vars: &'static [(&'static str, &'static str)]| {
            let map: HashMap<_, _> = vars.iter().copied().collect();
            move |k: &str| map.get(k).map(|v| v.to_string())
        };
        assert_eq!(
            sessions_dir(env(&[]), home.path()),
            home.path().join(".putty/sessions")
        );
        std::fs::create_dir_all(home.path().join(".config/putty")).unwrap();
        assert_eq!(
            sessions_dir(env(&[]), home.path()),
            home.path().join(".config/putty/sessions")
        );
        assert_eq!(
            sessions_dir(env(&[("PUTTYDIR", "/p")]), home.path()),
            PathBuf::from("/p/sessions")
        );
        assert_eq!(
            sessions_dir(
                env(&[("PUTTYDIR", "/p"), ("PUTTYSESSIONS", "/s")]),
                home.path()
            ),
            PathBuf::from("/s")
        );
    }
}
