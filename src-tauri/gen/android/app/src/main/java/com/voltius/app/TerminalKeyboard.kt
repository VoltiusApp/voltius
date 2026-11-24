package com.voltius.app

import android.annotation.SuppressLint
import android.content.Context
import android.text.InputType
import android.util.Log
import android.view.KeyCharacterMap
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.BaseInputConnection
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.view.inputmethod.InputMethodManager
import android.webkit.WebView
import org.json.JSONObject

/**
 * Native soft-keyboard bridge for the xterm.js terminal.
 *
 * The WebView's own IME path corrupts terminal input on Android: Gboard-style IMEs send
 * composition, autocorrect and semantic edits that xterm's hidden textarea mishandles
 * (reordered/duplicated chars, deletes that reinsert composed text — issue #34). We can't
 * override the WebView's InputConnection (Wry's RustWebView is final and regenerated), so we
 * own the IME ourselves: a transparent, focusable overlay that becomes the sole input target,
 * advertises a composition-free EditorInfo, and translates each IME operation into clean
 * terminal bytes forwarded to JS (`window.__voltiusTermInput` / `__voltiusTermKey`).
 *
 * Touches fall through to the WebView (see [TerminalInputView.onTouchEvent]) so xterm keeps
 * its native selection/scroll gestures.
 */
object TerminalKeyboard {
  private const val TAG = "TerminalKeyboard"
  private var inputView: TerminalInputView? = null
  internal var webView: WebView? = null
    private set
  @Volatile private var volumeCtrl = false
  private var volumeCtrlHeld = false

  /** Called from MainActivity.onWebViewCreate once Wry has built the RustWebView. */
  fun install(activity: MainActivity, wv: WebView) {
    webView = wv
    wv.post {
      val parent = wv.parent as? ViewGroup
      if (parent == null) { Log.w(TAG, "install: webView has no ViewGroup parent"); return@post }
      // A 1x1 view: focusable enough to own the IME, but too small to intercept terminal touches.
      val view = TerminalInputView(activity)
      parent.addView(view, ViewGroup.LayoutParams(1, 1))
      inputView = view
    }
  }

  /** JS asked to raise the keyboard for the active terminal. Runs on the UI thread.
   *  While the terminal keyboard is up the WebView is made non-focusable so it can't win
   *  Android focus (and rebind the IME to xterm's textarea, which would restore Gboard's
   *  suggestion/composition path — issue #34). Touches still reach the WebView for
   *  selection/scroll; DOM focus (cursor) is unaffected. hide() restores focusability so the
   *  rest of the app's text inputs keep working. */
  @JvmStatic
  fun show(volumeCtrl: Boolean) {
    this.volumeCtrl = volumeCtrl
    val view = inputView
    if (view == null) { Log.w(TAG, "show: no input view yet"); return }
    view.post {
      webView?.let { it.clearFocus(); it.isFocusable = false; it.isFocusableInTouchMode = false }
      view.requestFocus()
      val imm = view.context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
      imm?.showSoftInput(view, InputMethodManager.SHOW_IMPLICIT)
    }
  }

  /** JS asked to dismiss the keyboard. [focusWebView]: native text selection needs WebView focus. */
  @JvmStatic
  fun hide(focusWebView: Boolean) {
    val view = inputView ?: return
    view.post {
      volumeCtrlHeld = false
      val imm = view.context.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager
      imm?.hideSoftInputFromWindow(view.windowToken, 0)
      // Focusable first: clearFocus() hands focus to the WebView, so a hardware keyboard still has a target.
      webView?.let { it.isFocusable = true; it.isFocusableInTouchMode = true }
      view.clearFocus()
      if (focusWebView) webView?.requestFocus()
    }
  }

  /** Volume Down held while the terminal owns input acts as Ctrl; true = consumed, volume untouched. */
  fun onVolumeKey(event: KeyEvent): Boolean {
    if (event.keyCode != KeyEvent.KEYCODE_VOLUME_DOWN) return false
    when (event.action) {
      KeyEvent.ACTION_DOWN -> {
        if (!volumeCtrl || inputView?.hasFocus() != true) return false
        volumeCtrlHeld = true
      }
      KeyEvent.ACTION_UP -> {
        if (!volumeCtrlHeld) return false
        volumeCtrlHeld = false
      }
      else -> return false
    }
    return true
  }

  /** Forward a run of typed text to the active terminal. */
  fun feedText(text: String) {
    if (text.isEmpty()) return
    eval("window.__voltiusTermInput", JSONObject.quote(text), mods(volumeCtrlHeld, alt = false, shift = false))
  }

  /** Forward a semantic key (Enter, Backspace, Delete, arrows, Home/End, Tab, Esc, PgUp/PgDn). */
  fun feedKey(name: String) {
    eval("window.__voltiusTermKey", JSONObject.quote(name), mods(volumeCtrlHeld, alt = false, shift = false))
  }

  private val KEY_NAMES = mapOf(
    KeyEvent.KEYCODE_ENTER to "Enter", KeyEvent.KEYCODE_NUMPAD_ENTER to "Enter",
    KeyEvent.KEYCODE_DEL to "Backspace", KeyEvent.KEYCODE_FORWARD_DEL to "Delete", KeyEvent.KEYCODE_INSERT to "Insert",
    KeyEvent.KEYCODE_DPAD_LEFT to "Left", KeyEvent.KEYCODE_DPAD_RIGHT to "Right",
    KeyEvent.KEYCODE_DPAD_UP to "Up", KeyEvent.KEYCODE_DPAD_DOWN to "Down",
    KeyEvent.KEYCODE_MOVE_HOME to "Home", KeyEvent.KEYCODE_MOVE_END to "End",
    KeyEvent.KEYCODE_PAGE_UP to "PgUp", KeyEvent.KEYCODE_PAGE_DOWN to "PgDn",
    KeyEvent.KEYCODE_TAB to "Tab", KeyEvent.KEYCODE_ESCAPE to "Esc",
    KeyEvent.KEYCODE_F1 to "F1", KeyEvent.KEYCODE_F2 to "F2", KeyEvent.KEYCODE_F3 to "F3", KeyEvent.KEYCODE_F4 to "F4",
    KeyEvent.KEYCODE_F5 to "F5", KeyEvent.KEYCODE_F6 to "F6", KeyEvent.KEYCODE_F7 to "F7", KeyEvent.KEYCODE_F8 to "F8",
    KeyEvent.KEYCODE_F9 to "F9", KeyEvent.KEYCODE_F10 to "F10", KeyEvent.KEYCODE_F11 to "F11", KeyEvent.KEYCODE_F12 to "F12",
  )

  /** A key-down from a hardware keyboard, or one an IME injects, as terminal input with its modifiers.
   *  False when it isn't terminal input (Meta shortcuts, bare modifiers, dead keys). */
  fun feedKeyEvent(event: KeyEvent): Boolean {
    if (event.action != KeyEvent.ACTION_DOWN || event.isMetaPressed) return false
    val ctrl = event.isCtrlPressed || volumeCtrlHeld
    KEY_NAMES[event.keyCode]?.let {
      eval("window.__voltiusTermKey", JSONObject.quote(it), mods(ctrl, event.isAltPressed, event.isShiftPressed))
      return true
    }
    // Ctrl and Alt make getUnicodeChar return 0, so read the character without them, except
    // when Alt is AltGr and itself picks the character (German @, Polish ą).
    val noCtrl = event.metaState and KeyEvent.META_CTRL_MASK.inv()
    val withAlt = event.getUnicodeChar(noCtrl)
    val plain = event.getUnicodeChar(noCtrl and KeyEvent.META_ALT_MASK.inv())
    val altGr = event.isAltPressed && withAlt != 0 && withAlt != plain
    val ch = if (altGr) withAlt else plain
    if (ch == 0 || (ch and KeyCharacterMap.COMBINING_ACCENT) != 0) return false
    eval("window.__voltiusTermInput", JSONObject.quote(String(Character.toChars(ch))), mods(ctrl, event.isAltPressed && !altGr, shift = false))
    return true
  }

  private fun mods(ctrl: Boolean, alt: Boolean, shift: Boolean) =
    JSONObject().put("ctrl", ctrl).put("alt", alt).put("shift", shift).toString()

  @JvmStatic
  fun setSelectionTouchFeed(on: Boolean) = SelectionTouchFeed.setEnabled(on)

  internal fun eval(fn: String, vararg jsArgs: String) {
    val wv = webView ?: return
    val js = "if(typeof $fn==='function'){$fn(${jsArgs.joinToString(",")});}"
    wv.post { wv.evaluateJavascript(js, null) }
  }
}

/**
 * Transparent overlay that owns the Android IME on behalf of the terminal. It reports itself as
 * a text editor with a composition-free EditorInfo and returns a [TerminalInputConnection] that
 * emits terminal bytes instead of mutating an editable buffer.
 */
@SuppressLint("ViewConstructor", "ClickableViewAccessibility")
class TerminalInputView(context: Context) : View(context) {
  init {
    isFocusable = true
    isFocusableInTouchMode = true
    isClickable = false
    setWillNotDraw(true)
  }

  override fun onCheckIsTextEditor(): Boolean = true

  // Never consume touches: the WebView beneath keeps its selection/scroll gestures.
  override fun onTouchEvent(event: MotionEvent?): Boolean = false

  private val heldKeys = HashSet<Int>()

  // Hardware keys reach the focused view, not the InputConnection. Consuming Esc also stops
  // Android's fallback that turns an unhandled Esc into Back.
  override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
    if (TerminalKeyboard.feedKeyEvent(event)) { heldKeys.add(keyCode); return true }
    return super.onKeyDown(keyCode, event)
  }

  override fun onKeyUp(keyCode: Int, event: KeyEvent): Boolean =
    heldKeys.remove(keyCode) || super.onKeyUp(keyCode, event)

  override fun onCreateInputConnection(outAttrs: EditorInfo): InputConnection {
    // VISIBLE_PASSWORD + NO_SUGGESTIONS disables autocorrect, predictions and (on Gboard)
    // composition, so the IME commits raw characters. NO_EXTRACT_UI / NO_FULLSCREEN keep the
    // terminal visible in landscape; NO_PERSONALIZED_LEARNING avoids leaking commands to the IME.
    outAttrs.inputType = InputType.TYPE_CLASS_TEXT or
      InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS or
      InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
    outAttrs.imeOptions = EditorInfo.IME_ACTION_NONE or
      EditorInfo.IME_FLAG_NO_EXTRACT_UI or
      EditorInfo.IME_FLAG_NO_FULLSCREEN or
      EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING
    return TerminalInputConnection(this)
  }
}

/**
 * Translates IME operations into terminal input. Holds no editable text: the terminal (via the
 * remote shell) is the source of truth. A composition tracker collapses the rare IME that still
 * composes (setComposingText → commit) into incremental writes without duplication.
 */
private class TerminalInputConnection(view: View) : BaseInputConnection(view, false) {
  /** Text the IME currently considers "composing" and that we've already written to the shell. */
  private var composing = ""

  /** Reconcile the on-screen composing region with [next]: backspace the diverging tail, write
   *  the new suffix. No-op when unchanged, so repeated setComposingText calls don't duplicate. */
  private fun setComposing(next: String) {
    if (next == composing) return
    var common = 0
    val max = minOf(composing.length, next.length)
    while (common < max && composing[common] == next[common]) common++
    repeat(composing.length - common) { TerminalKeyboard.feedKey("Backspace") }
    if (next.length > common) TerminalKeyboard.feedText(next.substring(common))
    composing = next
  }

  override fun setComposingText(text: CharSequence, newCursorPosition: Int): Boolean {
    setComposing(text.toString())
    return true
  }

  override fun finishComposingText(): Boolean {
    composing = ""
    return true
  }

  override fun commitText(text: CharSequence, newCursorPosition: Int): Boolean {
    // Fold any active composition into this commit, then send whatever the commit adds beyond it.
    setComposing(text.toString())
    composing = ""
    return true
  }

  override fun deleteSurroundingText(beforeLength: Int, afterLength: Int): Boolean {
    if (composing.isNotEmpty()) return super.deleteSurroundingText(beforeLength, afterLength)
    repeat(beforeLength) { TerminalKeyboard.feedKey("Backspace") }
    repeat(afterLength) { TerminalKeyboard.feedKey("Delete") }
    return true
  }

  override fun sendKeyEvent(event: KeyEvent): Boolean {
    TerminalKeyboard.feedKeyEvent(event)
    return true
  }
}
