// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::ExitCode;

fn main() -> ExitCode {
    if let Some(code) = voltius_lib::cli::dispatch(std::env::args_os().collect()) {
        return code;
    }
    voltius_lib::run();
    ExitCode::SUCCESS
}
