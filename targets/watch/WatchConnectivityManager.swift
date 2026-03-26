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

    private var session: WCSession?

    override init() {
        super.init()
        if WCSession.isSupported() {
            session = WCSession.default
            session?.delegate = self
            session?.activate()
        }
    }

    // MARK: - Send check-in confirmation to iPhone
    func sendCheckin() {
        guard let session = session else { return }

        let message: [String: Any] = [
            "type": "checkin_confirmed",
            "timestamp": ISO8601DateFormatter().string(from: Date()),
        ]

        if session.isReachable {
            // iPhone app is open — instant delivery
            session.sendMessage(message, replyHandler: { reply in
                DispatchQueue.main.async {
                    if let next = reply["nextCheckinTime"] as? String {
                        self.nextCheckinTime = next
                    }
                    self.hasPendingCheckin = false
                    if let s = reply["streak"] as? Int {
                        self.streak = s
                    }
                }
            }, errorHandler: { error in
                print("[Watch] sendMessage error: \(error.localizedDescription)")
                // Fall back to transferUserInfo for guaranteed delivery
                self.session?.transferUserInfo(message)
            })
        } else {
            // iPhone not reachable — queue for delivery
            session.transferUserInfo(message)
        }

        // Haptic feedback
        WKInterfaceDevice.current().play(.success)
    }

    // MARK: - Send SOS to iPhone
    func sendSOS() {
        guard let session = session else { return }

        let message: [String: Any] = [
            "type": "sos_activated",
            "timestamp": ISO8601DateFormatter().string(from: Date()),
        ]

        // SOS is critical — try both channels
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
        guard let session = session else { return }

        let message: [String: Any] = [
            "type": "fall_detected",
            "timestamp": ISO8601DateFormatter().string(from: timestamp),
            "heartRate": heartRate,
        ]

        // Fall is critical — try both channels for guaranteed delivery
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
        guard let session = session else { return }

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
        guard let session = session else { return }

        let context: [String: Any] = [
            "type": "movement_update",
            "isMoving": isMoving,
            "magnitude": magnitude,
            "timestamp": ISO8601DateFormatter().string(from: Date()),
        ]

        // Use application context — only latest value matters
        try? session.updateApplicationContext(context)
    }

    // MARK: - Send heart rate to iPhone
    func sendHeartRate(_ bpm: Double) {
        guard let session = session else { return }

        let context: [String: Any] = [
            "type": "heart_rate_update",
            "bpm": bpm,
            "timestamp": ISO8601DateFormatter().string(from: Date()),
        ]

        try? session.updateApplicationContext(context)
    }

    func sendHealthData(type: String, value: Double) {
        guard let session = session else { return }

        let context: [String: Any] = [
            "type": "health_data",
            "dataType": type,
            "value": value,
            "timestamp": ISO8601DateFormatter().string(from: Date()),
        ]

        try? session.updateApplicationContext(context)
    }

    func sendLowSpO2Alert(_ spo2: Double) {
        guard let session = session, session.isReachable else { return }

        session.sendMessage([
            "type": "low_spo2_alert",
            "spo2": spo2,
            "timestamp": ISO8601DateFormatter().string(from: Date()),
        ], replyHandler: nil, errorHandler: nil)
    }

    // MARK: - Request sync from iPhone
    func requestSync() {
        guard let session = session, session.isReachable else { return }

        session.sendMessage(["type": "request_sync"], replyHandler: { reply in
            DispatchQueue.main.async {
                self.processSettings(reply)
            }
        }, errorHandler: nil)
    }

    private func processSettings(_ data: [String: Any]) {
        if let name = data["elderName"] as? String { elderName = name }
        if let next = data["nextCheckinTime"] as? String { nextCheckinTime = next }
        if let pending = data["hasPendingCheckin"] as? Bool { hasPendingCheckin = pending }
        if let s = data["streak"] as? Int { streak = s }
        lastSyncTime = Date()
    }
}

// MARK: - WCSessionDelegate
extension WatchConnectivityManager: WCSessionDelegate {

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
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
