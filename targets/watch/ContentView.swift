import SwiftUI

// MARK: - Color Theme (bright, readable on watchOS)
extension Color {
    static let brightGreen = Color(red: 76/255, green: 175/255, blue: 80/255)     // #4CAF50
    static let lighterGreen = Color(red: 102/255, green: 187/255, blue: 106/255)  // #66BB6A
    static let houseGold  = Color(red: 201/255, green: 169/255, blue: 110/255)    // #C9A96E
    static let cardBg     = Color(red: 28/255, green: 28/255, blue: 30/255)       // #1C1C1E (watchOS standard)
    static let houseDanger = Color(red: 139/255, green: 58/255, blue: 58/255)     // #8B3A3A
}

// MARK: - Check-in Cooldown Manager
struct CheckinCooldown {
    private static let lastCheckinKey = "lastCheckinTimestamp"
    static let cooldownInterval: TimeInterval = 3600 // 1 hour
    /// Tolerance window (minutes) around scheduled check-in times
    static let scheduleWindowMinutes: Int = 15

    static var lastCheckinDate: Date? {
        let ts = UserDefaults.standard.double(forKey: lastCheckinKey)
        return ts > 0 ? Date(timeIntervalSince1970: ts) : nil
    }

    static func recordCheckin() {
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: lastCheckinKey)
    }

    static func isInCooldown() -> Bool {
        guard let last = lastCheckinDate else { return false }
        return Date().timeIntervalSince(last) < cooldownInterval
    }

    static func nextAllowedDate() -> Date? {
        guard let last = lastCheckinDate else { return nil }
        return last.addingTimeInterval(cooldownInterval)
    }

    /// Returns true if now is within ±15 min of any scheduled check-in time.
    /// If no schedule exists, returns true (allow anytime, subject to cooldown).
    static func isWithinScheduledWindow(scheduledTimes: [String]) -> Bool {
        guard !scheduledTimes.isEmpty else { return true }

        let calendar = Calendar.current
        let now = Date()
        let todayComponents = calendar.dateComponents([.year, .month, .day], from: now)

        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"

        for timeStr in scheduledTimes {
            guard let parsed = formatter.date(from: timeStr) else { continue }
            let timeComponents = calendar.dateComponents([.hour, .minute], from: parsed)

            var scheduled = DateComponents()
            scheduled.year = todayComponents.year
            scheduled.month = todayComponents.month
            scheduled.day = todayComponents.day
            scheduled.hour = timeComponents.hour
            scheduled.minute = timeComponents.minute

            if let scheduledDate = calendar.date(from: scheduled) {
                let diff = abs(now.timeIntervalSince(scheduledDate))
                if diff <= Double(scheduleWindowMinutes * 60) {
                    return true
                }
            }
        }
        return false
    }

    /// Returns the next scheduled check-in time string (HH:mm) after now
    static func nextScheduledTime(scheduledTimes: [String]) -> String? {
        guard !scheduledTimes.isEmpty else { return nil }

        let calendar = Calendar.current
        let now = Date()
        let todayComponents = calendar.dateComponents([.year, .month, .day], from: now)

        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"

        var candidates: [(String, Date)] = []

        for timeStr in scheduledTimes {
            guard let parsed = formatter.date(from: timeStr) else { continue }
            let timeComponents = calendar.dateComponents([.hour, .minute], from: parsed)

            var scheduled = DateComponents()
            scheduled.year = todayComponents.year
            scheduled.month = todayComponents.month
            scheduled.day = todayComponents.day
            scheduled.hour = timeComponents.hour
            scheduled.minute = timeComponents.minute

            if let scheduledDate = calendar.date(from: scheduled), scheduledDate > now {
                candidates.append((timeStr, scheduledDate))
            }
        }

        candidates.sort { $0.1 < $1.1 }
        return candidates.first?.0
    }
}

// MARK: - Main Content View
struct ContentView: View {
    @EnvironmentObject var connectivity: WatchConnectivityManager
    @EnvironmentObject var motionManager: MotionDetectionManager
    @EnvironmentObject var healthManager: HealthManager
    @EnvironmentObject var fallDetection: FallDetectionManager

    @State private var checkinConfirmed = false
    @State private var showingPulse = false
    @State private var showStatusDetail = false
    @State private var lastCheckinTimeString: String? = nil

    /// Whether the button is disabled due to cooldown or schedule
    private var checkinDisabled: Bool {
        if checkinConfirmed { return true }
        if CheckinCooldown.isInCooldown() { return true }
        if !CheckinCooldown.isWithinScheduledWindow(scheduledTimes: connectivity.scheduledCheckinTimes) {
            return true
        }
        return false
    }

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 16) {
                    headerSection
                    checkinButton
                    statusRow

                    if healthManager.latestHeartRate > 0 || healthManager.bloodOxygen > 0 {
                        healthCard
                    }

                    if healthManager.sleepHours > 0 {
                        sleepCard
                    }

                    movementCard
                    fallDetectionStatusCard
                }
                .padding(.horizontal, 8)
                .padding(.bottom, 16)
            }
            .background(Color.black) // System default watchOS dark background
            .navigationTitle("")
            .navigationBarHidden(true)
            .overlay(
                Group {
                    if fallDetection.fallDetected {
                        fallAlertOverlay
                    }
                }
            )
        }
        .onAppear {
            // Restore last check-in display if in cooldown
            if let last = CheckinCooldown.lastCheckinDate, CheckinCooldown.isInCooldown() {
                let fmt = DateFormatter()
                fmt.dateFormat = "HH:mm"
                lastCheckinTimeString = fmt.string(from: last)
                checkinConfirmed = true
            }
            connectivity.loadPersistedSchedule()
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
                    .foregroundColor(.white)
                    .fontWeight(.regular)
            }
        }
        .padding(.top, 4)
    }

    // MARK: - Check-in Button
    private var checkinButton: some View {
        VStack(spacing: 6) {
            Button(action: performCheckin) {
                ZStack {
                    // Outer pulse ring
                    if showingPulse {
                        Circle()
                            .stroke(Color.brightGreen.opacity(0.4), lineWidth: 2)
                            .scaleEffect(showingPulse ? 1.3 : 1.0)
                            .opacity(showingPulse ? 0 : 1)
                            .animation(.easeOut(duration: 0.8), value: showingPulse)
                    }

                    // Main circle
                    Circle()
                        .fill(buttonColor)
                        .shadow(color: Color.brightGreen.opacity(0.4), radius: 12, y: 4)

                    // Content
                    VStack(spacing: 4) {
                        if checkinConfirmed {
                            Image(systemName: "checkmark")
                                .font(.system(size: 28, weight: .light))
                                .foregroundColor(.white)
                        } else if checkinDisabled {
                            Image(systemName: "clock.fill")
                                .font(.system(size: 24, weight: .light))
                                .foregroundColor(.white.opacity(0.6))
                        } else {
                            Image(systemName: "hand.raised.fill")
                                .font(.system(size: 24, weight: .light))
                                .foregroundColor(.white)
                        }

                        Text(buttonLabel)
                            .font(.system(size: checkinConfirmed ? 9 : 12, weight: .semibold))
                            .foregroundColor(.white)
                            .tracking(1.5)
                            .multilineTextAlignment(.center)
                    }
                }
            }
            .buttonStyle(.plain)
            .frame(width: 110, height: 110)
            .disabled(checkinDisabled)
            .opacity(checkinDisabled && !checkinConfirmed ? 0.5 : 1.0)

            // Status text below button
            if checkinConfirmed, let ts = lastCheckinTimeString {
                Text("Check-in confirmado \u{2713}")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundColor(.lighterGreen)
                Text("as \(ts)")
                    .font(.system(size: 9))
                    .foregroundColor(Color.gray)
            } else if !CheckinCooldown.isWithinScheduledWindow(scheduledTimes: connectivity.scheduledCheckinTimes),
                      let next = CheckinCooldown.nextScheduledTime(scheduledTimes: connectivity.scheduledCheckinTimes) {
                Text("Proximo check-in as \(next)")
                    .font(.system(size: 10))
                    .foregroundColor(Color.gray)
            } else if CheckinCooldown.isInCooldown(), let nextDate = CheckinCooldown.nextAllowedDate() {
                let fmt = { () -> String in
                    let f = DateFormatter(); f.dateFormat = "HH:mm"; return f.string(from: nextDate)
                }()
                Text("Proximo check-in as \(fmt)")
                    .font(.system(size: 10))
                    .foregroundColor(Color.gray)
            }
        }
    }

    private var buttonColor: Color {
        if checkinConfirmed {
            return .brightGreen
        } else if checkinDisabled {
            return Color(white: 0.25)
        } else if connectivity.hasPendingCheckin {
            return .houseGold
        } else {
            return .brightGreen
        }
    }

    private var buttonLabel: String {
        if checkinConfirmed {
            return "OK"
        } else if checkinDisabled {
            return "AGUARDE"
        } else {
            return "ESTOU BEM"
        }
    }

    // MARK: - Status Row
    private var statusRow: some View {
        HStack(spacing: 12) {
            if let nextTime = connectivity.nextCheckinTime {
                VStack(spacing: 2) {
                    Text("PROXIMO")
                        .font(.system(size: 8, weight: .medium))
                        .foregroundColor(Color.gray)
                        .tracking(1)
                    Text(nextTime)
                        .font(.system(size: 16, design: .serif))
                        .foregroundColor(.white)
                }
            }

            VStack(spacing: 2) {
                Text("SEQUENCIA")
                    .font(.system(size: 8, weight: .medium))
                    .foregroundColor(Color.gray)
                    .tracking(1)
                Text("\(connectivity.streak)")
                    .font(.system(size: 16, design: .serif))
                    .foregroundColor(.houseGold)
            }
        }
    }

    // MARK: - Health Card
    private var healthCard: some View {
        VStack(spacing: 8) {
            if healthManager.latestHeartRate > 0 {
                HStack {
                    Image(systemName: "heart.fill")
                        .font(.system(size: 12))
                        .foregroundColor(.red)

                    Text("\(Int(healthManager.latestHeartRate))")
                        .font(.system(size: 18, design: .serif))
                        .foregroundColor(.white)

                    Text("BPM")
                        .font(.system(size: 9, weight: .medium))
                        .foregroundColor(Color.gray)
                        .tracking(1)

                    Spacer()

                    if healthManager.latestHeartRate > 100 {
                        Text("ALTO")
                            .font(.system(size: 8, weight: .medium))
                            .foregroundColor(.houseDanger)
                            .tracking(1)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.houseDanger.opacity(0.2))
                            .cornerRadius(2)
                    }
                }
            }

            if healthManager.bloodOxygen > 0 {
                HStack {
                    Image(systemName: "lungs.fill")
                        .font(.system(size: 12))
                        .foregroundColor(spo2Color)

                    Text("\(Int(healthManager.bloodOxygen))")
                        .font(.system(size: 18, design: .serif))
                        .foregroundColor(.white)

                    Text("% SpO2")
                        .font(.system(size: 9, weight: .medium))
                        .foregroundColor(Color.gray)
                        .tracking(1)

                    Spacer()

                    Text(spo2Label)
                        .font(.system(size: 8, weight: .medium))
                        .foregroundColor(spo2Color)
                        .tracking(1)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(spo2Color.opacity(0.2))
                        .cornerRadius(2)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Color.cardBg)
        .cornerRadius(8)
    }

    // MARK: - SpO2 Helpers
    private var spo2Color: Color {
        if healthManager.bloodOxygen > 95 {
            return .brighterGreen
        } else if healthManager.bloodOxygen >= 90 {
            return .houseGold
        } else {
            return .houseDanger
        }
    }

    private var spo2Label: String {
        if healthManager.bloodOxygen > 95 {
            return "NORMAL"
        } else if healthManager.bloodOxygen >= 90 {
            return "BAIXO"
        } else {
            return "CRITICO"
        }
    }

    // MARK: - Sleep Card
    private var sleepCard: some View {
        HStack {
            Image(systemName: "moon.zzz.fill")
                .font(.system(size: 12))
                .foregroundColor(Color(red: 156/255, green: 39/255, blue: 176/255))

            Text(String(format: "%.1f", healthManager.sleepHours))
                .font(.system(size: 18, design: .serif))
                .foregroundColor(.white)

            Text("HORAS")
                .font(.system(size: 9, weight: .medium))
                .foregroundColor(Color.gray)
                .tracking(1)

            Spacer()

            Text(healthManager.sleepHours >= 7 ? "BOM" : healthManager.sleepHours >= 5 ? "POUCO" : "ALERTA")
                .font(.system(size: 8, weight: .medium))
                .foregroundColor(healthManager.sleepHours >= 7 ? .brighterGreen : healthManager.sleepHours >= 5 ? .houseGold : .houseDanger)
                .tracking(1)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background((healthManager.sleepHours >= 7 ? Color.brighterGreen : healthManager.sleepHours >= 5 ? Color.houseGold : Color.houseDanger).opacity(0.2))
                .cornerRadius(2)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color.cardBg)
        .cornerRadius(8)
    }

    // MARK: - Movement Card
    private var movementCard: some View {
        HStack {
            Circle()
                .fill(motionManager.isMoving ? Color.brighterGreen : Color.gray.opacity(0.3))
                .frame(width: 8, height: 8)

            Text(motionManager.isMoving ? "Movimento detectado" : "Em repouso")
                .font(.system(size: 11))
                .foregroundColor(Color(white: 0.7))

            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color.cardBg)
        .cornerRadius(8)
    }

    // MARK: - Fall Detection Status Card
    private var fallDetectionStatusCard: some View {
        HStack {
            Image(systemName: "figure.fall")
                .font(.system(size: 12))
                .foregroundColor(fallDetection.fallDetectionAvailable ? .brighterGreen : Color.gray.opacity(0.3))

            Text(fallDetection.fallDetectionAvailable ? "Deteccao de queda ativa" : "Deteccao indisponivel")
                .font(.system(size: 11))
                .foregroundColor(Color(white: 0.7))

            Spacer()

            Circle()
                .fill(fallDetection.fallDetectionAvailable ? Color.brighterGreen : Color.gray.opacity(0.3))
                .frame(width: 6, height: 6)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color.cardBg)
        .cornerRadius(8)
    }

    // MARK: - Fall Alert Overlay
    private var fallAlertOverlay: some View {
        ZStack {
            Color.black.opacity(0.95)
                .ignoresSafeArea()

            VStack(spacing: 12) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 28))
                    .foregroundColor(.houseDanger)

                Text("QUEDA DETECTADA")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(.houseDanger)
                    .tracking(2)

                ZStack {
                    Circle()
                        .stroke(Color.houseDanger.opacity(0.3), lineWidth: 4)

                    Circle()
                        .trim(from: 0, to: CGFloat(fallDetection.countdownSeconds) / 30.0)
                        .stroke(Color.houseDanger, style: StrokeStyle(lineWidth: 4, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                        .animation(.linear(duration: 1), value: fallDetection.countdownSeconds)

                    Text("\(fallDetection.countdownSeconds)")
                        .font(.system(size: 32, weight: .light, design: .serif))
                        .foregroundColor(.white)
                }
                .frame(width: 70, height: 70)

                Text("Toque para cancelar\nse voce esta bem")
                    .font(.system(size: 10))
                    .foregroundColor(Color.gray)
                    .multilineTextAlignment(.center)

                Button(action: {
                    fallDetection.cancelFallAlert()
                }) {
                    Text("ESTOU BEM")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(.white)
                        .tracking(1.5)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 10)
                        .background(Color.brightGreen)
                        .cornerRadius(4)
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: - Helpers
    private var greeting: String {
        let hour = Calendar.current.component(.hour, from: Date())
        if hour < 12 { return "Bom dia" }
        if hour < 18 { return "Boa tarde" }
        return "Boa noite"
    }

    private func performCheckin() {
        guard !checkinDisabled else { return }

        checkinConfirmed = true
        showingPulse = true

        // Record the check-in time
        CheckinCooldown.recordCheckin()
        let fmt = DateFormatter()
        fmt.dateFormat = "HH:mm"
        lastCheckinTimeString = fmt.string(from: Date())

        // Haptic feedback
        WKInterfaceDevice.current().play(.success)

        // Send check-in to iPhone app
        connectivity.sendCheckin()

        // Keep confirmed state (don't auto-reset -- cooldown controls re-enable)
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            showingPulse = false
        }
    }
}

// Convenience alias so spo2Color references work
private extension Color {
    static let brighterGreen = Color.brightGreen
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
                .foregroundColor(Color.gray)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black)
    }

    private func startHold() {
        holdTimer?.invalidate()
        holdProgress = 0
        holdTimer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { _ in
            DispatchQueue.main.async {
                holdProgress += 0.05 / 3.0
                if holdProgress >= 1.0 {
                    holdTimer?.invalidate()
                }
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
