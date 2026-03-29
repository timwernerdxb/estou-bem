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
                    // Activate WatchConnectivity after UI is ready
                    connectivity.activateSession()
                    // DO NOT request HealthKit auth from the Watch app.
                    // The iPhone companion app (ExpoHealthkitModule) owns the permission dialog.
                    // HealthKit permissions granted on iPhone are automatically shared with the
                    // paired Watch extension — no second prompt needed.
                    healthManager.startDataReadingIfAuthorized()
                    // Defer motion & fall detection - CoreMotion crashes if started too early on watchOS
                    // Do NOT start automatically - let user enable from settings
                }
        }
    }
}
