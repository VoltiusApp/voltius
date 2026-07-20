//! Native terminal soft-keyboard control (Android). Drives the `TerminalKeyboard` overlay that
//! owns the IME for the xterm.js terminal — see `TerminalKeyboard.kt` and issue #34. No-op on
//! desktop, where the OS keyboard already works.

#[cfg(target_os = "android")]
fn call(op: &str, method: &str) -> Result<(), String> {
    use crate::android_ctx::{load_class, with_env};
    with_env(op, |env, _ctx| {
        // Resolve via the app class loader: Tauri commands run on tokio workers whose default
        // FindClass only sees the system loader (see android_ctx::load_class).
        let cls = load_class(env, "com.voltius.app.TerminalKeyboard")?;
        env.call_static_method(&cls, method, "()V", &[])?.v()
    })
}

#[tauri::command]
pub fn terminal_show_keyboard() {
    #[cfg(target_os = "android")]
    if let Err(e) = call("terminal show keyboard", "show") {
        log::warn!("terminal_show_keyboard: {e}");
    }
}

#[tauri::command]
pub fn terminal_hide_keyboard() {
    #[cfg(target_os = "android")]
    if let Err(e) = call("terminal hide keyboard", "hide") {
        log::warn!("terminal_hide_keyboard: {e}");
    }
}
