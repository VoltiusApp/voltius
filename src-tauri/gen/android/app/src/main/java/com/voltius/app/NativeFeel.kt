package com.voltius.app

import android.util.Log
import android.view.View
import android.webkit.WebView
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

/**
 * Makes the WebView stop behaving like a browser tab (A7):
 * - `textZoom = 100`: the system font scale must not blow up the fixed layout. Instead the page
 *   gets the (capped) scale as `--vt-font-scale` and scales its own type tokens with it.
 * - no WebView-level overscroll glow/stretch (inner scrollers keep theirs), no page zoom.
 * - `data-android` on <html>: the hook for the Android-only CSS in globals.css.
 */
object NativeFeel {
  private const val TAG = "NativeFeel"
  private const val MIN_FONT_SCALE = 0.85f
  private const val MAX_FONT_SCALE = 1.3f

  private var webView: WebView? = null
  private var script: ScriptHandler? = null
  private var fontScale = 1f

  fun install(webView: WebView) {
    this.webView = webView
    webView.settings.apply {
      textZoom = 100
      setSupportZoom(false)
      builtInZoomControls = false
      displayZoomControls = false
    }
    webView.overScrollMode = View.OVER_SCROLL_NEVER
    onFontScale(webView.resources.configuration.fontScale)
  }

  /** System font scale changed (fontScale is in the activity's configChanges, so no restart). */
  fun onFontScale(systemScale: Float) {
    val wv = webView ?: return
    fontScale = systemScale.coerceIn(MIN_FONT_SCALE, MAX_FONT_SCALE)
    val js = "(function(){var d=document.documentElement;if(!d)return;" +
      "d.setAttribute('data-android','');d.style.setProperty('--vt-font-scale','$fontScale');})();"
    // Document-start script so the attribute is there before the first paint and on reloads;
    // re-registered so a reload after a change picks up the new value.
    if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
      script?.remove()
      script = WebViewCompat.addDocumentStartJavaScript(wv, js, setOf("*"))
    } else {
      Log.w(TAG, "DOCUMENT_START_SCRIPT unsupported; applying to the current page only")
    }
    wv.evaluateJavascript(js, null)
  }
}
