use super::{CliError, Ctx};
use std::io::BufRead;
use std::path::PathBuf;

#[cfg(unix)]
pub fn is_system_account() -> bool {
    unsafe { libc::geteuid() == 0 }
}

#[cfg(windows)]
pub fn is_system_account() -> bool {
    is_system_sid(crate::win_security::current_user_sid())
}

// An unreadable token counts as SYSTEM so a per-user write never lands in the wrong profile.
#[cfg(any(windows, test))]
fn is_system_sid(sid: std::io::Result<String>) -> bool {
    sid.map_or(true, |s| s == "S-1-5-18")
}

#[cfg(not(any(unix, windows)))]
pub fn is_system_account() -> bool {
    false
}

#[cfg(unix)]
pub fn is_elevated() -> bool {
    is_system_account()
}

#[cfg(windows)]
pub fn is_elevated() -> bool {
    crate::win_security::is_elevated()
}

#[cfg(not(any(unix, windows)))]
pub fn is_elevated() -> bool {
    false
}

fn system_account_hint(command: &str) -> String {
    format!(
        "`{command}` changes per-user settings and cannot run as root/SYSTEM; \
         use --defaults or --lock for every user, or run as that user (Ansible become_user)"
    )
}

pub fn require_user_account(command: &str) -> Result<PathBuf, CliError> {
    if is_system_account() {
        return Err(CliError::Usage(system_account_hint(command)));
    }
    Ok(crate::storage::config::config_dir())
}

pub fn confirm(ctx: &mut Ctx, question: &str) -> Result<bool, CliError> {
    if ctx.yes {
        return Ok(true);
    }
    if !ctx.interactive {
        return Err(CliError::Usage(format!(
            "{question} Not a terminal: add --yes to confirm."
        )));
    }
    eprint!("{question} [y/N] ");
    let mut line = String::new();
    std::io::stdin()
        .lock()
        .read_line(&mut line)
        .map_err(CliError::Io)?;
    Ok(matches!(
        line.trim().to_ascii_lowercase().as_str(),
        "y" | "yes"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::output::Output;

    fn ctx(out: &mut Output, yes: bool) -> Ctx<'_> {
        Ctx {
            out,
            yes,
            interactive: false,
        }
    }

    #[test]
    fn confirm_without_tty_needs_yes() {
        let mut out = Output::with_sink(false, true, Box::new(std::io::sink()));
        match confirm(&mut ctx(&mut out, false), "Proceed?") {
            Err(CliError::Usage(m)) => assert!(m.contains("--yes"), "{m}"),
            other => panic!("{other:?}"),
        }
        assert!(confirm(&mut ctx(&mut out, true), "Proceed?").unwrap());
    }

    #[test]
    fn system_check_fails_closed() {
        assert!(is_system_sid(Ok("S-1-5-18".into())));
        assert!(!is_system_sid(Ok("S-1-5-21-1-2-3-1001".into())));
        assert!(is_system_sid(Err(std::io::Error::other("token"))));
    }

    #[cfg(unix)]
    #[test]
    fn require_user_account_message() {
        let m = system_account_hint("config set");
        for needle in ["--defaults", "--lock", "become_user"] {
            assert!(m.contains(needle), "{m}");
        }
    }
}
