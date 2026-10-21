package com.voltius.app

import android.content.Context
import android.os.Build
import androidx.activity.ComponentActivity
import androidx.core.view.WindowCompat

/**
 * Status/navigation bar icon contrast that follows the active Voltius theme rather than the
 * phone's dark mode. The web side computes the verdict from the theme background luminance
 * (`src/services/androidSystemBars.ts` → Rust `set_system_bars` → [setLight]).
 *
 * The last verdict is persisted so a cold start paints the right icons before the WebView has
 * loaded (default: dark background → light icons, matching the default Voltius theme).
 */
object SystemBars {
  private const val PREFS = "voltius_system_bars"
  private const val KEY_LIGHT = "light_background"

  /** True when the theme behind the bars is light, i.e. the bar icons must be dark. */
  @Volatile
  private var lightBackground = false

  /** From `MainActivity.onCreate`: restore the last verdict and keep it across uiMode changes. */
  fun install(activity: ComponentActivity) {
    lightBackground = prefs(activity).getBoolean(KEY_LIGHT, false)
    apply(activity)
    // The activity handles uiMode itself (configChanges), so re-assert our choice when the
    // phone's dark mode flips instead of letting the system/DayNight defaults win.
    activity.addOnConfigurationChangedListener { activity.window.decorView.post { apply(activity) } }
  }

  @JvmStatic
  fun setLight(light: Boolean) {
    val activity = MainActivity.instance ?: return
    if (light != lightBackground) {
      lightBackground = light
      prefs(activity).edit().putBoolean(KEY_LIGHT, light).apply()
    }
    activity.runOnUiThread { apply(activity) }
  }

  private fun apply(activity: ComponentActivity) {
    val window = activity.window
    WindowCompat.getInsetsController(window, window.decorView).run {
      isAppearanceLightStatusBars = lightBackground
      isAppearanceLightNavigationBars = lightBackground
    }
    // Keep the 3-button nav bar fully transparent (no system scrim) so the app shows through.
    if (Build.VERSION.SDK_INT >= 29) window.isNavigationBarContrastEnforced = false
  }

  private fun prefs(context: Context) =
    context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
