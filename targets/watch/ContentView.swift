import SwiftUI

// MARK: - Color Theme (Soho House–inspired)
extension Color {
    static let houseGreen = Color(red: 45/255, green: 74/255, blue: 62/255)     // #2D4A3E
    static let houseCream = Color(red: 245/255, green: 240/255, blue: 235/255)   // #F5F0EB
    static let houseGold  = Color(red: 201/255, green: 169/255, blue: 110/255)   // #C9A96E
    static let houseDark  = Color(red: 26/255, green: 26/255, blue: 26/255)      // #1A1A1A
    static let houseWarm  = Color(red: 92/255, green: 85/255, blue: 73/255)      // #5C5549
    static let houseDanger = Color(red: 139/255, green: 58/255, blue: 58/255)    // #8B3A3A
}

// MARK: - Main Content View
struct ContentView: View {
    @EnvironmentObject var connectivity: WatchConnectivityManager
    @EnvironmentObject var motionManager: MotionDetectionManager
    @EnvironmentObject var healthManager: HealthManager

    @State private var checkinConfirmed = false
    @State private var showingPulse = false
    @State private var showStatusDetail = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    // Header
                    headerSection

                    // Main check-in button
                    checkinButton

                    // Status indicators
                    statusRow

                    // Health vitals (compact)
                    if healthManager.latestHeartRate > 0 {
                        healthCard
                    }

                    // Movement indicator
                    movementCard
                }
                .padding(.horizontal, 8)
                .padding(.bottom, 16)
            }
            .background(Color.houseDark)
            .navigationTitle("")
            .toolbar(.hidden, for: .navigationBar)
        }
    }

    // MARK: - Header
    private var headerSection: some View {
        VStack(spacing: 2) {
            Text(greeting)
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(.houseGold)
                .tracking(1.5)
                .textCase(.uppercase)

            if let name = connectivity.elderName {
                Text(name)
                    .font(.system(.title3, design: .serif))
                    .foregroundColor(.houseCream)
                    .fontWeight(.regular)
            }
        }
        .padding(.top, 4)
    }

    // MARK: - Check-in Button
    private var checkinButton: some View {
        Button(action: performCheckin) {
            ZStack {
                // Outer pulse ring
                if showingPulse {
                    Circle()
                        .stroke(Color.houseGreen.opacity(0.3), lineWidth: 2)
                        .scaleEffect(showingPulse ? 1.3 : 1.0)
                        .opacity(showingPulse ? 0 : 1)
                        .animation(
                            .easeOut(duration: 0.8),
                            value: showingPulse
                        )
                }

                // Main circle
                Circle()
                    .fill(
                        checkinConfirmed
                            ? Color.houseGreen
                            : (connectivity.hasPendingCheckin
                                ? Color.houseGold
                                : Color.houseGreen)
                    )
                    .shadow(color: Color.houseGreen.opacity(0.3), radius: 12, y: 4)

                // Content
                VStack(spacing: 4) {
                    if checkinConfirmed {
                        Image(systemName: "checkmark")
                            .font(.system(size: 28, weight: .light))
                            .foregroundColor(.white)
                    } else {
                        Image(systemName: "hand.raised.fill")
                            .font(.system(size: 24, weight: .light))
                            .foregroundColor(.white)
                    }

                    Text(checkinConfirmed ? "OK" : "ESTOU BEM")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundColor(.white.opacity(0.9))
                        .tracking(1.5)
                }
            }
        }
        .buttonStyle(.plain)
        .frame(width: 110, height: 110)
        .sensoryFeedback(.success, trigger: checkinConfirmed)
    }

    // MARK: - Status Row
    private var statusRow: some View {
        HStack(spacing: 12) {
            // Next check-in time
            if let nextTime = connectivity.nextCheckinTime {
                VStack(spacing: 2) {
                    Text("PROXIMO")
                        .font(.system(size: 8, weight: .medium))
                        .foregroundColor(Color.houseWarm)
                        .tracking(1)
                    Text(nextTime)
                        .font(.system(size: 16, design: .serif))
                        .foregroundColor(.houseCream)
                }
            }

            // Streak
            VStack(spacing: 2) {
                Text("SEQUENCIA")
                    .font(.system(size: 8, weight: .medium))
                    .foregroundColor(Color.houseWarm)
                    .tracking(1)
                Text("\(connectivity.streak)")
                    .font(.system(size: 16, design: .serif))
                    .foregroundColor(.houseGold)
            }
        }
    }

    // MARK: - Health Card
    private var healthCard: some View {
        HStack {
            Image(systemName: "heart.fill")
                .font(.system(size: 12))
                .foregroundColor(.houseDanger)

            Text("\(Int(healthManager.latestHeartRate))")
                .font(.system(size: 18, design: .serif))
                .foregroundColor(.houseCream)

            Text("BPM")
                .font(.system(size: 9, weight: .medium))
                .foregroundColor(Color.houseWarm)
                .tracking(1)

            Spacer()

            if healthManager.latestHeartRate > 100 {
                Text("ALTO")
                    .font(.system(size: 8, weight: .medium))
                    .foregroundColor(.houseDanger)
                    .tracking(1)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Color.houseDanger.opacity(0.15))
                    .cornerRadius(2)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Color.white.opacity(0.06))
        .cornerRadius(4)
    }

    // MARK: - Movement Card
    private var movementCard: some View {
        HStack {
            Circle()
                .fill(motionManager.isMoving ? Color.houseGreen : Color.houseWarm.opacity(0.3))
                .frame(width: 8, height: 8)

            Text(motionManager.isMoving ? "Movimento detectado" : "Em repouso")
                .font(.system(size: 11))
                .foregroundColor(Color.houseWarm)

            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color.white.opacity(0.04))
        .cornerRadius(4)
    }

    // MARK: - Helpers
    private var greeting: String {
        let hour = Calendar.current.component(.hour, from: Date())
        if hour < 12 { return "Bom dia" }
        if hour < 18 { return "Boa tarde" }
        return "Boa noite"
    }

    private func performCheckin() {
        guard !checkinConfirmed else { return }

        checkinConfirmed = true
        showingPulse = true

        // Send check-in to iPhone app
        connectivity.sendCheckin()

        // Reset after delay
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
            checkinConfirmed = false
            showingPulse = false
        }
    }
}

// MARK: - SOS View (accessible from long press or swipe)
struct SOSView: View {
    @EnvironmentObject var connectivity: WatchConnectivityManager
    @State private var sosActivated = false
    @State private var holdProgress: CGFloat = 0
    @State private var holdTimer: Timer?

    var body: some View {
        VStack(spacing: 12) {
            Text("EMERGENCIA")
                .font(.system(size: 10, weight: .medium))
                .foregroundColor(.houseDanger)
                .tracking(2)

            ZStack {
                Circle()
                    .stroke(Color.houseDanger.opacity(0.3), lineWidth: 3)

                Circle()
                    .trim(from: 0, to: holdProgress)
                    .stroke(Color.houseDanger, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .animation(.linear(duration: 0.1), value: holdProgress)

                Circle()
                    .fill(sosActivated ? Color.houseDanger : Color.houseDanger.opacity(0.8))

                VStack(spacing: 2) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 20))
                        .foregroundColor(.white)
                    Text("SOS")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundColor(.white)
                        .tracking(2)
                }
            }
            .frame(width: 90, height: 90)
            .gesture(
                LongPressGesture(minimumDuration: 3)
                    .onChanged { _ in startHold() }
                    .onEnded { _ in activateSOS() }
            )
            .simultaneousGesture(
                DragGesture(minimumDistance: 0)
                    .onEnded { _ in cancelHold() }
            )

            Text("Segure 3 segundos")
                .font(.system(size: 10))
                .foregroundColor(Color.houseWarm)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.houseDark)
    }

    private func startHold() {
        holdTimer?.invalidate()
        holdProgress = 0
        holdTimer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { _ in
            holdProgress += 0.05 / 3.0
            if holdProgress >= 1.0 {
                holdTimer?.invalidate()
            }
        }
    }

    private func cancelHold() {
        holdTimer?.invalidate()
        holdProgress = 0
    }

    private func activateSOS() {
        sosActivated = true
        holdTimer?.invalidate()
        holdProgress = 1.0
        connectivity.sendSOS()
        WKInterfaceDevice.current().play(.notification)
    }
}
