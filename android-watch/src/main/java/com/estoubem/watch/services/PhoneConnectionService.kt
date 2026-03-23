package com.estoubem.watch.services

import android.content.Context
import android.util.Log
import com.google.android.gms.wearable.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import org.json.JSONObject
import java.time.Instant
import java.time.format.DateTimeFormatter

/**
 * Manages communication between Watch and Phone app via Wearable Data Layer API.
 * Equivalent of Apple Watch WatchConnectivityManager.
 *
 * Uses:
 * - MessageClient: for real-time messages (check-in, SOS, fall alerts)
 * - DataClient: for synced data (settings, health data)
 *
 * Message paths:
 *   /estoubem/checkin        - Check-in confirmation
 *   /estoubem/sos            - SOS emergency alert
 *   /estoubem/fall_alert     - Fall detection alert
 *   /estoubem/fall_cancelled - Fall alert cancelled by user
 *   /estoubem/movement       - Movement status update
 *   /estoubem/health         - Health data update
 *   /estoubem/spo2_alert     - Low SpO2 alert
 *   /estoubem/settings       - Settings from phone (incoming)
 */
class PhoneConnectionService(private val context: Context) :
    MessageClient.OnMessageReceivedListener,
    DataClient.OnDataChangedListener {

    companion object {
        private const val TAG = "PhoneConnection"

        // Message paths
        private const val PATH_CHECKIN = "/estoubem/checkin"
        private const val PATH_SOS = "/estoubem/sos"
        private const val PATH_FALL_ALERT = "/estoubem/fall_alert"
        private const val PATH_FALL_CANCELLED = "/estoubem/fall_cancelled"
        private const val PATH_MOVEMENT = "/estoubem/movement"
        private const val PATH_HEALTH = "/estoubem/health"
        private const val PATH_SPO2_ALERT = "/estoubem/spo2_alert"
        private const val PATH_SETTINGS = "/estoubem/settings"
        private const val PATH_SYNC_REQUEST = "/estoubem/sync_request"
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val messageClient: MessageClient = Wearable.getMessageClient(context)
    private val dataClient: DataClient = Wearable.getDataClient(context)
    private val nodeClient: NodeClient = Wearable.getNodeClient(context)

    // Published state (synced from phone)
    private val _elderName = MutableStateFlow<String?>(null)
    val elderName: StateFlow<String?> = _elderName.asStateFlow()

    private val _nextCheckinTime = MutableStateFlow<String?>(null)
    val nextCheckinTime: StateFlow<String?> = _nextCheckinTime.asStateFlow()

    private val _hasPendingCheckin = MutableStateFlow(false)
    val hasPendingCheckin: StateFlow<Boolean> = _hasPendingCheckin.asStateFlow()

    private val _streak = MutableStateFlow(0)
    val streak: StateFlow<Int> = _streak.asStateFlow()

    private val _isPhoneReachable = MutableStateFlow(false)
    val isPhoneReachable: StateFlow<Boolean> = _isPhoneReachable.asStateFlow()

    init {
        messageClient.addListener(this)
        dataClient.addListener(this)

        // Register companion reference for inter-service communication
        EstouBemWatchAppCompanion.phoneConnection = this

        // Request initial sync
        requestSync()
    }

    // ---------------------------------------------------------------
    // Outgoing messages (Watch -> Phone)
    // ---------------------------------------------------------------

    /**
     * Send check-in confirmation to phone app.
     */
    fun sendCheckin() {
        val json = JSONObject().apply {
            put("type", "checkin_confirmed")
            put("timestamp", currentTimestamp())
        }
        sendMessageToPhone(PATH_CHECKIN, json)
        Log.d(TAG, "Check-in sent")
    }

    /**
     * Send SOS emergency alert to phone app.
     * Critical: sent via both message and data for guaranteed delivery.
     */
    fun sendSOS() {
        val json = JSONObject().apply {
            put("type", "sos_activated")
            put("timestamp", currentTimestamp())
        }
        sendMessageToPhone(PATH_SOS, json)
        // Also write to DataItem for guaranteed delivery
        putDataItem(PATH_SOS, json)
        Log.w(TAG, "SOS ALERT SENT")
    }

    /**
     * Send fall detection alert to phone app.
     * Critical: sent via both message and data for guaranteed delivery.
     */
    fun sendFallAlert(heartRate: Double) {
        val json = JSONObject().apply {
            put("type", "fall_detected")
            put("timestamp", currentTimestamp())
            put("heartRate", heartRate)
        }
        sendMessageToPhone(PATH_FALL_ALERT, json)
        putDataItem(PATH_FALL_ALERT, json)
        Log.w(TAG, "FALL ALERT SENT")
    }

    /**
     * Send fall cancellation to phone (false alarm).
     */
    fun sendFallCancelled() {
        val json = JSONObject().apply {
            put("type", "fall_cancelled")
            put("timestamp", currentTimestamp())
        }
        sendMessageToPhone(PATH_FALL_CANCELLED, json)
        Log.d(TAG, "Fall cancelled sent")
    }

    /**
     * Send movement status update to phone.
     */
    fun sendMovementUpdate(isMoving: Boolean, magnitude: Double) {
        val json = JSONObject().apply {
            put("type", "movement_update")
            put("isMoving", isMoving)
            put("magnitude", magnitude)
            put("timestamp", currentTimestamp())
        }
        // Use DataItem -- only latest value matters
        putDataItem(PATH_MOVEMENT, json)
    }

    /**
     * Send health data update to phone.
     */
    fun sendHealthData(type: String, value: Double) {
        val json = JSONObject().apply {
            put("type", "health_update")
            put("metric", type)
            put("value", value)
            put("timestamp", currentTimestamp())
        }
        putDataItem(PATH_HEALTH, json)
    }

    /**
     * Send low SpO2 alert to phone.
     */
    fun sendLowSpO2Alert(spo2: Double) {
        val json = JSONObject().apply {
            put("type", "low_spo2_alert")
            put("spo2", spo2)
            put("timestamp", currentTimestamp())
        }
        sendMessageToPhone(PATH_SPO2_ALERT, json)
        putDataItem(PATH_SPO2_ALERT, json)
        Log.w(TAG, "LOW SPO2 ALERT: $spo2%")
    }

    /**
     * Request settings sync from phone app.
     */
    fun requestSync() {
        val json = JSONObject().apply {
            put("type", "request_sync")
        }
        sendMessageToPhone(PATH_SYNC_REQUEST, json)
    }

    // ---------------------------------------------------------------
    // Incoming messages (Phone -> Watch)
    // ---------------------------------------------------------------

    override fun onMessageReceived(messageEvent: MessageEvent) {
        val path = messageEvent.path
        val data = String(messageEvent.data, Charsets.UTF_8)
        Log.d(TAG, "Message received: $path")

        try {
            val json = JSONObject(data)
            handleIncomingMessage(path, json)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse incoming message", e)
        }
    }

    override fun onDataChanged(dataEvents: DataEventBuffer) {
        dataEvents.forEach { event ->
            if (event.type == DataEvent.TYPE_CHANGED) {
                val path = event.dataItem.uri.path ?: return@forEach
                if (path == PATH_SETTINGS) {
                    try {
                        val dataMap = DataMapItem.fromDataItem(event.dataItem).dataMap
                        processSettings(dataMap)
                    } catch (e: Exception) {
                        Log.e(TAG, "Failed to process settings data", e)
                    }
                }
            }
        }
    }

    private fun handleIncomingMessage(path: String, json: JSONObject) {
        when (json.optString("type", "")) {
            "checkin_reminder" -> {
                _hasPendingCheckin.value = true
                Log.d(TAG, "Check-in reminder received")
            }
            "settings_update" -> {
                processSettingsJson(json)
            }
            "escalation_started" -> {
                _hasPendingCheckin.value = true
                Log.d(TAG, "Escalation started")
            }
            "escalation_resolved" -> {
                _hasPendingCheckin.value = false
                Log.d(TAG, "Escalation resolved")
            }
            else -> {
                processSettingsJson(json)
            }
        }
    }

    private fun processSettings(dataMap: DataMap) {
        if (dataMap.containsKey("elderName")) {
            _elderName.value = dataMap.getString("elderName")
        }
        if (dataMap.containsKey("nextCheckinTime")) {
            _nextCheckinTime.value = dataMap.getString("nextCheckinTime")
        }
        if (dataMap.containsKey("hasPendingCheckin")) {
            _hasPendingCheckin.value = dataMap.getBoolean("hasPendingCheckin")
        }
        if (dataMap.containsKey("streak")) {
            _streak.value = dataMap.getInt("streak")
        }
    }

    private fun processSettingsJson(json: JSONObject) {
        if (json.has("elderName")) _elderName.value = json.getString("elderName")
        if (json.has("nextCheckinTime")) _nextCheckinTime.value = json.getString("nextCheckinTime")
        if (json.has("hasPendingCheckin")) _hasPendingCheckin.value = json.getBoolean("hasPendingCheckin")
        if (json.has("streak")) _streak.value = json.getInt("streak")
    }

    // ---------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------

    /**
     * Send a message to the connected phone node.
     */
    private fun sendMessageToPhone(path: String, json: JSONObject) {
        scope.launch {
            try {
                val nodes = nodeClient.connectedNodes.await()
                val phoneNode = nodes.firstOrNull()

                if (phoneNode != null) {
                    messageClient.sendMessage(
                        phoneNode.id,
                        path,
                        json.toString().toByteArray(Charsets.UTF_8)
                    ).await()
                    _isPhoneReachable.value = true
                    Log.d(TAG, "Message sent to phone: $path")
                } else {
                    _isPhoneReachable.value = false
                    Log.w(TAG, "No phone node connected, message queued: $path")
                    // Fall back to DataItem for guaranteed delivery
                    putDataItem(path, json)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to send message: $path", e)
                _isPhoneReachable.value = false
            }
        }
    }

    /**
     * Write data to the Wearable Data Layer for guaranteed sync.
     */
    private fun putDataItem(path: String, json: JSONObject) {
        scope.launch {
            try {
                val request = PutDataMapRequest.create(path).apply {
                    dataMap.putString("payload", json.toString())
                    dataMap.putLong("timestamp", System.currentTimeMillis())
                }.asPutDataRequest().setUrgent()

                dataClient.putDataItem(request).await()
                Log.d(TAG, "DataItem written: $path")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to write DataItem: $path", e)
            }
        }
    }

    private fun currentTimestamp(): String {
        return DateTimeFormatter.ISO_INSTANT.format(Instant.now())
    }

    /**
     * Cleanup listeners.
     */
    fun destroy() {
        messageClient.removeListener(this)
        dataClient.removeListener(this)
        EstouBemWatchAppCompanion.phoneConnection = null
    }
}
