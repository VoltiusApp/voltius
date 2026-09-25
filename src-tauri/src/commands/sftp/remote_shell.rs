use super::shell_quote;
use crate::sftp::SftpManager;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WinShell {
    Cmd,
    PowerShell,
}

/// The shell a host runs exec'd commands through, and so the dialect tar commands are written in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RemoteShell {
    Posix,
    /// Win32-OpenSSH; `temp` is the native `%TEMP%` the archives are staged in.
    Windows {
        shell: WinShell,
        temp: String,
    },
}

const POSIX_PROBE: &str = "command -v tar >/dev/null 2>&1 && test -d /tmp; echo __TF_EXIT__:$?";
const TEMP_MARKER: &str = "__TF_TEMP__:";
// Each prints the marker only under its own shell; the other shells echo it literally or fail.
const CMD_TEMP_PROBE: &str = "echo __TF_TEMP__:%TEMP%";
const PS_TEMP_PROBE: &str = "'__TF_TEMP__:' + $env:TEMP";
const CMD_MAX_LEN: usize = 8191;

/// The host's shell if it can run tar transfers, probed once per session.
pub async fn remote_shell(manager: &SftpManager, sftp_id: &str) -> Option<RemoteShell> {
    let cell = manager.tar_shell_cell(sftp_id).await?;
    cell.get_or_init(|| detect(manager, sftp_id)).await.clone()
}

async fn detect(manager: &SftpManager, sftp_id: &str) -> Option<RemoteShell> {
    if manager.exec_probe(sftp_id, POSIX_PROBE).await {
        return Some(RemoteShell::Posix);
    }
    for (shell, probe) in [
        (WinShell::Cmd, CMD_TEMP_PROBE),
        (WinShell::PowerShell, PS_TEMP_PROBE),
    ] {
        let Ok(out) = manager.exec_output(sftp_id, probe).await else {
            continue;
        };
        if let Some(temp) = parse_temp(&out) {
            let found = RemoteShell::Windows { shell, temp };
            let has_tar = manager
                .exec_probe(sftp_id, &found.status("tar --version", None))
                .await;
            return has_tar.then_some(found);
        }
    }
    None
}

fn parse_temp(out: &str) -> Option<String> {
    let temp = out
        .lines()
        .find_map(|l| l.trim().strip_prefix(TEMP_MARKER))?
        .trim();
    let b = temp.as_bytes();
    let absolute = b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && b[2] == b'\\';
    absolute.then(|| temp.trim_end_matches('\\').to_string())
}

/// `/C:/Users/x` (the form Win32-OpenSSH's SFTP speaks) → `C:\Users\x`.
fn to_native(sftp_path: &str) -> String {
    let b = sftp_path.as_bytes();
    let path = if b.len() >= 3 && b[0] == b'/' && b[2] == b':' {
        &sftp_path[1..]
    } else {
        sftp_path
    };
    let mut native = path.replace('/', "\\").trim_end_matches('\\').to_string();
    // A bare `C:` is the drive's current directory, not its root; `C:\` would escape the closing quote.
    if native.len() == 2 && native.ends_with(':') {
        native.push_str("\\.");
    }
    native
}

/// Double-quote `s` for a cmd.exe command line. cmd expands `%VAR%` even inside
/// quotes, and a caret there is literal, so each `%` steps outside them as `^%`:
/// any `%…%` pair then spans a name starting with `"` and ending with `^`, which
/// no variable has, and cmd drops the caret before the program runs. Backslashes
/// ahead of a quote are doubled so the program's argv parsing keeps them.
fn cmd_quote(s: &str) -> String {
    let mut out = String::from("\"");
    for (i, part) in s.split('%').enumerate() {
        if i > 0 {
            out.push_str("^%\"");
        }
        let slashes = part.len() - part.trim_end_matches('\\').len();
        out.push_str(part);
        out.push_str(&"\\".repeat(slashes));
        out.push('"');
    }
    out
}

fn to_sftp(native: &str) -> String {
    format!("/{}", native.replace('\\', "/"))
}

impl RemoteShell {
    pub fn is_windows(&self) -> bool {
        matches!(self, Self::Windows { .. })
    }

    /// SFTP path of a temp file named `name`.
    pub fn temp_path(&self, name: &str) -> String {
        match self {
            Self::Posix => format!("/tmp/{name}"),
            Self::Windows { temp, .. } => format!("{}/{name}", to_sftp(temp)),
        }
    }

    pub fn quote(&self, s: &str) -> String {
        match self {
            Self::Posix => shell_quote(s),
            Self::Windows {
                shell: WinShell::Cmd,
                ..
            } => cmd_quote(s),
            Self::Windows {
                shell: WinShell::PowerShell,
                ..
            } => format!("'{}'", s.replace('\'', "''")),
        }
    }

    /// Quote an SFTP path as the shell's native path.
    pub fn quote_path(&self, sftp_path: &str) -> String {
        match self {
            Self::Posix => shell_quote(sftp_path),
            Self::Windows { .. } => self.quote(&to_native(sftp_path)),
        }
    }

    pub fn deref_flags(&self) -> &'static str {
        match self {
            Self::Posix => "-h --ignore-failed-read ",
            Self::Windows { .. } => "-h ",
        }
    }

    /// Create `dir` (and its parents), then run `cmd` whether or not it already existed.
    pub fn in_dir(&self, dir: &str, cmd: &str) -> String {
        let d = self.quote_path(dir);
        match self {
            Self::Posix => format!("mkdir -p {d} && {cmd}"),
            Self::Windows {
                shell: WinShell::Cmd,
                ..
            } => format!("(mkdir {d} 2>nul & {cmd})"),
            Self::Windows {
                shell: WinShell::PowerShell,
                ..
            } => format!("New-Item -ItemType Directory -Force -Path {d} | Out-Null; {cmd}"),
        }
    }

    pub fn rm(&self, path: &str) -> String {
        let p = self.quote_path(path);
        match self {
            Self::Posix => format!("rm -f {p}"),
            Self::Windows {
                shell: WinShell::Cmd,
                ..
            } => format!("del /f /q {p} 2>nul"),
            Self::Windows {
                shell: WinShell::PowerShell,
                ..
            } => format!("Remove-Item -Force -LiteralPath {p} -ErrorAction SilentlyContinue"),
        }
    }

    /// Run `cmd` with its output merged, then `cleanup`, and report `cmd`'s exit
    /// code in the `__TF_EXIT__` marker `exec_command` looks for.
    pub fn status(&self, cmd: &str, cleanup: Option<&str>) -> String {
        match (self, cleanup) {
            (Self::Posix, None) => format!("{cmd} 2>&1; echo __TF_EXIT__:$?"),
            (Self::Posix, Some(c)) => {
                format!("{cmd} 2>&1; RC=$?; {c}; echo __TF_EXIT__:$RC")
            }
            // cmd.exe expands %errorlevel% before the line runs, so branch on success instead.
            (
                Self::Windows {
                    shell: WinShell::Cmd,
                    ..
                },
                c,
            ) => {
                let then = |code: u8| match c {
                    Some(c) => format!("({c} & echo __TF_EXIT__:{code})"),
                    None => format!("echo __TF_EXIT__:{code}"),
                };
                format!("{cmd} 2>&1 && {} || {}", then(0), then(1))
            }
            (
                Self::Windows {
                    shell: WinShell::PowerShell,
                    ..
                },
                c,
            ) => {
                let c = c.map(|c| format!("{c}; ")).unwrap_or_default();
                format!("{cmd} 2>&1; $rc = $LASTEXITCODE; {c}'__TF_EXIT__:' + $rc")
            }
        }
    }

    /// `cmd` unless it overflows cmd.exe's command-line limit.
    pub fn checked(&self, cmd: String) -> Result<String, String> {
        match self {
            Self::Windows {
                shell: WinShell::Cmd,
                ..
            } if cmd.len() > CMD_MAX_LEN => Err(
                "Too many items for one tar transfer from a Windows host: select fewer, or turn off tar transfers"
                    .into(),
            ),
            _ => Ok(cmd),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn win(shell: WinShell) -> RemoteShell {
        RemoteShell::Windows {
            shell,
            temp: r"C:\Users\me\AppData\Local\Temp".into(),
        }
    }

    #[test]
    fn temp_probe_accepts_only_an_expanded_windows_path() {
        assert_eq!(
            parse_temp("__TF_TEMP__:C:\\Users\\me\\Temp\r\n").as_deref(),
            Some(r"C:\Users\me\Temp")
        );
        assert_eq!(parse_temp("__TF_TEMP__:%TEMP%\n"), None);
        assert_eq!(parse_temp("__TF_TEMP__::TEMP\n"), None);
        assert_eq!(parse_temp("sh: 1: __TF_TEMP__:: not found\n"), None);
    }

    #[test]
    fn sftp_paths_map_to_native_windows_paths() {
        assert_eq!(to_native("/C:/Users/me/a b"), r"C:\Users\me\a b");
        assert_eq!(to_native("/C:/Users/me/"), r"C:\Users\me");
        assert_eq!(to_native("/C:"), r"C:\.");
        assert_eq!(to_native("/D:/"), r"D:\.");
    }

    #[test]
    fn windows_archives_are_staged_in_temp() {
        assert_eq!(
            win(WinShell::Cmd).temp_path("tf_1.tar.gz"),
            "/C:/Users/me/AppData/Local/Temp/tf_1.tar.gz"
        );
        assert_eq!(
            RemoteShell::Posix.temp_path("tf_1.tar.gz"),
            "/tmp/tf_1.tar.gz"
        );
    }

    #[test]
    fn quoting_follows_the_shell() {
        assert_eq!(win(WinShell::Cmd).quote_path("/C:/a b"), r#""C:\a b""#);
        assert_eq!(
            win(WinShell::PowerShell).quote_path("/C:/it's"),
            r"'C:\it''s'"
        );
        assert_eq!(RemoteShell::Posix.quote_path("/a b"), "'/a b'");
    }

    #[test]
    fn cmd_quoting_never_expands_a_variable() {
        let q = |s| win(WinShell::Cmd).quote(s);
        assert_eq!(q("a b"), r#""a b""#);
        assert_eq!(q("%PATH%"), r#"""^%"PATH"^%"""#);
        assert_eq!(q("50% off"), r#""50"^%" off""#);
        // A backslash before a quote would escape it for the program, so it's doubled.
        assert_eq!(q(r"dir\%x"), r#""dir\\"^%"x""#);
        assert_eq!(
            win(WinShell::Cmd).quote_path("/C:/Users/%USERNAME%/a"),
            r#""C:\Users\\"^%"USERNAME"^%"\a""#
        );
    }

    #[test]
    fn cmd_status_branches_instead_of_reading_errorlevel() {
        assert_eq!(
            win(WinShell::Cmd).status("tar x", Some("del y")),
            "tar x 2>&1 && (del y & echo __TF_EXIT__:0) || (del y & echo __TF_EXIT__:1)"
        );
        assert_eq!(
            win(WinShell::Cmd).status("tar x", None),
            "tar x 2>&1 && echo __TF_EXIT__:0 || echo __TF_EXIT__:1"
        );
    }

    #[test]
    fn powershell_status_reports_the_exit_code_before_cleanup_changes_it() {
        assert_eq!(
            win(WinShell::PowerShell).status("tar x", Some("rm y")),
            "tar x 2>&1; $rc = $LASTEXITCODE; rm y; '__TF_EXIT__:' + $rc"
        );
    }

    #[test]
    fn only_cmd_rejects_an_overlong_command() {
        let long = "x".repeat(CMD_MAX_LEN + 1);
        assert!(win(WinShell::Cmd).checked(long.clone()).is_err());
        assert!(win(WinShell::PowerShell).checked(long.clone()).is_ok());
        assert!(RemoteShell::Posix.checked(long).is_ok());
    }
}
