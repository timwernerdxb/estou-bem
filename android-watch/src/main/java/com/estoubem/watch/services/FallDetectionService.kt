package com.estoubem.watch.services

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.util.Log
import kotlin.math.sqrt

/**
 * Foreground service that uses the accelerometer to detect falls.
 *
 * Detection algorithm:
 *   1. Impact phase:  total acceleration > 3g  (29.4 m/s^2)
 *   2. Stillness phase: total acceleration < 0.2g (1.96 m/s^2) sustained for 3 seconds
 *
 * On detection:
 *   - Vibrate the watch
 *   - Broadcast ACTION_FALL_DETECTED so the UI can show FallAlertScreen
 *   - Start a 30-second countdown; if the user does not cancel, send a fall alert to the phone
 */
class FallDetectionService : Service(), SensorEventListener {

    companion object {
        private const val TAG = "FallDetection"
        private const val NOTIFICATION_ID = 1002
        private const val CHANNEL_ID = "fall_detection"

        const val ACTION_FALL_DETECTED  = "com.estoubem.watch.FALL_DETECTED"
        const val ACTION_FALL_CANCELLED = "com.estoubem.watch.FALL_CANCELLED_BY_USER"

        private const val IMPACT_THRESHOLD_G = 3.0f        // 3g in m/s^2: 29.43
        private const val STILLNESS_THRESHOLD_G = 0.2f     // 0.2g in m/s^2: 1.962
        private const val GRAVITY = 9.81f
        private const val STILLNESS_DURATION_MS = 3_000L
        private const val ALERT_COUNTDOWN_MS = 30_000L
    }

    private lateinit var sensorManager: SensorManager
    private var accelerometer: Sensor? = null
    private val handler = Handler(Looper.getMainLooper())

    // State machine
    private var impactDetected = false
    private var stillnessStartTime = 0L
    private var fallAlertActive = false

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildNotification())

        sensorManager = getSystemService(Context.SENSOR_SERVICE) as SensorManager
        accelerometer = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)

        if (accelerometer != null) {
            // ~50 Hz is fine for fall detection
            sensorManager.registerListener(this, accelerometer, SensorManager.SENSOR_DELAY_GAME)
            Log.d(TAG, "Accelerometer registered for fall detection")
        } else {
            Log.e(TAG, "No accelerometer available on this device")
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Allow the UI to cancel a fall alert
        if (intent?.action == ACTION_FALL_CANCELLED) {
            cancelFallAlert()
        }
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
        if (fallAlertActive) return // already processing a fall

        val x = event.values[0]
        val y = event.values[1]
        val z = event.values[2]
        val totalG = sqrt(x * x + y * y + z * z) / GRAVITY

        if (!impactDetected) {
            // Phase 1: detect impact > 3g
            if (totalG > IMPACT_THRESHOLD_G) {
                impactDetected = true
                stillnessStartTime = 0L
                Log.d(TAG, "Impact detected: ${totalG}g")
            }
        } else {
            // Phase 2: detect stillness < 0.2g for 3 seconds
            if (totalG < STILLNESS_THRESHOLD_G) {
                if (stillnessStartTime == 0L) {
                    stillnessStartTime = System.currentTimeMillis()
                } else if (System.currentTimeMillis() - stillnessStartTime >= STILLNESS_DURATION_MS) {
                    // Fall confirmed
                    onFallDetected()
                }
            } else {
                // Movement resumed — reset
                stillnessStartTime = 0L
                // If more than 10 seconds since impact without stillness, cancel
                if (System.currentTimeMillis() - stillnessStartTime > 10_000L && stillnessStartTime == 0L) {
                    impactDetected = false
                }
            }
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

    // ---- Fall handling ----

    private fun onFallDetected() {
        fallAlertActive = true
        impactDetected = false
        stillnessStartTime = 0L
        Log.w(TAG, "FALL DETECTED — starting 30s countdown")

        // Vibrate watch
        val vibrator = getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        vibrator.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 500, 200, 500, 200, 500), -1))

        // Broadcast so the UI can show FallAlertScreen
        sendBroadcast(Intent(ACTION_FALL_DETECTED))

        // Start 30-second countdown — if not cancelled, send alert to phone
        handler.postDelayed(sendAlertRunnable, ALERT_COUNTDOWN_MS)
    }

    private val sendAlertRunnable = Runnable {
        if (fallAlertActive) {
            Log.w(TAG, "Fall alert NOT cancelled — sending to phone")
            PhoneConnectionService.sendFallAlert(this)
            fallAlertActive = false
        }
    }

    private fun cancelFallAlert() {
        if (fallAlertActive) {
            Log.d(TAG, "Fall alert cancelled by user")
            fallAlertActive = false
            handler.removeCallbacks(sendAlertRunnable)
            PhoneConnectionService.sendFallCancelled(this)
            sendBroadcast(Intent(ACTION_FALL_CANCELLED))
        }
    }

    // ---- Notification ----

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Fall Detection",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Fall detection service for Estou Bem"
        }
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(channel)
    }

    private fun buildNotification(): Notification {
        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("Estou Bem")
            .setContentText("Fall detection active")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .build()
    }
}
