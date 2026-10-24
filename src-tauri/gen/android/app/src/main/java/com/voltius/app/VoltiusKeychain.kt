package com.voltius.app

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.io.File
import java.io.IOException
import java.security.GeneralSecurityException

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
    private const val TAG = "VoltiusKeychain"
    private const val FILE = "voltius_secrets"
    private const val KEEP_QUARANTINED = 3
    private val QUARANTINED = Regex("""^${FILE}\.xml\.(\d+)\.bak$""")

    /**
     * Hands the Rust keyring store the JavaVM + application Context. Must be called once at
     * startup (MainActivity.onCreate) after the native library is loaded — tao 0.35 doesn't
     * populate `ndk_context`, so Rust can't obtain the Context on its own.
     */
    @JvmStatic
    external fun nativeInit(context: Context)

    private fun open(ctx: Context, masterKey: MasterKey) = EncryptedSharedPreferences.create(
        ctx,
        FILE,
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    /** A file this install's Keystore key can't decrypt is set aside and replaced by an empty store. */
    @Synchronized
    private fun prefs(ctx: Context): SharedPreferences {
        val masterKey = MasterKey.Builder(ctx).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        return try {
            open(ctx, masterKey)
        } catch (e: GeneralSecurityException) {
            quarantine(ctx, e)
            open(ctx, masterKey)
        } catch (e: IOException) {
            quarantine(ctx, e)
            open(ctx, masterKey)
        }
    }

    private fun quarantine(ctx: Context, cause: Exception) {
        val dir = File(ctx.applicationInfo.dataDir, "shared_prefs")
        val file = File(dir, "$FILE.xml")
        if (!file.exists()) throw cause
        val taken = quarantinedStamps(dir)
        var stamp = maxOf(System.currentTimeMillis(), (taken.maxOrNull() ?: 0L) + 1)
        while (File(dir, "$FILE.xml.$stamp.bak").exists()) stamp++
        val dest = File(dir, "$FILE.xml.$stamp.bak")
        if (!file.renameTo(dest)) throw cause
        // The file is already gone: this only drops the stale copy cached by the Context.
        ctx.deleteSharedPreferences(FILE)
        Log.w(TAG, "Could not decrypt $FILE, set it aside as ${dest.name}", cause)
        quarantinedStamps(dir).sortedDescending().drop(KEEP_QUARANTINED).forEach {
            File(dir, "$FILE.xml.$it.bak").delete()
        }
    }

    private fun quarantinedStamps(dir: File): List<Long> =
        dir.list().orEmpty().mapNotNull { QUARANTINED.find(it)?.groupValues?.get(1)?.toLongOrNull() }

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
