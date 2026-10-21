package com.voltius.app

import android.util.Log
import android.webkit.WebView
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

/**
 * A native -> page script that must hold on every page load: [set] applies it to the current
 * document now and registers it as a document-start script (replacing the previous version),
 * so a reload or a not-yet-ready page gets it before its first paint. One instance per concern
 * (insets, font scale, ...); keep the scripts idempotent.
 */
class PageScript(private val tag: String) {
  private var handler: ScriptHandler? = null

  fun set(webView: WebView, js: String) {
    if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
      handler?.remove()
      handler = WebViewCompat.addDocumentStartJavaScript(webView, js, setOf("*"))
    } else {
      Log.w(tag, "DOCUMENT_START_SCRIPT unsupported; applying to the current page only")
    }
    webView.post { webView.evaluateJavascript(js, null) }
  }
}
