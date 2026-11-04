mod output;
mod policy_cmd;

use crate::policy::{self, Issue};
use clap::{CommandFactory, Parser, Subcommand};
use output::Output;
use policy_cmd::PolicyCmd;
use std::ffi::OsString;
use std::path::PathBuf;
use std::process::ExitCode;

pub const CLI_SUBCOMMANDS: &[&str] = &[
    "mcp",
    "policy",
    "completions",
    "help",
    "--help",
    "-h",
    "--version",
    "-V",
];

#[derive(Debug)]
pub enum CliError {
    Usage(String),
    Validation(Vec<Issue>),
    Permission(PathBuf),
    Io(std::io::Error),
}

impl CliError {
    pub fn exit_code(&self) -> u8 {
        match self {
            CliError::Usage(_) => 2,
            CliError::Validation(_) => 3,
            CliError::Permission(_) => 4,
            CliError::Io(_) => 5,
        }
    }

    fn report(&self) {
        match self {
            CliError::Usage(m) => eprintln!("error: {m}"),
            CliError::Validation(issues) => {
                for i in issues {
                    eprintln!("error: {}", policy_cmd::describe(i));
                }
            }
            CliError::Permission(p) => {
                eprintln!(
                    "error: Writing {} needs root (sudo) / Administrator.",
                    p.display()
                );
            }
            CliError::Io(e) => eprintln!("error: {e}"),
        }
    }
}

#[derive(Parser, Debug)]
#[command(name = "voltius", version, about = "Voltius command line")]
struct Cli {
    #[arg(long, global = true)]
    json: bool,
    #[arg(long, short, global = true)]
    quiet: bool,
    #[arg(long, global = true)]
    no_color: bool,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand, Debug)]
enum Command {
    /// Relay MCP over stdio to the running app
    Mcp,
    /// Manage the machine policy file
    Policy {
        #[command(subcommand)]
        cmd: PolicyCmd,
    },
    /// Print a shell completion script
    Completions { shell: clap_complete::Shell },
}

const GLOBAL_FLAGS: &[&str] = &["--json", "--quiet", "-q", "--no-color"];

fn command_word(args: &[OsString]) -> Option<&str> {
    args.iter()
        .skip(1)
        .filter_map(|a| a.to_str())
        .find(|a| !GLOBAL_FLAGS.contains(a))
}

pub fn is_cli_invocation(args: &[OsString]) -> bool {
    command_word(args).is_some_and(|a| CLI_SUBCOMMANDS.contains(&a))
}

pub fn wants_console(args: &[OsString]) -> bool {
    is_cli_invocation(args) && command_word(args) != Some("mcp")
}

pub fn dispatch(args: Vec<OsString>) -> Option<ExitCode> {
    if !is_cli_invocation(&args) {
        return None;
    }
    let cli = match Cli::try_parse_from(&args) {
        Ok(c) => c,
        Err(e) => {
            let code = e.exit_code();
            let _ = e.print();
            return Some(ExitCode::from(u8::try_from(code).unwrap_or(2)));
        }
    };
    if cli.no_color {
        anstream::ColorChoice::Never.write_global();
    }
    Some(match run(cli) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            e.report();
            ExitCode::from(e.exit_code())
        }
    })
}

fn run(cli: Cli) -> Result<(), CliError> {
    let mut out = Output::stdout(cli.json, cli.quiet);
    match cli.command {
        Command::Mcp => {
            if let Err(e) = crate::mcp::shim::run_shim() {
                eprintln!("voltius mcp: {e}");
                std::process::exit(1);
            }
            Ok(())
        }
        Command::Completions { shell } => {
            let mut cmd = Cli::command();
            clap_complete::generate(shell, &mut cmd, "voltius", &mut std::io::stdout());
            Ok(())
        }
        Command::Policy { cmd } => {
            let path = policy::machine_policy_path().ok_or_else(|| {
                CliError::Usage("policy commands are not available on this platform".into())
            })?;
            policy_cmd::run(cmd, &path, &mut out)
        }
    }
}

#[cfg(windows)]
pub fn attach_parent_console() {
    use windows_sys::Win32::Foundation::{GENERIC_READ, GENERIC_WRITE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
    };
    use windows_sys::Win32::System::Console::{
        AttachConsole, GetStdHandle, SetStdHandle, ATTACH_PARENT_PROCESS, STD_ERROR_HANDLE,
        STD_OUTPUT_HANDLE,
    };
    let conout: Vec<u16> = "CONOUT$\0".encode_utf16().collect();
    // SAFETY: plain Win32 calls with valid arguments; handles are only replaced when unset.
    unsafe {
        if AttachConsole(ATTACH_PARENT_PROCESS) == 0 {
            return;
        }
        for which in [STD_OUTPUT_HANDLE, STD_ERROR_HANDLE] {
            let h = GetStdHandle(which);
            if h.is_null() || h == INVALID_HANDLE_VALUE {
                let con = CreateFileW(
                    conout.as_ptr(),
                    GENERIC_READ | GENERIC_WRITE,
                    FILE_SHARE_READ | FILE_SHARE_WRITE,
                    std::ptr::null(),
                    OPEN_EXISTING,
                    0,
                    std::ptr::null_mut(),
                );
                if con != INVALID_HANDLE_VALUE {
                    SetStdHandle(which, con);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(a: &[&str]) -> Vec<OsString> {
        a.iter().map(OsString::from).collect()
    }

    #[test]
    fn non_cli_argv_runs_app() {
        assert!(dispatch(argv(&["voltius"])).is_none());
        assert!(dispatch(argv(&["voltius", "voltius://open?x"])).is_none());
        assert!(dispatch(argv(&["voltius", "--some-gfx-flag"])).is_none());
        assert!(dispatch(argv(&["voltius", "--json"])).is_none());
    }

    #[test]
    fn global_flags_before_command_are_cli() {
        assert!(is_cli_invocation(&argv(&[
            "voltius", "--json", "policy", "show"
        ])));
        assert!(wants_console(&argv(&["voltius", "-q", "policy", "show"])));
        assert!(!wants_console(&argv(&["voltius", "mcp"])));
    }
}
