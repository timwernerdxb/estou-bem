import ExpoModulesCore
import HealthKit

public class ExpoHealthkitModule: Module {
  private let healthStore = HKHealthStore()

  public func definition() -> ModuleDefinition {
    Name("ExpoHealthkit")

    AsyncFunction("requestAuthorization") { (promise: Promise) in
      let store = self.healthStore

      var readTypes = Set<HKObjectType>()
      if let hr = HKObjectType.quantityType(forIdentifier: .heartRate) { readTypes.insert(hr) }
      if let sc = HKObjectType.quantityType(forIdentifier: .stepCount) { readTypes.insert(sc) }
      if let ox = HKObjectType.quantityType(forIdentifier: .oxygenSaturation) { readTypes.insert(ox) }
      if let sys = HKObjectType.quantityType(forIdentifier: .bloodPressureSystolic) { readTypes.insert(sys) }
      if let dia = HKObjectType.quantityType(forIdentifier: .bloodPressureDiastolic) { readTypes.insert(dia) }
      if let sleep = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) { readTypes.insert(sleep) }
      if let cal = HKObjectType.quantityType(forIdentifier: .activeEnergyBurned) { readTypes.insert(cal) }

      guard !readTypes.isEmpty else {
        promise.resolve(false)
        return
      }

      store.requestAuthorization(toShare: nil, read: readTypes) { success, error in
        if let error = error {
          promise.reject("HEALTHKIT_AUTH_ERROR", error.localizedDescription)
        } else {
          promise.resolve(success)
        }
      }
    }

    AsyncFunction("getHeartRate") { (promise: Promise) in
      self.queryLatestQuantity(
        typeIdentifier: .heartRate,
        unit: HKUnit(from: "count/min"),
        hoursBack: 720, // last 30 days — show most recent reading ever available
        promise: promise
      )
    }

    AsyncFunction("getStepCount") { (promise: Promise) in
      self.queryStepCount(promise: promise)
    }

    AsyncFunction("getBloodOxygen") { (promise: Promise) in
      self.queryLatestQuantity(
        typeIdentifier: .oxygenSaturation,
        unit: HKUnit.percent(),
        hoursBack: 720, // last 30 days — show most recent reading ever available
        promise: promise,
        multiplyBy100: true
      )
    }

    AsyncFunction("getSleepHours") { (promise: Promise) in
      self.querySleepHours(promise: promise)
    }

    AsyncFunction("getBloodPressure") { (promise: Promise) in
      self.queryBloodPressure(promise: promise)
    }

    AsyncFunction("getActiveCalories") { (promise: Promise) in
      self.queryTodayCalories(promise: promise)
    }

    AsyncFunction("isAvailable") { () -> Bool in
      return true
    }
  }

  // MARK: - Query latest quantity sample

  private func queryLatestQuantity(
    typeIdentifier: HKQuantityTypeIdentifier,
    unit: HKUnit,
    hoursBack: Int,
    promise: Promise,
    multiplyBy100: Bool = false
  ) {
    guard let sampleType = HKSampleType.quantityType(forIdentifier: typeIdentifier) else {
      promise.resolve(Optional<Double>.none as Any)
      return
    }

    let now = Date()
    guard let startDate = Calendar.current.date(byAdding: .hour, value: -hoursBack, to: now) else {
      promise.resolve(Optional<Double>.none as Any)
      return
    }
    let predicate = HKQuery.predicateForSamples(withStart: startDate, end: now, options: .strictStartDate)
    let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)

    let query = HKSampleQuery(
      sampleType: sampleType,
      predicate: predicate,
      limit: 1,
      sortDescriptors: [sortDescriptor]
    ) { _, samples, _ in
      guard let sample = samples?.first as? HKQuantitySample else {
        promise.resolve(Optional<Double>.none as Any)
        return
      }
      var value = sample.quantity.doubleValue(for: unit)
      if multiplyBy100 {
        value = value * 100.0
      }
      promise.resolve(round(value * 10) / 10)
    }

    self.healthStore.execute(query)
  }

  // MARK: - Query today's step count (cumulative)

  private func queryStepCount(promise: Promise) {
    guard let stepType = HKQuantityType.quantityType(forIdentifier: .stepCount) else {
      promise.resolve(0)
      return
    }

    let now = Date()
    let startOfDay = Calendar.current.startOfDay(for: now)
    let predicate = HKQuery.predicateForSamples(withStart: startOfDay, end: now, options: .strictStartDate)

    let query = HKStatisticsQuery(
      quantityType: stepType,
      quantitySamplePredicate: predicate,
      options: .cumulativeSum
    ) { _, statistics, _ in
      let steps = statistics?.sumQuantity()?.doubleValue(for: HKUnit.count()) ?? 0
      promise.resolve(Int(steps))
    }

    self.healthStore.execute(query)
  }

  // MARK: - Query today's active calories (cumulative)

  private func queryTodayCalories(promise: Promise) {
    guard let calType = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned) else {
      promise.resolve(0)
      return
    }

    let now = Date()
    let startOfDay = Calendar.current.startOfDay(for: now)
    let predicate = HKQuery.predicateForSamples(withStart: startOfDay, end: now, options: .strictStartDate)

    let query = HKStatisticsQuery(
      quantityType: calType,
      quantitySamplePredicate: predicate,
      options: .cumulativeSum
    ) { _, statistics, _ in
      let kcal = statistics?.sumQuantity()?.doubleValue(for: HKUnit.kilocalorie()) ?? 0
      promise.resolve(Int(kcal))
    }

    self.healthStore.execute(query)
  }

  // MARK: - Query last night's sleep hours

  private func querySleepHours(promise: Promise) {
    guard let sleepType = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) else {
      promise.resolve(Optional<Double>.none as Any)
      return
    }

    let now = Date()
    // Look back 36 hours to always catch last night's sleep
    guard let startDate = Calendar.current.date(byAdding: .hour, value: -36, to: now) else {
      promise.resolve(Optional<Double>.none as Any)
      return
    }
    let predicate = HKQuery.predicateForSamples(withStart: startDate, end: now, options: .strictStartDate)
    let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)

    let query = HKSampleQuery(
      sampleType: sleepType,
      predicate: predicate,
      limit: HKObjectQueryNoLimit,
      sortDescriptors: [sortDescriptor]
    ) { _, samples, _ in
      guard let categorySamples = samples as? [HKCategorySample] else {
        promise.resolve(Optional<Double>.none as Any)
        return
      }

      var totalSleepSeconds: TimeInterval = 0
      for sample in categorySamples {
        let value = sample.value
        var isSleeping = false
        if #available(iOS 16.0, *) {
          isSleeping = value == HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue
            || value == HKCategoryValueSleepAnalysis.asleepCore.rawValue
            || value == HKCategoryValueSleepAnalysis.asleepDeep.rawValue
            || value == HKCategoryValueSleepAnalysis.asleepREM.rawValue
        } else {
          // iOS 15: only .asleep is available
          isSleeping = value == HKCategoryValueSleepAnalysis.asleep.rawValue
        }
        if isSleeping {
          totalSleepSeconds += sample.endDate.timeIntervalSince(sample.startDate)
        }
      }

      if totalSleepSeconds > 0 {
        let hours = round((totalSleepSeconds / 3600.0) * 10) / 10
        promise.resolve(hours)
      } else {
        promise.resolve(Optional<Double>.none as Any)
      }
    }

    self.healthStore.execute(query)
  }

  // MARK: - Query latest blood pressure

  private func queryBloodPressure(promise: Promise) {
    guard let sysType = HKSampleType.quantityType(forIdentifier: .bloodPressureSystolic) else {
      promise.resolve(Optional<[String: Int]>.none as Any)
      return
    }

    let now = Date()
    // Look back 30 days — show most recent BP reading available
    guard let startDate = Calendar.current.date(byAdding: .hour, value: -720, to: now) else {
      promise.resolve(Optional<[String: Int]>.none as Any)
      return
    }
    let predicate = HKQuery.predicateForSamples(withStart: startDate, end: now, options: .strictStartDate)
    let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)

    let query = HKSampleQuery(
      sampleType: sysType,
      predicate: predicate,
      limit: 1,
      sortDescriptors: [sortDescriptor]
    ) { _, samples, _ in
      guard let sample = samples?.first as? HKQuantitySample else {
        promise.resolve(Optional<[String: Int]>.none as Any)
        return
      }
      let mmHg = HKUnit.millimeterOfMercury()
      let systolic = Int(sample.quantity.doubleValue(for: mmHg))

      guard let diaType = HKSampleType.quantityType(forIdentifier: .bloodPressureDiastolic) else {
        promise.resolve(["systolic": systolic, "diastolic": 0])
        return
      }

      let diaQuery = HKSampleQuery(
        sampleType: diaType,
        predicate: predicate,
        limit: 1,
        sortDescriptors: [sortDescriptor]
      ) { _, diaSamples, _ in
        let diastolic: Int
        if let diaSample = diaSamples?.first as? HKQuantitySample {
          diastolic = Int(diaSample.quantity.doubleValue(for: mmHg))
        } else {
          diastolic = 0
        }
        promise.resolve(["systolic": systolic, "diastolic": diastolic])
      }

      self.healthStore.execute(diaQuery)
    }

    self.healthStore.execute(query)
  }
}
