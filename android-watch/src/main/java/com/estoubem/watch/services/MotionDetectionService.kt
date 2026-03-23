package com.estoubem.watch.services

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.util.Log
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlin.math.abs
import kotlin.math.sqrt

/**
 * Accelerometer-based movement detection service.
 * Monitors whether the elderly person is moving or still.
 * Used to postpone escalation when the person is active.
 *
 * Configuration (matching Apple Watch app):
 * - 0.15g movement threshold (tuned for gentle movements like walking)
 * - 30-second stillness timeout before marking "not moving"
 * - Reports to phone every 60 seconds via MessageClient
 */
class MotionDetectionService(private val context: Context) : SensorEventListener {

    companion object {
        private const val TAG = "MotionDetection"

        /** Movement threshold -- accelerations above this are considered "moving" */
        private const val MOVEMENT_THRESHOLD = 0.15

        /** Seconds of stillness before marking "not moving" */
        private const val STILLNESS_TIMEOUT_MS = 30_000L

        /** How often to report status to phone (milliseconds) */
        private const val REPORT_INTERVAL_MS = 60_000L

        /** Sample rate in microseconds (2 Hz -- battery friendly) */
        private const val SAMPLE_RATE_US = 500_000
    }

    private val sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private val accelerometer = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var reportJob: Job? = null

    // Published state
    private val _isMoving = MutableStateFlow(false)
    val isMoving: StateFlow<Boolean> = _isMoving.asStateFlow()

    private val _movementMagnitude = MutableStateFlow(0.0)
    val movementMagnitude: StateFlow<Double> = _movementMagnitude.asStateFlow()

    private val _isMonitoring = MutableStateFlow(false)
    val isMonitoring: StateFlow<Boolean> = _isMonitoring.asStateFlow()

    // Internal state
    private var lastMovementTime: Long = System.currentTimeMillis()

    /**
     * Start accelerometer monitoring for movement detection.
     */
    fun startMonitoring() {
        if (accelerometer == null) {
            Log.w(TAG, "Accelerometer not available")
            return
        }

        if (_isMonitoring.value) return

        sensorManager.registerListener(this, accelerometer, SAMPLE_RATE_US)
        _isMonitoring.value = true

        // Periodic report to phone
        reportJob = scope.launch {
            while (isActive) {
                delay(REPORT_INTERVAL_MS)
                try {
                    EstouBemWatchAppCompanion.phoneConnection?.sendMovementUpdate(
                        isMoving = _isMoving.value,
                        magnitude = _movementMagnitude.value
                    )
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to send movement update", e)
                }
            }
        }

        Log.d(TAG, "Motion detection started")
    }

    /**
     * Stop monitoring.
     */
    fun stopMonitoring() {
        sensorManager.unregisterListener(this)
        reportJob?.cancel()
        reportJob = null
        _isMonitoring.value = false
        Log.d(TAG, "Motion detection stopped")
    }

    override fun onSensorChanged(event: SensorEvent?) {
        if (event?.sensor?.type != Sensor.TYPE_ACCELEROMETER) return

        // Values are in m/s^2, convert to g-force
        val x = event.values[0] / SensorManager.GRAVITY_EARTH
        val y = event.values[1] / SensorManager.GRAVITY_EARTH
        val z = event.values[2] / SensorManager.GRAVITY_EARTH

        // Calculate magnitude deviation from gravity (~1g when stationary)
        val totalMagnitude = sqrt(x * x + y * y + z * z)
        val deviation = abs(totalMagnitude - 1.0)

        _movementMagnitude.value = deviation

        if (deviation > MOVEMENT_THRESHOLD) {
            // Movement detected
            lastMovementTime = System.currentTimeMillis()
            if (!_isMoving.value) {
                _isMoving.value = true
                // Immediately report movement (important for escalation postponement)
                scope.launch {
                    try {
                        EstouBemWatchAppCompanion.phoneConnection?.sendMovementUpdate(
                            isMoving = true,
                            magnitude = deviation
                        )
                    } catch (e: Exception) {
                        Log.e(TAG, "Failed to send immediate movement update", e)
                    }
                }
            }
        } else {
            // Check if stillness timeout has elapsed
            val timeSinceMovement = System.currentTimeMillis() - lastMovementTime
            if (timeSinceMovement > STILLNESS_TIMEOUT_MS && _isMoving.value) {
                _isMoving.value = false
                scope.launch {
                    try {
                        EstouBemWatchAppCompanion.phoneConnection?.sendMovementUpdate(
                            isMoving = false,
                            magnitude = deviation
                        )
                    } catch (e: Exception) {
                        Log.e(TAG, "Failed to send stillness update", e)
                    }
                }
            }
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {
        // Not needed
    }
}
