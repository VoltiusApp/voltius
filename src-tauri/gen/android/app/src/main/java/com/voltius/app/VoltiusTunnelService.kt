package com.voltius.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/** Held while tunnels are up so Android keeps their 127.0.0.1 listeners alive in the background.
 *  Driven over JNI from `port_forward/keepalive.rs` through [update]. */
class VoltiusTunnelService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // startForeground must run for every startForegroundService, even when the tunnels
    // already closed in the meantime, or the system kills the app.
    val type = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
    try {
      ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(this, desired), type)
    } catch (e: Exception) {
      stopSelf()
      return START_NOT_STICKY
    }
    apply()
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    if (instance === this) instance = null
    starting = false
    super.onDestroy()
  }

  private fun apply() {
    val count = desired
    if (count == 0) {
      ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
      stopSelf()
    } else {
      getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification(this, count))
    }
  }

  companion object {
    private const val CHANNEL_ID = "tunnels"
    private const val NOTIFICATION_ID = 0x7e1

    @Volatile private var instance: VoltiusTunnelService? = null
    @Volatile private var desired = 0
    @Volatile private var starting = false

    /** Number of listening tunnels; 0 stops the service. */
    @JvmStatic
    fun update(ctx: Context, count: Int) {
      desired = count
      val running = instance
      if (running != null) {
        running.apply()
        return
      }
      if (count == 0 || starting) return
      try {
        starting = true
        ContextCompat.startForegroundService(ctx, Intent(ctx, VoltiusTunnelService::class.java))
        MainActivity.instance?.requestNotificationPermission()
      } catch (e: Exception) {
        // Android 12+ refuses a start from the background; the next change retries.
        starting = false
      }
    }

    private fun notification(ctx: Context, count: Int): Notification {
      val manager = ctx.getSystemService(NotificationManager::class.java)
      if (Build.VERSION.SDK_INT >= 26 && manager.getNotificationChannel(CHANNEL_ID) == null) {
        val channel = NotificationChannel(
          CHANNEL_ID,
          ctx.getString(R.string.tunnel_channel_name),
          NotificationManager.IMPORTANCE_LOW,
        )
        manager.createNotificationChannel(channel)
      }
      val open = PendingIntent.getActivity(
        ctx,
        0,
        Intent(Intent.ACTION_VIEW, Uri.parse("voltius://port-forwarding"), ctx, MainActivity::class.java),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      )
      return NotificationCompat.Builder(ctx, CHANNEL_ID)
        .setSmallIcon(R.drawable.ic_stat_tunnel)
        .setContentTitle(ctx.resources.getQuantityString(R.plurals.tunnel_notification_title, count, count))
        .setContentText(ctx.getString(R.string.tunnel_notification_text))
        .setContentIntent(open)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
        .build()
    }
  }
}
