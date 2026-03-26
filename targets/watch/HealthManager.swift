import Foundation
import HealthKit

/// Manages HealthKit integration on Apple Watch.
/// Reads heart rate, step count, SpO2, and sleep data to monitor elderly well-being.
class HealthManager: NSObject, ObservableObject {

    // MARK: - Singleton
    static let shared = HealthManager()

    // MARK: - Published state
    @Published var latestHeartRate: Double = 0
    @Published var todaySteps: Int = 0
    @Published var bloodOxygen: Double = 0
    @Published var sleepHours: Double = 0
    @Published var isAuthorized: Bool = false

    // MARK: - Private
    private let healthStore: HKHealthStore?
    private var heartRateQuery: HKAnchoredObjectQuery?
    private var stepsQuery: HKStatisticsCollectionQuery?
    private var spo2Query: HKAnchoredObjectQuery?
    private var hasRequestedAuth = false

    // MARK: - Health data types (lazy to avoid crash if HealthKit unavailable)
    private lazy var heartRateType = HKQuantityType.quantityType(forIdentifier: .heartRate)
    private lazy var stepsType = HKQuantityType.quantityType(forIdentifier: .stepCount)
    private lazy var spo2Type = HKQuantityType.quantityType(forIdentifier: .oxygenSaturation)
    private lazy var sleepType = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis)

    // MARK: - Init
    override init() {
        if HKHealthStore.isHealthDataAvailable() {
            self.healthStore = HKHealthStore()
        } else {
            self.healthStore = nil
        }
        super.init()
    }

    // MARK: - Authorization
    func requestAuthorization() {
        guard !hasRequestedAuth else { return }
        guard let healthStore = healthStore else {
            print("[Health] HealthKit not available on this device")
            return
        }
        guard let heartRateType = heartRateType,
              let stepsType = stepsType,
              let spo2Type = spo2Type,
              let sleepType = sleepType else {
            print("[Health] Could not create HealthKit types")
            return
        }

        hasRequestedAuth = true
        let readTypes: Set<HKObjectType> = [heartRateType, stepsType, spo2Type, sleepType]

        healthStore.requestAuthorization(toShare: nil, read: readTypes) { [weak self] success, error in
            DispatchQueue.main.async {
                self?.isAuthorized = success
                if success {
                    self?.startHeartRateObserver()
                    self?.fetchTodaySteps()
                    self?.startSpO2Observer()
                    self?.fetchTodaySleep()
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
        guard let healthStore = healthStore, let heartRateType = heartRateType else { return }

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

    // MARK: - SpO2 (Blood Oxygen) Observer
    /// Uses HKAnchoredObjectQuery for real-time SpO2 updates.
    /// Apple Watch measures blood oxygen periodically in the background
    /// and on-demand via the Blood Oxygen app.
    private func startSpO2Observer() {
        guard let healthStore = healthStore, let spo2Type = spo2Type else { return }

        let calendar = Calendar.current
        let startOfDay = calendar.startOfDay(for: Date())
        let predicate = HKQuery.predicateForSamples(
            withStart: startOfDay,
            end: nil,
            options: .strictEndDate
        )

        spo2Query = HKAnchoredObjectQuery(
            type: spo2Type,
            predicate: predicate,
            anchor: nil,
            limit: HKObjectQueryNoLimit
        ) { [weak self] _, samples, _, _, error in
            self?.processSpO2Samples(samples)
        }

        spo2Query?.updateHandler = { [weak self] _, samples, _, _, error in
            self?.processSpO2Samples(samples)
        }

        if let query = spo2Query {
            healthStore.execute(query)
        }
    }

    private func processSpO2Samples(_ samples: [HKSample]?) {
        guard let quantitySamples = samples as? [HKQuantitySample],
              let latest = quantitySamples.last else { return }

        // SpO2 is stored as a fraction (0.0-1.0), convert to percentage
        let spo2 = latest.quantity.doubleValue(for: HKUnit.percent()) * 100.0

        DispatchQueue.main.async {
            self.bloodOxygen = spo2
            // Send to iPhone
            WatchConnectivityManager.shared.sendHealthData(type: "spo2", value: spo2)

            // Alert if SpO2 drops below 90%
            if spo2 < 90.0 {
                WatchConnectivityManager.shared.sendLowSpO2Alert(spo2)
            }
        }
    }

    // MARK: - Sleep Analysis
    /// Queries sleep data for the last 24 hours and calculates total sleep duration.
    private func fetchTodaySleep() {
        guard let healthStore = healthStore, let sleepType = sleepType else { return }

        let calendar = Calendar.current
        let now = Date()
        // Look back 24 hours to capture overnight sleep
        guard let startOfYesterday = calendar.date(byAdding: .hour, value: -24, to: now) else {
            print("[Health] Could not compute yesterday's date")
            return
        }

        let predicate = HKQuery.predicateForSamples(
            withStart: startOfYesterday,
            end: now,
            options: .strictStartDate
        )

        let query = HKSampleQuery(
            sampleType: sleepType,
            predicate: predicate,
            limit: HKObjectQueryNoLimit,
            sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]
        ) { [weak self] _, samples, error in
            guard let categorySamples = samples as? [HKCategorySample] else { return }

            // Sum up all asleep intervals (InBed is excluded, only count actual sleep)
            var totalSleepSeconds: TimeInterval = 0
            for sample in categorySamples {
                // Include asleepCore, asleepDeep, asleepREM, and legacy asleep
                let value = HKCategoryValueSleepAnalysis(rawValue: sample.value)
                if value == .asleepCore || value == .asleepDeep || value == .asleepREM || value == .asleep {
                    totalSleepSeconds += sample.endDate.timeIntervalSince(sample.startDate)
                }
            }

            let hours = totalSleepSeconds / 3600.0

            DispatchQueue.main.async {
                self?.sleepHours = hours
                WatchConnectivityManager.shared.sendHealthData(type: "sleep", value: hours)
            }
        }

        healthStore.execute(query)
    }

    // MARK: - Steps
    private func fetchTodaySteps() {
        guard let healthStore = healthStore, let stepsType = stepsType else { return }

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
            healthStore?.stop(query)
        }
        if let query = spo2Query {
            healthStore?.stop(query)
        }
    }

    deinit {
        stopObserving()
    }
}
