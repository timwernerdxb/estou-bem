import SwiftUI

@main
struct EstouBemWatchApp: App {
    @StateObject private var connectivity = WatchConnectivityManager.shared
    @StateObject private var motionManager = MotionDetectionManager()
    @StateObject private var healthManager = HealthManager()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(connectivity)
                .environmentObject(motionManager)
                .environmentObject(healthManager)
        }
    }
}
