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

// MARK: - Main Content View (Paged: Main + Secondary)
struct ContentView: View {
    @EnvironmentObject var connectivity: WatchConnectivityManager
    @EnvironmentObject var motionManager: MotionDetectionManager
    @EnvironmentObject var healthManager: HealthManager
    @EnvironmentObject var fallDetection: FallDetectionManager

    @State private var selectedPage = 0

    var body: some View {
        TabView(selection: $selectedPage) {
            MainCheckinPage()
                .environmentObject(connectivity)
                .environmentObject(fallDetection)
                .tag(0)

            SecondaryPage()
                .environmentObject(connectivity)
                .environmentObject(healthManager)
                .tag(1)
        }
        .tabViewStyle(.page(indexDisplayMode: .automatic))
        .background(Color.black)
        .overlay(
            Group {
                if fallDetection.fallDetected {
                    fallAlertOverlay
                }
            }
        )
        .onAppear {
            connectivity.loadPersistedSchedule()
        }
    }

    // MARK: - Fall Alert Overlay (kept as-is, emergency overlay)
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
}

// MARK: - Main Check-in Page (ONE big green button)
struct MainCheckinPage: View {
    @EnvironmentObject var connectivity: WatchConnectivityManager
    @EnvironmentObject var fallDetection: FallDetectionManager

    @State private var checkinConfirmed = false
    @State private var showingPulse = false
    @State private var lastCheckinTimeString: String? = nil

    private var checkinDisabled: Bool {
        if checkinConfirmed { return true }
        if CheckinCooldown.isInCooldown() { return true }
        if !CheckinCooldown.isWithinScheduledWindow(scheduledTimes: connectivity.scheduledCheckinTimes) {
            return true
        }
        return false
    }

    /// Next check-in display string
    private var nextTimeText: String? {
        if let next = CheckinCooldown.nextScheduledTime(scheduledTimes: connectivity.scheduledCheckinTimes) {
            return next
        }
        if CheckinCooldown.isInCooldown(), let nextDate = CheckinCooldown.nextAllowedDate() {
            let f = DateFormatter()
            f.dateFormat = "HH:mm"
            return f.string(from: nextDate)
        }
        return nil
    }

    var body: some View {
        GeometryReader { geo in
            VStack(spacing: 0) {
                // Gear icon top-right — tapping goes to secondary page (page 1)
                HStack {
                    Spacer()
                    Image(systemName: "gearshape.fill")
                        .font(.system(size: 12))
                        .foregroundColor(Color.gray.opacity(0.6))
                        .padding(.trailing, 4)
                        .padding(.top, 2)
                        .onTapGesture {
                            // Swipe hint — the TabView handles actual navigation
                        }
                }
                .frame(height: 16)

                Spacer(minLength: 4)

                // Big check-in button
                Button(action: performCheckin) {
                    ZStack {
                        // Pulse ring on confirmation
                        if showingPulse {
                            RoundedRectangle(cornerRadius: 20)
                                .stroke(Color.brightGreen.opacity(0.4), lineWidth: 3)
                                .scaleEffect(showingPulse ? 1.1 : 1.0)
                                .opacity(showingPulse ? 0 : 1)
                                .animation(.easeOut(duration: 0.8), value: showingPulse)
                        }

                        // Main button background
                        RoundedRectangle(cornerRadius: 20)
                            .fill(buttonColor)

                        // Button content
                        VStack(spacing: 6) {
                            if checkinConfirmed {
                                Image(systemName: "checkmark")
                                    .font(.system(size: 36, weight: .bold))
                                    .foregroundColor(.white)
                                Text("Confirmado \u{2713}")
                                    .font(.system(size: 16, weight: .semibold))
                                    .foregroundColor(.white)
                                if let ts = lastCheckinTimeString {
                                    Text(ts)
                                        .font(.system(size: 13))
                                        .foregroundColor(.white.opacity(0.8))
                                }
                            } else if checkinDisabled {
                                Image(systemName: "clock.fill")
                                    .font(.system(size: 30, weight: .medium))
                                    .foregroundColor(.white.opacity(0.6))
                                Text("AGUARDE")
                                    .font(.system(size: 18, weight: .bold))
                                    .foregroundColor(.white.opacity(0.6))
                            } else {
                                Text("ESTOU\nBEM")
                                    .font(.system(size: 28, weight: .bold))
                                    .foregroundColor(.white)
                                    .multilineTextAlignment(.center)
                                    .lineSpacing(2)
                            }
                        }
                    }
                }
                .buttonStyle(.plain)
                .frame(
                    width: geo.size.width - 16,
                    height: geo.size.height * 0.65
                )
                .disabled(checkinDisabled)
                .opacity(checkinDisabled && !checkinConfirmed ? 0.5 : 1.0)

                Spacer(minLength: 6)

                // Next check-in time below button
                if let next = nextTimeText {
                    Text("Proximo: \(next)")
                        .font(.system(size: 12))
                        .foregroundColor(Color.gray)
                } else {
                    // Keep spacing consistent
                    Text(" ")
                        .font(.system(size: 12))
                }

                Spacer(minLength: 2)
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .background(Color.black)
        .onAppear {
            if let last = CheckinCooldown.lastCheckinDate, CheckinCooldown.isInCooldown() {
                let fmt = DateFormatter()
                fmt.dateFormat = "HH:mm"
                lastCheckinTimeString = fmt.string(from: last)
                checkinConfirmed = true
            }
        }
    }

    private var buttonColor: Color {
        if checkinConfirmed {
            return .brightGreen
        } else if checkinDisabled {
            return Color(white: 0.25)
        } else {
            return .brightGreen
        }
    }

    private func performCheckin() {
        guard !checkinDisabled else { return }

        checkinConfirmed = true
        showingPulse = true

        CheckinCooldown.recordCheckin()
        let fmt = DateFormatter()
        fmt.dateFormat = "HH:mm"
        lastCheckinTimeString = fmt.string(from: Date())

        // Haptic feedback
        WKInterfaceDevice.current().play(.success)

        // Send check-in to iPhone app
        connectivity.sendCheckin()

        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            showingPulse = false
        }
    }
}

// MARK: - Secondary Page (Health, SOS, Nap)
struct SecondaryPage: View {
    @EnvironmentObject var connectivity: WatchConnectivityManager
    @EnvironmentObject var healthManager: HealthManager

    @State private var napActive = false
    @State private var sosActivated = false
    @State private var holdProgress: CGFloat = 0
    @State private var holdTimer: Timer?

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                // Heart rate
                if healthManager.latestHeartRate > 0 {
                    HStack(spacing: 8) {
                        Image(systemName: "heart.fill")
                            .font(.system(size: 18))
                            .foregroundColor(.red)

                        Text("\(Int(healthManager.latestHeartRate))")
                            .font(.system(size: 24, weight: .bold))
                            .foregroundColor(.white)

                        Text("BPM")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(Color.gray)

                        Spacer()
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .background(Color.cardBg)
                    .cornerRadius(12)
                }

                // Nap button
                Button(action: toggleNap) {
                    HStack(spacing: 8) {
                        Image(systemName: napActive ? "moon.zzz.fill" : "moon.fill")
                            .font(.system(size: 16))
                            .foregroundColor(napActive ? Color.purple : .white)

                        Text(napActive ? "ACORDEI" : "COCHILO")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundColor(.white)

                        Spacer()
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 12)
                    .background(napActive ? Color.purple.opacity(0.3) : Color.cardBg)
                    .cornerRadius(12)
                }
                .buttonStyle(.plain)

                // SOS button (long press)
                ZStack {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(sosActivated ? Color.houseDanger : Color.houseDanger.opacity(0.8))

                    // Progress overlay
                    GeometryReader { geo in
                        RoundedRectangle(cornerRadius: 12)
                            .fill(Color.houseDanger)
                            .frame(width: geo.size.width * holdProgress)
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .opacity(holdProgress > 0 && !sosActivated ? 0.6 : 0)

                    HStack(spacing: 8) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .font(.system(size: 16))
                            .foregroundColor(.white)

                        VStack(alignment: .leading, spacing: 2) {
                            Text("SOS")
                                .font(.system(size: 14, weight: .bold))
                                .foregroundColor(.white)
                            Text(sosActivated ? "Enviado" : "Segure 3s")
                                .font(.system(size: 10))
                                .foregroundColor(.white.opacity(0.7))
                        }

                        Spacer()
                    }
                    .padding(.horizontal, 12)
                }
                .frame(height: 52)
                .gesture(
                    LongPressGesture(minimumDuration: 3)
                        .onChanged { _ in startHold() }
                        .onEnded { _ in activateSOS() }
                )
                .simultaneousGesture(
                    DragGesture(minimumDistance: 0)
                        .onEnded { _ in cancelHold() }
                )
            }
            .padding(.horizontal, 8)
            .padding(.top, 8)
        }
        .background(Color.black)
    }

    private func toggleNap() {
        napActive.toggle()
        WKInterfaceDevice.current().play(.click)
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

// MARK: - SOS View (kept for backward compatibility if referenced elsewhere)
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

// Convenience alias so references work
private extension Color {
    static let brighterGreen = Color.brightGreen
}
