package com.voltius.app

import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // super.onCreate loaded the Rust lib; hand the keychain store the app Context + VM.
    VoltiusKeychain.nativeInit(applicationContext)
  }
}
