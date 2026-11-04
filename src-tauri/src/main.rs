// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<std::ffi::OsString> = std::env::args_os().collect();
    // `voltius mcp` keeps its piped stdio, so only other commands attach a console.
    #[cfg(windows)]
    if voltius_lib::cli::wants_console(&args) {
        voltius_lib::cli::attach_parent_console();
    }
    if let Some(code) = voltius_lib::cli::dispatch(args) {
        return code;
    }
    voltius_lib::run();
    ExitCode::SUCCESS
}
