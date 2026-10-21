package com.voltius.app

import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen

/**
 * Holds the system splash (navy + bolt, Theme.voltius.Starting) until the web app has painted its
 * first real frame, so a cold start never flashes the default window or a blank WebView.
 *
 * "Painted" = React has mounted something into #root (the web splash / lock screen / shell).
 * Native-only: polls the DOM over evaluateJavascript, no JS bridge and no web change.
 * A JS failure can never hang the splash: it is released after [TIMEOUT_MS] regardless.
 */
object SplashGate {
  // Debug cold starts take 1-2 min; past this the navy window background (no logo) shows instead.
  private const val TIMEOUT_MS = 20_000L
  private const val POLL_MS = 150L
  private const val MOUNTED_JS =
    "(function(){var r=document.getElementById('root');return !!(r&&r.firstElementChild)})()"

  private val main = Handler(Looper.getMainLooper())
  @Volatile private var ready = false
  private var generation = 0

  /** Call from MainActivity.onCreate, before super.onCreate. */
  fun install(activity: MainActivity) {
    ready = false
    val gen = ++generation
    activity.installSplashScreen().setKeepOnScreenCondition { !ready }
    main.postDelayed({ if (gen == generation) release() }, TIMEOUT_MS)
  }

  /** Call from onWebViewCreate: waits for the first React mount, then releases. */
  fun watch(webView: WebView) {
    val gen = generation
    val poll = object : Runnable {
      override fun run() {
        if (ready || gen != generation) return
        webView.evaluateJavascript(MOUNTED_JS) { mounted ->
          if (ready || gen != generation) return@evaluateJavascript
          // No VisualStateCallback here: the held splash blocks the content view from drawing, so
          // it might never fire. Releasing on mount is enough, as the WebView and window behind it
          // are already navy (no flash) and the splash fades out over the frame being drawn.
          if (mounted == "true") release() else main.postDelayed(this, POLL_MS)
        }
      }
    }
    main.post(poll)
  }

  private fun release() {
    ready = true
  }
}
