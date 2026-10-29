package com.voltius.app

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException

/** Phone → SFTP uploads. Called over JNI from Rust (`commands/uploads.rs`), like [VoltiusDownloads]. */
object VoltiusUploads {
    /** JNI callback Rust implements: a JSON `[{uri,name,size}]` (empty on cancel), or null on failure. */
    @JvmStatic
    external fun nativeFilesPicked(json: String?)

    @JvmStatic
    fun launchPicker(): Boolean {
        val activity = MainActivity.instance ?: return false
        activity.launchFilePicker()
        return true
    }

    fun picked(ctx: Context, uris: List<Uri>) {
        val json = try {
            JSONArray().apply { uris.forEach { put(describe(ctx, it)) } }.toString()
        } catch (e: Exception) {
            null
        }
        nativeFilesPicked(json)
    }

    @JvmStatic
    fun describe(ctx: Context, uri: Uri): JSONObject {
        var name = uri.lastPathSegment?.substringAfterLast('/') ?: ""
        var size = -1L
        ctx.contentResolver.query(
            uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null,
        )?.use { c ->
            if (c.moveToFirst()) {
                val n = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (n >= 0 && !c.isNull(n)) name = c.getString(n)
                val s = c.getColumnIndex(OpenableColumns.SIZE)
                if (s >= 0 && !c.isNull(s)) size = c.getLong(s)
            }
        }
        return JSONObject().put("uri", uri.toString()).put("name", name).put("size", size)
    }

    /** Copy a content URI into [destPath] (an app-cache file). Throws on failure. */
    @JvmStatic
    fun copyToCache(ctx: Context, uri: String, destPath: String) {
        val input = ctx.contentResolver.openInputStream(Uri.parse(uri))
            ?: throw IOException("cannot open $uri")
        input.use { src -> File(destPath).outputStream().use { src.copyTo(it) } }
    }
}
