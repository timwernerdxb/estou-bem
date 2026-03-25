package com.estoubem.watch.services

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import kotlin.math.sqrt

/**
 * Foreground service that monitors movement via the accelerometer at ~2 Hz.
 *
 * - Movement threshold: 0.15g
 * - Tracks last_movement_at timestamp
 * - Reports to phone every 60 seconds via PhoneConnectionService
 */
class MotionDetectionService : Service(), SensorEventListener {

    companion object {
        private const val TAG = "MotionDetection"
        private const val NOTIFICATION_ID = 1003
        private const val CHANNEL_ID = "motion_detection"
        private const val PREFS_NAME = "estoubem_motion"

        const val ACTION_MOTION_UPDATED = "com.estoubem.watch.MOTION_UPDATED"

        private const val MOVEMENT_THRESHOLD_G = 0.15f
        private const val GRAVITY = 9.81f
        private const val PHONE_REPORT_INTERVAL_MS = 60_000L

        // ~2 Hz => 500_000 microseconds between samples
        private const val SAMPLING_PERIOD_US = 500_000
    }

    private lateinit var sensorManager: SensorManager
    private lateinit var prefs: SharedPreferences
    private var accelerometer: Sensor? = null
    private val handler = Handler(Looper.getMainLooper())

    private var lastMagnitude = 0f
    private var lastMovementAt = 0L
    private var isMoving = false

    override fun onCreate() {
        super.onCreate()
        prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        lastMovementAt = prefs.getLong("last_movement_at", System.currentTimeMillis())

        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildNotification())

        sensorManager = getSystemService(Context.SENSOR_SERVICE) as SensorManager
        accelerometer = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)

        if (accelerometer != null) {
            sensorManager.registerListener(this, accelerometer, SAMPLING_PERIOD_US)
            Log.d(TAG, "Accelerometer registered for motion detection at ~2Hz")
        } else {
            Log.e(TAG, "No accelerometer available")
        }

        // Start periodic reporting to phone
        handler.postDelayed(phoneReportRunnable, PHONE_REPORT_INTERVAL_MS)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        sensorManager.unregisterListener(this)
        handler.removeCallbacksAndMessages(null)
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // ---- SensorEventListener ----

    override fun onSensorChanged(event: SensorEvent) {
        if (event.sensor.type != Sensor.TYPE_ACCELEROMETER) return

        val x = event.values[0]
        val y = event.values[1]
        val z = event.values[2]
        val magnitude = sqrt(x * x + y * y + z * z) / GRAVITY

        // Compare with gravity-subtracted magnitude to detect motion
        val delta = kotlin.math.abs(magnitude - 1.0f)

        if (delta > MOVEMENT_THRESHOLD_G) {
            lastMovementAt = System.currentTimeMillis()
            if (!isMoving) {
                isMoving = true
                broadcastUpdate()
            }
        } else {
            if (isMoving) {
                isMoving = false
                broadcastUpdate()
            }
        }

        lastMagnitude = magnitude

        // Persist
        prefs.edit().putLong("last_movement_at", lastMovementAt).apply()
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

    // ---- Phone reporting ----

    private val phoneReportRunnable = object : Runnable {
        override fun run() {
            Log.d(TAG, "Reporting motion to phone: lastMovement=$lastMovementAt isMoving=$isMoving")
            PhoneConnectionService.sendMovementData(this@MotionDetectionService, lastMovementAt, isMoving)
            handler.postDelayed(this, PHONE_REPORT_INTERVAL_MS)
        }
    }

    private fun broadcastUpdate() {
        sendBroadcast(Intent(ACTION_MOTION_UPDATED).apply {
            putExtra("last_movement_at", lastMovementAt)
            putExtra("is_moving", isMoving)
        })
    }

    // ---- Notification ----

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Motion Detection",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Motion detection for Estou Bem"
        }
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(channel)
    }

    private fun buildNotification(): Notification {
        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("Estou Bem")
            .setContentText("Motion monitoring active")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .build()
    }
}
