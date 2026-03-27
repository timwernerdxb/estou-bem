import Foundation
import WatchConnectivity
import WatchKit

/// Manages communication between Watch and iPhone app via WatchConnectivity.
/// Handles check-in sync, settings, and real-time status updates.
class WatchConnectivityManager: NSObject, ObservableObject {
    static let shared = WatchConnectivityManager()

    // MARK: - Published state (drives SwiftUI updates)
    @Published var elderName: String?
    @Published var nextCheckinTime: String?
    @Published var hasPendingCheckin: Bool = false
    @Published var streak: Int = 0
    @Published var isPhoneReachable: Bool = false
    @Published var lastSyncTime: Date?
    /// Scheduled check-in times received from the phone (HH:mm strings)
    @Published var scheduledCheckinTimes: [String] = []

    private var session: WCSession?

    override init() {
        super.init()
        // Do NOT activate WCSession here — defer to activateSession()
    }

    /// Call from onAppear to safely activate WatchConnectivity after UI is ready
    func activateSession() {
        guard session == nil else { return }
        guard WCSession.isSupported() else {
            print("[Watch] WCSession is not supported on this device")
            return
        }
        let wcSession = WCSession.default
        wcSession.delegate = self
        wcSession.activate()
        session = wcSession
    }

    // MARK: - Send check-in confirmation to iPhone
    func sendCheckin() {
        guard let session = session, session.activationState == .activated else {
            print("[Watch] Session not activated, cannot send checkin")
            return
        }

        let message: [String: Any] = [
            "type": "checkin_confirmed",
            "timestamp": ISO8601DateFormatter().string(from: Date()),
        ]

        if session.isReachable {
            // iPhone app is open -- instant delivery
            session.sendMessage(message, replyHandler: { [weak self] reply in
                DispatchQueue.main.async {
                    if let next = reply["nextCheckinTime"] as? String {
                        self?.nextCheckinTime = next
                    }
                    self?.hasPendingCheckin = false
                    if let s = reply["streak"] as? Int {
                        self?.streak = s
                    }
                }
            }, errorHandler: { [weak self] error in
                print("[Watch] sendMessage error: \(error.localizedDescription)")
                // Fall back to transferUserInfo for guaranteed delivery
                self?.session?.transferUserInfo(message)
            })
        } else {
            // iPhone not reachable -- queue for delivery
            session.transferUserInfo(message)
        }

        // Haptic feedback
        WKInterfaceDevice.current().play(.success)
    }

    // MARK: - Send SOS to iPhone
    func sendSOS() {
        guard let session = session, session.activationState == .activated else {
            print("[Watch] Session not activated, cannot send SOS")
            return
        }

        let message: [String: Any] = [
            "type": "sos_activated",
            "timestamp": ISO8601DateFormatter().string(from: Date()),
        ]

        // SOS is critical -- try both channels
        if session.isReachable {
            session.sendMessage(message, replyHandler: nil) { error in
                print("[Watch] SOS sendMessage error: \(error.localizedDescription)")
            }
        }
        // Always also transfer for guaranteed delivery
        session.transferUserInfo(message)

        WKInterfaceDevice.current().play(.notification)
    }

    // MARK: - Send fall alert to iPhone
    func sendFallAlert(timestamp: Date, heartRate: Double) {
        guard let session = session, session.activationState == .activated else {
            print("[Watch] Session not activated, cannot send fall alert")
            return
        }

        let message: [String: Any] = [
            "type": "fall_detected",
            "timestamp": ISO8601DateFormatter().string(from: timestamp),
            "heartRate": heartRate,
        ]

        // Fall is critical -- try both channels for guaranteed delivery
        if session.isReachable {
            session.sendMessage(message, replyHandler: nil) { error in
                print("[Watch] Fall alert sendMessage error: \(error.localizedDescription)")
            }
        }
        // Always also transfer for guaranteed delivery
        session.transferUserInfo(message)

        WKInterfaceDevice.current().play(.notification)
    }

    // MARK: - Send fall cancellation to iPhone
    func sendFallCancelled() {
        guard let session = session, session.activationState == .activated else { return }

        let message: [String: Any] = [
            "type": "fall_cancelled",
            "timestamp": ISO8601DateFormatter().string(from: Date()),
        ]

        if session.isReachable {
            session.sendMessage(message, replyHandler: nil) { error in
                print("[Watch] Fall cancelled sendMessage error: \(error.localizedDescription)")
            }
        }
        session.transferUserInfo(message)
    }

    // MARK: - Send movement status to iPhone
    func sendMovementUpdate(isMoving: Bool, magnitude: Double) {
        guard let session = session, session.activationState == .activated else { return }

        let context: [String: Any] = [
            "type": "movement_update",
            "isMoving": isMoving,
            "magnitude": magnitude,
            "timestamp": ISO8601DateFormatter().string(from: Date()),
        ]

        // Use application context -- only latest value matters
        do {
            try session.updateApplicationContext(context)
        } catch {
            print("[Watch] Failed to update application context (movement): \(error.localizedDescription)")
        }
    }

    // MARK: - Send heart rate to iPhone
    func sendHeartRate(_ bpm: Double) {
        guard let session = session, session.activationState == .activated else { return }

        let context: [String: Any] = [
            "type": "heart_rate_update",
            "bpm": bpm,
            "timestamp": ISO8601DateFormatter().string(from: Date()),
        ]

        do {
            try session.updateApplicationContext(context)
        } catch {
            print("[Watch] Failed to update application context (heart rate): \(error.localizedDescription)")
        }
    }

    func sendHealthData(type: String, value: Double) {
        guard let session = session, session.activationState == .activated else { return }

        let context: [String: Any] = [
            "type": "health_data",
            "dataType": type,
            "value": value,
            "timestamp": ISO8601DateFormatter().string(from: Date()),
        ]

        do {
            try session.updateApplicationContext(context)
        } catch {
            print("[Watch] Failed to update application context (health data): \(error.localizedDescription)")
        }
    }

    func sendLowSpO2Alert(_ spo2: Double) {
        guard let session = session,
              session.activationState == .activated,
              session.isReachable else { return }

        session.sendMessage([
            "type": "low_spo2_alert",
            "spo2": spo2,
            "timestamp": ISO8601DateFormatter().string(from: Date()),
        ], replyHandler: nil, errorHandler: { error in
            print("[Watch] Low SpO2 alert sendMessage error: \(error.localizedDescription)")
        })
    }

    // MARK: - Request sync from iPhone
    func requestSync() {
        guard let session = session,
              session.activationState == .activated,
              session.isReachable else { return }

        session.sendMessage(["type": "request_sync"], replyHandler: { [weak self] reply in
            DispatchQueue.main.async {
                self?.processSettings(reply)
            }
        }, errorHandler: { error in
            print("[Watch] requestSync error: \(error.localizedDescription)")
        })
    }

    private func processSettings(_ data: [String: Any]) {
        if let name = data["elderName"] as? String { elderName = name }
        if let next = data["nextCheckinTime"] as? String { nextCheckinTime = next }
        if let pending = data["hasPendingCheckin"] as? Bool { hasPendingCheckin = pending }
        if let s = data["streak"] as? Int { streak = s }
        if let times = data["checkinTimes"] as? [String] {
            scheduledCheckinTimes = times
            // Persist so we have them after relaunch
            UserDefaults.standard.set(times, forKey: "scheduledCheckinTimes")
        }
        lastSyncTime = Date()
    }

    /// Load persisted scheduled times on launch
    func loadPersistedSchedule() {
        if let times = UserDefaults.standard.stringArray(forKey: "scheduledCheckinTimes") {
            scheduledCheckinTimes = times
        }
    }
}

// MARK: - WCSessionDelegate
extension WatchConnectivityManager: WCSessionDelegate {

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: (any Error)?) {
        DispatchQueue.main.async {
            self.isPhoneReachable = session.isReachable
        }
        if activationState == .activated {
            requestSync()
        }
        if let error = error {
            print("[Watch] Activation error: \(error.localizedDescription)")
        }
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        DispatchQueue.main.async {
            self.isPhoneReachable = session.isReachable
        }
        if session.isReachable {
            requestSync()
        }
    }

    // Receive messages from iPhone
    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        DispatchQueue.main.async {
            self.handleMessage(message)
        }
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        DispatchQueue.main.async {
            self.handleMessage(message)
        }
        replyHandler(["status": "received"])
    }

    // Receive application context updates from iPhone
    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        DispatchQueue.main.async {
            self.processSettings(applicationContext)
        }
    }

    // Receive queued user info from iPhone
    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        DispatchQueue.main.async {
            self.handleMessage(userInfo)
        }
    }

    private func handleMessage(_ message: [String: Any]) {
        let type = message["type"] as? String ?? ""

        switch type {
        case "checkin_reminder":
            hasPendingCheckin = true
            WKInterfaceDevice.current().play(.notification)

        case "settings_update":
            processSettings(message)

        case "escalation_started":
            hasPendingCheckin = true
            WKInterfaceDevice.current().play(.directionUp)

        case "escalation_resolved":
            hasPendingCheckin = false

        default:
            processSettings(message)
        }
    }
}
