package com.voltius.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.RestrictionsManager
import android.webkit.WebView
import androidx.core.content.ContextCompat
import androidx.enterprise.feedback.KeyedAppState
import androidx.enterprise.feedback.KeyedAppStatesReporter
import org.json.JSONArray
import org.json.JSONObject

object VoltiusManagedConfig {
    private var webView: WebView? = null
    private var registered = false
    private var reporter: KeyedAppStatesReporter? = null

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            webView?.evaluateJavascript("window.dispatchEvent(new Event('voltius:policy-changed'))", null)
        }
    }

    @JvmStatic
    @Suppress("DEPRECATION")
    fun read(ctx: Context): String {
        val manager = ctx.getSystemService(Context.RESTRICTIONS_SERVICE) as RestrictionsManager
        val bundle = manager.applicationRestrictions
        val out = JSONObject()
        for (key in bundle.keySet()) {
            when (val value = bundle.get(key)) {
                null -> {}
                is String, is Boolean -> out.put(key, value)
                else -> out.put(key, value.toString())
            }
        }
        return out.toString()
    }

    @JvmStatic
    @Synchronized
    fun report(ctx: Context, entriesJson: String) {
        val entries = JSONArray(entriesJson)
        val states = (0 until entries.length()).map { i ->
            val entry = entries.getJSONObject(i)
            KeyedAppState.builder()
                .setKey(entry.getString("key"))
                .setSeverity(
                    if (entry.getString("severity") == "error") KeyedAppState.SEVERITY_ERROR else KeyedAppState.SEVERITY_INFO,
                )
                .setMessage(entry.getString("message"))
                .build()
        }
        val r = reporter ?: KeyedAppStatesReporter.create(ctx.applicationContext).also { reporter = it }
        r.setStates(states)
    }

    fun install(webView: WebView) {
        this.webView = webView
    }

    fun register(ctx: Context) {
        if (registered) return
        registered = true
        ContextCompat.registerReceiver(
            ctx,
            receiver,
            IntentFilter(Intent.ACTION_APPLICATION_RESTRICTIONS_CHANGED),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
    }

    fun unregister(ctx: Context) {
        if (!registered) return
        registered = false
        ctx.unregisterReceiver(receiver)
    }
}
