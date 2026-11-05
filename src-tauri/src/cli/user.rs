use super::{CliError, Ctx};
use std::io::BufRead;
use std::path::PathBuf;

#[cfg(unix)]
pub fn is_system_account() -> bool {
    unsafe { libc::geteuid() == 0 }
}

#[cfg(windows)]
pub fn is_system_account() -> bool {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::Security::{
        GetTokenInformation, IsWellKnownSid, TokenUser, WinLocalSystemSid, TOKEN_QUERY, TOKEN_USER,
    };
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    unsafe {
        let mut token = std::ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return false;
        }
        let mut needed = 0u32;
        GetTokenInformation(token, TokenUser, std::ptr::null_mut(), 0, &mut needed);
        let mut buf = vec![0u64; (needed as usize).div_ceil(8).max(1)];
        let ok = GetTokenInformation(
            token,
            TokenUser,
            buf.as_mut_ptr().cast(),
            needed,
            &mut needed,
        ) != 0
            && IsWellKnownSid(
                (*buf.as_ptr().cast::<TOKEN_USER>()).User.Sid,
                WinLocalSystemSid,
            ) != 0;
        CloseHandle(token);
        ok
    }
}

#[cfg(not(any(unix, windows)))]
pub fn is_system_account() -> bool {
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

    #[cfg(unix)]
    #[test]
    fn require_user_account_message() {
        let m = system_account_hint("config set");
        for needle in ["--defaults", "--lock", "become_user"] {
            assert!(m.contains(needle), "{m}");
        }
    }
}
