package com.voltius.app

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts

class MainActivity : TauriActivity() {
  private lateinit var dirPicker: ActivityResultLauncher<Uri?>

  override fun onCreate(savedInstanceState: Bundle?) {
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
  }

  override fun onDestroy() {
    if (instance === this) instance = null
    super.onDestroy()
  }

  fun launchDirPicker() {
    runOnUiThread { dirPicker.launch(null) }
  }

  companion object {
    @Volatile
    var instance: MainActivity? = null
  }
}
