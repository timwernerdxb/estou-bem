import SwiftUI

@main
struct EstouBemWatchApp: App {
    @StateObject private var connectivity = WatchConnectivityManager.shared
    @StateObject private var motionManager = MotionDetectionManager()
    @StateObject private var fallDetectionManager = FallDetectionManager()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(connectivity)
                .environmentObject(motionManager)
                .environmentObject(HealthManager.shared)
                .environmentObject(fallDetectionManager)
                .onAppear {
                    // Request HealthKit authorization after the app UI is ready
                    HealthManager.shared.requestAuthorization()
                }
        }
    }
}
