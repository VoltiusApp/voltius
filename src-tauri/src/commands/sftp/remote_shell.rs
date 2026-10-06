use super::shell_quote;
use crate::ssh::exec::{run_captured, run_captured_with_stdin, Captured};
use russh::client::{Handle, Handler};
use std::future::Future;
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WinShell {
    Cmd,
    PowerShell,
}

/// The shell a host runs exec'd commands through, and so the dialect tar commands are written in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RemoteShell {
    Posix,
    Windows { shell: WinShell },
}

const PROBE_TIMEOUT: Duration = Duration::from_secs(120);
const EXIT_MARKER: &str = "__TF_EXIT__:";
const POSIX_PROBE: &str = "command -v tar >/dev/null 2>&1; echo __TF_EXIT__:$?";
const STREAM_PROBE_BYTES: &[u8] = b"voltius\n\r\n\x1a\x00\xff probe\n";
const TEMP_MARKER: &str = "__TF_TEMP__:";
// Each prints the marker only under its own shell; the other shells echo it literally or fail.
const CMD_TEMP_PROBE: &str = "echo __TF_TEMP__:%TEMP%";
const PS_TEMP_PROBE: &str = "'__TF_TEMP__:' + $env:TEMP";
const CMD_MAX_LEN: usize = 8191;
// PowerShell ends a single-quoted string at any of these, not just at ASCII `'`.
const PS_QUOTES: [char; 5] = ['\'', '\u{2018}', '\u{2019}', '\u{201A}', '\u{201B}'];

/// `argv`, a host command line, run where `inside` puts it: behind a prefix such as
/// `docker exec -i <id>` or `pct exec <vmid> --`, or on the host itself.
pub fn run_in(inside: Option<&str>, argv: &str) -> String {
    match inside {
        Some(prefix) => format!("{prefix} {argv}"),
        None => argv.to_string(),
    }
}

/// `cmd`, written in the session's dialect, run where `inside` puts it; a container runs it through its `sh`.
pub fn wrap(inside: Option<&str>, cmd: &str) -> String {
    match inside {
        Some(_) => run_in(inside, &format!("sh -c {}", shell_quote(cmd))),
        None => cmd.to_string(),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Unreachable;

pub(crate) async fn answer(
    run: impl Future<Output = Result<Captured, String>>,
) -> Result<Captured, Unreachable> {
    match tokio::time::timeout(PROBE_TIMEOUT, run).await {
        Ok(Ok(out)) => Ok(out),
        _ => Err(Unreachable),
    }
}

async fn output<H: Handler>(handle: &Handle<H>, cmd: &str) -> Result<String, Unreachable> {
    Ok(answer(run_captured(handle, cmd)).await?.stdout_text())
}

async fn reports_success<H: Handler>(handle: &Handle<H>, cmd: &str) -> Result<bool, Unreachable> {
    Ok(output(handle, cmd)
        .await?
        .contains(&format!("{EXIT_MARKER}0")))
}

/// `Some(has_tar)` when a POSIX shell ran `POSIX_PROBE`: cmd.exe echoes `$?` as is, PowerShell as `True`/`False`.
fn posix_has_tar(out: &str) -> Option<bool> {
    let code = out
        .lines()
        .find_map(|l| l.trim().strip_prefix(EXIT_MARKER))?;
    Some(code.parse::<u8>().ok()? == 0)
}

/// The shell commands run through where `inside` points, and whether tar is there:
/// the dialect is known (for hashes, sizes) even where tar is not.
async fn dialect<H: Handler>(
    handle: &Handle<H>,
    inside: Option<&str>,
) -> Result<Option<(RemoteShell, bool)>, Unreachable> {
    if let Some(has_tar) = posix_has_tar(&output(handle, &wrap(inside, POSIX_PROBE)).await?) {
        return Ok(Some((RemoteShell::Posix, has_tar)));
    }
    if inside.is_some() {
        return Ok(None);
    }
    for (shell, probe) in [
        (WinShell::Cmd, CMD_TEMP_PROBE),
        (WinShell::PowerShell, PS_TEMP_PROBE),
    ] {
        if is_expanded_temp(&output(handle, probe).await?) {
            let found = RemoteShell::Windows { shell };
            let has_tar = reports_success(handle, &found.status("tar --version")).await?;
            return Ok(Some((found, has_tar)));
        }
    }
    Ok(None)
}

async fn streams<H: Handler>(
    handle: &Handle<H>,
    shell: &RemoteShell,
    inside: Option<&str>,
) -> Result<bool, Unreachable> {
    let Ok(archive) = super::local_tar::pack_bytes("probe.bin", STREAM_PROBE_BYTES) else {
        return Ok(false);
    };
    let cmd = wrap(inside, &shell.stream_probe());
    let out = answer(run_captured_with_stdin(
        handle,
        &cmd,
        Some(archive.as_slice()),
    ))
    .await?;
    Ok(out.code == Some(0) && out.stdout == STREAM_PROBE_BYTES)
}

/// The dialect, and whether tar streams binary-clean through it (never, without tar).
pub async fn detect<H: Handler>(
    handle: &Handle<H>,
    inside: Option<&str>,
) -> Result<Option<(RemoteShell, bool)>, Unreachable> {
    let Some((shell, has_tar)) = dialect(handle, inside).await? else {
        return Ok(None);
    };
    let streams = has_tar && streams(handle, &shell, inside).await?;
    Ok(Some((shell, streams)))
}

fn is_expanded_temp(out: &str) -> bool {
    let Some(temp) = out.lines().find_map(|l| l.trim().strip_prefix(TEMP_MARKER)) else {
        return false;
    };
    let b = temp.trim().as_bytes();
    b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && b[2] == b'\\'
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

impl RemoteShell {
    pub fn is_windows(&self) -> bool {
        matches!(self, Self::Windows { .. })
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
            } => {
                let quoted: String = s
                    .chars()
                    .flat_map(|c| {
                        let n = if PS_QUOTES.contains(&c) { 2 } else { 1 };
                        std::iter::repeat_n(c, n)
                    })
                    .collect();
                format!("'{quoted}'")
            }
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

    /// Run `cmd` with its output merged and report its exit code in the
    /// `__TF_EXIT__` marker `exec_command` looks for.
    pub fn status(&self, cmd: &str) -> String {
        match self {
            Self::Posix => format!("{cmd} 2>&1; echo __TF_EXIT__:$?"),
            // cmd.exe expands %errorlevel% before the line runs, so branch on success instead.
            Self::Windows {
                shell: WinShell::Cmd,
            } => format!("{cmd} 2>&1 && echo __TF_EXIT__:0 || echo __TF_EXIT__:1"),
            Self::Windows {
                shell: WinShell::PowerShell,
            } => format!("{cmd} 2>&1; $rc = $LASTEXITCODE; '__TF_EXIT__:' + $rc"),
        }
    }

    fn quote_all(&self, items: &[String]) -> String {
        items
            .iter()
            .map(|i| self.quote(i))
            .collect::<Vec<_>>()
            .join(" ")
    }

    fn tar_c(&self, archive: Option<&str>, parent: &str, items: &[String], deref: bool) -> String {
        format!(
            "tar -czf {arch} {deref}-C {parent} -- {items}",
            arch = archive.map_or_else(|| "-".to_string(), |a| self.quote_path(a)),
            deref = if deref { self.deref_flags() } else { "" },
            parent = self.quote_path(parent),
            items = self.quote_all(items),
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
        self.checked(self.status(&self.tar_c(Some(archive), parent, items, false)))
    }

    pub fn extract(&self, archive: &str, dest: &str) -> String {
        self.status(&self.tar_x(Some(archive), dest, false))
    }

    pub fn create_to_stdout(
        &self,
        parent: &str,
        items: &[String],
        deref: bool,
    ) -> Result<String, String> {
        self.checked(self.exits(&self.tar_c(None, parent, items, deref)))
    }

    pub fn extract_from_stdin(&self, dest: &str, strip: bool) -> String {
        self.exits(&self.tar_x(None, dest, strip))
    }

    pub fn stream_probe(&self) -> String {
        self.exits("tar -xzf - -O")
    }

    pub fn size_probe(&self, parent: &str, items: &[String]) -> Option<String> {
        match self {
            Self::Posix => Some(format!(
                "cd {} && du -sk -- {}",
                self.quote_path(parent),
                self.quote_all(items)
            )),
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

    pub fn sha256(&self, sftp_path: &str) -> String {
        let p = self.quote_path(sftp_path);
        match self {
            Self::Posix => format!("sha256sum -- {p} 2>/dev/null || shasum -a 256 -- {p}"),
            Self::Windows {
                shell: WinShell::PowerShell,
            } => format!("(Get-FileHash -Algorithm SHA256 -LiteralPath {p}).Hash"),
            Self::Windows {
                shell: WinShell::Cmd,
            } => format!("certutil -hashfile {p} SHA256"),
        }
    }

    pub fn large_file_probe(
        &self,
        parent: &str,
        items: &[String],
        min_bytes: u64,
    ) -> Option<String> {
        match self {
            Self::Posix => {
                let items: Vec<String> = items
                    .iter()
                    .map(|i| self.quote(&format!("./{i}")))
                    .collect();
                Some(format!(
                    "cd {} && find {} -type f -size +{}c | head -n 1",
                    self.quote_path(parent),
                    items.join(" "),
                    min_bytes.saturating_sub(1)
                ))
            }
            Self::Windows {
                shell: WinShell::PowerShell,
            } => {
                let base = parent.trim_end_matches('/');
                let paths: Vec<String> = items
                    .iter()
                    .map(|i| self.quote_path(&format!("{base}/{i}")))
                    .collect();
                Some(format!(
                    "Get-ChildItem -LiteralPath {} -Recurse -File -Force | Where-Object {{ $_.Length -ge {min_bytes} }} | Select-Object -First 1 -ExpandProperty FullName",
                    paths.join(",")
                ))
            }
            Self::Windows {
                shell: WinShell::Cmd,
            } => None,
        }
    }

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
    use crate::ssh::exec::docker_exec;

    #[test]
    fn container_commands_run_inside_sh() {
        assert_eq!(wrap(None, "tar -xzf - -O"), "tar -xzf - -O");
        assert_eq!(
            wrap(Some(&docker_exec("ab c")), "tar -xzf - -O"),
            "docker exec -i 'ab c' sh -c 'tar -xzf - -O'"
        );
        assert_eq!(
            wrap(Some("pct exec 7 --"), "tar -xzf - -O"),
            "pct exec 7 -- sh -c 'tar -xzf - -O'"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_shell_without_tar_still_reports_its_dialect() {
        use crate::ssh::test_proc_server::{no_tar, proc_server, ProcOptions};
        let (handle, _) = proc_server(ProcOptions::default()).await;
        let (_bin, inside) = no_tar();
        assert_eq!(
            detect(&handle, Some(&inside)).await,
            Ok(Some((RemoteShell::Posix, false)))
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_binary_clean_posix_host_streams() {
        use crate::ssh::test_proc_server::{proc_server, ProcOptions};
        let (handle, _) = proc_server(ProcOptions::default()).await;
        assert_eq!(
            detect(&handle, None).await,
            Ok(Some((RemoteShell::Posix, true)))
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_host_that_mangles_newlines_keeps_its_dialect_but_never_streams() {
        use crate::ssh::test_proc_server::{proc_server, ProcOptions};
        let (handle, _) = proc_server(ProcOptions {
            crlf: true,
            ..Default::default()
        })
        .await;
        assert_eq!(
            detect(&handle, None).await,
            Ok(Some((RemoteShell::Posix, false)))
        );
    }

    fn win(shell: WinShell) -> RemoteShell {
        RemoteShell::Windows { shell }
    }

    #[test]
    fn only_a_posix_shell_answers_the_tar_probe_with_a_number() {
        assert_eq!(posix_has_tar("__TF_EXIT__:0\n"), Some(true));
        assert_eq!(posix_has_tar("__TF_EXIT__:1\n"), Some(false));
        assert_eq!(posix_has_tar("__TF_EXIT__:$?\r\n"), None);
        assert_eq!(posix_has_tar("__TF_EXIT__:False\r\n"), None);
        assert_eq!(posix_has_tar(""), None);
    }

    #[test]
    fn temp_probe_accepts_only_an_expanded_windows_path() {
        assert!(is_expanded_temp("__TF_TEMP__:C:\\Users\\me\\Temp\r\n"));
        assert!(!is_expanded_temp("__TF_TEMP__:%TEMP%\n"));
        assert!(!is_expanded_temp("__TF_TEMP__::TEMP\n"));
        assert!(!is_expanded_temp("sh: 1: __TF_TEMP__:: not found\n"));
    }

    #[test]
    fn sftp_paths_map_to_native_windows_paths() {
        assert_eq!(to_native("/C:/Users/me/a b"), r"C:\Users\me\a b");
        assert_eq!(to_native("/C:/Users/me/"), r"C:\Users\me");
        assert_eq!(to_native("/C:"), r"C:\.");
        assert_eq!(to_native("/D:/"), r"D:\.");
    }

    #[test]
    fn powershell_quoting_doubles_every_quote_it_reads_as_one() {
        assert_eq!(
            win(WinShell::PowerShell).quote("a’b‘c‚d‛e'f"),
            "'a’’b‘‘c‚‚d‛‛e''f'"
        );
    }

    #[test]
    fn sha256_commands_per_dialect() {
        assert_eq!(
            RemoteShell::Posix.sha256("/v/it's.mp4"),
            r"sha256sum -- '/v/it'\''s.mp4' 2>/dev/null || shasum -a 256 -- '/v/it'\''s.mp4'"
        );
        assert_eq!(
            win(WinShell::PowerShell).sha256("/C:/v/a.mp4"),
            r"(Get-FileHash -Algorithm SHA256 -LiteralPath 'C:\v\a.mp4').Hash"
        );
        assert_eq!(
            win(WinShell::Cmd).sha256("/C:/v/a.mp4"),
            r#"certutil -hashfile "C:\v\a.mp4" SHA256"#
        );
    }

    #[test]
    fn large_file_probes_per_dialect() {
        let items = vec!["-x".to_string(), "b c".to_string()];
        assert_eq!(
            RemoteShell::Posix
                .large_file_probe("/srv", &items, 1024)
                .as_deref(),
            Some("cd '/srv' && find './-x' './b c' -type f -size +1023c | head -n 1")
        );
        assert!(win(WinShell::PowerShell)
            .large_file_probe("/C:/srv", &items, 1024)
            .unwrap()
            .contains("Where-Object { $_.Length -ge 1024 }"));
        assert_eq!(
            win(WinShell::Cmd).large_file_probe("/C:/srv", &items, 1024),
            None
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
            win(WinShell::Cmd).status("tar x"),
            "tar x 2>&1 && echo __TF_EXIT__:0 || echo __TF_EXIT__:1"
        );
    }

    #[test]
    fn powershell_status_reports_the_exit_code() {
        assert_eq!(
            win(WinShell::PowerShell).status("tar x"),
            "tar x 2>&1; $rc = $LASTEXITCODE; '__TF_EXIT__:' + $rc"
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
