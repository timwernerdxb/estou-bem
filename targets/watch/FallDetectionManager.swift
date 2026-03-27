import Foundation
import CoreMotion
import WatchKit

/// Detects falls using CMFallDetectionManager (watchOS 9+) as primary detection,
/// with accelerometer-based detection as fallback (high-g impact followed by stillness).
/// On fall detected: vibrates watch, shows 30-second countdown.
/// If no cancel within 30s -> sends fall alert to iPhone via WatchConnectivity.
class FallDetectionManager: NSObject, ObservableObject {

    // MARK: - Published state
    @Published var fallDetected: Bool = false
    @Published var countdownSeconds: Int = 30
    @Published var isCountingDown: Bool = false
    @Published var fallDetectionAvailable: Bool = false
    @Published var lastFallTime: Date?

    // MARK: - Configuration
    /// Accelerometer impact threshold (g-force) -- a sudden spike above this triggers fall candidate
    private let impactThreshold: Double = 3.0
    /// Stillness threshold after impact -- below this for stillnessRequiredDuration confirms fall
    private let stillnessThreshold: Double = 0.2
    /// How long (seconds) of stillness after impact to confirm a fall
    private let stillnessRequiredDuration: TimeInterval = 3.0
    /// Accelerometer sample rate for fallback detection
    private let sampleInterval: TimeInterval = 0.05  // 20 Hz for impact detection

    // MARK: - Private
    private let motionManager = CMMotionManager()
    private var countdownTimer: Timer?
    private var impactDetectedTime: Date?
    private var isMonitoringForStillness: Bool = false
    private var stillnessStartTime: Date?

    // CMFallDetectionManager (watchOS 9+)
    private var cmFallManager: Any?  // Type-erased to avoid compile error on older SDKs

    override init() {
        super.init()
        // Do NOT start CoreMotion here - crashes on watchOS during app init
    }

    /// Call from view onAppear to start fall detection safely after UI is ready
    func startMonitoring() {
        // Defer all CoreMotion work to avoid crash during initial layout
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
            self?.safeSetupMonitoring()
        }
    }

    private func safeSetupMonitoring() {
        // Only start accelerometer fallback - skip CMFallDetectionManager entirely
        // CMFallDetectionManager crashes on some watch models during init
        startAccelerometerFallback()
    }

    // MARK: - Native Fall Detection (watchOS 9+)

    private func setupNativeFallDetection() {
        if #available(watchOS 9.0, *) {
            // Guard that CMFallDetectionManager class is actually available at runtime
            guard CMFallDetectionManager.isAvailable else {
                print("[FallDetection] CMFallDetectionManager not available on this device")
                DispatchQueue.main.async {
                    self.fallDetectionAvailable = self.motionManager.isAccelerometerAvailable
                }
                return
            }

            let manager = CMFallDetectionManager()
            manager.delegate = self
            cmFallManager = manager

            let authStatus = manager.authorizationStatus
            switch authStatus {
            case .authorized:
                DispatchQueue.main.async {
                    self.fallDetectionAvailable = true
                }
                print("[FallDetection] CMFallDetectionManager authorized and active")
            case .notDetermined:
                // Authorization is requested automatically when delegate is set
                DispatchQueue.main.async {
                    self.fallDetectionAvailable = true
                }
                print("[FallDetection] CMFallDetectionManager authorization pending")
            default:
                DispatchQueue.main.async {
                    self.fallDetectionAvailable = self.motionManager.isAccelerometerAvailable
                }
                print("[FallDetection] CMFallDetectionManager not authorized, using accelerometer fallback")
            }
        } else {
            DispatchQueue.main.async {
                self.fallDetectionAvailable = self.motionManager.isAccelerometerAvailable
            }
            print("[FallDetection] watchOS < 9, using accelerometer fallback only")
        }
    }

    // MARK: - Accelerometer Fallback Detection

    /// Uses accelerometer to detect sudden high-g impact followed by stillness.
    /// This is a fallback for devices without CMFallDetectionManager or when it's not authorized.
    private func startAccelerometerFallback() {
        guard motionManager.isAccelerometerAvailable else {
            print("[FallDetection] Accelerometer not available")
            return
        }

        motionManager.accelerometerUpdateInterval = sampleInterval

        motionManager.startAccelerometerUpdates(to: OperationQueue()) { [weak self] data, error in
            guard let self = self else { return }
            if let error = error {
                print("[FallDetection] Accelerometer error: \(error.localizedDescription)")
                return
            }
            guard let accel = data?.acceleration else { return }
            self.processAccelerometerForFall(x: accel.x, y: accel.y, z: accel.z)
        }

        print("[FallDetection] Accelerometer fallback detection started")
    }

    private func processAccelerometerForFall(x: Double, y: Double, z: Double) {
        let magnitude = sqrt(x * x + y * y + z * z)

        if !isMonitoringForStillness {
            // Phase 1: Detect high-g impact
            if magnitude > impactThreshold {
                impactDetectedTime = Date()
                isMonitoringForStillness = true
                stillnessStartTime = nil
                print("[FallDetection] High-g impact detected: \(String(format: "%.2f", magnitude))g")
            }
        } else {
            // Phase 2: After impact, check for stillness
            let deviation = abs(magnitude - 1.0)  // deviation from gravity
            let now = Date()
            let timeSinceImpact = now.timeIntervalSince(impactDetectedTime ?? now)

            if deviation < stillnessThreshold {
                // Person is still
                if stillnessStartTime == nil {
                    stillnessStartTime = Date()
                }

                if let start = stillnessStartTime {
                    let stillnessDuration = now.timeIntervalSince(start)
                    if stillnessDuration >= stillnessRequiredDuration {
                        // Fall confirmed: high-g impact followed by sustained stillness
                        DispatchQueue.main.async { [weak self] in
                            self?.handleFallDetected(source: "accelerometer")
                        }
                        isMonitoringForStillness = false
                        stillnessStartTime = nil
                    }
                }
            } else {
                // Person moved -- reset stillness timer but keep monitoring
                stillnessStartTime = nil
            }

            // Timeout: if more than 10 seconds since impact with no confirmed fall, reset
            if timeSinceImpact > 10.0 {
                isMonitoringForStillness = false
                stillnessStartTime = nil
            }
        }
    }

    // MARK: - Fall Handling

    private func handleFallDetected(source: String) {
        guard !isCountingDown else { return }  // Prevent double-trigger

        print("[FallDetection] Fall detected via \(source)")
        fallDetected = true
        isCountingDown = true
        countdownSeconds = 30
        lastFallTime = Date()

        // Vibrate watch to alert user
        WKInterfaceDevice.current().play(.notification)

        // Start 30-second countdown
        countdownTimer?.invalidate()
        countdownTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] timer in
            guard let self = self else {
                timer.invalidate()
                return
            }

            DispatchQueue.main.async {
                self.countdownSeconds -= 1

                // Haptic feedback every 5 seconds during countdown
                if self.countdownSeconds % 5 == 0 && self.countdownSeconds > 0 {
                    WKInterfaceDevice.current().play(.retry)
                }

                if self.countdownSeconds <= 0 {
                    timer.invalidate()
                    self.escalateFallAlert()
                }
            }
        }
    }

    // MARK: - User Actions

    /// User presses cancel -- they're OK, dismiss the alert
    func cancelFallAlert() {
        print("[FallDetection] Fall alert cancelled by user")
        countdownTimer?.invalidate()
        countdownTimer = nil

        fallDetected = false
        isCountingDown = false
        countdownSeconds = 30

        // Send cancellation to iPhone so server knows it was a false alarm
        WatchConnectivityManager.shared.sendFallCancelled()

        WKInterfaceDevice.current().play(.success)
    }

    /// Countdown expired -- send fall alert to iPhone via WatchConnectivity
    private func escalateFallAlert() {
        print("[FallDetection] Countdown expired -- sending fall alert to iPhone")
        isCountingDown = false

        // Safely read heart rate from HealthManager on main thread
        let heartRate = HealthManager.shared.latestHeartRate

        // Send fall alert to iPhone
        WatchConnectivityManager.shared.sendFallAlert(
            timestamp: lastFallTime ?? Date(),
            heartRate: heartRate
        )

        // Strong haptic to indicate alert was sent
        WKInterfaceDevice.current().play(.notification)
    }

    // MARK: - Cleanup

    func stopMonitoring() {
        motionManager.stopAccelerometerUpdates()
        countdownTimer?.invalidate()
        countdownTimer = nil
    }

    deinit {
        stopMonitoring()
    }
}

// MARK: - CMFallDetectionDelegate (watchOS 9+)

@available(watchOS 9.0, *)
extension FallDetectionManager: CMFallDetectionDelegate {
    func fallDetectionManager(
        _ fallDetectionManager: CMFallDetectionManager,
        didDetect event: CMFallDetectionEvent,
        completionHandler handler: @escaping () -> Void
    ) {
        DispatchQueue.main.async { [weak self] in
            self?.handleFallDetected(source: "CMFallDetectionManager")
        }
        // Always call the completion handler
        handler()
    }
}
