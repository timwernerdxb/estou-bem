package com.estoubem.watch.services

import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.util.Log
import com.google.android.gms.wearable.DataClient
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.MessageClient
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import org.json.JSONObject

/**
 * Handles all communication between the watch and the phone app.
 *
 * - MessageClient  -> real-time, fire-and-forget (checkin, SOS, fall_alert)
 * - DataClient     -> guaranteed delivery   (health_data, settings sync)
 *
 * Also acts as a WearableListenerService to receive messages FROM the phone.
 */
class PhoneConnectionService : WearableListenerService() {

    companion object {
        private const val TAG = "PhoneConnection"

        // Message paths (real-time, fire-and-forget)
        const val PATH_CHECKIN       = "/checkin"
        const val PATH_SOS           = "/sos"
        const val PATH_FALL_ALERT    = "/fall_alert"
        const val PATH_FALL_CANCELLED = "/fall_cancelled"

        // Data paths (guaranteed delivery)
        const val PATH_HEALTH_DATA   = "/health_data"
        const val PATH_MOVEMENT      = "/movement"
        const val PATH_SETTINGS      = "/settings"

        // Broadcast actions sent within the watch app
        const val ACTION_SETTINGS_UPDATED = "com.estoubem.watch.SETTINGS_UPDATED"
        const val ACTION_PHONE_CONNECTED  = "com.estoubem.watch.PHONE_CONNECTED"

        private const val PREFS_NAME = "estoubem_settings"

        /** Send a real-time message to the connected phone node. */
        fun sendMessage(context: Context, path: String, data: String = "") {
            CoroutineScope(Dispatchers.IO + SupervisorJob()).launch {
                try {
                    val messageClient = Wearable.getMessageClient(context)
                    val nodeClient = Wearable.getNodeClient(context)
                    val nodes = nodeClient.connectedNodes.await()
                    if (nodes.isEmpty()) {
                        Log.w(TAG, "sendMessage($path): no connected phone nodes")
                        return@launch
                    }
                    for (node in nodes) {
                        messageClient.sendMessage(
                            node.id,
                            path,
                            data.toByteArray(Charsets.UTF_8)
                        ).await()
                        Log.d(TAG, "sendMessage($path) -> ${node.displayName}")
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "sendMessage($path) failed", e)
                }
            }
        }

        /** Put data into the DataLayer for guaranteed delivery. */
        fun sendData(context: Context, path: String, data: Map<String, Any>) {
            CoroutineScope(Dispatchers.IO + SupervisorJob()).launch {
                try {
                    val dataClient = Wearable.getDataClient(context)
                    val request = PutDataMapRequest.create(path).apply {
                        dataMap.apply {
                            for ((key, value) in data) {
                                when (value) {
                                    is String  -> putString(key, value)
                                    is Int     -> putInt(key, value)
                                    is Long    -> putLong(key, value)
                                    is Float   -> putFloat(key, value)
                                    is Double  -> putDouble(key, value)
                                    is Boolean -> putBoolean(key, value)
                                }
                            }
                            // Timestamp ensures unique data items even with same values
                            putLong("timestamp", System.currentTimeMillis())
                        }
                    }.asPutDataRequest().setUrgent()

                    dataClient.putDataItem(request).await()
                    Log.d(TAG, "sendData($path) success")
                } catch (e: Exception) {
                    Log.e(TAG, "sendData($path) failed", e)
                }
            }
        }

        // --- Convenience helpers used by other services ---

        fun sendCheckin(context: Context) {
            val json = JSONObject().apply {
                put("type", "checkin")
                put("timestamp", System.currentTimeMillis())
            }
            sendMessage(context, PATH_CHECKIN, json.toString())
        }

        fun sendSOS(context: Context) {
            val json = JSONObject().apply {
                put("type", "sos")
                put("timestamp", System.currentTimeMillis())
            }
            sendMessage(context, PATH_SOS, json.toString())
        }

        fun sendFallAlert(context: Context) {
            val json = JSONObject().apply {
                put("type", "fall_alert")
                put("timestamp", System.currentTimeMillis())
            }
            sendMessage(context, PATH_FALL_ALERT, json.toString())
        }

        fun sendFallCancelled(context: Context) {
            val json = JSONObject().apply {
                put("type", "fall_cancelled")
                put("timestamp", System.currentTimeMillis())
            }
            sendMessage(context, PATH_FALL_CANCELLED, json.toString())
        }

        fun sendHealthData(context: Context, heartRate: Float, spo2: Float, steps: Long) {
            val data = mapOf<String, Any>(
                "heart_rate" to heartRate,
                "spo2" to spo2,
                "steps" to steps,
                "measured_at" to System.currentTimeMillis()
            )
            sendData(context, PATH_HEALTH_DATA, data)
        }

        fun sendMovementData(context: Context, lastMovementAt: Long, isMoving: Boolean) {
            val data = mapOf<String, Any>(
                "last_movement_at" to lastMovementAt,
                "is_moving" to isMoving,
                "reported_at" to System.currentTimeMillis()
            )
            sendData(context, PATH_MOVEMENT, data)
        }
    }

    // ---- WearableListenerService callbacks ----

    override fun onMessageReceived(messageEvent: MessageEvent) {
        super.onMessageReceived(messageEvent)
        val path = messageEvent.path
        val payload = String(messageEvent.data, Charsets.UTF_8)
        Log.d(TAG, "onMessageReceived: $path -> $payload")

        when (path) {
            PATH_SETTINGS -> handleSettingsMessage(payload)
        }
    }

    override fun onDataChanged(dataEvents: DataEventBuffer) {
        super.onDataChanged(dataEvents)
        for (event in dataEvents) {
            if (event.type == DataEvent.TYPE_CHANGED) {
                val path = event.dataItem.uri.path ?: continue
                Log.d(TAG, "onDataChanged: $path")
                when (path) {
                    PATH_SETTINGS -> {
                        val dataMap = DataMapItem.fromDataItem(event.dataItem).dataMap
                        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                        prefs.edit().apply {
                            if (dataMap.containsKey("elder_name")) {
                                putString("elder_name", dataMap.getString("elder_name"))
                            }
                            if (dataMap.containsKey("checkin_interval_minutes")) {
                                putInt("checkin_interval_minutes", dataMap.getInt("checkin_interval_minutes"))
                            }
                            if (dataMap.containsKey("checkin_schedule")) {
                                putString("checkin_schedule", dataMap.getString("checkin_schedule"))
                            }
                            if (dataMap.containsKey("streak")) {
                                putInt("streak", dataMap.getInt("streak"))
                            }
                            apply()
                        }
                        // Broadcast so UI can refresh
                        sendBroadcast(Intent(ACTION_SETTINGS_UPDATED))
                    }
                }
            }
        }
    }

    private fun handleSettingsMessage(payload: String) {
        try {
            val json = JSONObject(payload)
            val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs.edit().apply {
                if (json.has("elder_name")) putString("elder_name", json.getString("elder_name"))
                if (json.has("checkin_interval_minutes")) putInt("checkin_interval_minutes", json.getInt("checkin_interval_minutes"))
                if (json.has("checkin_schedule")) putString("checkin_schedule", json.getString("checkin_schedule"))
                if (json.has("streak")) putInt("streak", json.getInt("streak"))
                apply()
            }
            sendBroadcast(Intent(ACTION_SETTINGS_UPDATED))
        } catch (e: Exception) {
            Log.e(TAG, "handleSettingsMessage failed", e)
        }
    }
}
