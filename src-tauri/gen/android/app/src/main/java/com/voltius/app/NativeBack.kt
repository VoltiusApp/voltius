package com.voltius.app

import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback

/**
 * Hardware/gesture Back for the web UI, without WebView history.
 *
 * One OnBackPressedCallback, enabled from JS (`window.VoltiusBack.setEnabled`) iff
 * the page has something to close (sheet, popover, settings, page, tab). A press
 * calls `window.__voltiusBack()` (src/hooks/useAndroidBack.ts), which closes one
 * thing and answers whether it did. While disabled the press goes straight to
 * the system default, so the root behaviour is plain Android.
 *
 * MainActivity turns Wry's own callback off (`handleBackNavigation = false`), so
 * WebView.goBack() is never hit.
 *
 * Hooks for follow-ups: predictive back (A3) overrides handleOnBackStarted /
 * Progressed / Cancelled on [callback]; root behaviour (A8) lives in [onNothingToClose].
 */
object NativeBack {
  private const val BACK_JS = "(window.__voltiusBack ? window.__voltiusBack() : false)"

  private var callback: OnBackPressedCallback? = null

  fun install(activity: ComponentActivity, webView: WebView) {
    callback?.remove()
    val cb = object : OnBackPressedCallback(false) {
      override fun handleOnBackPressed() {
        webView.evaluateJavascript(BACK_JS) { consumed ->
          if (consumed != "true") onNothingToClose(activity)
        }
      }
    }
    callback = cb
    activity.onBackPressedDispatcher.addCallback(activity, cb)
    webView.addJavascriptInterface(Bridge(webView), "VoltiusBack")
  }

  /**
   * The page had nothing to close although the callback was enabled (stale flag,
   * page not loaded yet): hand this press to the system default, as if disabled.
   */
  private fun onNothingToClose(activity: ComponentActivity) {
    val cb = callback ?: return
    cb.isEnabled = false
    activity.onBackPressedDispatcher.onBackPressed()
  }

  private class Bridge(private val webView: WebView) {
    // Runs on the JavaBridge thread; the callback belongs to the main thread.
    @JavascriptInterface
    fun setEnabled(enabled: Boolean) {
      webView.post { callback?.isEnabled = enabled }
    }
  }
}
