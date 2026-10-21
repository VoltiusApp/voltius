package com.voltius.app

import android.webkit.WebView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import kotlin.math.roundToInt

/**
 * Native window insets -> page CSS custom properties.
 *
 * The activity is edge-to-edge, but WebView reports `env(safe-area-inset-*)` = 0 on many builds
 * (WebView 133 / Android 16), so the gesture bar overlaps bottom UI. We read the real insets
 * here and push them (in CSS px) onto `document.documentElement`:
 *
 *   --vt-sat / --vt-sab / --vt-sal / --vt-sar   system bars + display cutout (top/bottom/left/right)
 *   --vt-ime                                    soft-keyboard height from the bottom of the window
 *                                               (0 when hidden; includes the nav bar area under it)
 *
 * plus `window.__voltiusInsets = {top,bottom,left,right,ime}` and a `voltius:insets` window
 * event (detail = the same object) for JS that needs numbers rather than CSS. Values are
 * re-pushed on every inset dispatch (rotation, IME show/hide, nav-mode change) and replayed
 * at document start of every page load, so a reload or a not-yet-ready page still gets them.
 * The web side resolves them with an env() fallback in `src/styles/globals.css` (--safe-*).
 */
object SystemInsets {
  private var webView: WebView? = null
  private var lastJson: String? = null
  private var docStartScript: ScriptHandler? = null

  /** Called from MainActivity.onWebViewCreate. */
  fun install(wv: WebView) {
    webView = wv
    ViewCompat.setOnApplyWindowInsetsListener(wv) { v, insets ->
      push(insets)
      // Keep WebView's own inset handling (IME resize, env()) intact.
      ViewCompat.onApplyWindowInsets(v, insets)
    }
    ViewCompat.requestApplyInsets(wv)
  }

  private fun push(insets: WindowInsetsCompat) {
    val wv = webView ?: return
    val density = wv.resources.displayMetrics.density
    fun css(px: Int) = (px / density).roundToInt()
    val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
    val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
    val json = JSONObject()
      .put("top", css(bars.top)).put("bottom", css(bars.bottom))
      .put("left", css(bars.left)).put("right", css(bars.right))
      .put("ime", css(ime.bottom))
      .toString()
    if (json == lastJson) return
    lastJson = json
    val js = applyScript(json)
    // Replay at document start of future loads (reload / not-yet-ready page)...
    if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
      docStartScript?.remove()
      docStartScript = WebViewCompat.addDocumentStartJavaScript(wv, js, setOf("*"))
    }
    // ...and apply to the current document now.
    wv.post { wv.evaluateJavascript(js, null) }
  }

  private fun applyScript(json: String) = """
    (function(){
      var i=$json;window.__voltiusInsets=i;
      function a(){var s=document.documentElement.style;
        s.setProperty('--vt-sat',i.top+'px');s.setProperty('--vt-sab',i.bottom+'px');
        s.setProperty('--vt-sal',i.left+'px');s.setProperty('--vt-sar',i.right+'px');
        s.setProperty('--vt-ime',i.ime+'px');
        window.dispatchEvent(new CustomEvent('voltius:insets',{detail:i}));}
      if(document.documentElement)a();else document.addEventListener('readystatechange',a,{once:true});
    })();
  """.trimIndent()
}
