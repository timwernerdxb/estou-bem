package com.estoubem.watch.presentation

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.graphics.Typeface
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import com.estoubem.watch.services.HealthService

/**
 * Health screen showing real-time data from HealthService:
 * - Heart rate (bpm)
 * - SpO2 (%)
 * - Steps
 *
 * Observes HealthService.PREFS_NAME SharedPreferences via broadcast.
 */
object HealthScreen {

    fun build(context: Context): View {
        val prefs = context.getSharedPreferences(HealthService.PREFS_NAME, Context.MODE_PRIVATE)

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
            setPadding(24, 20, 24, 20)
        }

        // Title
        val title = TextView(context).apply {
            text = "Saude"
            setTextColor(Color.parseColor("#1A1A1A"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = (12 * context.resources.displayMetrics.density).toInt()
            }
        }
        container.addView(title)

        // Heart rate row
        val hrValue = createMetricRow(context, container, "Batimentos", "--", "bpm")
        // SpO2 row
        val spo2Value = createMetricRow(context, container, "Oxigenio", "--", "%")
        // Steps row
        val stepsValue = createMetricRow(context, container, "Passos", "--", "")

        // Load initial values
        updateValues(prefs, hrValue, spo2Value, stepsValue)

        // Listen for updates
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context, intent: Intent) {
                val p = ctx.getSharedPreferences(HealthService.PREFS_NAME, Context.MODE_PRIVATE)
                updateValues(p, hrValue, spo2Value, stepsValue)
            }
        }
        context.registerReceiver(
            receiver,
            IntentFilter(HealthService.ACTION_HEALTH_UPDATED),
            Context.RECEIVER_NOT_EXPORTED
        )

        root.addView(container)
        return root
    }

    private fun createMetricRow(
        context: Context,
        parent: LinearLayout,
        label: String,
        initialValue: String,
        unit: String
    ): TextView {
        val density = context.resources.displayMetrics.density

        val row = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                topMargin = (6 * density).toInt()
                bottomMargin = (6 * density).toInt()
            }
        }

        val labelView = TextView(context).apply {
            text = label
            setTextColor(Color.parseColor("#6B6560"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        row.addView(labelView)

        val valueView = TextView(context).apply {
            text = initialValue
            setTextColor(Color.parseColor("#2D4A3E"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.END
        }
        row.addView(valueView)

        if (unit.isNotEmpty()) {
            val unitView = TextView(context).apply {
                text = " $unit"
                setTextColor(Color.parseColor("#9A9189"))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
                gravity = Gravity.END
            }
            row.addView(unitView)
        }

        parent.addView(row)
        return valueView
    }

    private fun updateValues(
        prefs: android.content.SharedPreferences,
        hrView: TextView,
        spo2View: TextView,
        stepsView: TextView
    ) {
        val hr = prefs.getFloat("heart_rate", 0f)
        val spo2 = prefs.getFloat("spo2", 0f)
        val steps = prefs.getFloat("steps", 0f)

        hrView.text = if (hr > 0) "${hr.toInt()}" else "--"
        spo2View.text = if (spo2 > 0) "${spo2.toInt()}" else "--"
        stepsView.text = if (steps > 0) "${steps.toLong()}" else "--"

        // Highlight low SpO2 in red
        if (spo2 > 0 && spo2 < 90) {
            spo2View.setTextColor(Color.parseColor("#D32F2F"))
        } else {
            spo2View.setTextColor(Color.parseColor("#2D4A3E"))
        }
    }
}
