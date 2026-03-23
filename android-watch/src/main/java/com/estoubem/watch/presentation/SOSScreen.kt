package com.estoubem.watch.presentation

import android.os.VibrationEffect
import android.os.Vibrator
import android.content.Context
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.Text
import com.estoubem.watch.services.PhoneConnectionService
import com.estoubem.watch.theme.EstouBemColors
import kotlinx.coroutines.delay
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/**
 * SOS emergency screen with a red button requiring 3-second long press.
 * Displays a circular progress indicator during the hold.
 * On completion, sends SOS alert to phone app with haptic feedback.
 */
@Composable
fun SOSScreen(phoneConnection: PhoneConnectionService) {
    val context = LocalContext.current
    val vibrator = remember { context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator }
    val scope = rememberCoroutineScope()

    var holdProgress by remember { mutableFloatStateOf(0f) }
    var sosActivated by remember { mutableStateOf(false) }
    var holdJob by remember { mutableStateOf<Job?>(null) }

    val animatedProgress by animateFloatAsState(
        targetValue = holdProgress,
        animationSpec = tween(durationMillis = 100),
        label = "hold_progress"
    )

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(EstouBemColors.houseDark),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            // Title
            Text(
                text = "EMERGENCIA",
                fontSize = 10.sp,
                fontWeight = FontWeight.Medium,
                color = EstouBemColors.houseDanger,
                letterSpacing = 2.sp
            )

            Spacer(modifier = Modifier.height(12.dp))

            // SOS button with progress ring
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .size(100.dp)
                    .drawBehind {
                        // Background ring
                        drawArc(
                            color = EstouBemColors.houseDanger.copy(alpha = 0.3f),
                            startAngle = -90f,
                            sweepAngle = 360f,
                            useCenter = false,
                            style = Stroke(width = 6f, cap = StrokeCap.Round),
                            topLeft = Offset(3f, 3f),
                            size = Size(size.width - 6f, size.height - 6f)
                        )
                        // Progress ring
                        drawArc(
                            color = EstouBemColors.houseDangerBright,
                            startAngle = -90f,
                            sweepAngle = animatedProgress * 360f,
                            useCenter = false,
                            style = Stroke(width = 6f, cap = StrokeCap.Round),
                            topLeft = Offset(3f, 3f),
                            size = Size(size.width - 6f, size.height - 6f)
                        )
                    }
                    .pointerInput(sosActivated) {
                        if (!sosActivated) {
                            detectTapGestures(
                                onPress = {
                                    // Start hold timer
                                    holdJob = scope.launch {
                                        val totalMs = 3000L
                                        val stepMs = 50L
                                        var elapsed = 0L
                                        while (elapsed < totalMs) {
                                            delay(stepMs)
                                            elapsed += stepMs
                                            holdProgress = elapsed.toFloat() / totalMs.toFloat()
                                        }
                                        // Hold completed - activate SOS
                                        sosActivated = true
                                        holdProgress = 1f
                                        phoneConnection.sendSOS()
                                        vibrator.vibrate(
                                            VibrationEffect.createOneShot(
                                                500,
                                                VibrationEffect.DEFAULT_AMPLITUDE
                                            )
                                        )
                                    }

                                    // Wait for release
                                    val released = tryAwaitRelease()
                                    if (!sosActivated) {
                                        // Released before 3 seconds - cancel
                                        holdJob?.cancel()
                                        holdProgress = 0f
                                    }
                                }
                            )
                        }
                    }
            ) {
                // Inner filled circle
                Box(
                    modifier = Modifier
                        .size(80.dp)
                        .clip(CircleShape)
                        .background(
                            if (sosActivated) EstouBemColors.houseDanger
                            else EstouBemColors.houseDanger.copy(alpha = 0.8f)
                        ),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            text = "\u26A0\uFE0F",
                            fontSize = 20.sp,
                            color = Color.White
                        )
                        Text(
                            text = "SOS",
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Medium,
                            color = Color.White,
                            letterSpacing = 2.sp
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(12.dp))

            Text(
                text = if (sosActivated) "Alerta enviado!" else "Segure 3 segundos",
                fontSize = 10.sp,
                color = if (sosActivated) EstouBemColors.houseDanger else EstouBemColors.houseWarm,
                textAlign = TextAlign.Center
            )
        }
    }
}
