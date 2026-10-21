//! Android status/navigation bar icon contrast. The web side decides light vs dark from the
//! active Voltius theme background (`src/services/androidSystemBars.ts`) and pushes it here;
//! `SystemBars.kt` applies it through `WindowInsetsControllerCompat`. No-op on desktop.

/// `light_background`: the theme behind the bars is light, so the bar icons must be dark.
#[tauri::command]
pub fn set_system_bars(light_background: bool) {
    #[cfg(target_os = "android")]
    crate::android_ctx::call_static_bool(
        "com.voltius.app.SystemBars",
        "setLight",
        light_background,
    );
    #[cfg(not(target_os = "android"))]
    let _ = light_background;
}
