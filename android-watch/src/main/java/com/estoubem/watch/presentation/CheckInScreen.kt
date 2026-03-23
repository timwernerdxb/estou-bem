package com.estoubem.watch.presentation

import android.os.VibrationEffect
import android.os.Vibrator
import android.content.Context
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.ButtonDefaults
import androidx.wear.compose.material.Text
import com.estoubem.watch.services.HealthService
import com.estoubem.watch.services.FallDetectionService
import com.estoubem.watch.services.MotionDetectionService
import com.estoubem.watch.services.PhoneConnectionService
import com.estoubem.watch.theme.EstouBemColors
import kotlinx.coroutines.delay
import java.util.Calendar

/**
 * Main check-in screen matching the Apple Watch design.
 * Large green circular "Estou Bem" button with streak counter,
 * health vitals summary, and movement/fall detection status.
 */
@Composable
fun CheckInScreen(
    phoneConnection: PhoneConnectionService,
    motionService: MotionDetectionService,
    healthService: HealthService,
    fallDetectionService: FallDetectionService,
    onNavigateToHealth: () -> Unit,
    onNavigateToSOS: () -> Unit
) {
    val context = LocalContext.current
    val vibrator = remember { context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator }

    val streak by phoneConnection.streak.collectAsState()
    val elderName by phoneConnection.elderName.collectAsState()
    val nextCheckinTime by phoneConnection.nextCheckinTime.collectAsState()
    val heartRate by healthService.heartRate.collectAsState()
    val bloodOxygen by healthService.bloodOxygen.collectAsState()
    val isMoving by motionService.isMoving.collectAsState()
    val fallDetectionAvailable by fallDetectionService.isAvailable.collectAsState()

    var checkinConfirmed by remember { mutableStateOf(false) }
    var pulseScale by remember { mutableFloatStateOf(1f) }

    val animatedScale by animateFloatAsState(
        targetValue = pulseScale,
        animationSpec = tween(durationMillis = 600),
        label = "pulse"
    )

    // Reset check-in confirmation after 3 seconds
    LaunchedEffect(checkinConfirmed) {
        if (checkinConfirmed) {
            delay(3000)
            checkinConfirmed = false
            pulseScale = 1f
        }
    }

    val listState = rememberScalingLazyListState()

    ScalingLazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(EstouBemColors.houseDark),
        horizontalAlignment = Alignment.CenterHorizontally,
        state = listState
    ) {
        // Header: greeting + name
        item {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    text = getGreeting().uppercase(),
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Medium,
                    color = EstouBemColors.houseGold,
                    letterSpacing = 1.5.sp
                )
                elderName?.let { name ->
                    Text(
                        text = name,
                        fontSize = 16.sp,
                        fontFamily = FontFamily.Serif,
                        color = EstouBemColors.houseCream
                    )
                }
            }
        }

        // Main check-in button
        item {
            Spacer(modifier = Modifier.height(8.dp))
            Box(contentAlignment = Alignment.Center) {
                // Pulse ring
                if (checkinConfirmed) {
                    Box(
                        modifier = Modifier
                            .size(120.dp)
                            .scale(animatedScale)
                            .clip(CircleShape)
                            .background(EstouBemColors.houseGreen.copy(alpha = 0.3f))
                    )
                }

                Button(
                    onClick = {
                        if (!checkinConfirmed) {
                            checkinConfirmed = true
                            pulseScale = 1.3f
                            phoneConnection.sendCheckin()
                            vibrator.vibrate(
                                VibrationEffect.createOneShot(100, VibrationEffect.DEFAULT_AMPLITUDE)
                            )
                        }
                    },
                    modifier = Modifier.size(110.dp),
                    colors = ButtonDefaults.buttonColors(
                        backgroundColor = if (checkinConfirmed) EstouBemColors.houseGreen
                        else EstouBemColors.houseGreen
                    ),
                    shape = CircleShape
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            text = if (checkinConfirmed) "\u2713" else "\u270B",
                            fontSize = 28.sp,
                            color = Color.White
                        )
                        Text(
                            text = if (checkinConfirmed) "OK" else "ESTOU BEM",
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Medium,
                            color = Color.White.copy(alpha = 0.9f),
                            letterSpacing = 1.5.sp
                        )
                    }
                }
            }
        }

        // Status row: next check-in + streak
        item {
            Row(
                horizontalArrangement = Arrangement.spacedBy(16.dp),
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.padding(vertical = 8.dp)
            ) {
                nextCheckinTime?.let { time ->
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            text = "PROXIMO",
                            fontSize = 8.sp,
                            fontWeight = FontWeight.Medium,
                            color = EstouBemColors.houseWarm,
                            letterSpacing = 1.sp
                        )
                        Text(
                            text = time,
                            fontSize = 16.sp,
                            fontFamily = FontFamily.Serif,
                            color = EstouBemColors.houseCream
                        )
                    }
                }
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        text = "SEQUENCIA",
                        fontSize = 8.sp,
                        fontWeight = FontWeight.Medium,
                        color = EstouBemColors.houseWarm,
                        letterSpacing = 1.sp
                    )
                    Text(
                        text = "$streak",
                        fontSize = 16.sp,
                        fontFamily = FontFamily.Serif,
                        color = EstouBemColors.houseGold
                    )
                }
            }
        }

        // Health vitals card (compact)
        if (heartRate > 0 || bloodOxygen > 0.0) {
            item {
                Button(
                    onClick = onNavigateToHealth,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp),
                    colors = ButtonDefaults.buttonColors(
                        backgroundColor = Color.White.copy(alpha = 0.06f)
                    ),
                    shape = RoundedCornerShape(4.dp)
                ) {
                    Column(modifier = Modifier.padding(vertical = 4.dp)) {
                        if (heartRate > 0) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    text = "\u2764",
                                    fontSize = 12.sp,
                                    color = EstouBemColors.houseDanger
                                )
                                Spacer(modifier = Modifier.width(6.dp))
                                Text(
                                    text = "${heartRate.toInt()}",
                                    fontSize = 16.sp,
                                    fontFamily = FontFamily.Serif,
                                    color = EstouBemColors.houseCream
                                )
                                Spacer(modifier = Modifier.width(4.dp))
                                Text(
                                    text = "BPM",
                                    fontSize = 9.sp,
                                    fontWeight = FontWeight.Medium,
                                    color = EstouBemColors.houseWarm,
                                    letterSpacing = 1.sp
                                )
                            }
                        }
                        if (bloodOxygen > 0.0) {
                            Spacer(modifier = Modifier.height(4.dp))
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    text = "\uD83E\uDEC1",
                                    fontSize = 12.sp,
                                    color = spo2Color(bloodOxygen)
                                )
                                Spacer(modifier = Modifier.width(6.dp))
                                Text(
                                    text = "${bloodOxygen.toInt()}",
                                    fontSize = 16.sp,
                                    fontFamily = FontFamily.Serif,
                                    color = EstouBemColors.houseCream
                                )
                                Spacer(modifier = Modifier.width(4.dp))
                                Text(
                                    text = "% SpO2",
                                    fontSize = 9.sp,
                                    fontWeight = FontWeight.Medium,
                                    color = EstouBemColors.houseWarm,
                                    letterSpacing = 1.sp
                                )
                            }
                        }
                    }
                }
            }
        }

        // Movement indicator
        item {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 4.dp)
                    .background(
                        Color.White.copy(alpha = 0.04f),
                        RoundedCornerShape(4.dp)
                    )
                    .padding(horizontal = 12.dp, vertical = 8.dp)
            ) {
                Box(
                    modifier = Modifier
                        .size(8.dp)
                        .clip(CircleShape)
                        .background(
                            if (isMoving) EstouBemColors.houseGreen
                            else EstouBemColors.houseWarm.copy(alpha = 0.3f)
                        )
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = if (isMoving) "Movimento detectado" else "Em repouso",
                    fontSize = 11.sp,
                    color = EstouBemColors.houseWarm
                )
            }
        }

        // Fall detection status
        item {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 4.dp)
                    .background(
                        Color.White.copy(alpha = 0.04f),
                        RoundedCornerShape(4.dp)
                    )
                    .padding(horizontal = 12.dp, vertical = 8.dp)
            ) {
                Text(
                    text = "\uD83E\uDDD1\u200D\uD83E\uDDBD",
                    fontSize = 12.sp,
                    color = if (fallDetectionAvailable) EstouBemColors.houseGreen
                    else EstouBemColors.houseWarm.copy(alpha = 0.3f)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = if (fallDetectionAvailable) "Deteccao de queda ativa"
                    else "Deteccao indisponivel",
                    fontSize = 11.sp,
                    color = EstouBemColors.houseWarm,
                    modifier = Modifier.weight(1f)
                )
                Box(
                    modifier = Modifier
                        .size(6.dp)
                        .clip(CircleShape)
                        .background(
                            if (fallDetectionAvailable) EstouBemColors.houseGreen
                            else EstouBemColors.houseWarm.copy(alpha = 0.3f)
                        )
                )
            }
        }

        // SOS navigation
        item {
            Spacer(modifier = Modifier.height(8.dp))
            Button(
                onClick = onNavigateToSOS,
                modifier = Modifier.size(width = 100.dp, height = 36.dp),
                colors = ButtonDefaults.buttonColors(
                    backgroundColor = EstouBemColors.houseDanger.copy(alpha = 0.2f)
                ),
                shape = RoundedCornerShape(4.dp)
            ) {
                Text(
                    text = "SOS",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium,
                    color = EstouBemColors.houseDanger,
                    letterSpacing = 2.sp
                )
            }
        }
    }
}

/** Returns a Portuguese greeting based on time of day. */
private fun getGreeting(): String {
    val hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
    return when {
        hour < 12 -> "Bom dia"
        hour < 18 -> "Boa tarde"
        else -> "Boa noite"
    }
}

/** Returns SpO2 status color matching Apple Watch thresholds. */
fun spo2Color(value: Double): Color = when {
    value > 95.0 -> EstouBemColors.spo2Normal
    value >= 90.0 -> EstouBemColors.spo2Warning
    else -> EstouBemColors.spo2Critical
}

/** Returns SpO2 status label in Portuguese. */
fun spo2Label(value: Double): String = when {
    value > 95.0 -> "NORMAL"
    value >= 90.0 -> "BAIXO"
    else -> "CRITICO"
}
