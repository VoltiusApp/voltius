package com.voltius.app

import android.app.Activity
import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import android.os.SystemClock
import android.provider.OpenableColumns
import android.view.DragEvent
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException

object VoltiusUploads {
    // JSON `[{uri,name,size}]`, `[]` on cancel, null on failure.
    @JvmStatic
    external fun nativeFilesPicked(json: String?)

    @JvmStatic
    external fun nativeFilesDropped(x: Float, y: Float, json: String)

    @JvmStatic
    fun launchPicker(): Boolean {
        val activity = MainActivity.instance ?: return false
        activity.launchFilePicker()
        return true
    }

    fun picked(ctx: Context, uris: List<Uri>) = describeAsync(ctx, uris) { nativeFilesPicked(it) }

    private fun describeAsync(ctx: Context, uris: List<Uri>, deliver: (String?) -> Unit) {
        Thread {
            val json = try {
                JSONArray().apply { uris.forEach { put(describe(ctx, it)) } }.toString()
            } catch (e: Exception) {
                null
            }
            deliver(json)
        }.start()
    }

    @Volatile
    private var dropTarget = false

    @JvmStatic
    fun setDropTarget(on: Boolean) {
        dropTarget = on
    }

    fun installDrop(activity: Activity, webView: WebView) {
        val density = activity.resources.displayMetrics.density
        var active = false
        var lastMove = 0L
        fun tell(phase: String, e: DragEvent) {
            val js = "window.dispatchEvent(new CustomEvent('voltius:file-drag',{detail:" +
                "{phase:'$phase',x:${e.x / density},y:${e.y / density}}}))"
            webView.evaluateJavascript(js, null)
        }
        webView.setOnDragListener { _, e ->
            if (e.action == DragEvent.ACTION_DRAG_STARTED) active = dropTarget
            if (!active) return@setOnDragListener false
            when (e.action) {
                DragEvent.ACTION_DRAG_ENTERED -> tell("over", e)
                DragEvent.ACTION_DRAG_LOCATION -> {
                    val now = SystemClock.uptimeMillis()
                    if (now - lastMove >= 50) {
                        lastMove = now
                        tell("over", e)
                    }
                }
                DragEvent.ACTION_DRAG_EXITED -> tell("leave", e)
                DragEvent.ACTION_DRAG_ENDED -> {
                    active = false
                    tell("leave", e)
                }
                DragEvent.ACTION_DROP -> return@setOnDragListener dropped(activity, e, density)
            }
            true
        }
    }

    private fun dropped(activity: Activity, e: DragEvent, density: Float): Boolean {
        if (!dropTarget) return false
        val clip = e.clipData ?: return false
        val uris = (0 until clip.itemCount).mapNotNull {
            clip.getItemAt(it).uri?.takeIf { u -> u.scheme == ContentResolver.SCHEME_CONTENT }
        }
        if (uris.isEmpty()) return false
        // Best effort and never released: the source may have granted read already, and staging
        // (and every Retry) reads the URIs later; the grant ends with the activity.
        activity.requestDragAndDropPermissions(e)
        val x = e.x / density
        val y = e.y / density
        describeAsync(activity.applicationContext, uris) { json ->
            if (json != null) nativeFilesDropped(x, y, json)
        }
        return true
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

    @JvmStatic
    external fun nativeCopyCancelled(transferId: String): Boolean

    @JvmStatic
    fun copyToCache(ctx: Context, uri: String, destPath: String, transferId: String) {
        val input = ctx.contentResolver.openInputStream(Uri.parse(uri))
            ?: throw IOException("cannot open $uri")
        input.use { src ->
            File(destPath).outputStream().use { out ->
                val buf = ByteArray(COPY_CHUNK)
                while (!nativeCopyCancelled(transferId)) {
                    val n = src.read(buf)
                    if (n < 0) return
                    out.write(buf, 0, n)
                }
                throw IOException("Transfer cancelled")
            }
        }
    }

    private const val COPY_CHUNK = 256 * 1024
}
