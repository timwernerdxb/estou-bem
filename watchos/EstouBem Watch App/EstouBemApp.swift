import SwiftUI

@main
struct EstouBemWatchApp: App {
    @StateObject private var checkInManager = CheckInManager()
    @StateObject private var healthManager = HealthManager()
    @StateObject private var connectivityManager = WatchConnectivityManager()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(checkInManager)
                .environmentObject(healthManager)
                .environmentObject(connectivityManager)
        }
    }
}
