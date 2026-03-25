package com.estoubem.watch.presentation

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.VibrationEffect
import android.os.Vibrator
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import com.estoubem.watch.services.PhoneConnectionService

/**
 * Check-in screen: large button that sends check-in to phone.
 * Shows confirmation animation and streak from phone data.
 */
object CheckInScreen {

    fun build(context: Context, onSosLongPress: () -> Unit): View {
        val prefs = context.getSharedPreferences("estoubem_settings", Context.MODE_PRIVATE)
        val elderName = prefs.getString("elder_name", "") ?: ""
        val streak = prefs.getInt("streak", 0)

        val root = FrameLayout(context).apply {
            setBackgroundColor(Color.parseColor("#F5F0EB"))
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        }

        val container = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
            setPadding(16, 24, 16, 16)
        }

        // Greeting
        val greeting = TextView(context).apply {
            text = if (elderName.isNotBlank()) "Ola, $elderName" else "Estou Bem"
            setTextColor(Color.parseColor("#1A1A1A"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            gravity = Gravity.CENTER
        }
        container.addView(greeting)

        // Streak
        val streakText = TextView(context).apply {
            text = if (streak > 0) "$streak dias seguidos" else ""
            setTextColor(Color.parseColor("#C9A96E"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = (4 * context.resources.displayMetrics.density).toInt() }
        }
        container.addView(streakText)

        // Status text
        val statusText = TextView(context).apply {
            text = "Toque para confirmar"
            setTextColor(Color.parseColor("#9A9189"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = (8 * context.resources.displayMetrics.density).toInt() }
        }

        // Main check-in button
        val btnSize = (100 * context.resources.displayMetrics.density).toInt()
        val btnBg = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(Color.parseColor("#2D4A3E"))
        }
        val btnLabel = TextView(context).apply {
            text = "Estou\nBem"
            setTextColor(Color.parseColor("#C9A96E"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            gravity = Gravity.CENTER
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.CENTER
            )
        }

        var isCheckedIn = false

        val mainButton = FrameLayout(context).apply {
            layoutParams = LinearLayout.LayoutParams(btnSize, btnSize).apply {
                gravity = Gravity.CENTER
                topMargin = (12 * context.resources.displayMetrics.density).toInt()
            }
            background = btnBg
            isClickable = true

            setOnClickListener {
                if (!isCheckedIn) {
                    isCheckedIn = true

                    // Haptic feedback
                    val vibrator = context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
                    vibrator.vibrate(VibrationEffect.createOneShot(100, VibrationEffect.DEFAULT_AMPLITUDE))

                    // Visual confirmation
                    (background as GradientDrawable).setColor(Color.parseColor("#1E352B"))
                    btnLabel.text = "✓"
                    btnLabel.setTextSize(TypedValue.COMPLEX_UNIT_SP, 28f)
                    statusText.text = "Check-in confirmado!"
                    statusText.setTextColor(Color.parseColor("#2D4A3E"))

                    // Send check-in to phone
                    PhoneConnectionService.sendCheckin(context)

                    // Reset after 3 seconds
                    it.postDelayed({
                        isCheckedIn = false
                        (background as GradientDrawable).setColor(Color.parseColor("#2D4A3E"))
                        btnLabel.text = "Estou\nBem"
                        btnLabel.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
                        statusText.text = "Toque para confirmar"
                        statusText.setTextColor(Color.parseColor("#9A9189"))
                    }, 3000)
                }
            }

            // Long press for SOS
            setOnLongClickListener {
                val vibrator = context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
                vibrator.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 300, 100, 300), -1))
                PhoneConnectionService.sendSOS(context)
                statusText.text = "SOS enviado!"
                statusText.setTextColor(Color.parseColor("#D32F2F"))
                onSosLongPress()
                true
            }
        }

        mainButton.addView(btnLabel)
        container.addView(mainButton)
        container.addView(statusText)

        root.addView(container)

        // Listen for settings updates to refresh streak/name
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context, intent: Intent) {
                val updatedPrefs = ctx.getSharedPreferences("estoubem_settings", Context.MODE_PRIVATE)
                val name = updatedPrefs.getString("elder_name", "") ?: ""
                val s = updatedPrefs.getInt("streak", 0)
                greeting.text = if (name.isNotBlank()) "Ola, $name" else "Estou Bem"
                streakText.text = if (s > 0) "$s dias seguidos" else ""
            }
        }
        context.registerReceiver(
            receiver,
            IntentFilter(PhoneConnectionService.ACTION_SETTINGS_UPDATED),
            Context.RECEIVER_NOT_EXPORTED
        )

        return root
    }
}
