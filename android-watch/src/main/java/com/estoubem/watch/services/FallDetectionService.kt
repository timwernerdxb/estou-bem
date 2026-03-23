package com.estoubem.watch.services

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.util.Log
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlin.math.abs
import kotlin.math.sqrt

/**
 * Fall detection service using accelerometer.
 * Detection algorithm: high-g impact (>3g) followed by sustained stillness (<0.2g deviation).
 *
 * Samsung Galaxy Watch 4+ has built-in fall detection via Health Services,
 * but we also implement accelerometer-based detection as a universal fallback
 * that works on all Wear OS devices.
 *
 * On fall detected:
 *  1. Vibrates watch
 *  2. Shows 30-second countdown (FallAlertScreen)
 *  3. If not cancelled, sends emergency alert to phone app
 */
class FallDetectionService(private val context: Context) : SensorEventListener {

    companion object {
        private const val TAG = "FallDetection"

        /** Accelerometer impact threshold (g-force) */
        private const val IMPACT_THRESHOLD = 3.0

        /** Stillness threshold after impact (deviation from 1g gravity) */
        private const val STILLNESS_THRESHOLD = 0.2

        /** Seconds of stillness after impact to confirm a fall */
        private const val STILLNESS_REQUIRED_SECONDS = 3.0

        /** Timeout for monitoring stillness after impact (seconds) */
        private const val IMPACT_TIMEOUT_SECONDS = 10.0

        /** Countdown duration in seconds */
        private const val COUNTDOWN_SECONDS = 30

        /** Sample rate in microseconds (20 Hz for impact detection) */
        private const val SAMPLE_RATE_US = 50_000
    }

    private val sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private val accelerometer = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)

    // Published state
    private val _fallDetected = MutableStateFlow(false)
    val fallDetected: StateFlow<Boolean> = _fallDetected.asStateFlow()

    private val _countdownSeconds = MutableStateFlow(COUNTDOWN_SECONDS)
    val countdownSeconds: StateFlow<Int> = _countdownSeconds.asStateFlow()

    private val _isAvailable = MutableStateFlow(false)
    val isAvailable: StateFlow<Boolean> = _isAvailable.asStateFlow()

    // Internal state
    private var impactDetectedTime: Long = 0
    private var isMonitoringForStillness = false
    private var stillnessStartTime: Long = 0
    private var isCountingDown = false

    /**
     * Start accelerometer-based fall detection.
     */
    fun startMonitoring() {
        if (accelerometer == null) {
            Log.w(TAG, "Accelerometer not available on this device")
            _isAvailable.value = false
            return
        }

        sensorManager.registerListener(
            this,
            accelerometer,
            SAMPLE_RATE_US
        )
        _isAvailable.value = true
        Log.d(TAG, "Fall detection monitoring started")
    }

    /**
     * Stop fall detection monitoring.
     */
    fun stopMonitoring() {
        sensorManager.unregisterListener(this)
        _isAvailable.value = false
        Log.d(TAG, "Fall detection monitoring stopped")
    }

    override fun onSensorChanged(event: SensorEvent?) {
        if (event?.sensor?.type != Sensor.TYPE_ACCELEROMETER) return
        if (isCountingDown) return // Don't process during countdown

        val x = event.values[0] / SensorManager.GRAVITY_EARTH
        val y = event.values[1] / SensorManager.GRAVITY_EARTH
        val z = event.values[2] / SensorManager.GRAVITY_EARTH
        val magnitude = sqrt(x * x + y * y + z * z)

        if (!isMonitoringForStillness) {
            // Phase 1: Detect high-g impact
            if (magnitude > IMPACT_THRESHOLD) {
                impactDetectedTime = System.currentTimeMillis()
                isMonitoringForStillness = true
                stillnessStartTime = 0
                Log.d(TAG, "High-g impact detected: ${String.format("%.2f", magnitude)}g")
            }
        } else {
            // Phase 2: After impact, check for sustained stillness
            val deviation = abs(magnitude - 1.0)
            val timeSinceImpact = (System.currentTimeMillis() - impactDetectedTime) / 1000.0

            if (deviation < STILLNESS_THRESHOLD) {
                // Person is still
                if (stillnessStartTime == 0L) {
                    stillnessStartTime = System.currentTimeMillis()
                }

                val stillnessDuration = (System.currentTimeMillis() - stillnessStartTime) / 1000.0
                if (stillnessDuration >= STILLNESS_REQUIRED_SECONDS) {
                    // Fall confirmed: high-g impact followed by sustained stillness
                    handleFallDetected()
                    isMonitoringForStillness = false
                    stillnessStartTime = 0
                }
            } else {
                // Person moved -- reset stillness timer but keep monitoring
                stillnessStartTime = 0
            }

            // Timeout: if >10s since impact with no confirmed fall, reset
            if (timeSinceImpact > IMPACT_TIMEOUT_SECONDS) {
                isMonitoringForStillness = false
                stillnessStartTime = 0
            }
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {
        // Not needed
    }

    /**
     * Handle confirmed fall detection.
     * Sets state that triggers FallAlertScreen via navigation.
     */
    private fun handleFallDetected() {
        if (isCountingDown) return // Prevent double-trigger

        Log.w(TAG, "FALL DETECTED - starting countdown")
        isCountingDown = true
        _fallDetected.value = true
        _countdownSeconds.value = COUNTDOWN_SECONDS
    }

    /**
     * Called by FallAlertScreen every second to decrement countdown.
     */
    fun tick() {
        val current = _countdownSeconds.value
        if (current > 0) {
            _countdownSeconds.value = current - 1
        }
    }

    /**
     * User cancels fall alert (they are OK).
     */
    fun cancelFallAlert() {
        Log.d(TAG, "Fall alert cancelled by user")
        isCountingDown = false
        _fallDetected.value = false
        _countdownSeconds.value = COUNTDOWN_SECONDS
    }

    /**
     * Reset state after alert has been sent.
     */
    fun resetAfterAlert() {
        isCountingDown = false
        _fallDetected.value = false
        _countdownSeconds.value = COUNTDOWN_SECONDS
    }
}
