package com.voltius.app

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.MotionEvent

/**
 * While a native terminal selection is live: reports the finger position to JS (handle drags never
 * reach the DOM) and repeats a held finger's last move, so Chromium keeps re-clamping the dragged
 * handle to the edge row while the overlay autoscrolls under a still finger.
 */
object SelectionTouchFeed {
  private const val REPEAT_MS = 40L
  private const val SEND_MS = 16L
  private val handler = Handler(Looper.getMainLooper())
  private var enabled = false
  private var activity: MainActivity? = null
  private var last: MotionEvent? = null
  private var lastMoveAt = 0L
  private var lastSendAt = 0L
  private var repeating = false
  private var replaying = false

  fun setEnabled(on: Boolean) {
    handler.post {
      enabled = on
      if (!on) stop()
    }
  }

  /** Called from MainActivity.dispatchTouchEvent on the UI thread, before the WebView sees [ev]. */
  fun onTouch(activity: MainActivity, ev: MotionEvent) {
    if (!enabled || replaying) return
    this.activity = activity
    when (ev.actionMasked) {
      MotionEvent.ACTION_DOWN, MotionEvent.ACTION_MOVE -> {
        if (ev.pointerCount != 1) { stop(); return }
        last?.recycle()
        last = MotionEvent.obtain(ev)
        lastMoveAt = SystemClock.uptimeMillis()
        if (ev.actionMasked == MotionEvent.ACTION_DOWN || lastMoveAt - lastSendAt >= SEND_MS) send(ev, true)
        if (!repeating) {
          repeating = true
          handler.postDelayed(repeat, REPEAT_MS)
        }
      }
      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL, MotionEvent.ACTION_POINTER_DOWN -> {
        send(ev, false)
        stop()
      }
    }
  }

  private val repeat = object : Runnable {
    override fun run() {
      val ev = last
      val act = activity
      if (ev == null || act == null) { repeating = false; return }
      val now = SystemClock.uptimeMillis()
      if (now - lastMoveAt >= REPEAT_MS) {
        val copy = MotionEvent.obtain(ev.downTime, now, MotionEvent.ACTION_MOVE, ev.x, ev.y, ev.metaState)
        replaying = true
        try { act.dispatchTouchEvent(copy) } finally { replaying = false; copy.recycle() }
      }
      handler.postDelayed(this, REPEAT_MS)
    }
  }

  private fun stop() {
    handler.removeCallbacks(repeat)
    repeating = false
    last?.recycle()
    last = null
  }

  private fun send(ev: MotionEvent, down: Boolean) {
    val wv = TerminalKeyboard.webView ?: return
    lastSendAt = SystemClock.uptimeMillis()
    val loc = IntArray(2)
    wv.getLocationOnScreen(loc)
    val y = if (down) ((ev.rawY - loc[1]) / wv.resources.displayMetrics.density).toString() else "null"
    TerminalKeyboard.eval("window.__voltiusSelTouch", y)
  }
}
