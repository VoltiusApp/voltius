mod output;
mod policy_cmd;

use crate::policy::{self, Issue};
use clap::{CommandFactory, Parser, Subcommand};
use output::Output;
use policy_cmd::PolicyCmd;
use std::ffi::OsString;
use std::fmt;
use std::path::PathBuf;
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
    Usage(String),
    Validation(Vec<Issue>),
    Permission(Access, PathBuf),
    Io(std::io::Error),
}

impl CliError {
    pub fn exit_code(&self) -> u8 {
        match self {
            CliError::Usage(_) => 2,
            CliError::Validation(_) => 3,
            CliError::Permission(..) => 4,
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
            CliError::Usage(m) => f.write_str(m),
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

fn cli_args(args: &[OsString]) -> Option<Vec<OsString>> {
    let rest = match args.get(1)?.to_str()? {
        CLI_MARKER => &args[2..],
        "mcp" => &args[1..],
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
        Command::Policy { cmd } => {
            policy_cmd::run(cmd, policy::machine_policy_path().as_deref(), &mut out)
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
}
