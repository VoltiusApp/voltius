package com.voltius.app

import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.inspector.WindowInspector
import java.util.Collections
import java.util.WeakHashMap

// Reports the finger to JS during a native terminal selection and replays a still finger's move so
// Chromium keeps clamping the dragged end while the overlay autoscrolls; handles are popup windows.
object SelectionTouchFeed {
  private const val REPEAT_MS = 40L
  private const val SEND_MS = 16L
  private const val HOOK_SCAN_MS = 300L
  private val handler = Handler(Looper.getMainLooper())
  private val hooked: MutableSet<View> = Collections.newSetFromMap(WeakHashMap<View, Boolean>())
  private var enabled = false
  private var last: MotionEvent? = null
  private var replay: ((MotionEvent) -> Unit)? = null
  private var lastMoveAt = 0L
  private var lastSendAt = 0L
  private var repeating = false
  private var replaying = false

  fun setEnabled(on: Boolean) {
    handler.post {
      enabled = on
      handler.removeCallbacks(scanHandles)
      if (on) scanHandles.run() else stop()
    }
  }

  fun onTouch(activity: MainActivity, ev: MotionEvent) {
    track(ev) { e ->
      val copy = MotionEvent.obtain(e.downTime, SystemClock.uptimeMillis(), MotionEvent.ACTION_MOVE, e.x, e.y, e.metaState)
      try { activity.dispatchTouchEvent(copy) } finally { copy.recycle() }
    }
  }

  private val handleListener = View.OnTouchListener { view, ev ->
    track(ev) { e ->
      // A copy keeps the raw offset Chromium uses to map popup-local coordinates back to the WebView.
      val copy = MotionEvent.obtain(e)
      copy.action = MotionEvent.ACTION_MOVE
      try { view.dispatchTouchEvent(copy) } finally { copy.recycle() }
    }
    false
  }

  private val scanHandles = object : Runnable {
    override fun run() {
      if (!enabled) return
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        for (root in WindowInspector.getGlobalWindowViews()) hookHandles(root)
      }
      handler.postDelayed(this, HOOK_SCAN_MS)
    }
  }

  private fun hookHandles(view: View) {
    if (view.javaClass.name.endsWith("TouchHandleDrawable")) {
      if (hooked.add(view)) view.setOnTouchListener(handleListener)
      return
    }
    if (view is ViewGroup) for (i in 0 until view.childCount) hookHandles(view.getChildAt(i))
  }

  private fun track(ev: MotionEvent, replayWith: (MotionEvent) -> Unit) {
    if (!enabled || replaying) return
    when (ev.actionMasked) {
      MotionEvent.ACTION_DOWN, MotionEvent.ACTION_MOVE -> {
        if (ev.pointerCount != 1) { stop(); return }
        last?.recycle()
        last = MotionEvent.obtain(ev)
        replay = replayWith
        lastMoveAt = SystemClock.uptimeMillis()
        if (ev.actionMasked == MotionEvent.ACTION_DOWN || lastMoveAt - lastSendAt >= SEND_MS) send(ev.rawY)
        if (!repeating) {
          repeating = true
          handler.postDelayed(repeat, REPEAT_MS)
        }
      }
      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL, MotionEvent.ACTION_POINTER_DOWN -> {
        send(null)
        stop()
      }
    }
  }

  private val repeat = object : Runnable {
    override fun run() {
      val ev = last
      val r = replay
      if (ev == null || r == null) { repeating = false; return }
      if (SystemClock.uptimeMillis() - lastMoveAt >= REPEAT_MS) {
        replaying = true
        try { r(ev) } finally { replaying = false }
      }
      handler.postDelayed(this, REPEAT_MS)
    }
  }

  private fun stop() {
    handler.removeCallbacks(repeat)
    repeating = false
    last?.recycle()
    last = null
    replay = null
  }

  private fun send(rawY: Float?) {
    val wv = TerminalKeyboard.webView ?: return
    lastSendAt = SystemClock.uptimeMillis()
    val y = rawY?.let {
      val loc = IntArray(2)
      wv.getLocationOnScreen(loc)
      ((it - loc[1]) / wv.resources.displayMetrics.density).toString()
    } ?: "null"
    TerminalKeyboard.eval("window.__voltiusSelTouch", y)
  }
}
