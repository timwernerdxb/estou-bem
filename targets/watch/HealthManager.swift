import Foundation
import HealthKit

/// Manages HealthKit integration on Apple Watch.
/// Reads heart rate and step count data to monitor elderly well-being.
class HealthManager: NSObject, ObservableObject {

    // MARK: - Published state
    @Published var latestHeartRate: Double = 0
    @Published var todaySteps: Int = 0
    @Published var isAuthorized: Bool = false

    // MARK: - Private
    private let healthStore = HKHealthStore()
    private var heartRateQuery: HKAnchoredObjectQuery?
    private var stepsQuery: HKStatisticsCollectionQuery?

    // MARK: - Health data types
    private let heartRateType = HKQuantityType.quantityType(forIdentifier: .heartRate)!
    private let stepsType = HKQuantityType.quantityType(forIdentifier: .stepCount)!

    // MARK: - Authorization
    func requestAuthorization() {
        guard HKHealthStore.isHealthDataAvailable() else { return }

        let readTypes: Set<HKObjectType> = [heartRateType, stepsType]

        healthStore.requestAuthorization(toShare: nil, read: readTypes) { [weak self] success, error in
            DispatchQueue.main.async {
                self?.isAuthorized = success
                if success {
                    self?.startHeartRateObserver()
                    self?.fetchTodaySteps()
                }
            }
            if let error = error {
                print("[Health] Authorization error: \(error.localizedDescription)")
            }
        }
    }

    // MARK: - Heart Rate Observer
    /// Uses HKAnchoredObjectQuery to get real-time heart rate updates.
    /// On Apple Watch, heart rate is sampled automatically every ~5 minutes
    /// and more frequently during workouts.
    private func startHeartRateObserver() {
        let calendar = Calendar.current
        let startOfDay = calendar.startOfDay(for: Date())
        let predicate = HKQuery.predicateForSamples(
            withStart: startOfDay,
            end: nil,
            options: .strictEndDate
        )

        heartRateQuery = HKAnchoredObjectQuery(
            type: heartRateType,
            predicate: predicate,
            anchor: nil,
            limit: HKObjectQueryNoLimit
        ) { [weak self] _, samples, _, _, error in
            self?.processHeartRateSamples(samples)
        }

        heartRateQuery?.updateHandler = { [weak self] _, samples, _, _, error in
            self?.processHeartRateSamples(samples)
        }

        if let query = heartRateQuery {
            healthStore.execute(query)
        }
    }

    private func processHeartRateSamples(_ samples: [HKSample]?) {
        guard let quantitySamples = samples as? [HKQuantitySample],
              let latest = quantitySamples.last else { return }

        let bpm = latest.quantity.doubleValue(
            for: HKUnit.count().unitDivided(by: .minute())
        )

        DispatchQueue.main.async {
            self.latestHeartRate = bpm
            // Send to iPhone
            WatchConnectivityManager.shared.sendHeartRate(bpm)
        }
    }

    // MARK: - Steps
    private func fetchTodaySteps() {
        let calendar = Calendar.current
        let startOfDay = calendar.startOfDay(for: Date())

        let predicate = HKQuery.predicateForSamples(
            withStart: startOfDay,
            end: Date(),
            options: .strictStartDate
        )

        let query = HKStatisticsQuery(
            quantityType: stepsType,
            quantitySamplePredicate: predicate,
            options: .cumulativeSum
        ) { [weak self] _, result, error in
            guard let sum = result?.sumQuantity() else { return }
            let steps = Int(sum.doubleValue(for: .count()))
            DispatchQueue.main.async {
                self?.todaySteps = steps
            }
        }

        healthStore.execute(query)
    }

    // MARK: - Cleanup
    func stopObserving() {
        if let query = heartRateQuery {
            healthStore.stop(query)
        }
    }

    deinit {
        stopObserving()
    }
}
