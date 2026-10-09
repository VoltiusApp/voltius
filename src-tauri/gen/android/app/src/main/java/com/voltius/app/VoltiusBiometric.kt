package com.voltius.app

import android.app.KeyguardManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import android.security.keystore.UserNotAuthenticatedException
import android.view.WindowManager
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import java.security.KeyStore
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** System authentication for the app lock, called over JNI from `system_auth/android.rs`. */
object VoltiusBiometric {
    const val OK = 0
    const val CANCELLED = 1
    const val FAILED = 2
    const val UNAVAILABLE = 3
    const val INVALIDATED = 4

    private const val ALIAS = "voltius_vault_seal"
    private const val IV_LEN = 12

    @JvmStatic
    external fun nativeAuthResult(code: Int, data: ByteArray?)

    // Below API 30 a strong biometric cannot be combined with the device-credential fallback.
    private fun authenticators(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) BIOMETRIC_STRONG or DEVICE_CREDENTIAL
        else BIOMETRIC_WEAK or DEVICE_CREDENTIAL

    @JvmStatic
    fun available(ctx: Context): Boolean =
        BiometricManager.from(ctx).canAuthenticate(authenticators()) == BiometricManager.BIOMETRIC_SUCCESS

    private fun onResumedUi(work: (MainActivity) -> Unit): Boolean {
        val activity = MainActivity.instance ?: return false
        activity.runOnUiThread {
            // BiometricPrompt silently drops a request made while the activity is stopped, so no callback would ever fire.
            if (!activity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED) ||
                activity.supportFragmentManager.isStateSaved
            ) {
                nativeAuthResult(CANCELLED, null)
                return@runOnUiThread
            }
            try {
                work(activity)
            } catch (e: Exception) {
                nativeAuthResult(FAILED, null)
            }
        }
        return true
    }

    @JvmStatic
    fun authenticate(title: String): Boolean = onResumedUi {
        showPrompt(it, title, authenticators(), null) { nativeAuthResult(OK, null) }
    }

    private fun showPrompt(
        activity: MainActivity,
        title: String,
        allowed: Int,
        crypto: BiometricPrompt.CryptoObject?,
        onOk: (BiometricPrompt.AuthenticationResult) -> Unit,
    ) {
        val prompt = BiometricPrompt(
            activity,
            ContextCompat.getMainExecutor(activity),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) =
                    onOk(result)

                override fun onAuthenticationError(code: Int, msg: CharSequence) =
                    nativeAuthResult(mapError(code), null)
            },
        )
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setAllowedAuthenticators(allowed)
            .build()
        if (crypto != null) prompt.authenticate(info, crypto) else prompt.authenticate(info)
    }

    private fun perUseKey() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R

    @JvmStatic
    fun sealAvailable(ctx: Context): Boolean =
        available(ctx) && (ctx.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).isDeviceSecure

    private fun keyStore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    private fun existingKey(): SecretKey? = keyStore().getKey(ALIAS, null) as? SecretKey

    // Sealing anew is the one moment a dead key can be replaced: nothing sealed by it can be opened anyway.
    private fun replaceKey(ctx: Context): SecretKey {
        keyStore().deleteEntry(ALIAS)
        return sealKey(ctx)
    }

    private fun newKey(strongBox: Boolean): SecretKey {
        val spec = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(false)
            .apply {
                if (perUseKey()) {
                    setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL)
                } else {
                    @Suppress("DEPRECATION")
                    setUserAuthenticationValidityDurationSeconds(10)
                }
                if (strongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) setIsStrongBoxBacked(true)
            }
            .build()
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(spec)
            generateKey()
        }
    }

    private fun sealKey(ctx: Context): SecretKey = existingKey() ?: run {
        val strongBox = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
            ctx.packageManager.hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE)
        try {
            newKey(strongBox)
        } catch (e: StrongBoxUnavailableException) {
            newKey(false)
        }
    }

    private fun cipherFor(mode: Int, key: SecretKey, iv: ByteArray?): Cipher =
        Cipher.getInstance("AES/GCM/NoPadding").apply {
            if (iv == null) init(mode, key) else init(mode, key, GCMParameterSpec(128, iv))
        }

    // A tag that no longer verifies means the key was replaced since this blob was sealed.
    private fun finish(cipher: Cipher, input: ByteArray, encrypting: Boolean) {
        val out = try {
            cipher.doFinal(input)
        } catch (e: AEADBadTagException) {
            nativeAuthResult(INVALIDATED, null)
            return
        }
        nativeAuthResult(OK, if (encrypting) cipher.iv + out else out)
    }

    private fun runSealed(title: String, encrypting: Boolean, input: ByteArray, iv: ByteArray?): Boolean =
        onResumedUi { activity ->
            val key = try {
                if (encrypting) sealKey(activity) else existingKey()
            } catch (e: Exception) {
                null
            }
            if (key == null) {
                nativeAuthResult(if (encrypting) FAILED else INVALIDATED, null)
                return@onResumedUi
            }
            val mode = if (encrypting) Cipher.ENCRYPT_MODE else Cipher.DECRYPT_MODE
            if (!perUseKey()) {
                timeBound(activity, title, authenticators(), mode, key, iv, input, encrypting, retried = false)
                return@onResumedUi
            }
            // A time-bound key from before an upgrade to API 30 refuses per-use init like a dead one.
            val cipher = try {
                cipherFor(mode, key, iv)
            } catch (e: Exception) {
                if (e !is KeyPermanentlyInvalidatedException && e !is UserNotAuthenticatedException) throw e
                if (!encrypting) {
                    nativeAuthResult(INVALIDATED, null)
                    return@onResumedUi
                }
                cipherFor(mode, replaceKey(activity), null)
            }
            showPrompt(activity, title, BIOMETRIC_STRONG or DEVICE_CREDENTIAL, BiometricPrompt.CryptoObject(cipher)) { r ->
                val c = r.cryptoObject?.cipher
                try {
                    if (c == null) nativeAuthResult(FAILED, null) else finish(c, input, encrypting)
                } catch (e: Exception) {
                    nativeAuthResult(FAILED, null)
                }
            }
        }

    // A weak biometric passes the prompt but doesn't authorise a time-bound key; retry once with the screen lock.
    private fun timeBound(
        activity: MainActivity, title: String, allowed: Int, mode: Int, key: SecretKey,
        iv: ByteArray?, input: ByteArray, encrypting: Boolean, retried: Boolean,
    ) {
        showPrompt(activity, title, allowed, null) {
            try {
                finish(cipherFor(mode, key, iv), input, encrypting)
            } catch (e: KeyPermanentlyInvalidatedException) {
                if (encrypting) runCatching { keyStore().deleteEntry(ALIAS) }
                nativeAuthResult(INVALIDATED, null)
            } catch (e: UserNotAuthenticatedException) {
                if (retried) nativeAuthResult(FAILED, null)
                else timeBound(activity, title, DEVICE_CREDENTIAL, mode, key, iv, input, encrypting, retried = true)
            } catch (e: Exception) {
                nativeAuthResult(FAILED, null)
            }
        }
    }

    @JvmStatic
    fun seal(title: String, plaintext: ByteArray): Boolean = runSealed(title, true, plaintext, null)

    @JvmStatic
    fun unseal(title: String, body: ByteArray): Boolean {
        if (body.size <= IV_LEN) {
            nativeAuthResult(INVALIDATED, null)
            return true
        }
        return runSealed(title, false, body.copyOfRange(IV_LEN, body.size), body.copyOfRange(0, IV_LEN))
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

    @Volatile private var locked = false
    @Volatile private var hideInRecents = false
    @Volatile private var foreground = false

    @JvmStatic
    fun setSecure(on: Boolean) {
        locked = on
        refresh()
    }

    @JvmStatic
    fun setHideInRecents(on: Boolean) {
        hideInRecents = on
        refresh()
    }

    private fun refresh() {
        val activity = MainActivity.instance ?: return
        activity.runOnUiThread { applyWindowFlags(activity) }
    }

    // Lifecycle reports RESUMED only after onResume returns, so the activity tells us instead.
    @JvmStatic
    fun setForeground(activity: MainActivity, on: Boolean) {
        foreground = on
        applyWindowFlags(activity)
    }

    // Recents is snapshotted on the way out, before the webview hears it was hidden, so this can't wait for the lock.
    @JvmStatic
    fun applyWindowFlags(activity: MainActivity) {
        val recentsApi = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
        if (recentsApi) activity.setRecentsScreenshotEnabled(!hideInRecents)
        if (locked || (hideInRecents && !foreground && !recentsApi)) {
            activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        } else {
            activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
    }
}
