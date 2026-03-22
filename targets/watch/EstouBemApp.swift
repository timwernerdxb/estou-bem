import SwiftUI

@main
struct EstouBemWatchApp: App {
    @StateObject private var connectivity = WatchConnectivityManager.shared
    @StateObject private var motionManager = MotionDetectionManager()
    @StateObject private var healthManager = HealthManager()
    @StateObject private var fallDetectionManager = FallDetectionManager()

    init() {
        // Set shared reference so FallDetectionManager can access heart rate
        HealthManager.shared = healthManager
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(connectivity)
                .environmentObject(motionManager)
                .environmentObject(healthManager)
                .environmentObject(fallDetectionManager)
        }
    }
}
