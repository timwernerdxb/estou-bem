import SwiftUI
import WatchKit

@main
struct EstouBemWatchApp: App {
    // Use @StateObject with wrapper initializers to safely reference singletons.
    // Direct `@StateObject private var x = SomeClass.shared` can cause issues
    // if the singleton accesses other singletons during init before SwiftUI is ready.
    @StateObject private var connectivity = WatchConnectivityManager.shared
    @StateObject private var healthManager = HealthManager.shared
    @StateObject private var motionManager = MotionDetectionManager()
    @StateObject private var fallDetectionManager = FallDetectionManager()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(connectivity)
                .environmentObject(motionManager)
                .environmentObject(healthManager)
                .environmentObject(fallDetectionManager)
                .onAppear {
                    // Request HealthKit authorization after the app UI is ready
                    healthManager.requestAuthorization()
                    // Start motion monitoring after UI is ready
                    motionManager.startMonitoring()
                }
        }
    }
}
