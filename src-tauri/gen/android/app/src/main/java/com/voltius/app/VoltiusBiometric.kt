package com.voltius.app

import android.content.Context
import android.os.Build
import android.view.WindowManager
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle

/** System authentication for the app lock, called over JNI from `system_auth/android.rs`. */
object VoltiusBiometric {
    const val OK = 0
    const val CANCELLED = 1
    const val FAILED = 2
    const val UNAVAILABLE = 3

    @JvmStatic
    external fun nativeAuthResult(code: Int)

    // Below API 30 a strong biometric cannot be combined with the device-credential fallback.
    private fun authenticators(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) BIOMETRIC_STRONG or DEVICE_CREDENTIAL
        else BIOMETRIC_WEAK or DEVICE_CREDENTIAL

    @JvmStatic
    fun available(ctx: Context): Boolean =
        BiometricManager.from(ctx).canAuthenticate(authenticators()) == BiometricManager.BIOMETRIC_SUCCESS

    @JvmStatic
    fun authenticate(title: String): Boolean {
        val activity = MainActivity.instance ?: return false
        activity.runOnUiThread {
            // BiometricPrompt silently drops a request made while the activity is stopped, so no callback would ever fire.
            if (!activity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED) ||
                activity.supportFragmentManager.isStateSaved
            ) {
                nativeAuthResult(CANCELLED)
                return@runOnUiThread
            }
            try {
                showPrompt(activity, title)
            } catch (e: Exception) {
                nativeAuthResult(FAILED)
            }
        }
        return true
    }

    private fun showPrompt(activity: MainActivity, title: String) {
        val prompt = BiometricPrompt(
            activity,
            ContextCompat.getMainExecutor(activity),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) =
                    nativeAuthResult(OK)

                override fun onAuthenticationError(code: Int, msg: CharSequence) =
                    nativeAuthResult(mapError(code))
            },
        )
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setAllowedAuthenticators(authenticators())
            .build()
        prompt.authenticate(info)
    }

    @JvmStatic
    fun mapError(code: Int): Int = when (code) {
        BiometricPrompt.ERROR_USER_CANCELED,
        BiometricPrompt.ERROR_NEGATIVE_BUTTON,
        BiometricPrompt.ERROR_CANCELED -> CANCELLED
        BiometricPrompt.ERROR_NO_BIOMETRICS,
        BiometricPrompt.ERROR_HW_NOT_PRESENT,
        BiometricPrompt.ERROR_HW_UNAVAILABLE,
        BiometricPrompt.ERROR_NO_DEVICE_CREDENTIAL -> UNAVAILABLE
        else -> FAILED
    }

    @JvmStatic
    fun setSecure(on: Boolean) {
        val activity = MainActivity.instance ?: return
        activity.runOnUiThread {
            if (on) activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
            else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
    }
}
