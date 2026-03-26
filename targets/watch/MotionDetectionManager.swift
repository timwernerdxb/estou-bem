import Foundation
import CoreMotion

/// Monitors accelerometer data to detect movement vs. stillness.
/// Used to postpone escalation when the elderly person is moving (active).
class MotionDetectionManager: NSObject, ObservableObject {

    // MARK: - Published state
    @Published var isMoving: Bool = false
    @Published var movementMagnitude: Double = 0.0
    @Published var isMonitoring: Bool = false

    // MARK: - Configuration
    /// Movement threshold -- accelerations above this are considered "moving"
    /// Tuned for elderly: lower threshold catches gentle movements like walking
    private let movementThreshold: Double = 0.15  // g-force above gravity
    /// How often to sample (seconds)
    private let sampleInterval: TimeInterval = 0.5  // 2 Hz -- battery friendly
    /// Seconds of stillness before marking "not moving"
    private let stillnessTimeout: TimeInterval = 30.0
    /// How often to report status to iPhone (seconds)
    private let reportInterval: TimeInterval = 60.0

    // MARK: - Private
    private let motionManager = CMMotionManager()
    private var lastMovementTime: Date = Date()
    private var reportTimer: Timer?

    // MARK: - Start / Stop
    func startMonitoring() {
        guard motionManager.isAccelerometerAvailable else {
            print("[Motion] Accelerometer not available on this device")
            return
        }
        guard !isMonitoring else { return }

        motionManager.accelerometerUpdateInterval = sampleInterval

        motionManager.startAccelerometerUpdates(to: .main) { [weak self] data, error in
            guard let self = self else { return }
            if let error = error {
                print("[Motion] Accelerometer error: \(error.localizedDescription)")
                return
            }
            guard let accel = data?.acceleration else { return }
            self.processAcceleration(x: accel.x, y: accel.y, z: accel.z)
        }

        isMonitoring = true

        // Periodic report to iPhone
        reportTimer = Timer.scheduledTimer(withTimeInterval: reportInterval, repeats: true) { [weak self] _ in
            guard let self = self else { return }
            DispatchQueue.main.async {
                WatchConnectivityManager.shared.sendMovementUpdate(
                    isMoving: self.isMoving,
                    magnitude: self.movementMagnitude
                )
            }
        }
    }

    func stopMonitoring() {
        motionManager.stopAccelerometerUpdates()
        reportTimer?.invalidate()
        reportTimer = nil
        isMonitoring = false
    }

    // MARK: - Process accelerometer data
    private func processAcceleration(x: Double, y: Double, z: Double) {
        // Calculate magnitude of acceleration minus gravity (~1g)
        // When stationary: magnitude ~= 1.0 (gravity only)
        // When moving: magnitude deviates from 1.0
        let totalMagnitude = sqrt(x * x + y * y + z * z)
        let deviation = abs(totalMagnitude - 1.0)

        movementMagnitude = deviation

        if deviation > movementThreshold {
            // Movement detected
            lastMovementTime = Date()
            if !isMoving {
                isMoving = true
                // Immediately report movement (important for escalation postponement)
                WatchConnectivityManager.shared.sendMovementUpdate(
                    isMoving: true,
                    magnitude: deviation
                )
            }
        } else {
            // Check if stillness timeout has elapsed
            let timeSinceMovement = Date().timeIntervalSince(lastMovementTime)
            if timeSinceMovement > stillnessTimeout && isMoving {
                isMoving = false
                WatchConnectivityManager.shared.sendMovementUpdate(
                    isMoving: false,
                    magnitude: deviation
                )
            }
        }
    }

    deinit {
        stopMonitoring()
    }
}
