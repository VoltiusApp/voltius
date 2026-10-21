package com.voltius.app

import android.view.View
import android.webkit.WebView
import androidx.activity.ComponentActivity

/**
 * Makes the WebView stop behaving like a browser tab (A7):
 * - `textZoom = 100`: the system font scale must not blow up the fixed layout. Instead the page
 *   gets the (capped) scale as `--vt-font-scale` and scales its own type tokens with it.
 * - no WebView-level overscroll glow/stretch (inner scrollers keep theirs), no page zoom.
 * - `data-android` on <html>: the hook for the Android-only CSS in globals.css.
 */
object NativeFeel {
  private const val MIN_FONT_SCALE = 0.85f
  private const val MAX_FONT_SCALE = 1.3f

  private var webView: WebView? = null
  private val script = PageScript("NativeFeel")
  private var fontScale = 1f

  /** From onWebViewCreate. Follows font-scale changes (fontScale is in the activity configChanges). */
  fun install(activity: ComponentActivity, webView: WebView) {
    this.webView = webView
    webView.settings.apply {
      textZoom = 100
      setSupportZoom(false)
      builtInZoomControls = false
      displayZoomControls = false
    }
    webView.overScrollMode = View.OVER_SCROLL_NEVER
    onFontScale(webView.resources.configuration.fontScale)
    activity.addOnConfigurationChangedListener { onFontScale(it.fontScale) }
  }

  private fun onFontScale(systemScale: Float) {
    val wv = webView ?: return
    fontScale = systemScale.coerceIn(MIN_FONT_SCALE, MAX_FONT_SCALE)
    val js = "(function(){var d=document.documentElement;if(!d)return;" +
      "d.setAttribute('data-android','');d.style.setProperty('--vt-font-scale','$fontScale');})();"
    // Document-start so the attribute is there before the first paint and on reloads.
    script.set(wv, js)
  }
}
