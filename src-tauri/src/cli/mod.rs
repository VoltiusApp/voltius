mod config_cmd;
mod enroll_cmd;
mod login_cmd;
mod logout_cmd;
mod output;
mod path_cmd;
mod plugins_cmd;
mod policy_cmd;
mod prompt;
mod server_cmd;
pub(crate) mod session;
#[cfg(test)]
mod testing;
pub mod user;
mod whoami_cmd;

use crate::cli_state::pending::{self, Change};
use crate::policy::{self, Issue};
use clap::{CommandFactory, Parser, Subcommand};
use config_cmd::ConfigCmd;
use enroll_cmd::EnrollArgs;
use login_cmd::LoginArgs;
use output::Output;
use path_cmd::PathCmd;
use plugins_cmd::PluginsCmd;
use policy_cmd::PolicyCmd;
use server_cmd::ServerCmd;
use std::ffi::OsString;
use std::fmt;
use std::io::IsTerminal;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

pub const CLI_MARKER: &str = "__voltius_cli";

const BIN_NAME: &str = "voltius-cli";

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Access {
    Read,
    Write,
}

#[derive(Debug)]
pub enum CliError {
    NotSignedIn,
    Usage(String),
    Refused(String),
    Validation(Vec<Issue>),
    Permission(Access, PathBuf),
    Denied(String),
    Io(std::io::Error),
}

impl CliError {
    pub fn io(message: impl Into<String>) -> Self {
        CliError::Io(std::io::Error::other(message.into()))
    }

    pub fn exit_code(&self) -> u8 {
        match self {
            CliError::NotSignedIn => 1,
            CliError::Usage(_) => 2,
            CliError::Validation(_) | CliError::Refused(_) => 3,
            CliError::Permission(..) | CliError::Denied(_) => 4,
            CliError::Io(_) => 5,
        }
    }

    fn report(&self) {
        for line in self.to_string().lines() {
            eprintln!("error: {line}");
        }
    }
}

impl fmt::Display for CliError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CliError::NotSignedIn => f.write_str("Not signed in"),
            CliError::Usage(m) | CliError::Refused(m) | CliError::Denied(m) => f.write_str(m),
            CliError::Validation(issues) => {
                let lines: Vec<String> = issues.iter().map(policy_cmd::describe).collect();
                f.write_str(&lines.join("\n"))
            }
            CliError::Permission(access, p) => {
                let verb = match access {
                    Access::Read => "Reading",
                    Access::Write => "Writing",
                };
                write!(
                    f,
                    "{verb} {} needs root (sudo) / Administrator.",
                    p.display()
                )
            }
            CliError::Io(e) => write!(f, "{e}"),
        }
    }
}

pub struct Ctx<'a> {
    pub out: &'a mut Output,
    pub yes: bool,
    pub interactive: bool,
}

/// Runs one network call to completion on a throwaway runtime; `Err` is a runtime or timeout failure.
fn block_on_timeout<F: std::future::Future>(
    timeout: std::time::Duration,
    work: F,
) -> Result<F::Output, String> {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| e.to_string())?
        .block_on(async {
            tokio::time::timeout(timeout, work)
                .await
                .map_err(|_| "timed out".to_string())
        })
}

fn queue(dir: &Path, change: Change, out: &mut Output) -> Result<(), CliError> {
    let what = match &change {
        Change::Setting { key, value } => format!("set {key} = {value}"),
        Change::Server { url } => format!("server {url}"),
        Change::Plugin { action, id, .. } => format!("{} {id}", action.name()),
    };
    pending::append(dir, change).map_err(CliError::Io)?;
    out.line(format!(
        "Queued: {what}. Applies when Voltius next opens or regains focus."
    ));
    Ok(())
}

#[derive(Parser, Debug)]
#[command(name = "voltius-cli", version, about = "Voltius command line")]
struct Cli {
    /// Print machine-readable JSON
    #[arg(long, global = true)]
    json: bool,
    /// Print only errors
    #[arg(long, short, global = true)]
    quiet: bool,
    /// Disable colours
    #[arg(long, global = true)]
    no_color: bool,
    /// Never prompt; assume yes where a confirmation is needed
    #[arg(long, short = 'y', global = true)]
    yes: bool,
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
    /// Read and queue per-user settings
    Config {
        #[command(subcommand)]
        cmd: ConfigCmd,
    },
    /// Show who is signed in
    Whoami,
    /// Sign this user in to their Voltius account
    Login(LoginArgs),
    /// Sign this user out and remove their Voltius data from this device
    Logout,
    /// Show or set the sync server URL
    Server {
        #[command(subcommand)]
        cmd: ServerCmd,
    },
    /// Enrol this machine with a company token
    Enroll(EnrollArgs),
    /// List, install, enable, disable or remove plugins
    Plugins {
        #[command(subcommand)]
        cmd: PluginsCmd,
    },
    /// Print a shell completion script
    Completions { shell: clap_complete::Shell },
    #[command(name = "__path", hide = true)]
    Path {
        #[command(subcommand)]
        cmd: PathCmd,
    },
}

#[cfg(target_os = "linux")]
const BARE_SUBCOMMANDS: [&str; 9] = [
    "policy",
    "whoami",
    "login",
    "logout",
    "config",
    "plugins",
    "server",
    "enroll",
    "completions",
];
#[cfg(not(target_os = "linux"))]
const BARE_SUBCOMMANDS: [&str; 0] = [];

fn cli_args(args: &[OsString]) -> Option<Vec<OsString>> {
    let rest = match args.get(1)?.to_str()? {
        CLI_MARKER => &args[2..],
        "mcp" => &args[1..],
        name if BARE_SUBCOMMANDS.contains(&name) => &args[1..],
        _ => return None,
    };
    Some(
        std::iter::once(OsString::from(BIN_NAME))
            .chain(rest.iter().cloned())
            .collect(),
    )
}

pub fn dispatch(args: Vec<OsString>) -> Option<ExitCode> {
    let cli = match Cli::try_parse_from(cli_args(&args)?) {
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
    let mut ctx = Ctx {
        out: &mut out,
        yes: cli.yes,
        interactive: std::io::stdin().is_terminal() && std::io::stdout().is_terminal(),
    };
    match cli.command {
        Command::Mcp => {
            if let Err(e) = crate::mcp::shim::run_shim() {
                eprintln!("{BIN_NAME} mcp: {e}");
                std::process::exit(1);
            }
            Ok(())
        }
        Command::Completions { shell } => {
            let mut cmd = Cli::command();
            clap_complete::generate(shell, &mut cmd, BIN_NAME, &mut std::io::stdout());
            Ok(())
        }
        Command::Path { cmd } => path_cmd::run(cmd, &mut ctx),
        Command::Config { cmd } => config_cmd::run(cmd, &mut ctx),
        Command::Server { cmd } => server_cmd::run(cmd, &mut ctx),
        Command::Whoami => whoami_cmd::run(&mut ctx),
        Command::Login(args) => login_cmd::run(args, &mut ctx),
        Command::Logout => logout_cmd::run(&mut ctx),
        Command::Enroll(args) => enroll_cmd::run(args, &mut ctx),
        Command::Plugins { cmd } => plugins_cmd::run(cmd, &mut ctx),
        Command::Policy { cmd } => {
            policy_cmd::run(cmd, policy::machine_policy_path().as_deref(), ctx.out)
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
        #[cfg(not(target_os = "linux"))]
        assert!(dispatch(argv(&["voltius", "policy", "show"])).is_none());
        assert!(dispatch(argv(&["voltius", "--json"])).is_none());
    }

    #[test]
    fn marker_and_mcp_are_cli() {
        assert_eq!(
            dispatch(argv(&["voltius", CLI_MARKER, "-q", "policy", "path"])),
            Some(ExitCode::SUCCESS)
        );
        assert!(cli_args(&argv(&["voltius", "mcp"])).is_some());
        assert!(cli_args(&argv(&["voltius", CLI_MARKER, "--json"])).is_some());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn subcommand_names_are_cli_on_linux() {
        assert!(cli_args(&argv(&["voltius", "policy", "show"])).is_some());
        assert!(cli_args(&argv(&["voltius", "voltius://x"])).is_none());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn bare_enroll_is_a_cli_subcommand_on_linux() {
        assert!(cli_args(&argv(&["voltius", "enroll", "--show"])).is_some());
    }

    #[test]
    fn yes_flag_parses() {
        assert!(Cli::try_parse_from(["voltius-cli", "--yes", "policy", "path"]).is_ok());
        let help = Cli::command().render_help().to_string();
        assert!(help.contains("Never prompt"), "{help}");
    }

    #[test]
    fn parses_as_voltius_cli() {
        let err = Cli::try_parse_from(["voltius-cli", "--help"]).unwrap_err();
        assert!(err.to_string().contains("voltius-cli"));
        assert!(Cli::try_parse_from(["voltius-cli", "mcp"]).is_ok());
    }

    #[test]
    fn global_flags_have_help() {
        let help = Cli::command().render_help().to_string();
        for line in [
            "Print machine-readable JSON",
            "Print only errors",
            "Disable colours",
        ] {
            assert!(help.contains(line), "missing {line:?} in:\n{help}");
        }
    }

    #[test]
    fn completions_include_range_flags() {
        let mut buf = Vec::new();
        clap_complete::generate(
            clap_complete::Shell::Bash,
            &mut Cli::command(),
            BIN_NAME,
            &mut buf,
        );
        let text = String::from_utf8(buf).unwrap();
        for flag in ["--allow", "--min", "--max"] {
            assert!(text.contains(flag), "missing {flag}");
        }
    }
}
