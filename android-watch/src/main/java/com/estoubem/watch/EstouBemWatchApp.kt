package com.estoubem.watch

import android.Manifest
import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Bundle
import android.util.Log
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.View
import android.widget.FrameLayout
import android.os.Build
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.estoubem.watch.presentation.CheckInScreen
import com.estoubem.watch.presentation.FallAlertScreen
import com.estoubem.watch.presentation.HealthScreen
import com.estoubem.watch.services.FallDetectionService
import com.estoubem.watch.services.HealthService
import com.estoubem.watch.services.MotionDetectionService

/**
 * Main entry point for the Estou Bem watch app.
 *
 * - Requests permissions
 * - Starts all foreground services (Health, FallDetection, MotionDetection)
 * - Shows CheckInScreen by default, swipe left for HealthScreen
 * - Shows FallAlertScreen overlay when a fall is detected
 */
class MainActivity : Activity() {

    companion object {
        private const val TAG = "MainActivity"
        private const val PERMISSION_REQUEST_CODE = 100
    }

    private lateinit var rootContainer: FrameLayout
    private var currentScreen = 0 // 0 = checkin, 1 = health
    private var fallAlertShowing = false
    private lateinit var gestureDetector: GestureDetector

    // Receiver for fall detection broadcast
    private val fallReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                FallDetectionService.ACTION_FALL_DETECTED -> showFallAlert()
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        rootContainer = FrameLayout(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        }
        setContentView(rootContainer)

        // Set up swipe gesture for screen navigation
        gestureDetector = GestureDetector(this, object : GestureDetector.SimpleOnGestureListener() {
            override fun onFling(
                e1: MotionEvent?,
                e2: MotionEvent,
                velocityX: Float,
                velocityY: Float
            ): Boolean {
                if (fallAlertShowing) return false
                val diffX = (e2.x) - (e1?.x ?: 0f)
                if (kotlin.math.abs(diffX) > 100 && kotlin.math.abs(velocityX) > 200) {
                    if (diffX < 0 && currentScreen == 0) {
                        // Swipe left -> health screen
                        currentScreen = 1
                        showCurrentScreen()
                        return true
                    } else if (diffX > 0 && currentScreen == 1) {
                        // Swipe right -> checkin screen
                        currentScreen = 0
                        showCurrentScreen()
                        return true
                    }
                }
                return false
            }
        })

        // Request permissions then start services
        requestPermissionsIfNeeded()
    }

    override fun onStart() {
        super.onStart()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(
                fallReceiver,
                IntentFilter(FallDetectionService.ACTION_FALL_DETECTED),
                RECEIVER_NOT_EXPORTED
            )
        } else {
            registerReceiver(
                fallReceiver,
                IntentFilter(FallDetectionService.ACTION_FALL_DETECTED)
            )
        }
    }

    override fun onStop() {
        super.onStop()
        try {
            unregisterReceiver(fallReceiver)
        } catch (_: Exception) {}
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        gestureDetector.onTouchEvent(event)
        return super.onTouchEvent(event)
    }

    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        gestureDetector.onTouchEvent(event)
        return super.dispatchTouchEvent(event)
    }

    // ---- Permissions ----

    private fun requestPermissionsIfNeeded() {
        val needed = mutableListOf<String>()
        val perms = arrayOf(
            Manifest.permission.BODY_SENSORS,
            Manifest.permission.ACTIVITY_RECOGNITION
        )
        for (p in perms) {
            if (ContextCompat.checkSelfPermission(this, p) != PackageManager.PERMISSION_GRANTED) {
                needed.add(p)
            }
        }
        if (needed.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, needed.toTypedArray(), PERMISSION_REQUEST_CODE)
        } else {
            onPermissionsReady()
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == PERMISSION_REQUEST_CODE) {
            // Start services regardless -- they will handle missing permissions gracefully
            onPermissionsReady()
        }
    }

    private fun onPermissionsReady() {
        startAllServices()
        showCurrentScreen()
    }

    // ---- Service startup ----

    private fun startAllServices() {
        Log.d(TAG, "Starting all services...")

        // Start HealthService (foreground)
        val healthIntent = Intent(this, HealthService::class.java)
        startForegroundService(healthIntent)
        Log.d(TAG, "HealthService started")

        // Start FallDetectionService (foreground)
        val fallIntent = Intent(this, FallDetectionService::class.java)
        startForegroundService(fallIntent)
        Log.d(TAG, "FallDetectionService started")

        // Start MotionDetectionService (foreground)
        val motionIntent = Intent(this, MotionDetectionService::class.java)
        startForegroundService(motionIntent)
        Log.d(TAG, "MotionDetectionService started")

        // PhoneConnectionService is auto-started by the system as a WearableListenerService
        // No manual start needed -- it receives messages when the phone sends them
        Log.d(TAG, "PhoneConnectionService (WearableListenerService) will be started by system")
    }

    // ---- Screen management ----

    private fun showCurrentScreen() {
        rootContainer.removeAllViews()
        val screen = when (currentScreen) {
            0 -> CheckInScreen.build(this) { /* SOS long press callback */ }
            1 -> HealthScreen.build(this)
            else -> CheckInScreen.build(this) {}
        }
        rootContainer.addView(screen)
    }

    private fun showFallAlert() {
        if (fallAlertShowing) return
        fallAlertShowing = true
        rootContainer.removeAllViews()
        rootContainer.addView(FallAlertScreen.build(this) {
            // On dismiss
            fallAlertShowing = false
            showCurrentScreen()
        })
    }
}
