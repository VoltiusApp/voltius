use portable_pty::CommandBuilder;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

// `cd` to the requested directory on the host, falling back to $HOME when it is
// missing there, then exec the shell so it owns the pty.
const CD_THEN_EXEC: &str = r#"[ -n "$1" ] && cd -- "$1" 2>/dev/null || cd; shift; exec "$@""#;

const PROBE_SHELLS: &str =
    r#"getent passwd "$(id -un)" | cut -d: -f7; for p; do [ -x "$p" ] && printf '%s\n' "$p"; done"#;

// A Flatpak without the org.freedesktop.Flatpak talk-name keeps its shells in the sandbox.
pub fn spawns_on_host() -> bool {
    static ON_HOST: OnceLock<bool> = OnceLock::new();
    *ON_HOST.get_or_init(|| {
        Path::new("/.flatpak-info").exists()
            && std::process::Command::new("flatpak-spawn")
                .args(["--host", "true"])
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .is_ok_and(|s| s.success())
    })
}

// The sandbox's /tmp is private; its XDG cache dir is the same path on the host.
pub fn host_visible_temp_dir() -> Option<PathBuf> {
    if !spawns_on_host() {
        return None;
    }
    let dir = PathBuf::from(std::env::var_os("XDG_CACHE_HOME")?);
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

pub fn host_command(
    program: &str,
    args: &[String],
    env: &[(String, String)],
    cwd: Option<&str>,
) -> CommandBuilder {
    let mut cmd = CommandBuilder::new("flatpak-spawn");
    // The host shell must take the pty as its controlling tty; it cannot while flatpak-spawn holds it.
    cmd.set_controlling_tty(false);
    cmd.args(["--host", "--watch-bus", "--directory=/"]);
    for (k, v) in env {
        cmd.arg(format!("--env={k}={v}"));
    }
    cmd.args(["sh", "-c", CD_THEN_EXEC, "sh", cwd.unwrap_or("")]);
    cmd.arg(program);
    cmd.args(args);
    cmd
}

pub struct HostShells {
    pub login: Option<String>,
    pub installed: Vec<String>,
}

pub fn probe_host_shells(candidates: &[&str]) -> HostShells {
    let stdout = std::process::Command::new("flatpak-spawn")
        .args(["--host", "sh", "-c", PROBE_SHELLS, "sh"])
        .args(candidates)
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_default();
    parse_probe(&stdout)
}

fn parse_probe(stdout: &str) -> HostShells {
    let mut lines = stdout.lines();
    let login = lines
        .next()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from);
    HostShells {
        login,
        installed: lines.map(String::from).collect(),
    }
}

pub fn host_login_shell() -> Option<String> {
    static LOGIN: OnceLock<Option<String>> = OnceLock::new();
    LOGIN.get_or_init(|| probe_host_shells(&[]).login).clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(cmd: &CommandBuilder) -> Vec<String> {
        cmd.get_argv()
            .iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn host_command_forwards_env_and_cwd_and_execs_the_shell() {
        let cmd = host_command(
            "/usr/bin/zsh",
            &["-l".into(), "-i".into()],
            &[("TERM".into(), "xterm-256color".into())],
            Some("/home/u/src"),
        );
        assert_eq!(
            argv(&cmd),
            [
                "flatpak-spawn",
                "--host",
                "--watch-bus",
                "--directory=/",
                "--env=TERM=xterm-256color",
                "sh",
                "-c",
                CD_THEN_EXEC,
                "sh",
                "/home/u/src",
                "/usr/bin/zsh",
                "-l",
                "-i",
            ]
        );
    }

    #[cfg(unix)]
    #[test]
    fn cd_then_exec_falls_back_to_home_for_a_missing_directory() {
        let run = |dir: &str| {
            let out = std::process::Command::new("sh")
                .args(["-c", CD_THEN_EXEC, "sh", dir, "pwd"])
                .env("HOME", "/")
                .current_dir("/tmp")
                .output()
                .expect("run sh");
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        };
        assert_eq!(run("/usr"), "/usr");
        assert_eq!(run("/no/such/dir"), "/");
        assert_eq!(run(""), "/");
    }

    #[test]
    fn parse_probe_splits_login_shell_from_installed_ones() {
        let shells = parse_probe("/usr/bin/fish\n/bin/zsh\n/bin/bash\n");
        assert_eq!(shells.login.as_deref(), Some("/usr/bin/fish"));
        assert_eq!(shells.installed, ["/bin/zsh", "/bin/bash"]);
    }

    #[test]
    fn parse_probe_tolerates_a_missing_login_shell() {
        let shells = parse_probe("\n/bin/bash\n");
        assert_eq!(shells.login, None);
        assert_eq!(shells.installed, ["/bin/bash"]);
        assert_eq!(parse_probe("").login, None);
    }
}
