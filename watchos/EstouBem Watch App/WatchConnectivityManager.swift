import Foundation
import WatchConnectivity
import Combine

class WatchConnectivityManager: NSObject, ObservableObject, WCSessionDelegate {
    static let shared = WatchConnectivityManager()

    @Published var isReachable = false
    @Published var lastSyncTime: Date?

    private var session: WCSession?
    private var pendingMessages: [[String: Any]] = []

    override init() {
        super.init()
        if WCSession.isSupported() {
            session = WCSession.default
            session?.delegate = self
            session?.activate()
        }
    }

    // MARK: - Sending

    func sendMessage(_ message: [String: Any]) {
        guard let session = session else { return }

        if session.isReachable {
            session.sendMessage(message, replyHandler: nil) { [weak self] error in
                // Queue for later if send fails
                self?.pendingMessages.append(message)
                self?.trySendViaContext(message)
            }
        } else {
            // Use application context for non-urgent data
            trySendViaContext(message)
        }
    }

    func sendSOS() {
        let message: [String: Any] = [
            "action": "sos_activated",
            "timestamp": ISO8601DateFormatter().string(from: Date()),
        ]

        guard let session = session else { return }

        // SOS is high priority — try interactive message first
        if session.isReachable {
            session.sendMessage(message, replyHandler: nil) { [weak self] _ in
                self?.trySendViaContext(message)
            }
        } else {
            // Transfer as high priority user info
            session.transferUserInfo(message)
        }
    }

    func sendCheckInUpdate(confirmed: Int, total: Int) {
        let message: [String: Any] = [
            "action": "checkin_status",
            "confirmed": confirmed,
            "total": total,
            "timestamp": ISO8601DateFormatter().string(from: Date()),
        ]
        sendMessage(message)
    }

    private func trySendViaContext(_ message: [String: Any]) {
        // Merge into application context (last-write-wins)
        var context = session?.applicationContext ?? [:]
        for (key, value) in message {
            context[key] = value
        }
        try? session?.updateApplicationContext(context)
    }

    // MARK: - Flush Pending

    private func flushPendingMessages() {
        let messages = pendingMessages
        pendingMessages.removeAll()
        for msg in messages {
            sendMessage(msg)
        }
    }

    // MARK: - WCSessionDelegate

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        DispatchQueue.main.async { [weak self] in
            self?.isReachable = session.isReachable
        }
        if activationState == .activated {
            flushPendingMessages()
        }
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        DispatchQueue.main.async { [weak self] in
            self?.isReachable = session.isReachable
        }
        if session.isReachable {
            flushPendingMessages()
        }
    }

    // Receive messages from phone (e.g., updated check-in schedule)
    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        handleReceivedMessage(message)
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        handleReceivedMessage(message)
        replyHandler(["status": "received"])
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        handleReceivedMessage(applicationContext)
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        handleReceivedMessage(userInfo)
    }

    private func handleReceivedMessage(_ message: [String: Any]) {
        guard let action = message["action"] as? String else { return }

        DispatchQueue.main.async { [weak self] in
            self?.lastSyncTime = Date()

            switch action {
            case "update_schedule":
                // Phone sent updated check-in times
                if let times = message["checkInTimes"] as? [String] {
                    NotificationCenter.default.post(
                        name: .checkInTimesUpdated,
                        object: nil,
                        userInfo: ["times": times]
                    )
                }

            case "checkin_reminder":
                // Phone triggered a check-in reminder
                NotificationCenter.default.post(
                    name: .checkInReminderReceived,
                    object: nil
                )

            case "escalation_active":
                // Phone is escalating — show alert on watch
                NotificationCenter.default.post(
                    name: .escalationActive,
                    object: nil,
                    userInfo: message
                )

            default:
                break
            }
        }
    }
}

// MARK: - Notification Names

extension Notification.Name {
    static let checkInTimesUpdated = Notification.Name("checkInTimesUpdated")
    static let checkInReminderReceived = Notification.Name("checkInReminderReceived")
    static let escalationActive = Notification.Name("escalationActive")
}
