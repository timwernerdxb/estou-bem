import SwiftUI

struct ContentView: View {
    @EnvironmentObject var checkInManager: CheckInManager
    @EnvironmentObject var healthManager: HealthManager

    var body: some View {
        TabView {
            CheckInView()
            StatusView()
            SOSView()
        }
        .tabViewStyle(.verticalPage)
        .onAppear {
            healthManager.requestAuthorization()
            healthManager.startWorkout()
        }
    }
}

// ─── Main Check-in View ──────────────────────────────────
struct CheckInView: View {
    @EnvironmentObject var checkInManager: CheckInManager
    @EnvironmentObject var healthManager: HealthManager
    @State private var isPressed = false
    @State private var showConfirmed = false

    var body: some View {
        VStack(spacing: 8) {
            if checkInManager.hasPendingCheckIn {
                Text("Check-in pendente")
                    .font(.caption2)
                    .foregroundColor(.orange)
            }

            // Big check-in button — the entire screen is basically a button
            Button(action: performCheckIn) {
                ZStack {
                    Circle()
                        .fill(buttonColor)
                        .shadow(color: buttonColor.opacity(0.4), radius: 8)

                    VStack(spacing: 4) {
                        Image(systemName: showConfirmed ? "checkmark.circle.fill" : "hand.raised.fill")
                            .font(.system(size: 36))
                            .foregroundColor(.white)

                        Text(showConfirmed ? "OK! ✅" : "ESTOU\nBEM")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundColor(.white)
                            .multilineTextAlignment(.center)
                    }
                }
            }
            .buttonStyle(.plain)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .scaleEffect(isPressed ? 0.92 : 1.0)
            .animation(.spring(response: 0.3), value: isPressed)

            // Heart rate if available
            if let hr = healthManager.currentHeartRate {
                HStack(spacing: 4) {
                    Image(systemName: "heart.fill")
                        .font(.caption2)
                        .foregroundColor(.red)
                    Text("\(Int(hr)) bpm")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }
        }
        .padding(.horizontal, 4)
    }

    private var buttonColor: Color {
        if showConfirmed { return Color(red: 0.22, green: 0.56, blue: 0.24) } // Dark green
        if checkInManager.hasPendingCheckIn { return .orange }
        return .green
    }

    private func performCheckIn() {
        isPressed = true
        WKInterfaceDevice.current().play(.success)

        // Gather sensor context
        let context = SensorContext(
            heartRate: healthManager.currentHeartRate,
            heartRateTimestamp: healthManager.lastHeartRateTime,
            isMoving: healthManager.isActivelyMoving
        )

        checkInManager.confirmCheckIn(sensorContext: context)
        showConfirmed = true

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            isPressed = false
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
            showConfirmed = false
        }
    }
}

// ─── Status View ─────────────────────────────────────────
struct StatusView: View {
    @EnvironmentObject var checkInManager: CheckInManager
    @EnvironmentObject var healthManager: HealthManager

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Text("Status")
                    .font(.headline)

                // Today's check-ins
                HStack {
                    Image(systemName: "checkmark.circle")
                        .foregroundColor(.green)
                    Text("Hoje: \(checkInManager.confirmedToday)/\(checkInManager.totalToday)")
                        .font(.caption)
                }

                // Heart rate
                if let hr = healthManager.currentHeartRate {
                    HStack {
                        Image(systemName: "heart.fill")
                            .foregroundColor(.red)
                        Text("\(Int(hr)) bpm")
                            .font(.caption)
                    }
                }

                // Movement
                HStack {
                    Image(systemName: "figure.walk")
                        .foregroundColor(.blue)
                    Text(healthManager.isActivelyMoving ? "Em movimento" : "Parado")
                        .font(.caption)
                }

                // Fall detection
                HStack {
                    Image(systemName: "exclamationmark.triangle")
                        .foregroundColor(healthManager.fallDetected ? .red : .gray)
                    Text(healthManager.fallDetected ? "Queda detectada!" : "Sem quedas")
                        .font(.caption)
                        .foregroundColor(healthManager.fallDetected ? .red : .secondary)
                }

                // Next check-in
                if let next = checkInManager.nextCheckInTime {
                    HStack {
                        Image(systemName: "alarm")
                            .foregroundColor(.orange)
                        Text("Próximo: \(next)")
                            .font(.caption)
                    }
                }
            }
            .padding(.horizontal, 8)
        }
    }
}

// ─── SOS View ────────────────────────────────────────────
struct SOSView: View {
    @State private var sosActivated = false
    @State private var holdProgress: CGFloat = 0
    @State private var holdTimer: Timer?

    var body: some View {
        VStack(spacing: 8) {
            Text("EMERGÊNCIA")
                .font(.caption)
                .foregroundColor(.red)

            Button(action: {}) {
                ZStack {
                    Circle()
                        .fill(sosActivated ? Color(red: 0.72, green: 0.11, blue: 0.11) : .red)

                    // Progress ring
                    Circle()
                        .trim(from: 0, to: holdProgress)
                        .stroke(Color.white, lineWidth: 3)
                        .rotationEffect(.degrees(-90))
                        .padding(4)

                    VStack(spacing: 2) {
                        Image(systemName: "sos")
                            .font(.system(size: 24, weight: .bold))
                            .foregroundColor(.white)
                        Text(sosActivated ? "ATIVADO" : "SOS")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundColor(.white)
                    }
                }
            }
            .buttonStyle(.plain)
            .frame(width: 100, height: 100)
            .simultaneousGesture(
                LongPressGesture(minimumDuration: 3.0)
                    .onChanged { _ in startHold() }
                    .onEnded { _ in activateSOS() }
            )

            Text(sosActivated ? "Socorro a caminho" : "Segure 3s")
                .font(.caption2)
                .foregroundColor(.secondary)
        }
    }

    private func startHold() {
        holdTimer?.invalidate()
        holdProgress = 0
        holdTimer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { _ in
            holdProgress += 0.05 / 3.0 // 3 seconds
            if holdProgress >= 1.0 {
                holdTimer?.invalidate()
            }
        }
    }

    private func activateSOS() {
        holdTimer?.invalidate()
        holdProgress = 1.0
        sosActivated = true
        WKInterfaceDevice.current().play(.failure) // Strong haptic

        // Send SOS to phone app which handles WhatsApp + calls
        WatchConnectivityManager.shared.sendSOS()

        DispatchQueue.main.asyncAfter(deadline: .now() + 10) {
            sosActivated = false
            holdProgress = 0
        }
    }
}
