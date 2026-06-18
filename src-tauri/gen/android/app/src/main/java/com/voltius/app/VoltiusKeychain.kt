package com.voltius.app

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Secret storage backing Voltius' OS-keychain on Android.
 *
 * Values live in an [EncryptedSharedPreferences] file whose data-encryption keys are
 * wrapped by a [MasterKey] held in the hardware-backed Android Keystore (TEE/StrongBox
 * when available). That gives the same "key never leaves secure hardware" guarantee the
 * desktop OS keychains provide, which is what Voltius relies on to store the vault key.
 *
 * Called over JNI from Rust's keyring-core store (see `keychain_android.rs`). Keep the
 * surface to these three static String-in/String-out methods so the JNI side stays trivial.
 */
object VoltiusKeychain {
    private const val FILE = "voltius_secrets"

    /**
     * Hands the Rust keyring store the JavaVM + application Context. Must be called once at
     * startup (MainActivity.onCreate) after the native library is loaded — tao 0.35 doesn't
     * populate `ndk_context`, so Rust can't obtain the Context on its own.
     */
    @JvmStatic
    external fun nativeInit(context: Context)

    private fun prefs(ctx: Context) = EncryptedSharedPreferences.create(
        ctx,
        FILE,
        MasterKey.Builder(ctx).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    /** Returns the stored value for [key], or null if absent. */
    @JvmStatic
    fun get(ctx: Context, key: String): String? = prefs(ctx).getString(key, null)

    /** Stores [value] under [key], synchronously (commit) so it's durable before returning. */
    @JvmStatic
    fun set(ctx: Context, key: String, value: String) {
        prefs(ctx).edit().putString(key, value).commit()
    }

    /** Removes [key]. No-op if it doesn't exist. */
    @JvmStatic
    fun delete(ctx: Context, key: String) {
        prefs(ctx).edit().remove(key).commit()
    }
}
