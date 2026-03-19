import Foundation
import Combine
import UserNotifications

struct SensorContext {
    let heartRate: Double?
    let heartRateTimestamp: Date?
    let isMoving: Bool
}

class CheckInManager: ObservableObject {
    @Published var hasPendingCheckIn = false
    @Published var confirmedToday = 0
    @Published var totalToday = 0
    @Published var nextCheckInTime: String?

    private var checkInTimes: [String] = ["09:00"]
    private var todayCheckIns: [(id: String, time: String, status: String)] = []

    init() {
        loadFromPhone()
        scheduleNotifications()
        checkPendingStatus()
    }

    func confirmCheckIn(sensorContext: SensorContext) {
        // Mark pending as confirmed
        if let idx = todayCheckIns.firstIndex(where: { $0.status == "pending" }) {
            todayCheckIns[idx].status = "confirmed"
        } else {
            // Create new confirmed entry
            let formatter = DateFormatter()
            formatter.dateFormat = "HH:mm"
            todayCheckIns.append((
                id: UUID().uuidString,
                time: formatter.string(from: Date()),
                status: "confirmed"
            ))
        }

        hasPendingCheckIn = false
        confirmedToday = todayCheckIns.filter { $0.status == "confirmed" }.count
        totalToday = todayCheckIns.count

        // Send to phone app with sensor context
        let payload: [String: Any] = [
            "action": "checkin_confirmed",
            "timestamp": ISO8601DateFormatter().string(from: Date()),
            "heartRate": sensorContext.heartRate ?? 0,
            "heartRateTimestamp": sensorContext.heartRateTimestamp.map {
                ISO8601DateFormatter().string(from: $0)
            } ?? "",
            "isMoving": sensorContext.isMoving,
        ]
        WatchConnectivityManager.shared.sendMessage(payload)
    }

    func scheduleNotifications() {
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            guard granted else { return }
        }

        // Remove old check-in notifications
        center.removePendingNotificationRequests(withIdentifiers:
            checkInTimes.map { "checkin_\($0)" }
        )

        for time in checkInTimes {
            let parts = time.split(separator: ":").compactMap { Int($0) }
            guard parts.count == 2 else { continue }

            let content = UNMutableNotificationContent()
            content.title = "Hora do Check-in! ✅"
            content.body = "Abra o app e confirme que está tudo bem"
            content.sound = .default
            content.categoryIdentifier = "CHECKIN"

            var dateComponents = DateComponents()
            dateComponents.hour = parts[0]
            dateComponents.minute = parts[1]

            let trigger = UNCalendarNotificationTrigger(dateMatching: dateComponents, repeats: true)
            let request = UNNotificationRequest(
                identifier: "checkin_\(time)",
                content: content,
                trigger: trigger
            )
            center.add(request)
        }

        // Set up interactive notification actions
        let confirmAction = UNNotificationAction(
            identifier: "CONFIRM",
            title: "✅ Estou Bem",
            options: [.foreground]
        )
        let helpAction = UNNotificationAction(
            identifier: "NEED_HELP",
            title: "🆘 Preciso de Ajuda",
            options: [.foreground, .destructive]
        )
        let category = UNNotificationCategory(
            identifier: "CHECKIN",
            actions: [confirmAction, helpAction],
            intentIdentifiers: []
        )
        center.setNotificationCategories([category])
    }

    private func checkPendingStatus() {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        let now = formatter.string(from: Date())

        // Check if any scheduled time has passed without confirmation
        for time in checkInTimes {
            if time <= now && !todayCheckIns.contains(where: { $0.time == time && $0.status == "confirmed" }) {
                if !todayCheckIns.contains(where: { $0.time == time }) {
                    todayCheckIns.append((id: UUID().uuidString, time: time, status: "pending"))
                }
                hasPendingCheckIn = true
            }
        }

        confirmedToday = todayCheckIns.filter { $0.status == "confirmed" }.count
        totalToday = todayCheckIns.count

        // Calculate next check-in
        let futureCheckins = checkInTimes.filter { $0 > now }
        nextCheckInTime = futureCheckins.first
    }

    private func loadFromPhone() {
        // In production, this syncs with the phone app via WatchConnectivity
        // For now, use default schedule
    }
}
