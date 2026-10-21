package com.voltius.app

import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.BackEventCompat
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.OnBackPressedDispatcher
import java.util.Locale

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
 * Predictive back: while enabled, the gesture's start / progress / cancel go to
 * `window.__voltiusBackProgress({phase, progress, edge})` (src/hooks/predictiveBack.ts),
 * which previews closing the topmost layer; the commit is the ordinary
 * handleOnBackPressed. While disabled (root) the system plays its own
 * back-to-home preview (manifest `enableOnBackInvokedCallback`).
 *
 * Root behaviour (A8) lives in [onNothingToClose].
 */
object NativeBack {
  private const val BACK_JS = "(window.__voltiusBack ? window.__voltiusBack() : false)"

  private fun progressJs(phase: String, e: BackEventCompat?): String {
    val edge = when (e?.swipeEdge) {
      BackEventCompat.EDGE_LEFT -> "left"
      BackEventCompat.EDGE_RIGHT -> "right"
      else -> "none"
    }
    return String.format(
      Locale.US,
      "window.__voltiusBackProgress && window.__voltiusBackProgress({phase:'%s',progress:%.4f,edge:'%s'})",
      phase, e?.progress ?: 0f, edge,
    )
  }

  private var callback: OnBackPressedCallback? = null

  fun install(activity: ComponentActivity, webView: WebView) {
    callback?.remove()
    val cb = object : OnBackPressedCallback(false) {
      private fun send(phase: String, e: BackEventCompat?) =
        webView.evaluateJavascript(progressJs(phase, e), null)

      override fun handleOnBackStarted(backEvent: BackEventCompat) = send("start", backEvent)
      override fun handleOnBackProgressed(backEvent: BackEventCompat) = send("progress", backEvent)
      override fun handleOnBackCancelled() = send("cancel", null)

      override fun handleOnBackPressed() {
        webView.evaluateJavascript(BACK_JS) { consumed ->
          if (consumed != "true") onNothingToClose(activity)
        }
      }
    }
    callback = cb
    activity.onBackPressedDispatcher.addCallback(activity, cb)
    webView.addJavascriptInterface(Bridge(activity, webView), "VoltiusBack")
    disableTauriBack(activity)
  }

  /**
   * Tauri's AppPlugin adds an always-enabled OnBackPressedCallback (WebView history /
   * `back-button` event), neither of which Voltius uses. While any callback is enabled
   * the system sees an app callback on every Back, so its back-to-home preview never
   * plays at root (backType CALLBACK instead of RETURN_TO_HOME). The dispatcher has no
   * API to list callbacks, hence reflection; re-run on every enable change in case the
   * plugin registers late. Failing it only costs the root preview.
   */
  private fun disableTauriBack(activity: ComponentActivity) {
    try {
      val field = OnBackPressedDispatcher::class.java.getDeclaredField("onBackPressedCallbacks")
      field.isAccessible = true
      (field.get(activity.onBackPressedDispatcher) as? Iterable<*>)
        ?.filterIsInstance<OnBackPressedCallback>()
        ?.filter { it !== callback && it.isEnabled && it.javaClass.name.startsWith("app.tauri.AppPlugin") }
        ?.forEach { it.isEnabled = false }
    } catch (e: ReflectiveOperationException) {
      Log.w("NativeBack", "cannot disable Tauri's back callback", e)
    }
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

  private class Bridge(private val activity: ComponentActivity, private val webView: WebView) {
    // Runs on the JavaBridge thread; the callbacks belong to the main thread.
    @JavascriptInterface
    fun setEnabled(enabled: Boolean) {
      webView.post {
        callback?.isEnabled = enabled
        disableTauriBack(activity)
      }
    }
  }
}
