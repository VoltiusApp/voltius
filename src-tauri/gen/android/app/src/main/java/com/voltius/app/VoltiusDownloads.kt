package com.voltius.app

import android.content.Context
import android.net.Uri
import androidx.documentfile.provider.DocumentFile
import java.io.File

/**
 * Backs Voltius' Android SFTP "download directory". The user picks a folder once via the
 * Storage Access Framework (see MainActivity); we persist its tree URI here and stream
 * downloaded temp files into it through [DocumentFile].
 *
 * Called over JNI from Rust (`commands/downloads.rs`), mirroring [VoltiusKeychain]. Keep the
 * surface to these static methods. The tree URI string is not secret; the real capability is
 * the persistable URI permission MainActivity takes when the folder is chosen.
 */
object VoltiusDownloads {
    private const val PREFS = "voltius_downloads"
    private const val KEY_URI = "tree_uri"

    /** JNI callback Rust implements; fired when the SAF picker returns (uri or null). */
    @JvmStatic
    external fun nativeDirPicked(uri: String?)

    private fun prefs(ctx: Context) =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    @JvmStatic
    fun setDir(ctx: Context, uri: String) {
        prefs(ctx).edit().putString(KEY_URI, uri).apply()
    }

    @JvmStatic
    fun getDir(ctx: Context): String? = prefs(ctx).getString(KEY_URI, null)

    @JvmStatic
    fun clearDir(ctx: Context) {
        prefs(ctx).edit().remove(KEY_URI).apply()
    }

    /** True if a folder is set and we still hold a writable grant to it. */
    @JvmStatic
    fun isWritable(ctx: Context): Boolean {
        val uri = getDir(ctx) ?: return false
        val doc = DocumentFile.fromTreeUri(ctx, Uri.parse(uri)) ?: return false
        return doc.canWrite()
    }

    /** Human-readable folder name for Settings, or null if unset/unreadable. */
    @JvmStatic
    fun displayName(ctx: Context): String? {
        val uri = getDir(ctx) ?: return null
        return DocumentFile.fromTreeUri(ctx, Uri.parse(uri))?.name
    }

    /** Launch the SAF folder picker via MainActivity. Returns false if no Activity is available. */
    @JvmStatic
    fun launchPicker(): Boolean {
        val activity = MainActivity.instance ?: return false
        activity.launchDirPicker()
        return true
    }

    /**
     * Copy [srcPath] into the tree at [relPath] (slash-separated; intermediate folders are
     * created, an existing target is replaced). Returns false on any failure.
     */
    @JvmStatic
    fun publishFile(ctx: Context, relPath: String, srcPath: String): Boolean {
        val treeUri = getDir(ctx) ?: return false
        var dir = DocumentFile.fromTreeUri(ctx, Uri.parse(treeUri)) ?: return false
        val parts = relPath.split('/')
        for (i in 0 until parts.size - 1) {
            val seg = parts[i]
            dir = dir.findFile(seg)?.takeIf { it.isDirectory }
                ?: dir.createDirectory(seg)
                ?: return false
        }
        val name = parts.last()
        dir.findFile(name)?.delete()
        val file = dir.createFile("application/octet-stream", name) ?: return false
        return try {
            ctx.contentResolver.openOutputStream(file.uri)?.use { out ->
                File(srcPath).inputStream().use { it.copyTo(out) }
            } ?: return false
            true
        } catch (e: Exception) {
            false
        }
    }
}
