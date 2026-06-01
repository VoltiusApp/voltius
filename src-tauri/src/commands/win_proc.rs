//! Shared helper to suppress the transient console window that flashes on
//! Windows whenever a child process is spawned without one (e.g., `tar`).

#[cfg(target_os = "windows")]
const WINDOWS_CREATE_NO_WINDOW: u32 = 0x08000000;

/// Configure a tokio Command so it does not flash a console window on Windows.
/// No-op on other platforms.
#[cfg(target_os = "windows")]
pub fn prevent_visible_child_window(command: &mut tokio::process::Command) {
    command.creation_flags(WINDOWS_CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
pub fn prevent_visible_child_window(_command: &mut tokio::process::Command) {}
