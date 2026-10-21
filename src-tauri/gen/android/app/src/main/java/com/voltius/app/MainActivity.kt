package com.voltius.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.view.MotionEvent
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts

class MainActivity : TauriActivity() {
  // Back is routed to the page by NativeBack, never to WebView history.
  override val handleBackNavigation: Boolean = false

  private lateinit var dirPicker: ActivityResultLauncher<Uri?>

  override fun onCreate(savedInstanceState: Bundle?) {
    intent?.let(::withLinkType)
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // super.onCreate loaded the Rust lib; hand the keychain store the app Context + VM.
    VoltiusKeychain.nativeInit(applicationContext)

    // SAF folder picker for the SFTP download directory (see VoltiusDownloads.kt).
    dirPicker = registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
      if (uri != null) {
        // Persist the grant so the folder stays writable across app restarts. Guard against
        // a SecurityException so a refused grant can't crash the result callback — we still
        // notify Rust below either way.
        val granted = try {
          contentResolver.takePersistableUriPermission(
            uri,
            Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
          )
          true
        } catch (e: SecurityException) {
          false
        }
        if (granted) VoltiusDownloads.setDir(applicationContext, uri.toString())
      }
      VoltiusDownloads.nativeDirPicked(uri?.toString())
    }
    instance = this
    VoltiusBiometric.applyWindowFlags(this)
  }

  override fun onPause() {
    super.onPause()
    VoltiusBiometric.setForeground(this, false)
  }

  override fun onResume() {
    super.onResume()
    VoltiusBiometric.setForeground(this, true)
  }

  // Wry has just built the RustWebView: install the native terminal-keyboard overlay (#34).
  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    TerminalKeyboard.install(this, webView)
    NativeBack.install(this, webView)
  }

  override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
    SelectionTouchFeed.onTouch(this, ev)
    return super.dispatchTouchEvent(ev)
  }

  override fun dispatchKeyEvent(event: KeyEvent): Boolean =
    TerminalKeyboard.onVolumeKey(event) || super.dispatchKeyEvent(event)

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(withLinkType(intent))
  }

  // Root Back of a task the launcher icon didn't start (deep link, notification tap, `am start`)
  // makes the system finish the activity instead of moving the task back. Wry then drops the
  // WebView and tao exits the process, taking every SSH session with it, and Tauri can't attach
  // a recreated activity to the running app. So never finish at the task root: background the
  // task the way a launcher-started one is. The system's back-to-home preview still plays.
  // Quitting goes through app.exit / force_quit (process exit), not finish().
  override fun finish() {
    if (isTaskRoot && !isChangingConfigurations && moveTaskToBack(true)) return
    super.finish()
  }

  override fun onDestroy() {
    if (instance === this) instance = null
    super.onDestroy()
  }

  // tao 0.35 unwraps getType() on every VIEW intent, so an untyped voltius:// link aborts the app.
  private fun withLinkType(intent: Intent): Intent {
    val data = intent.data
    if (intent.action == Intent.ACTION_VIEW && intent.type == null && data != null) {
      intent.setDataAndType(data, "application/x-voltius-link")
    }
    return intent
  }

  fun launchDirPicker() {
    runOnUiThread { dirPicker.launch(null) }
  }

  fun requestNotificationPermission() {
    if (Build.VERSION.SDK_INT < 33 || notificationPermissionAsked) return
    if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return
    notificationPermissionAsked = true
    runOnUiThread { requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 0) }
  }

  companion object {
    @Volatile
    var instance: MainActivity? = null
    private var notificationPermissionAsked = false
  }
}
