import ExpoModulesCore
import HealthKit

public class ExpoHealthkitModule: Module {
  // Lazy-initialize HKHealthStore to avoid crash on module load
  // when HealthKit entitlement is missing or unavailable
  private lazy var healthStore: HKHealthStore? = {
    guard HKHealthStore.isHealthDataAvailable() else { return nil }
    return HKHealthStore()
  }()

  public func definition() -> ModuleDefinition {
    Name("ExpoHealthkit")

    AsyncFunction("requestAuthorization") { (promise: Promise) in
      do {
        guard #available(iOS 13.0, *) else {
          promise.resolve(false)
          return
        }

        guard HKHealthStore.isHealthDataAvailable(), let store = self.healthStore else {
          promise.resolve(false)
          return
        }

        var readTypes = Set<HKObjectType>()
        if let hr = HKObjectType.quantityType(forIdentifier: .heartRate) { readTypes.insert(hr) }
        if let sc = HKObjectType.quantityType(forIdentifier: .stepCount) { readTypes.insert(sc) }
        if let ox = HKObjectType.quantityType(forIdentifier: .oxygenSaturation) { readTypes.insert(ox) }
        if let sys = HKObjectType.quantityType(forIdentifier: .bloodPressureSystolic) { readTypes.insert(sys) }
        if let dia = HKObjectType.quantityType(forIdentifier: .bloodPressureDiastolic) { readTypes.insert(dia) }
        if let sleep = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) { readTypes.insert(sleep) }

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
      } catch {
        promise.resolve(false)
      }
    }

    AsyncFunction("getHeartRate") { (promise: Promise) in
      self.queryLatestQuantity(
        typeIdentifier: .heartRate,
        unit: HKUnit(from: "count/min"),
        hoursBack: 24,
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
        hoursBack: 24,
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

    AsyncFunction("isAvailable") { () -> Bool in
      guard #available(iOS 13.0, *) else { return false }
      return HKHealthStore.isHealthDataAvailable()
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
    guard #available(iOS 13.0, *) else {
      promise.resolve(nil)
      return
    }

    guard let store = self.healthStore else {
      promise.resolve(nil)
      return
    }

    guard let sampleType = HKSampleType.quantityType(forIdentifier: typeIdentifier) else {
      promise.resolve(nil)
      return
    }

    let now = Date()
    guard let startDate = Calendar.current.date(byAdding: .hour, value: -hoursBack, to: now) else {
      promise.resolve(nil)
      return
    }
    let predicate = HKQuery.predicateForSamples(withStart: startDate, end: now, options: .strictStartDate)
    let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)

    let query = HKSampleQuery(
      sampleType: sampleType,
      predicate: predicate,
      limit: 1,
      sortDescriptors: [sortDescriptor]
    ) { _, samples, error in
      if let error = error {
        promise.reject("HEALTHKIT_QUERY_ERROR", error.localizedDescription)
        return
      }
      guard let sample = samples?.first as? HKQuantitySample else {
        promise.resolve(nil)
        return
      }
      var value = sample.quantity.doubleValue(for: unit)
      if multiplyBy100 {
        value = value * 100.0
      }
      promise.resolve(round(value * 10) / 10)
    }

    store.execute(query)
  }

  // MARK: - Query today's step count (cumulative)

  private func queryStepCount(promise: Promise) {
    guard #available(iOS 13.0, *) else {
      promise.resolve(0)
      return
    }

    guard let store = self.healthStore else {
      promise.resolve(0)
      return
    }

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
    ) { _, statistics, error in
      if error != nil {
        promise.resolve(0)
        return
      }
      let steps = statistics?.sumQuantity()?.doubleValue(for: HKUnit.count()) ?? 0
      promise.resolve(Int(steps))
    }

    store.execute(query)
  }

  // MARK: - Query last night's sleep hours

  private func querySleepHours(promise: Promise) {
    guard #available(iOS 13.0, *) else {
      promise.resolve(nil)
      return
    }

    guard let store = self.healthStore else {
      promise.resolve(nil)
      return
    }

    guard let sleepType = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) else {
      promise.resolve(nil)
      return
    }

    let now = Date()
    guard let startDate = Calendar.current.date(byAdding: .hour, value: -24, to: now) else {
      promise.resolve(nil)
      return
    }
    let predicate = HKQuery.predicateForSamples(withStart: startDate, end: now, options: .strictStartDate)
    let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)

    let query = HKSampleQuery(
      sampleType: sleepType,
      predicate: predicate,
      limit: HKObjectQueryNoLimit,
      sortDescriptors: [sortDescriptor]
    ) { _, samples, error in
      if error != nil {
        promise.resolve(nil)
        return
      }
      guard let categorySamples = samples as? [HKCategorySample] else {
        promise.resolve(nil)
        return
      }

      var totalSleepSeconds: TimeInterval = 0
      for sample in categorySamples {
        let value = sample.value
        if value == HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue
          || value == HKCategoryValueSleepAnalysis.asleepCore.rawValue
          || value == HKCategoryValueSleepAnalysis.asleepDeep.rawValue
          || value == HKCategoryValueSleepAnalysis.asleepREM.rawValue
        {
          totalSleepSeconds += sample.endDate.timeIntervalSince(sample.startDate)
        }
      }

      if totalSleepSeconds > 0 {
        let hours = round((totalSleepSeconds / 3600.0) * 10) / 10
        promise.resolve(hours)
      } else {
        promise.resolve(nil)
      }
    }

    store.execute(query)
  }

  // MARK: - Query latest blood pressure

  private func queryBloodPressure(promise: Promise) {
    guard #available(iOS 13.0, *) else {
      promise.resolve(nil)
      return
    }

    guard let store = self.healthStore else {
      promise.resolve(nil)
      return
    }

    guard let sysType = HKSampleType.quantityType(forIdentifier: .bloodPressureSystolic) else {
      promise.resolve(nil)
      return
    }

    let now = Date()
    guard let startDate = Calendar.current.date(byAdding: .hour, value: -24, to: now) else {
      promise.resolve(nil)
      return
    }
    let predicate = HKQuery.predicateForSamples(withStart: startDate, end: now, options: .strictStartDate)
    let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)

    let query = HKSampleQuery(
      sampleType: sysType,
      predicate: predicate,
      limit: 1,
      sortDescriptors: [sortDescriptor]
    ) { _, samples, error in
      if error != nil {
        promise.resolve(nil)
        return
      }
      guard let sample = samples?.first as? HKQuantitySample else {
        promise.resolve(nil)
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
      ) { _, diaSamples, diaError in
        let diastolic: Int
        if let diaSample = diaSamples?.first as? HKQuantitySample {
          diastolic = Int(diaSample.quantity.doubleValue(for: mmHg))
        } else {
          diastolic = 0
        }
        promise.resolve(["systolic": systolic, "diastolic": diastolic])
      }

      store.execute(diaQuery)
    }

    store.execute(query)
  }
}
