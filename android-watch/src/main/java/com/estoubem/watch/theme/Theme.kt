package com.estoubem.watch.theme

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.Colors
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Typography

/**
 * Soho House-inspired color scheme for Wear OS.
 * Matches the Apple Watch app's visual identity.
 */
object EstouBemColors {
    val houseGreen = Color(0xFF2D4A3E)
    val houseGreenLight = Color(0xFF3D6454)
    val houseCream = Color(0xFFF5F0EB)
    val houseGold = Color(0xFFC9A96E)
    val houseDark = Color(0xFF1A1A1A)
    val houseWarm = Color(0xFF5C5549)
    val houseDanger = Color(0xFF8B3A3A)
    val houseDangerBright = Color(0xFFCC4444)
    val housePurple = Color(0xFF9C27B0)

    // SpO2 status colors
    val spo2Normal = houseGreen
    val spo2Warning = houseGold
    val spo2Critical = houseDanger
}

/**
 * Wear Compose Material color palette mapped to Soho House theme.
 */
private val WearColorPalette = Colors(
    primary = EstouBemColors.houseGreen,
    primaryVariant = EstouBemColors.houseGreenLight,
    secondary = EstouBemColors.houseGold,
    secondaryVariant = EstouBemColors.houseGold,
    background = EstouBemColors.houseDark,
    surface = Color(0xFF2A2A2A),
    error = EstouBemColors.houseDanger,
    onPrimary = EstouBemColors.houseCream,
    onSecondary = EstouBemColors.houseDark,
    onBackground = EstouBemColors.houseCream,
    onSurface = EstouBemColors.houseCream,
    onError = Color.White
)

/**
 * Typography with serif font for headings (matching Apple Watch design).
 */
private val WearTypography = Typography(
    display1 = TextStyle(
        fontFamily = FontFamily.Serif,
        fontWeight = FontWeight.Light,
        fontSize = 40.sp,
        color = EstouBemColors.houseCream
    ),
    display2 = TextStyle(
        fontFamily = FontFamily.Serif,
        fontWeight = FontWeight.Light,
        fontSize = 34.sp,
        color = EstouBemColors.houseCream
    ),
    display3 = TextStyle(
        fontFamily = FontFamily.Serif,
        fontWeight = FontWeight.Normal,
        fontSize = 28.sp,
        color = EstouBemColors.houseCream
    ),
    title1 = TextStyle(
        fontFamily = FontFamily.Serif,
        fontWeight = FontWeight.Normal,
        fontSize = 22.sp,
        color = EstouBemColors.houseCream
    ),
    title2 = TextStyle(
        fontFamily = FontFamily.Serif,
        fontWeight = FontWeight.Normal,
        fontSize = 18.sp,
        color = EstouBemColors.houseCream
    ),
    title3 = TextStyle(
        fontFamily = FontFamily.Serif,
        fontWeight = FontWeight.Normal,
        fontSize = 16.sp,
        color = EstouBemColors.houseCream
    ),
    body1 = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 14.sp,
        color = EstouBemColors.houseCream
    ),
    body2 = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 12.sp,
        color = EstouBemColors.houseWarm
    ),
    caption1 = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Medium,
        fontSize = 10.sp,
        letterSpacing = 1.5.sp,
        color = EstouBemColors.houseWarm
    ),
    caption2 = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Medium,
        fontSize = 8.sp,
        letterSpacing = 1.sp,
        color = EstouBemColors.houseWarm
    )
)

@Composable
fun EstouBemWatchTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colors = WearColorPalette,
        typography = WearTypography,
        content = content
    )
}
