use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

const CLI_MARKER: &str = "__voltius_cli";

fn sibling_app(launcher: &Path) -> PathBuf {
    let name = if cfg!(windows) {
        "voltius.exe"
    } else {
        "voltius"
    };
    launcher.with_file_name(name)
}

fn run(app: &Path, args: &[OsString]) -> i32 {
    match Command::new(app).arg(CLI_MARKER).args(args).status() {
        Ok(status) => status.code().unwrap_or(1),
        Err(e) => {
            eprintln!("error: cannot run {}: {e}", app.display());
            5
        }
    }
}

fn main() -> ExitCode {
    let launcher = match std::env::current_exe().and_then(|p| p.canonicalize()) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("error: cannot locate voltius-cli: {e}");
            return ExitCode::from(5);
        }
    };
    let args: Vec<OsString> = std::env::args_os().skip(1).collect();
    let code = run(&sibling_app(&launcher), &args);
    ExitCode::from(u8::try_from(code).unwrap_or(1))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sibling_is_next_to_launcher() {
        let app = sibling_app(Path::new("/opt/voltius/voltius-cli"));
        let name = if cfg!(windows) {
            "voltius.exe"
        } else {
            "voltius"
        };
        assert_eq!(app, Path::new("/opt/voltius").join(name));
    }

    #[cfg(unix)]
    #[test]
    fn forwards_exit_code_and_marker() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("voltius-cli-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let app = dir.join("voltius");
        std::fs::write(
            &app,
            "#!/bin/sh\n[ \"$1\" = __voltius_cli ] && [ \"$2\" = x ] && exit 7\nexit 1\n",
        )
        .unwrap();
        std::fs::set_permissions(&app, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(run(&app, &[OsString::from("x")]), 7);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn missing_app_is_exit_5() {
        assert_eq!(run(Path::new("/nonexistent/voltius"), &[]), 5);
    }
}
