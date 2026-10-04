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

/// cmd expands `%VAR%` even inside quotes, so each `%` steps outside them as `^%`;
/// backslashes ahead of a quote are doubled so the program's argv parsing keeps them.
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

    fn tar_c(&self, archive: Option<&str>, parent: &str, items: &[String], deref: bool) -> String {
        let quoted: Vec<String> = items.iter().map(|i| self.quote(i)).collect();
        format!(
            "tar -czf {arch} {deref}-C {parent} -- {items}",
            arch = archive.map_or_else(|| "-".to_string(), |a| self.quote_path(a)),
            deref = if deref { self.deref_flags() } else { "" },
            parent = self.quote_path(parent),
            items = quoted.join(" "),
        )
    }

    fn tar_x(&self, archive: Option<&str>, dest: &str, strip: bool) -> String {
        let tar = format!(
            "tar -xzf {arch} {strip}-C {dest}",
            arch = archive.map_or_else(|| "-".to_string(), |a| self.quote_path(a)),
            strip = if strip { "--strip-components=1 " } else { "" },
            dest = self.quote_path(dest),
        );
        self.in_dir(dest, &tar)
    }

    /// PowerShell's own exit code says only whether the last command threw.
    fn exits(&self, cmd: &str) -> String {
        match self {
            Self::Windows {
                shell: WinShell::PowerShell,
                ..
            } => format!("{cmd}; exit $LASTEXITCODE"),
            _ => cmd.to_string(),
        }
    }

    pub fn compress(
        &self,
        archive: &str,
        parent: &str,
        items: &[String],
    ) -> Result<String, String> {
        self.checked(self.status(&self.tar_c(Some(archive), parent, items, false), None))
    }

    pub fn extract(&self, archive: &str, dest: &str) -> String {
        self.status(&self.tar_x(Some(archive), dest, false), None)
    }

    #[allow(dead_code)]
    pub fn create_to_stdout(
        &self,
        parent: &str,
        items: &[String],
        deref: bool,
    ) -> Result<String, String> {
        self.checked(self.exits(&self.tar_c(None, parent, items, deref)))
    }

    #[allow(dead_code)]
    pub fn extract_from_stdin(&self, dest: &str, strip: bool) -> String {
        self.exits(&self.tar_x(None, dest, strip))
    }

    #[allow(dead_code)]
    pub fn stream_probe(&self) -> String {
        self.exits("tar -xzf - -O")
    }

    #[allow(dead_code)]
    pub fn size_probe(&self, parent: &str, items: &[String]) -> Option<String> {
        match self {
            Self::Posix => {
                let quoted: Vec<String> = items.iter().map(|i| self.quote(i)).collect();
                Some(format!(
                    "cd {} && du -sk -- {}",
                    self.quote_path(parent),
                    quoted.join(" ")
                ))
            }
            Self::Windows {
                shell: WinShell::PowerShell,
                ..
            } => {
                let base = parent.trim_end_matches('/');
                let paths: Vec<String> = items
                    .iter()
                    .map(|i| self.quote_path(&format!("{base}/{i}")))
                    .collect();
                Some(format!(
                    "(Get-ChildItem -LiteralPath {} -Recurse -File -Force | Measure-Object -Property Length -Sum).Sum",
                    paths.join(",")
                ))
            }
            Self::Windows {
                shell: WinShell::Cmd,
                ..
            } => None,
        }
    }

    #[allow(dead_code)]
    pub fn parse_size(&self, out: &str) -> Option<u64> {
        match self {
            Self::Posix => {
                let kib: Vec<u64> = out
                    .lines()
                    .filter_map(|l| l.split_whitespace().next()?.parse().ok())
                    .collect();
                (!kib.is_empty()).then(|| kib.iter().sum::<u64>() * 1024)
            }
            Self::Windows {
                shell: WinShell::PowerShell,
                ..
            } => out.trim().parse().ok(),
            Self::Windows {
                shell: WinShell::Cmd,
                ..
            } => None,
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

    const SH: RemoteShell = RemoteShell::Posix;

    #[test]
    fn stream_commands_use_stdio_and_keep_stderr_apart() {
        assert_eq!(
            SH.create_to_stdout("/srv", &["x".into(), "y z".into()], false),
            Ok("tar -czf - -C '/srv' -- 'x' 'y z'".into())
        );
        assert_eq!(
            SH.create_to_stdout("/srv", &["x".into()], true),
            Ok("tar -czf - -h --ignore-failed-read -C '/srv' -- 'x'".into())
        );
        assert_eq!(
            SH.extract_from_stdin("/srv/it's", true),
            r"mkdir -p '/srv/it'\''s' && tar -xzf - --strip-components=1 -C '/srv/it'\''s'"
        );
        assert_eq!(
            win(WinShell::Cmd).extract_from_stdin("/C:/d d", false),
            r#"(mkdir "C:\d d" 2>nul & tar -xzf - -C "C:\d d")"#
        );
        assert_eq!(
            win(WinShell::PowerShell).extract_from_stdin("/C:/it's", false),
            r"New-Item -ItemType Directory -Force -Path 'C:\it''s' | Out-Null; tar -xzf - -C 'C:\it''s'; exit $LASTEXITCODE"
        );
        assert_eq!(SH.stream_probe(), "tar -xzf - -O");
        assert_eq!(
            win(WinShell::PowerShell).stream_probe(),
            "tar -xzf - -O; exit $LASTEXITCODE"
        );
    }

    #[test]
    fn stream_create_never_reads_an_item_as_an_option() {
        let cmd = SH
            .create_to_stdout("/srv", &["--version".into()], false)
            .unwrap();
        assert!(cmd.ends_with("-C '/srv' -- '--version'"), "{cmd}");
    }

    #[test]
    fn compress_and_extract_still_report_through_the_marker() {
        assert_eq!(
            SH.compress("/tmp/a.tar.gz", "/srv", &["x".into(), "y z".into()]),
            Ok("tar -czf '/tmp/a.tar.gz' -C '/srv' -- 'x' 'y z' 2>&1; echo __TF_EXIT__:$?".into())
        );
        assert_eq!(
            SH.extract("/tmp/a.tar.gz", "/dest"),
            "mkdir -p '/dest' && tar -xzf '/tmp/a.tar.gz' -C '/dest' 2>&1; echo __TF_EXIT__:$?"
        );
        let at_root = win(WinShell::Cmd)
            .compress("/C:/Temp/a", "/C:", &["x".into()])
            .unwrap();
        assert!(at_root.contains(r#"-C "C:\." -- "x""#));
    }

    #[test]
    fn size_probes_per_dialect() {
        assert_eq!(
            SH.size_probe("/srv", &["a".into(), "b c".into()])
                .as_deref(),
            Some("cd '/srv' && du -sk -- 'a' 'b c'")
        );
        assert_eq!(SH.parse_size("4\ta\n8\tb c\n"), Some(12 * 1024));
        assert_eq!(
            win(WinShell::PowerShell)
                .size_probe("/C:/s", &["a".into()])
                .as_deref(),
            Some(
                r"(Get-ChildItem -LiteralPath 'C:\s\a' -Recurse -File -Force | Measure-Object -Property Length -Sum).Sum"
            )
        );
        assert_eq!(
            win(WinShell::PowerShell).parse_size("12345\r\n"),
            Some(12345)
        );
        assert_eq!(win(WinShell::Cmd).size_probe("/C:/s", &["a".into()]), None);
    }

    #[test]
    fn size_probe_output_that_is_not_a_size_gives_none() {
        assert_eq!(SH.parse_size("du: cannot access 'a': No such file\n"), None);
        assert_eq!(SH.parse_size(""), None);
        assert_eq!(win(WinShell::PowerShell).parse_size("\r\n"), None);
    }
}
