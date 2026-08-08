// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `voltius mcp` is a relay to an already-running app, not a second app
    // instance — it must not reach the Tauri builder.
    if std::env::args().nth(1).as_deref() == Some("mcp") {
        if let Err(e) = voltius_lib::mcp::shim::run_shim() {
            eprintln!("voltius mcp: {e}");
            std::process::exit(1);
        }
        return;
    }
    voltius_lib::run()
}
