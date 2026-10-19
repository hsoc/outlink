package io.github.hsoc.outlink.proximity

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.UUID

/** User-visible, non-restarting lease on the existing React/Bluetooth runtime. */
class ConnectivityService : Service(), HeadlessJsTaskEventListener {
  private var taskId: Int? = null
  private var context: ReactContext? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private var taskToken = ""

  override fun onBind(intent: Intent?): IBinder? = null

  @SuppressLint("WakelockTimeout")
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent == null || intent.action == ACTION_STOP) {
      stopSelf(); return START_NOT_STICKY
    }
    if (running) return START_NOT_STICKY
    try {
      val title = checkNotNull(intent.getStringExtra("title"))
      val body = checkNotNull(intent.getStringExtra("body"))
      val stopLabel = checkNotNull(intent.getStringExtra("stop"))
      val notifications = getSystemService(NotificationManager::class.java)
      check(notifications.areNotificationsEnabled()) { "Enable notifications for background connectivity" }
      if (Build.VERSION.SDK_INT >= 33) {
        check(checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
      }
      if (Build.VERSION.SDK_INT >= 26) {
        notifications.createNotificationChannel(NotificationChannel(CHANNEL, title, NotificationManager.IMPORTANCE_LOW))
        check(notifications.getNotificationChannel(CHANNEL).importance != NotificationManager.IMPORTANCE_NONE)
      }
      // Do not cold-start React or restore identities after process death.
      val react = (application as ReactApplication).reactHost?.currentReactContext
        ?: error("Open Outlink before starting background connectivity")
      val launch = packageManager.getLaunchIntentForPackage(packageName)
        ?: error("Missing application launch intent")
      val open = PendingIntent.getActivity(this, 0, launch,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      val stop = PendingIntent.getService(this, 1, Intent(this, ConnectivityService::class.java).setAction(ACTION_STOP),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else Notification.Builder(this)
      val notification = builder
        .setSmallIcon(R.drawable.outlink_connectivity)
        .setContentTitle(title)
        .setContentText(body)
        .setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true)
        .setCategory(Notification.CATEGORY_SERVICE).setVisibility(Notification.VISIBILITY_PUBLIC)
        .setPriority(Notification.PRIORITY_LOW)
        .addAction(Notification.Action.Builder(null, stopLabel, stop).build())
        .build()
      if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
      else startForeground(NOTIFICATION, notification)
      context = react
      taskToken = UUID.randomUUID().toString()
      token = taskToken
      wakeLock = getSystemService(PowerManager::class.java)
        .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "$packageName:connectivity").also {
          it.setReferenceCounted(false); it.acquire()
        }
      val data = Arguments.createMap().apply { putString("token", taskToken) }
      val tasks = HeadlessJsTaskContext.getInstance(react)
      tasks.addTaskEventListener(this)
      taskId = tasks.startTask(HeadlessJsTaskConfig("OutlinkConnectivity", data, 0, true))
      running = true
    } catch (_: Exception) {
      stopSelf()
    }
    // No boot receiver, sticky restart, saved identity, or automatic rejoin.
    return START_NOT_STICKY
  }

  override fun onHeadlessJsTaskStart(taskId: Int) = Unit
  override fun onHeadlessJsTaskFinish(taskId: Int) {
    if (this.taskId == taskId) stopSelf()
  }

  override fun onTaskRemoved(rootIntent: Intent?) { stopSelf(); super.onTaskRemoved(rootIntent) }

  override fun onDestroy() {
    running = false; token = null
    context?.let { react ->
      HeadlessJsTaskContext.getInstance(react).removeTaskEventListener(this)
      if (react.hasActiveReactInstance()) {
        val emitter = react.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        emitter.emit("OutlinkConnectivityTaskStopped", Arguments.createMap().apply { putString("token", taskToken) })
        emitter.emit("OutlinkConnectivityStopped", null)
      }
      taskId?.let { HeadlessJsTaskContext.getInstance(react).finishTask(it) }
    }
    taskId = null; context = null
    wakeLock?.let { if (it.isHeld) it.release() }; wakeLock = null
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  companion object {
    const val ACTION_STOP = "io.github.hsoc.outlink.STOP_CONNECTIVITY"
    private const val CHANNEL = "outlink-connectivity"
    private const val NOTIFICATION = 7141
    @Volatile var running = false
      private set
    @Volatile var token: String? = null
      private set
  }
}
