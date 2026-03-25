package com.estoubem.watch.presentation

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.CountDownTimer
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import com.estoubem.watch.services.FallDetectionService

/**
 * Full-screen alert shown when a fall is detected.
 * 30-second countdown: user can tap "Estou Bem" to cancel the alert.
 * If not cancelled, the FallDetectionService sends a fall alert to the phone.
 */
object FallAlertScreen {

    fun build(context: Context, onDismiss: () -> Unit): View {
        val root = FrameLayout(context).apply {
            setBackgroundColor(Color.parseColor("#D32F2F"))
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
            setPadding(24, 24, 24, 24)
        }

        val titleText = TextView(context).apply {
            text = "Queda Detectada!"
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
        }
        container.addView(titleText)

        val countdownText = TextView(context).apply {
            text = "30"
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 36f)
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                topMargin = (12 * context.resources.displayMetrics.density).toInt()
                bottomMargin = (8 * context.resources.displayMetrics.density).toInt()
            }
        }
        container.addView(countdownText)

        val subtitleText = TextView(context).apply {
            text = "Alerta sera enviado"
            setTextColor(Color.parseColor("#FFCDD2"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
            gravity = Gravity.CENTER
        }
        container.addView(subtitleText)

        val cancelText = TextView(context).apply {
            text = "Toque: Estou Bem"
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                topMargin = (16 * context.resources.displayMetrics.density).toInt()
            }
        }
        container.addView(cancelText)

        // Countdown timer
        val timer = object : CountDownTimer(30_000, 1_000) {
            override fun onTick(millisUntilFinished: Long) {
                countdownText.text = "${millisUntilFinished / 1000}"
            }

            override fun onFinish() {
                countdownText.text = "0"
                subtitleText.text = "Alerta enviado!"
                cancelText.visibility = View.GONE
                // Auto-dismiss after 2 seconds
                root.postDelayed({ onDismiss() }, 2000)
            }
        }
        timer.start()

        // Tap to cancel
        root.setOnClickListener {
            timer.cancel()
            // Tell FallDetectionService to cancel
            val cancelIntent = Intent(context, FallDetectionService::class.java).apply {
                action = FallDetectionService.ACTION_FALL_CANCELLED
            }
            context.startService(cancelIntent)
            onDismiss()
        }

        root.addView(container)
        return root
    }
}
