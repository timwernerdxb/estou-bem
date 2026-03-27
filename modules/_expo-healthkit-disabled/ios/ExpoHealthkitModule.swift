import ExpoModulesCore
import HealthKit

public class ExpoHealthkitModule: Module {
  private let healthStore = HKHealthStore()

  public func definition() -> ModuleDefinition {
    Name("ExpoHealthkit")

    AsyncFunction("requestAuthorization") { (promise: Promise) in
      guard HKHealthStore.isHealthDataAvailable() else {
        promise.resolve(false)
        return
      }

      let readTypes: Set<HKObjectType> = [
        HKObjectType.quantityType(forIdentifier: .heartRate)!,
        HKObjectType.quantityType(forIdentifier: .stepCount)!,
        HKObjectType.quantityType(forIdentifier: .oxygenSaturation)!,
        HKObjectType.quantityType(forIdentifier: .bloodPressureSystolic)!,
        HKObjectType.quantityType(forIdentifier: .bloodPressureDiastolic)!,
        HKObjectType.categoryType(forIdentifier: .sleepAnalysis)!,
      ]

      self.healthStore.requestAuthorization(toShare: nil, read: readTypes) { success, error in
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
    guard let sampleType = HKSampleType.quantityType(forIdentifier: typeIdentifier) else {
      promise.resolve(nil)
      return
    }

    let now = Date()
    let startDate = Calendar.current.date(byAdding: .hour, value: -hoursBack, to: now)!
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

    healthStore.execute(query)
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
    ) { _, statistics, error in
      if let error = error {
        promise.reject("HEALTHKIT_QUERY_ERROR", error.localizedDescription)
        return
      }
      let steps = statistics?.sumQuantity()?.doubleValue(for: HKUnit.count()) ?? 0
      promise.resolve(Int(steps))
    }

    healthStore.execute(query)
  }

  // MARK: - Query last night's sleep hours

  private func querySleepHours(promise: Promise) {
    guard let sleepType = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) else {
      promise.resolve(nil)
      return
    }

    let now = Date()
    let startDate = Calendar.current.date(byAdding: .hour, value: -24, to: now)!
    let predicate = HKQuery.predicateForSamples(withStart: startDate, end: now, options: .strictStartDate)
    let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)

    let query = HKSampleQuery(
      sampleType: sleepType,
      predicate: predicate,
      limit: HKObjectQueryNoLimit,
      sortDescriptors: [sortDescriptor]
    ) { _, samples, error in
      if let error = error {
        promise.reject("HEALTHKIT_QUERY_ERROR", error.localizedDescription)
        return
      }
      guard let categorySamples = samples as? [HKCategorySample] else {
        promise.resolve(nil)
        return
      }

      var totalSleepSeconds: TimeInterval = 0
      for sample in categorySamples {
        // Asleep states: asleepUnspecified(1), asleepCore(3), asleepDeep(4), asleepREM(5)
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

    healthStore.execute(query)
  }

  // MARK: - Query latest blood pressure

  private func queryBloodPressure(promise: Promise) {
    guard let sysType = HKSampleType.quantityType(forIdentifier: .bloodPressureSystolic) else {
      promise.resolve(nil)
      return
    }

    let now = Date()
    let startDate = Calendar.current.date(byAdding: .hour, value: -24, to: now)!
    let predicate = HKQuery.predicateForSamples(withStart: startDate, end: now, options: .strictStartDate)
    let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)

    let query = HKSampleQuery(
      sampleType: sysType,
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
      let mmHg = HKUnit.millimeterOfMercury()
      let systolic = Int(sample.quantity.doubleValue(for: mmHg))

      // Now query diastolic
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

      self.healthStore.execute(diaQuery)
    }

    healthStore.execute(query)
  }
}
