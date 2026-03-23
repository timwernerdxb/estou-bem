package com.estoubem.watch

import android.app.Application
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.wear.compose.navigation.SwipeDismissableNavHost
import androidx.wear.compose.navigation.composable
import androidx.wear.compose.navigation.rememberSwipeDismissableNavController
import com.estoubem.watch.presentation.CheckInScreen
import com.estoubem.watch.presentation.FallAlertScreen
import com.estoubem.watch.presentation.HealthScreen
import com.estoubem.watch.presentation.SOSScreen
import com.estoubem.watch.services.FallDetectionService
import com.estoubem.watch.services.HealthService
import com.estoubem.watch.services.MotionDetectionService
import com.estoubem.watch.services.PhoneConnectionService
import com.estoubem.watch.theme.EstouBemWatchTheme

/**
 * Application class for Estou Bem Wear OS companion app.
 * Initializes services on startup.
 */
class EstouBemWatchApp : Application() {

    lateinit var phoneConnection: PhoneConnectionService
    lateinit var healthService: HealthService
    lateinit var fallDetectionService: FallDetectionService
    lateinit var motionDetectionService: MotionDetectionService

    override fun onCreate() {
        super.onCreate()
        instance = this
        phoneConnection = PhoneConnectionService(this)
        healthService = HealthService(this)
        fallDetectionService = FallDetectionService(this)
        motionDetectionService = MotionDetectionService(this)
    }

    companion object {
        lateinit var instance: EstouBemWatchApp
            private set
    }
}

/**
 * Main Activity hosting the Wear OS Compose navigation.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val app = application as EstouBemWatchApp

        // Start monitoring services
        app.healthService.startMonitoring()
        app.fallDetectionService.startMonitoring()
        app.motionDetectionService.startMonitoring()

        setContent {
            EstouBemWatchTheme {
                WearNavigation(app)
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        val app = application as EstouBemWatchApp
        app.motionDetectionService.stopMonitoring()
    }
}

/**
 * Navigation routes for the Wear OS app.
 */
object WearRoutes {
    const val CHECKIN = "checkin"
    const val HEALTH = "health"
    const val SOS = "sos"
    const val FALL_ALERT = "fall_alert"
}

/**
 * Main navigation composable with swipe-to-dismiss support.
 */
@Composable
fun WearNavigation(app: EstouBemWatchApp) {
    val navController = rememberSwipeDismissableNavController()

    val fallDetected by app.fallDetectionService.fallDetected.collectAsState()

    // Auto-navigate to fall alert when detected
    if (fallDetected) {
        navController.navigate(WearRoutes.FALL_ALERT) {
            launchSingleTop = true
        }
    }

    SwipeDismissableNavHost(
        navController = navController,
        startDestination = WearRoutes.CHECKIN
    ) {
        composable(WearRoutes.CHECKIN) {
            CheckInScreen(
                phoneConnection = app.phoneConnection,
                motionService = app.motionDetectionService,
                healthService = app.healthService,
                fallDetectionService = app.fallDetectionService,
                onNavigateToHealth = { navController.navigate(WearRoutes.HEALTH) },
                onNavigateToSOS = { navController.navigate(WearRoutes.SOS) }
            )
        }

        composable(WearRoutes.HEALTH) {
            HealthScreen(healthService = app.healthService)
        }

        composable(WearRoutes.SOS) {
            SOSScreen(phoneConnection = app.phoneConnection)
        }

        composable(WearRoutes.FALL_ALERT) {
            FallAlertScreen(
                fallDetectionService = app.fallDetectionService,
                phoneConnection = app.phoneConnection,
                onDismiss = { navController.popBackStack() }
            )
        }
    }
}
