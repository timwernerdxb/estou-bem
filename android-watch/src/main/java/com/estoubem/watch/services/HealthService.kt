package com.estoubem.watch.services

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.health.services.client.HealthServices
import androidx.health.services.client.MeasureCallback
import androidx.health.services.client.MeasureClient
import androidx.health.services.client.PassiveListenerCallback
import androidx.health.services.client.PassiveMonitoringClient
import androidx.health.services.client.data.Availability
import androidx.health.services.client.data.DataPointContainer
import androidx.health.services.client.data.DataType
import androidx.health.services.client.data.DeltaDataType
import androidx.health.services.client.data.PassiveListenerConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.guava.await
import kotlinx.coroutines.launch

/**
 * Foreground service that monitors health metrics via Health Services API:
 * - Heart rate (MeasureClient)
 * - SpO2 / blood oxygen (MeasureClient)
 * - Steps (PassiveMonitoringClient)
 *
 * Stores latest readings in SharedPreferences and sends data to phone every 60s.
 * Alerts when SpO2 drops below 90%.
 */
class HealthService : Service() {

    companion object {
        private const val TAG = "HealthService"
        private const val NOTIFICATION_ID = 1001
        private const val CHANNEL_ID = "health_monitoring"
        const val PREFS_NAME = "estoubem_health"
        const val ACTION_HEALTH_UPDATED = "com.estoubem.watch.HEALTH_UPDATED"
        const val ACTION_SPO2_ALERT = "com.estoubem.watch.SPO2_ALERT"

        private const val PHONE_SYNC_INTERVAL_MS = 60_000L
        private const val SPO2_ALERT_THRESHOLD = 90f
    }

    private val serviceScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private lateinit var measureClient: MeasureClient
    private lateinit var passiveMonitoringClient: PassiveMonitoringClient
    private lateinit var prefs: SharedPreferences
    private val handler = Handler(Looper.getMainLooper())

    private var currentHeartRate: Float = 0f
    private var currentSpO2: Float = 0f
    private var currentSteps: Long = 0L

    // ---- MeasureCallbacks ----

    private val heartRateCallback = object : MeasureCallback {
        override fun onAvailabilityChanged(dataType: DeltaDataType<*, *>, availability: Availability) {
            Log.d(TAG, "Heart rate availability: $availability")
        }

        override fun onDataReceived(data: DataPointContainer) {
            val heartRatePoints = data.getData(DataType.HEART_RATE_BPM)
            for (point in heartRatePoints) {
                currentHeartRate = point.value.toFloat()
                Log.d(TAG, "Heart rate: $currentHeartRate bpm")
                storeReading("heart_rate", currentHeartRate)
                broadcastUpdate()
            }
        }
    }

    private val spo2Callback = object : MeasureCallback {
        override fun onAvailabilityChanged(dataType: DeltaDataType<*, *>, availability: Availability) {
            Log.d(TAG, "SpO2 availability: $availability")
        }

        override fun onDataReceived(data: DataPointContainer) {
            val spo2Points = data.getData(DataType.SPO2)
            for (point in spo2Points) {
                currentSpO2 = point.value.toFloat()
                Log.d(TAG, "SpO2: $currentSpO2%")
                storeReading("spo2", currentSpO2)
                broadcastUpdate()

                // Alert on low SpO2
                if (currentSpO2 > 0 && currentSpO2 < SPO2_ALERT_THRESHOLD) {
                    Log.w(TAG, "LOW SpO2 ALERT: $currentSpO2%")
                    sendBroadcast(Intent(ACTION_SPO2_ALERT).apply {
                        putExtra("spo2", currentSpO2)
                    })
                    // Also send alert to phone immediately
                    PhoneConnectionService.sendHealthData(
                        this@HealthService, currentHeartRate, currentSpO2, currentSteps
                    )
                }
            }
        }
    }

    // ---- Passive listener for steps ----

    private val passiveListenerCallback = object : PassiveListenerCallback {
        override fun onNewDataPointsReceived(dataPoints: DataPointContainer) {
            val stepsPoints = dataPoints.getData(DataType.STEPS_DAILY)
            for (point in stepsPoints) {
                currentSteps = point.value
                Log.d(TAG, "Steps: $currentSteps")
                storeReading("steps", currentSteps.toFloat())
                broadcastUpdate()
            }
        }
    }

    // ---- Periodic phone sync ----

    private val phoneSyncRunnable = object : Runnable {
        override fun run() {
            Log.d(TAG, "Syncing health data to phone: HR=$currentHeartRate, SpO2=$currentSpO2, steps=$currentSteps")
            PhoneConnectionService.sendHealthData(
                this@HealthService, currentHeartRate, currentSpO2, currentSteps
            )
            handler.postDelayed(this, PHONE_SYNC_INTERVAL_MS)
        }
    }

    // ---- Service lifecycle ----

    override fun onCreate() {
        super.onCreate()
        prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

        val healthServicesClient = HealthServices.getClient(this)
        measureClient = healthServicesClient.measureClient
        passiveMonitoringClient = healthServicesClient.passiveMonitoringClient

        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildNotification())

        startHealthMonitoring()
        handler.postDelayed(phoneSyncRunnable, PHONE_SYNC_INTERVAL_MS)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        handler.removeCallbacks(phoneSyncRunnable)
        stopHealthMonitoring()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // ---- Monitoring start/stop ----

    private fun startHealthMonitoring() {
        serviceScope.launch {
            try {
                // Check capabilities and register heart rate
                val capabilities = measureClient.getCapabilitiesAsync().await()
                if (DataType.HEART_RATE_BPM in capabilities.supportedDataTypesMeasure) {
                    measureClient.registerMeasureCallback(DataType.HEART_RATE_BPM, heartRateCallback)
                    Log.d(TAG, "Heart rate monitoring registered")
                } else {
                    Log.w(TAG, "Heart rate not supported on this device")
                }

                // Register SpO2 if supported
                if (DataType.SPO2 in capabilities.supportedDataTypesMeasure) {
                    measureClient.registerMeasureCallback(DataType.SPO2, spo2Callback)
                    Log.d(TAG, "SpO2 monitoring registered")
                } else {
                    Log.w(TAG, "SpO2 not supported on this device")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to register MeasureCallbacks", e)
            }

            try {
                // Register passive step counting
                val passiveConfig = PassiveListenerConfig.builder()
                    .setDataTypes(setOf(DataType.STEPS_DAILY))
                    .build()
                passiveMonitoringClient.setPassiveListenerCallback(passiveConfig, passiveListenerCallback)
                Log.d(TAG, "Passive step counting registered")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to register passive step monitoring", e)
            }
        }
    }

    private fun stopHealthMonitoring() {
        serviceScope.launch {
            try {
                measureClient.unregisterMeasureCallback(DataType.HEART_RATE_BPM, heartRateCallback)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to unregister heart rate callback", e)
            }
            try {
                measureClient.unregisterMeasureCallback(DataType.SPO2, spo2Callback)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to unregister SpO2 callback", e)
            }
            try {
                passiveMonitoringClient.clearPassiveListenerCallbackAsync().await()
            } catch (e: Exception) {
                Log.e(TAG, "Failed to clear passive listener", e)
            }
        }
    }

    // ---- Helpers ----

    private fun storeReading(key: String, value: Float) {
        prefs.edit().apply {
            putFloat(key, value)
            putLong("${key}_at", System.currentTimeMillis())
            apply()
        }
    }

    private fun broadcastUpdate() {
        sendBroadcast(Intent(ACTION_HEALTH_UPDATED))
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Health Monitoring",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Continuous health monitoring for Estou Bem"
        }
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(channel)
    }

    private fun buildNotification(): Notification {
        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("Estou Bem")
            .setContentText("Monitoring health...")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .build()
    }
}
