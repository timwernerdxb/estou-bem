package com.estoubem.watch.services

import android.content.Context
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
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.guava.await
import kotlinx.coroutines.launch
import java.util.concurrent.Executors

/**
 * Health monitoring service using Android Health Services API.
 * Monitors heart rate, SpO2 (blood oxygen), steps, and sleep.
 * Sends alerts when SpO2 drops below 90%.
 *
 * Uses MeasureClient for real-time heart rate and SpO2,
 * and PassiveMonitoringClient for steps and daily goals.
 */
class HealthService(private val context: Context) {

    companion object {
        private const val TAG = "HealthService"
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val executor = Executors.newSingleThreadExecutor()

    // Health Services clients
    private val healthServicesClient = HealthServices.getClient(context)
    private val measureClient: MeasureClient = healthServicesClient.measureClient
    private val passiveClient: PassiveMonitoringClient = healthServicesClient.passiveMonitoringClient

    // Published state
    private val _heartRate = MutableStateFlow(0.0)
    val heartRate: StateFlow<Double> = _heartRate.asStateFlow()

    private val _bloodOxygen = MutableStateFlow(0.0)
    val bloodOxygen: StateFlow<Double> = _bloodOxygen.asStateFlow()

    private val _steps = MutableStateFlow(0)
    val steps: StateFlow<Int> = _steps.asStateFlow()

    private val _sleepHours = MutableStateFlow(0.0)
    val sleepHours: StateFlow<Double> = _sleepHours.asStateFlow()

    private val _isMonitoring = MutableStateFlow(false)
    val isMonitoring: StateFlow<Boolean> = _isMonitoring.asStateFlow()

    // Callbacks
    private val heartRateCallback = object : MeasureCallback {
        override fun onAvailabilityChanged(
            dataType: DeltaDataType<*, *>,
            availability: Availability
        ) {
            Log.d(TAG, "Heart rate availability: $availability")
        }

        override fun onDataReceived(data: DataPointContainer) {
            val heartRatePoints = data.getData(DataType.HEART_RATE_BPM)
            heartRatePoints.lastOrNull()?.let { point ->
                val bpm = point.value
                _heartRate.value = bpm
                Log.d(TAG, "Heart rate: $bpm BPM")

                // Send to phone
                scope.launch {
                    try {
                        val phoneConnection = EstouBemWatchAppCompanion.phoneConnection
                        phoneConnection?.sendHealthData("heart_rate", bpm)
                    } catch (e: Exception) {
                        Log.e(TAG, "Failed to send heart rate to phone", e)
                    }
                }
            }
        }
    }

    private val spo2Callback = object : MeasureCallback {
        override fun onAvailabilityChanged(
            dataType: DeltaDataType<*, *>,
            availability: Availability
        ) {
            Log.d(TAG, "SpO2 availability: $availability")
        }

        override fun onDataReceived(data: DataPointContainer) {
            val spo2Points = data.getData(DataType.SPO2)
            spo2Points.lastOrNull()?.let { point ->
                val spo2 = point.value
                _bloodOxygen.value = spo2
                Log.d(TAG, "SpO2: $spo2%")

                scope.launch {
                    try {
                        val phoneConnection = EstouBemWatchAppCompanion.phoneConnection
                        phoneConnection?.sendHealthData("spo2", spo2)

                        // Alert if SpO2 drops below 90%
                        if (spo2 < 90.0) {
                            Log.w(TAG, "LOW SpO2 ALERT: $spo2%")
                            phoneConnection?.sendLowSpO2Alert(spo2)
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "Failed to send SpO2 to phone", e)
                    }
                }
            }
        }
    }

    private val passiveCallback = object : PassiveListenerCallback {
        override fun onNewDataPointsReceived(dataPoints: DataPointContainer) {
            // Process steps
            val stepsPoints = dataPoints.getData(DataType.STEPS_DAILY)
            stepsPoints.lastOrNull()?.let { point ->
                _steps.value = point.value.toInt()
                Log.d(TAG, "Steps: ${point.value}")
            }
        }
    }

    /**
     * Start monitoring all health metrics.
     */
    fun startMonitoring() {
        if (_isMonitoring.value) return
        _isMonitoring.value = true

        scope.launch {
            try {
                // Check capabilities first
                val capabilities = measureClient.getCapabilitiesAsync().await()

                // Register heart rate if supported
                if (DataType.HEART_RATE_BPM in capabilities.supportedDataTypesMeasure) {
                    measureClient.registerMeasureCallback(
                        DataType.HEART_RATE_BPM,
                        executor,
                        heartRateCallback
                    )
                    Log.d(TAG, "Heart rate monitoring started")
                } else {
                    Log.w(TAG, "Heart rate not supported on this device")
                }

                // Register SpO2 if supported
                if (DataType.SPO2 in capabilities.supportedDataTypesMeasure) {
                    measureClient.registerMeasureCallback(
                        DataType.SPO2,
                        executor,
                        spo2Callback
                    )
                    Log.d(TAG, "SpO2 monitoring started")
                } else {
                    Log.w(TAG, "SpO2 not supported on this device")
                }

                // Setup passive monitoring for steps
                val passiveConfig = PassiveListenerConfig.builder()
                    .setDataTypes(setOf(DataType.STEPS_DAILY))
                    .build()

                passiveClient.setPassiveListenerCallback(
                    passiveConfig,
                    executor,
                    passiveCallback
                )
                Log.d(TAG, "Passive step monitoring started")

            } catch (e: Exception) {
                Log.e(TAG, "Failed to start health monitoring", e)
                _isMonitoring.value = false
            }
        }
    }

    /**
     * Stop all health monitoring.
     */
    fun stopMonitoring() {
        scope.launch {
            try {
                measureClient.unregisterMeasureCallback(DataType.HEART_RATE_BPM, heartRateCallback)
                measureClient.unregisterMeasureCallback(DataType.SPO2, spo2Callback)
                passiveClient.clearPassiveListenerCallbackAsync().await()
                _isMonitoring.value = false
                Log.d(TAG, "Health monitoring stopped")
            } catch (e: Exception) {
                Log.e(TAG, "Error stopping health monitoring", e)
            }
        }
    }
}

/**
 * Companion object reference holder to allow services to communicate.
 * In production, use proper dependency injection (Hilt/Koin).
 */
object EstouBemWatchAppCompanion {
    var phoneConnection: PhoneConnectionService? = null
}
