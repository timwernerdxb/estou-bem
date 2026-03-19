import Foundation
import HealthKit
import Combine

class HealthManager: ObservableObject {
    @Published var currentHeartRate: Double?
    @Published var lastHeartRateTime: Date?
    @Published var isActivelyMoving = false
    @Published var fallDetected = false
    @Published var isAuthorized = false

    private let healthStore = HKHealthStore()
    private var heartRateQuery: HKAnchoredObjectQuery?
    private var workoutSession: HKWorkoutSession?
    private var workoutBuilder: HKLiveWorkoutBuilder?
    private var motionTimer: Timer?

    private let heartRateType = HKQuantityType.quantityType(forIdentifier: .heartRate)!
    private let activeEnergyType = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)!
    private let stepCountType = HKQuantityType.quantityType(forIdentifier: .stepCount)!

    func requestAuthorization() {
        guard HKHealthStore.isHealthDataAvailable() else { return }

        let readTypes: Set<HKObjectType> = [
            heartRateType,
            activeEnergyType,
            stepCountType,
            HKObjectType.categoryType(forIdentifier: .appleWalkingSteadiness)!,
        ]

        let shareTypes: Set<HKSampleType> = [
            activeEnergyType,
        ]

        healthStore.requestAuthorization(toShare: shareTypes, read: readTypes) { [weak self] granted, error in
            DispatchQueue.main.async {
                self?.isAuthorized = granted
                if granted {
                    self?.startHeartRateObserver()
                    self?.startMotionCheck()
                }
            }
        }
    }

    // MARK: - Workout Session (keeps heart rate streaming)

    func startWorkout() {
        let config = HKWorkoutConfiguration()
        config.activityType = .other
        config.locationType = .unknown

        do {
            workoutSession = try HKWorkoutSession(healthStore: healthStore, configuration: config)
            workoutBuilder = workoutSession?.associatedWorkoutBuilder()
            workoutBuilder?.dataSource = HKLiveWorkoutDataSource(healthStore: healthStore, workoutConfiguration: config)

            workoutSession?.startActivity(with: Date())
            workoutBuilder?.beginCollection(withStart: Date()) { _, _ in }
        } catch {
            // Fall back to anchored query only
            startHeartRateObserver()
        }
    }

    func stopWorkout() {
        workoutSession?.end()
        workoutBuilder?.endCollection(withEnd: Date()) { [weak self] _, _ in
            self?.workoutBuilder?.finishWorkout { _, _ in }
        }
    }

    // MARK: - Heart Rate Monitoring

    private func startHeartRateObserver() {
        let predicate = HKQuery.predicateForSamples(
            withStart: Date().addingTimeInterval(-60),
            end: nil,
            options: .strictStartDate
        )

        heartRateQuery = HKAnchoredObjectQuery(
            type: heartRateType,
            predicate: predicate,
            anchor: nil,
            limit: HKObjectQueryNoLimit
        ) { [weak self] _, samples, _, _, _ in
            self?.processHeartRateSamples(samples)
        }

        heartRateQuery?.updateHandler = { [weak self] _, samples, _, _, _ in
            self?.processHeartRateSamples(samples)
        }

        if let query = heartRateQuery {
            healthStore.execute(query)
        }
    }

    private func processHeartRateSamples(_ samples: [HKSample]?) {
        guard let quantitySamples = samples as? [HKQuantitySample],
              let latest = quantitySamples.last else { return }

        let bpm = latest.quantity.doubleValue(for: HKUnit.count().unitDivided(by: .minute()))

        DispatchQueue.main.async { [weak self] in
            self?.currentHeartRate = bpm
            self?.lastHeartRateTime = latest.endDate
        }
    }

    // MARK: - Motion Detection

    private func startMotionCheck() {
        // Check step count every 30 seconds to determine movement
        motionTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            self?.checkRecentSteps()
        }
        checkRecentSteps()
    }

    private func checkRecentSteps() {
        let now = Date()
        let fiveMinutesAgo = now.addingTimeInterval(-300)

        let predicate = HKQuery.predicateForSamples(
            withStart: fiveMinutesAgo,
            end: now,
            options: .strictStartDate
        )

        let query = HKStatisticsQuery(
            quantityType: stepCountType,
            quantitySamplePredicate: predicate,
            options: .cumulativeSum
        ) { [weak self] _, result, _ in
            let steps = result?.sumQuantity()?.doubleValue(for: .count()) ?? 0
            DispatchQueue.main.async {
                self?.isActivelyMoving = steps > 10 // More than 10 steps in 5 min = moving
            }
        }

        healthStore.execute(query)
    }

    // MARK: - Fall Detection

    func reportFallDetected() {
        DispatchQueue.main.async { [weak self] in
            self?.fallDetected = true
        }

        // Auto-reset after 5 minutes if not handled
        DispatchQueue.main.asyncAfter(deadline: .now() + 300) { [weak self] in
            self?.fallDetected = false
        }
    }

    func clearFallAlert() {
        fallDetected = false
    }

    deinit {
        if let query = heartRateQuery {
            healthStore.stop(query)
        }
        motionTimer?.invalidate()
        stopWorkout()
    }
}
