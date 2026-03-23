package com.estoubem.watch.presentation

import android.os.VibrationEffect
import android.os.Vibrator
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.ButtonDefaults
import androidx.wear.compose.material.Text
import com.estoubem.watch.services.FallDetectionService
import com.estoubem.watch.services.PhoneConnectionService
import com.estoubem.watch.theme.EstouBemColors
import kotlinx.coroutines.delay

/**
 * Fall alert screen with 30-second countdown.
 * Shows after fall detection triggers. User can press "Estou Bem" to cancel.
 * If countdown reaches zero, sends emergency alert to phone/caregivers.
 * Haptic pulses every 5 seconds during countdown.
 */
@Composable
fun FallAlertScreen(
    fallDetectionService: FallDetectionService,
    phoneConnection: PhoneConnectionService,
    onDismiss: () -> Unit
) {
    val context = LocalContext.current
    val vibrator = remember { context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator }

    val countdown by fallDetectionService.countdownSeconds.collectAsState()
    val fallDetected by fallDetectionService.fallDetected.collectAsState()

    // Countdown timer with haptic pulses
    LaunchedEffect(fallDetected) {
        if (fallDetected) {
            // Vibrate on detection
            vibrator.vibrate(
                VibrationEffect.createOneShot(500, VibrationEffect.DEFAULT_AMPLITUDE)
            )

            while (fallDetectionService.countdownSeconds.value > 0) {
                delay(1000)
                fallDetectionService.tick()

                // Haptic pulse every 5 seconds
                val current = fallDetectionService.countdownSeconds.value
                if (current > 0 && current % 5 == 0) {
                    vibrator.vibrate(
                        VibrationEffect.createOneShot(200, VibrationEffect.DEFAULT_AMPLITUDE)
                    )
                }

                // Countdown expired
                if (current <= 0) {
                    phoneConnection.sendFallAlert(
                        heartRate = 0.0 // Will be filled by health service
                    )
                    vibrator.vibrate(
                        VibrationEffect.createOneShot(1000, VibrationEffect.DEFAULT_AMPLITUDE)
                    )
                }
            }
        }
    }

    // Dismiss when fall is cancelled
    LaunchedEffect(fallDetected) {
        if (!fallDetected) {
            onDismiss()
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(EstouBemColors.houseDark.copy(alpha = 0.95f)),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
            modifier = Modifier.padding(16.dp)
        ) {
            // Warning icon
            Text(
                text = "\u26A0\uFE0F",
                fontSize = 28.sp,
                color = EstouBemColors.houseDanger
            )

            Text(
                text = "QUEDA DETECTADA",
                fontSize = 11.sp,
                fontWeight = FontWeight.Medium,
                color = EstouBemColors.houseDanger,
                letterSpacing = 2.sp
            )

            Spacer(modifier = Modifier.height(8.dp))

            // Countdown circle
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .size(70.dp)
                    .drawBehind {
                        // Background ring
                        drawArc(
                            color = EstouBemColors.houseDanger.copy(alpha = 0.3f),
                            startAngle = -90f,
                            sweepAngle = 360f,
                            useCenter = false,
                            style = Stroke(width = 8f, cap = StrokeCap.Round),
                            topLeft = Offset(4f, 4f),
                            size = Size(size.width - 8f, size.height - 8f)
                        )
                        // Progress ring (fills as countdown decreases)
                        val progress = countdown.toFloat() / 30f
                        drawArc(
                            color = EstouBemColors.houseDangerBright,
                            startAngle = -90f,
                            sweepAngle = progress * 360f,
                            useCenter = false,
                            style = Stroke(width = 8f, cap = StrokeCap.Round),
                            topLeft = Offset(4f, 4f),
                            size = Size(size.width - 8f, size.height - 8f)
                        )
                    }
            ) {
                Text(
                    text = "$countdown",
                    fontSize = 32.sp,
                    fontWeight = FontWeight.Light,
                    fontFamily = FontFamily.Serif,
                    color = EstouBemColors.houseCream
                )
            }

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = "Toque para cancelar\nse voce esta bem",
                fontSize = 10.sp,
                color = EstouBemColors.houseWarm,
                textAlign = TextAlign.Center,
                lineHeight = 14.sp
            )

            Spacer(modifier = Modifier.height(8.dp))

            // Cancel / "Estou Bem" button
            Button(
                onClick = {
                    fallDetectionService.cancelFallAlert()
                    phoneConnection.sendFallCancelled()
                    vibrator.vibrate(
                        VibrationEffect.createOneShot(100, VibrationEffect.DEFAULT_AMPLITUDE)
                    )
                },
                colors = ButtonDefaults.buttonColors(
                    backgroundColor = EstouBemColors.houseGreen
                ),
                shape = RoundedCornerShape(4.dp),
                modifier = Modifier.padding(horizontal = 16.dp)
            ) {
                Text(
                    text = "ESTOU BEM",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium,
                    color = Color.White,
                    letterSpacing = 1.5.sp
                )
            }
        }
    }
}
