package com.estoubem.watch.presentation

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.Text
import com.estoubem.watch.services.HealthService
import com.estoubem.watch.theme.EstouBemColors

/**
 * Health vitals detail screen.
 * Displays heart rate, SpO2, steps, and sleep hours with color coding.
 * SpO2 color coding: green >95%, yellow 90-95%, red <90%.
 */
@Composable
fun HealthScreen(healthService: HealthService) {
    val heartRate by healthService.heartRate.collectAsState()
    val bloodOxygen by healthService.bloodOxygen.collectAsState()
    val steps by healthService.steps.collectAsState()
    val sleepHours by healthService.sleepHours.collectAsState()

    val listState = rememberScalingLazyListState()

    ScalingLazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(EstouBemColors.houseDark),
        horizontalAlignment = Alignment.CenterHorizontally,
        state = listState
    ) {
        // Title
        item {
            Text(
                text = "SAUDE",
                fontSize = 10.sp,
                fontWeight = FontWeight.Medium,
                color = EstouBemColors.houseGold,
                letterSpacing = 2.sp,
                modifier = Modifier.padding(bottom = 8.dp)
            )
        }

        // Heart Rate card
        item {
            HealthCard(
                icon = "\u2764\uFE0F",
                iconColor = EstouBemColors.houseDanger,
                value = if (heartRate > 0) "${heartRate.toInt()}" else "--",
                unit = "BPM",
                statusLabel = when {
                    heartRate <= 0 -> null
                    heartRate > 100 -> "ALTO"
                    heartRate < 50 -> "BAIXO"
                    else -> "NORMAL"
                },
                statusColor = when {
                    heartRate > 100 -> EstouBemColors.houseDanger
                    heartRate < 50 -> EstouBemColors.houseGold
                    else -> EstouBemColors.houseGreen
                }
            )
        }

        // SpO2 card
        item {
            HealthCard(
                icon = "\uD83E\uDEC1",
                iconColor = if (bloodOxygen > 0) spo2Color(bloodOxygen) else EstouBemColors.houseWarm,
                value = if (bloodOxygen > 0) "${bloodOxygen.toInt()}" else "--",
                unit = "% SpO2",
                statusLabel = if (bloodOxygen > 0) spo2Label(bloodOxygen) else null,
                statusColor = if (bloodOxygen > 0) spo2Color(bloodOxygen) else EstouBemColors.houseWarm
            )
        }

        // Steps card
        item {
            HealthCard(
                icon = "\uD83D\uDEB6",
                iconColor = EstouBemColors.houseGreen,
                value = if (steps > 0) "$steps" else "--",
                unit = "PASSOS",
                statusLabel = when {
                    steps <= 0 -> null
                    steps >= 5000 -> "BOM"
                    steps >= 2000 -> "POUCO"
                    else -> "ALERTA"
                },
                statusColor = when {
                    steps >= 5000 -> EstouBemColors.houseGreen
                    steps >= 2000 -> EstouBemColors.houseGold
                    else -> EstouBemColors.houseDanger
                }
            )
        }

        // Sleep card
        item {
            HealthCard(
                icon = "\uD83C\uDF19",
                iconColor = EstouBemColors.housePurple,
                value = if (sleepHours > 0) String.format("%.1f", sleepHours) else "--",
                unit = "HORAS",
                statusLabel = when {
                    sleepHours <= 0 -> null
                    sleepHours >= 7 -> "BOM"
                    sleepHours >= 5 -> "POUCO"
                    else -> "ALERTA"
                },
                statusColor = when {
                    sleepHours >= 7 -> EstouBemColors.houseGreen
                    sleepHours >= 5 -> EstouBemColors.houseGold
                    else -> EstouBemColors.houseDanger
                }
            )
        }
    }
}

/**
 * Reusable health metric card with icon, value, unit, and status badge.
 */
@Composable
private fun HealthCard(
    icon: String,
    iconColor: Color,
    value: String,
    unit: String,
    statusLabel: String?,
    statusColor: Color
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = 3.dp)
            .background(
                Color.White.copy(alpha = 0.06f),
                RoundedCornerShape(4.dp)
            )
            .padding(horizontal = 12.dp, vertical = 10.dp)
    ) {
        Text(
            text = icon,
            fontSize = 14.sp,
            color = iconColor
        )
        Spacer(modifier = Modifier.width(8.dp))
        Text(
            text = value,
            fontSize = 18.sp,
            fontFamily = FontFamily.Serif,
            color = EstouBemColors.houseCream
        )
        Spacer(modifier = Modifier.width(4.dp))
        Text(
            text = unit,
            fontSize = 9.sp,
            fontWeight = FontWeight.Medium,
            color = EstouBemColors.houseWarm,
            letterSpacing = 1.sp
        )
        Spacer(modifier = Modifier.weight(1f))
        statusLabel?.let { label ->
            Text(
                text = label,
                fontSize = 8.sp,
                fontWeight = FontWeight.Medium,
                color = statusColor,
                letterSpacing = 1.sp,
                modifier = Modifier
                    .background(
                        statusColor.copy(alpha = 0.15f),
                        RoundedCornerShape(2.dp)
                    )
                    .padding(horizontal = 6.dp, vertical = 2.dp)
            )
        }
    }
}
