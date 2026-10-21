//! Native terminal soft-keyboard control (Android). Drives the `TerminalKeyboard` overlay that
//! owns the IME for the xterm.js terminal — see `TerminalKeyboard.kt` and issue #34. No-op on
//! desktop, where the OS keyboard already works.

/// Calls a static `(Z)V` method on `TerminalKeyboard`; warns instead of failing the command.
fn call_bool(method: &str, value: bool) {
    #[cfg(target_os = "android")]
    crate::android_ctx::call_static_bool("com.voltius.app.TerminalKeyboard", method, value);
    #[cfg(not(target_os = "android"))]
    let _ = (method, value);
}

#[tauri::command]
pub fn terminal_show_keyboard(volume_ctrl: bool) {
    call_bool("show", volume_ctrl);
}

#[tauri::command]
pub fn terminal_hide_keyboard(focus_web_view: Option<bool>) {
    call_bool("hide", focus_web_view.unwrap_or(false));
}

#[tauri::command]
pub fn terminal_selection_touch_feed(on: bool) {
    call_bool("setSelectionTouchFeed", on);
}
