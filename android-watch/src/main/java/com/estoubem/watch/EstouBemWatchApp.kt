package com.estoubem.watch

import android.app.Activity
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.view.View
import android.widget.TextView
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.util.TypedValue
import android.content.Context

class MainActivity : Activity() {

    private var isCheckedIn = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildUI())
    }

    private fun buildUI(): View {
        val root = FrameLayout(this).apply {
            setBackgroundColor(Color.parseColor("#F5F0EB"))
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        }

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
            setPadding(16, 24, 16, 16)
        }

        val greeting = TextView(this).apply {
            text = "Estou Bem"
            setTextColor(Color.parseColor("#1A1A1A"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            gravity = Gravity.CENTER
        }
        container.addView(greeting)

        val btnSize = (100 * resources.displayMetrics.density).toInt()
        val btnBg = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(Color.parseColor("#2D4A3E"))
        }
        val statusText = TextView(this).apply {
            text = "Toque para confirmar"
            setTextColor(Color.parseColor("#9A9189"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = (8 * resources.displayMetrics.density).toInt() }
        }

        val mainButton = FrameLayout(this).apply {
            layoutParams = LinearLayout.LayoutParams(btnSize, btnSize).apply {
                gravity = Gravity.CENTER
                topMargin = (12 * resources.displayMetrics.density).toInt()
            }
            background = btnBg
            isClickable = true
            setOnClickListener {
                if (!isCheckedIn) {
                    isCheckedIn = true
                    val v = getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
                    v.vibrate(VibrationEffect.createOneShot(100, VibrationEffect.DEFAULT_AMPLITUDE))
                    (background as GradientDrawable).setColor(Color.parseColor("#1E352B"))
                    statusText.text = "✓ Check-in confirmado!"
                    statusText.setTextColor(Color.parseColor("#2D4A3E"))
                }
            }
        }
        val btnLabel = TextView(this).apply {
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
        mainButton.addView(btnLabel)
        container.addView(mainButton)
        container.addView(statusText)

        root.addView(container)
        return root
    }
}
