package com.voltius.app

import android.view.ViewGroup
import android.webkit.WebView
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsAnimationCompat
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
 * Keyboard (adjustResize is a no-op for edge-to-edge apps on Android 15+): while the IME is up we
 * pad the WebView's parent by the IME height, so the WebView itself ends at the keyboard top on
 * every WebView version — window.innerHeight shrinks, focused inputs scroll into view, the page
 * lays out above the keyboard. The IME (and the nav bar it covers) are then removed from the
 * insets handed to the WebView, so a WebView that resizes its visual viewport by IME insets
 * itself (>= 139) does not count the keyboard twice. Consequently, while --vt-ime > 0 the page is
 * ALREADY above the keyboard: treat --vt-ime as "keyboard open", never pad by it, and
 * --vt-sab is 0 (the nav bar is behind the keyboard).
 * Opening is deferred to the end of the IME slide-in (the keyboard covers the page while it
 * animates, so no empty band shows under the page); closing applies at once (the page grows
 * back behind the keyboard as it slides out).
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
  private var latest: WindowInsetsCompat? = null
  /** IME height (px) the WebView's parent is currently padded by. */
  private var appliedIme = 0
  private var imeAnimating = false

  /** Called from MainActivity.onWebViewCreate. */
  fun install(wv: WebView) {
    webView = wv
    ViewCompat.setOnApplyWindowInsetsListener(wv) { v, insets ->
      latest = insets
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
      // Growing (keyboard opening) waits for the slide-in to finish; shrinking applies now.
      if (!(imeAnimating && ime > appliedIme)) applyIme(ime)
      // WebView's own inset handling (env()) sees the insets minus what the parent padding absorbed.
      ViewCompat.onApplyWindowInsets(v, forWebView(insets))
    }
    ViewCompat.setWindowInsetsAnimationCallback(wv,
      object : WindowInsetsAnimationCompat.Callback(DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
        override fun onPrepare(animation: WindowInsetsAnimationCompat) {
          if (animation.typeMask and WindowInsetsCompat.Type.ime() != 0) imeAnimating = true
        }
        override fun onProgress(insets: WindowInsetsCompat, running: List<WindowInsetsAnimationCompat>) = insets
        override fun onEnd(animation: WindowInsetsAnimationCompat) {
          if (animation.typeMask and WindowInsetsCompat.Type.ime() == 0) return
          imeAnimating = false
          latest?.let { applyIme(it.getInsets(WindowInsetsCompat.Type.ime()).bottom) }
        }
      })
    ViewCompat.requestApplyInsets(wv)
  }

  /** Pad the WebView's parent by the IME height (so the WebView ends at the keyboard top) and push. */
  private fun applyIme(ime: Int) {
    val wv = webView ?: return
    appliedIme = ime
    (wv.parent as? ViewGroup)?.let { p ->
      if (p.paddingBottom != ime) p.setPadding(p.paddingLeft, p.paddingTop, p.paddingRight, ime)
    }
    latest?.let(::push)
  }

  /** The insets the WebView sees once the parent padding has taken the keyboard (and the nav bar under it). */
  private fun forWebView(insets: WindowInsetsCompat): WindowInsetsCompat {
    if (appliedIme == 0) return insets
    val nav = insets.getInsets(WindowInsetsCompat.Type.navigationBars())
    return WindowInsetsCompat.Builder(insets)
      .setInsets(WindowInsetsCompat.Type.ime(), Insets.NONE)
      .setInsets(WindowInsetsCompat.Type.navigationBars(),
        Insets.of(nav.left, nav.top, nav.right, maxOf(0, nav.bottom - appliedIme)))
      .build()
  }

  private fun push(insets: WindowInsetsCompat) {
    val wv = webView ?: return
    val density = wv.resources.displayMetrics.density
    fun css(px: Int) = (px / density).roundToInt()
    val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
    // Report the keyboard state the layout actually reflects (appliedIme), not the raw inset:
    // while the open is deferred the page is still full height.
    val json = JSONObject()
      .put("top", css(bars.top)).put("bottom", css(maxOf(0, bars.bottom - appliedIme)))
      .put("left", css(bars.left)).put("right", css(bars.right))
      .put("ime", css(appliedIme))
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
