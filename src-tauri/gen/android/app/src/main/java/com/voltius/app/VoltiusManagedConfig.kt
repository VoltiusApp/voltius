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
    private const val GENERAL_KEY = "policy"
    private val ERROR_KINDS = setOf("file", "type")

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
    fun report(ctx: Context, issuesJson: String) {
        val issues = JSONArray(issuesJson)
        val byKey = LinkedHashMap<String, Pair<Int, MutableList<String>>>()
        for (i in 0 until issues.length()) {
            val issue = issues.getJSONObject(i)
            val key = if (issue.isNull("key")) GENERAL_KEY else issue.getString("key")
            val severity = if (issue.optString("kind") in ERROR_KINDS) {
                KeyedAppState.SEVERITY_ERROR
            } else {
                KeyedAppState.SEVERITY_INFO
            }
            val (worst, messages) = byKey[key] ?: Pair(severity, mutableListOf<String>())
            messages.add(issue.optString("message"))
            byKey[key] = Pair(maxOf(worst, severity), messages)
        }
        if (byKey.isEmpty()) byKey[GENERAL_KEY] = Pair(KeyedAppState.SEVERITY_INFO, mutableListOf("applied"))
        val states = byKey.map { (key, entry) ->
            KeyedAppState.builder()
                .setKey(key.take(KeyedAppState.MAX_KEY_LENGTH))
                .setSeverity(entry.first)
                .setMessage(entry.second.joinToString("; ").take(KeyedAppState.MAX_MESSAGE_LENGTH))
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
