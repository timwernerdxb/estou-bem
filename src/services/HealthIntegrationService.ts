import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { HealthEntry, HealthMetricType } from "../types";
import { postHealth, postActivityUpdate } from "./ApiService";
// expo-sensors Pedometer for iOS step count fallback
import { Pedometer } from "expo-sensors";

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

const HEALTHKIT_AUTHORIZED_KEY = "@estoubem_healthkit_authorized";

// ─── HealthKit summary returned to UI ──────────────────────────
export interface HealthSummary {
  heartRate?: number;
  heartRateTime?: string;
  steps?: number;
  bloodPressureSystolic?: number;
  bloodPressureDiastolic?: number;
  spo2?: number;
  sleepHours?: number;
  lastUpdated?: string;
}

const HEALTH_SUMMARY_KEY = "@estoubem_health_summary";

// Health Connect types for Android (expo-health-connect)
interface HealthConnectRecord {
  time?: string;
  startTime?: string;
  endTime?: string;
  samples?: Array<{ time: string; beatsPerMinute: number }>;
  systolic?: { inMillimetersOfMercury: number };
  diastolic?: { inMillimetersOfMercury: number };
  percentage?: number;
  temperature?: { inCelsius: number };
  weight?: { inKilograms: number };
  count?: number;
}

class HealthIntegrationService {
  private initialized = false;
  private healthConnect: any = null;
  private healthKit: any = null;
  private healthKitAvailable = false;
  private syncIntervalId: ReturnType<typeof setInterval> | null = null;

  async initialize(): Promise<boolean> {
    if (this.initialized) return true;

    try {
      if (Platform.OS === "android") {
        return await this.initAndroidHealthConnect();
      } else if (Platform.OS === "ios") {
        return await this.initAppleHealth();
      }
      return false;
    } catch (err) {
      console.warn("[HealthIntegration] Init failed:", err);
      return false;
    }
  }

  // ─── Android: Health Connect ────────────────────────────────
  private async initAndroidHealthConnect(): Promise<boolean> {
    try {
      // react-native-health-connect is the runtime package.
      // expo-health-connect is a config plugin only (build-time).
      let HC: any;
      try {
        HC = require("react-native-health-connect");
      } catch {
        console.log("[HealthConnect] react-native-health-connect not installed, skipping");
        this.initialized = true;
        return true;
      }

      const available = await HC.getSdkStatus();
      if (available !== HC.SdkAvailabilityStatus.SDK_AVAILABLE) {
        console.warn("[HealthConnect] SDK not available, status:", available);
        return false;
      }

      await HC.initialize();
      this.healthConnect = HC;
      this.initialized = true;
      console.log("[HealthConnect] Initialized");
      return true;
    } catch (err) {
      console.warn("[HealthConnect] Init error:", err);
      return false;
    }
  }

  async requestAndroidPermissions(): Promise<boolean> {
    if (!this.healthConnect) return false;
    try {
      const HC = this.healthConnect;
      const permissions = [
        { accessType: "read", recordType: "HeartRate" },
        { accessType: "read", recordType: "Steps" },
        { accessType: "read", recordType: "BloodPressure" },
        { accessType: "read", recordType: "OxygenSaturation" },
        { accessType: "read", recordType: "BodyTemperature" },
        { accessType: "read", recordType: "Weight" },
      ];
      const granted = await HC.requestPermission(permissions);
      return granted.length > 0;
    } catch (err) {
      console.warn("[HealthConnect] Permission error:", err);
      return false;
    }
  }

  async readAndroidHealthData(
    elderId: string,
    hoursBack: number = 24
  ): Promise<HealthEntry[]> {
    if (!this.healthConnect) return [];
    const HC = this.healthConnect;
    const entries: HealthEntry[] = [];
    const startTime = new Date(Date.now() - hoursBack * 3600000).toISOString();
    const endTime = new Date().toISOString();
    const timeRange = { operator: "between", startTime, endTime };

    try {
      // Heart rate
      const hr = await HC.readRecords("HeartRate", { timeRangeFilter: timeRange });
      for (const record of hr.records || []) {
        for (const sample of record.samples || []) {
          entries.push({
            id: generateId(),
            elderId,
            timestamp: sample.time,
            type: "heart_rate",
            value: sample.beatsPerMinute,
            unit: "bpm",
          });
        }
      }

      // Steps
      const steps = await HC.readRecords("Steps", { timeRangeFilter: timeRange });
      for (const record of steps.records || []) {
        entries.push({
          id: generateId(),
          elderId,
          timestamp: record.endTime || record.startTime,
          type: "blood_glucose" as HealthMetricType, // reuse as steps
          value: record.count || 0,
          unit: "passos",
          notes: "steps",
        });
      }

      // Blood pressure
      const bp = await HC.readRecords("BloodPressure", { timeRangeFilter: timeRange });
      for (const record of bp.records || []) {
        entries.push({
          id: generateId(),
          elderId,
          timestamp: record.time,
          type: "blood_pressure_systolic",
          value: record.systolic?.inMillimetersOfMercury || 0,
          unit: "mmHg",
        });
        entries.push({
          id: generateId(),
          elderId,
          timestamp: record.time,
          type: "blood_pressure_diastolic",
          value: record.diastolic?.inMillimetersOfMercury || 0,
          unit: "mmHg",
        });
      }

      // Oxygen saturation
      const o2 = await HC.readRecords("OxygenSaturation", { timeRangeFilter: timeRange });
      for (const record of o2.records || []) {
        entries.push({
          id: generateId(),
          elderId,
          timestamp: record.time,
          type: "oxygen_saturation",
          value: (record.percentage || 0) * 100,
          unit: "%",
        });
      }

      // Body temperature
      const temp = await HC.readRecords("BodyTemperature", { timeRangeFilter: timeRange });
      for (const record of temp.records || []) {
        entries.push({
          id: generateId(),
          elderId,
          timestamp: record.time,
          type: "temperature",
          value: record.temperature?.inCelsius || 0,
          unit: "°C",
        });
      }

      // Weight
      const weight = await HC.readRecords("Weight", { timeRangeFilter: timeRange });
      for (const record of weight.records || []) {
        entries.push({
          id: generateId(),
          elderId,
          timestamp: record.time,
          type: "weight",
          value: record.weight?.inKilograms || 0,
          unit: "kg",
        });
      }
    } catch (err) {
      console.warn("[HealthConnect] Read error:", err);
    }

    return entries;
  }

  // ─── iOS: Apple HealthKit (via @kingstinct/react-native-healthkit) ──
  private async initAppleHealth(): Promise<boolean> {
    try {
      let HK: any;
      try {
        HK = require("@kingstinct/react-native-healthkit");
      } catch {
        console.log("[AppleHealth] @kingstinct/react-native-healthkit not installed, falling back to pedometer");
        this.initialized = true;
        return true;
      }

      // Check if HealthKit is available on this device
      const available = HK.isHealthDataAvailable();
      if (!available) {
        console.log("[AppleHealth] HealthKit not available on this device");
        this.initialized = true;
        return true;
      }

      this.healthKit = HK;
      this.healthKitAvailable = true;
      this.initialized = true;
      console.log("[AppleHealth] HealthKit available, ready to request authorization");
      return true;
    } catch (err) {
      console.warn("[AppleHealth] Init error:", err);
      // Still mark as initialized so the app doesn't get stuck
      this.initialized = true;
      return true;
    }
  }

  /**
   * Request HealthKit authorization. Should be called once on first launch
   * for elder users only. Checks AsyncStorage so we don't prompt repeatedly.
   */
  async requestAppleHealthPermissions(): Promise<boolean> {
    if (Platform.OS !== "ios" || !this.healthKit) return false;

    try {
      // Check if we already asked
      const alreadyAsked = await AsyncStorage.getItem(HEALTHKIT_AUTHORIZED_KEY);
      if (alreadyAsked === "true") {
        console.log("[AppleHealth] Already requested authorization, skipping prompt");
        return true;
      }

      const HK = this.healthKit;

      const granted = await HK.requestAuthorization({
        toRead: [
          "HKQuantityTypeIdentifierHeartRate",
          "HKQuantityTypeIdentifierStepCount",
          "HKQuantityTypeIdentifierBloodPressureSystolic",
          "HKQuantityTypeIdentifierBloodPressureDiastolic",
          "HKQuantityTypeIdentifierOxygenSaturation",
          "HKCategoryTypeIdentifierSleepAnalysis",
        ],
      });

      // Mark that we've asked (even if user denied, we don't ask again)
      await AsyncStorage.setItem(HEALTHKIT_AUTHORIZED_KEY, "true");

      console.log("[AppleHealth] Authorization result:", granted);
      return granted;
    } catch (err) {
      console.warn("[AppleHealth] Authorization error:", err);
      return false;
    }
  }

  /**
   * Read health data from Apple HealthKit (last N hours).
   * Returns a HealthSummary with the latest values.
   */
  async readAppleHealthSummary(hoursBack: number = 24): Promise<HealthSummary> {
    if (Platform.OS !== "ios" || !this.healthKit || !this.healthKitAvailable) {
      return {};
    }

    const HK = this.healthKit;
    const summary: HealthSummary = {};
    const startDate = new Date(Date.now() - hoursBack * 3600000);
    const endDate = new Date();

    try {
      // Heart rate — get most recent sample
      try {
        const hrSamples = await HK.queryQuantitySamples(
          "HKQuantityTypeIdentifierHeartRate",
          {
            limit: 1,
            ascending: false,
            unit: "count/min",
            filter: { date: { startDate, endDate } },
          }
        );
        if (hrSamples && hrSamples.length > 0) {
          summary.heartRate = Math.round(hrSamples[0].quantity);
          summary.heartRateTime = new Date(hrSamples[0].startDate).toLocaleTimeString(
            "pt-BR",
            { hour: "2-digit", minute: "2-digit" }
          );
        }
      } catch (e) {
        console.warn("[AppleHealth] Heart rate read error:", e);
      }

      // Step count — get cumulative sum for the day
      try {
        const stepSamples = await HK.queryStatisticsForQuantity(
          "HKQuantityTypeIdentifierStepCount",
          ["cumulativeSum"],
          {
            from: startDate,
            to: endDate,
            unit: "count",
          }
        );
        if (stepSamples && stepSamples.sumQuantity != null) {
          summary.steps = Math.round(stepSamples.sumQuantity);
        }
      } catch {
        // Fallback: try pedometer
        try {
          const available = await Pedometer.isAvailableAsync();
          if (available) {
            const result = await Pedometer.getStepCountAsync(startDate, endDate);
            if (result?.steps) {
              summary.steps = result.steps;
            }
          }
        } catch {}
      }

      // Blood pressure systolic — most recent
      try {
        const bpSys = await HK.queryQuantitySamples(
          "HKQuantityTypeIdentifierBloodPressureSystolic",
          {
            limit: 1,
            ascending: false,
            unit: "mmHg",
            filter: { date: { startDate, endDate } },
          }
        );
        if (bpSys && bpSys.length > 0) {
          summary.bloodPressureSystolic = Math.round(bpSys[0].quantity);
        }
      } catch (e) {
        console.warn("[AppleHealth] BP systolic read error:", e);
      }

      // Blood pressure diastolic — most recent
      try {
        const bpDia = await HK.queryQuantitySamples(
          "HKQuantityTypeIdentifierBloodPressureDiastolic",
          {
            limit: 1,
            ascending: false,
            unit: "mmHg",
            filter: { date: { startDate, endDate } },
          }
        );
        if (bpDia && bpDia.length > 0) {
          summary.bloodPressureDiastolic = Math.round(bpDia[0].quantity);
        }
      } catch (e) {
        console.warn("[AppleHealth] BP diastolic read error:", e);
      }

      // Oxygen saturation (SpO2) — most recent
      try {
        const spo2Samples = await HK.queryQuantitySamples(
          "HKQuantityTypeIdentifierOxygenSaturation",
          {
            limit: 1,
            ascending: false,
            unit: "%",
            filter: { date: { startDate, endDate } },
          }
        );
        if (spo2Samples && spo2Samples.length > 0) {
          // HealthKit stores SpO2 as a fraction (0.0–1.0), multiply by 100
          const raw = spo2Samples[0].quantity;
          summary.spo2 = Math.round(raw <= 1 ? raw * 100 : raw);
        }
      } catch (e) {
        console.warn("[AppleHealth] SpO2 read error:", e);
      }

      // Sleep analysis — sum of asleep time from last night
      try {
        // Look back further for sleep (last 24h should capture last night)
        const sleepSamples = await HK.queryCategorySamples(
          "HKCategoryTypeIdentifierSleepAnalysis",
          {
            limit: 0, // all samples
            ascending: false,
            filter: { date: { startDate, endDate } },
          }
        );
        if (sleepSamples && sleepSamples.length > 0) {
          // Sum up asleep durations (value > 0 means some form of sleep; 1=InBed, 2+=asleep variants)
          let totalSleepMs = 0;
          for (const sample of sleepSamples) {
            // value: 0 = InBed, 1 = AsleepUnspecified, 2 = Awake, 3 = AsleepCore, 4 = AsleepDeep, 5 = AsleepREM
            // Count asleep states (1, 3, 4, 5) — not InBed(0) or Awake(2)
            const val = sample.value;
            if (val === 1 || val === 3 || val === 4 || val === 5) {
              const start = new Date(sample.startDate).getTime();
              const end = new Date(sample.endDate).getTime();
              totalSleepMs += end - start;
            }
          }
          if (totalSleepMs > 0) {
            summary.sleepHours = Math.round((totalSleepMs / 3600000) * 10) / 10;
          }
        }
      } catch (e) {
        console.warn("[AppleHealth] Sleep read error:", e);
      }

      summary.lastUpdated = new Date().toISOString();

      // Cache locally for offline access
      try {
        await AsyncStorage.setItem(HEALTH_SUMMARY_KEY, JSON.stringify(summary));
      } catch {}

    } catch (err) {
      console.warn("[AppleHealth] Read summary error:", err);
    }

    return summary;
  }

  /**
   * Get cached health summary from AsyncStorage (for offline/immediate display).
   */
  async getCachedHealthSummary(): Promise<HealthSummary> {
    try {
      const cached = await AsyncStorage.getItem(HEALTH_SUMMARY_KEY);
      if (cached) return JSON.parse(cached);
    } catch {}
    return {};
  }

  /**
   * Read HealthKit data and convert to HealthEntry[] for server sync.
   */
  async readAppleHealthEntries(elderId: string, hoursBack: number = 24): Promise<HealthEntry[]> {
    const summary = await this.readAppleHealthSummary(hoursBack);
    const entries: HealthEntry[] = [];
    const now = new Date().toISOString();

    if (summary.heartRate) {
      entries.push({
        id: generateId(),
        elderId,
        timestamp: now,
        type: "heart_rate",
        value: summary.heartRate,
        unit: "bpm",
      });
    }

    if (summary.steps) {
      entries.push({
        id: generateId(),
        elderId,
        timestamp: now,
        type: "blood_glucose" as HealthMetricType, // reuse field as steps
        value: summary.steps,
        unit: "passos",
        notes: "steps",
      });
    }

    if (summary.bloodPressureSystolic) {
      entries.push({
        id: generateId(),
        elderId,
        timestamp: now,
        type: "blood_pressure_systolic",
        value: summary.bloodPressureSystolic,
        unit: "mmHg",
      });
    }

    if (summary.bloodPressureDiastolic) {
      entries.push({
        id: generateId(),
        elderId,
        timestamp: now,
        type: "blood_pressure_diastolic",
        value: summary.bloodPressureDiastolic,
        unit: "mmHg",
      });
    }

    if (summary.spo2) {
      entries.push({
        id: generateId(),
        elderId,
        timestamp: now,
        type: "oxygen_saturation",
        value: summary.spo2,
        unit: "%",
      });
    }

    return entries;
  }

  // Read step count from iPhone Pedometer (iOS fallback without HealthKit)
  async readIOSPedometerData(elderId: string, hoursBack: number = 24): Promise<HealthEntry[]> {
    if (Platform.OS !== "ios") return [];
    const entries: HealthEntry[] = [];
    try {
      const available = await Pedometer.isAvailableAsync();
      if (!available) return [];

      const end = new Date();
      const start = new Date(end.getTime() - hoursBack * 3600000);
      const result = await Pedometer.getStepCountAsync(start, end);
      if (result && result.steps > 0) {
        entries.push({
          id: generateId(),
          elderId,
          timestamp: end.toISOString(),
          type: "blood_glucose" as HealthMetricType, // reuse as steps
          value: result.steps,
          unit: "passos",
          notes: "steps",
        });
      }
    } catch (err) {
      console.warn("[AppleHealth] Pedometer read error:", err);
    }
    return entries;
  }

  // ─── Sync health entries to the server ──────────────────────
  async syncEntriesToServer(
    user: { apiUrl?: string; token?: string } | null,
    entries: HealthEntry[]
  ): Promise<void> {
    if (!user?.token || entries.length === 0) return;
    for (const entry of entries) {
      const ts = new Date(entry.timestamp);
      postHealth(user, {
        type: entry.type,
        value: entry.value,
        unit: entry.unit,
        time: ts.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", hour12: false }),
        date: ts.toISOString().slice(0, 10),
        notes: entry.notes,
      }).catch(() => {});
    }
  }

  /**
   * Sync health summary to server via POST /api/activity-update.
   * Fire-and-forget — never crashes if server is down.
   */
  async syncHealthSummaryToServer(
    user: { apiUrl?: string; token?: string; id?: string } | null,
    summary: HealthSummary
  ): Promise<void> {
    if (!user?.token) return;
    try {
      postActivityUpdate(user, {
        user_id: user.id ? Number(user.id) : 0,
        movement_detected: (summary.steps || 0) > 10,
        heart_rate: summary.heartRate,
        spo2: summary.spo2,
        sleep_hours: summary.sleepHours,
      }).catch(() => {});
    } catch {}
  }

  /**
   * Start periodic background health sync (every 5 minutes).
   * Call once from ElderHomeScreen for elder users only.
   */
  startPeriodicSync(
    user: { apiUrl?: string; token?: string; id?: string } | null,
    elderId: string
  ): void {
    if (this.syncIntervalId) return; // already running

    const doSync = async () => {
      try {
        if (Platform.OS === "ios" && this.healthKitAvailable) {
          const summary = await this.readAppleHealthSummary(24);
          // Sync summary to activity-update endpoint
          this.syncHealthSummaryToServer(user, summary).catch(() => {});
          // Also sync individual entries to health endpoint
          const entries = await this.readAppleHealthEntries(elderId, 1); // last hour only for periodic
          this.syncEntriesToServer(user, entries).catch(() => {});
        }
      } catch {}
    };

    // Initial sync
    doSync();

    // Repeat every 5 minutes
    this.syncIntervalId = setInterval(doSync, 5 * 60 * 1000);
  }

  stopPeriodicSync(): void {
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
  }

  // ─── Unified read (cross-platform) ──────────────────────────
  async readLatestHealthData(
    elderId: string,
    hoursBack: number = 24,
    user?: { apiUrl?: string; token?: string } | null
  ): Promise<HealthEntry[]> {
    if (!this.initialized) {
      const ok = await this.initialize();
      if (!ok) return [];
    }

    let entries: HealthEntry[] = [];

    if (Platform.OS === "android") {
      entries = await this.readAndroidHealthData(elderId, hoursBack);
    } else if (Platform.OS === "ios") {
      if (this.healthKitAvailable) {
        // Use real HealthKit data
        entries = await this.readAppleHealthEntries(elderId, hoursBack);
      } else {
        // Fallback to pedometer only
        const pedometerEntries = await this.readIOSPedometerData(elderId, hoursBack);
        entries = [...entries, ...pedometerEntries];
      }
    }

    // Sync any new entries to the server (fire-and-forget)
    if (entries.length > 0 && user) {
      this.syncEntriesToServer(user, entries).catch(() => {});
    }

    return entries;
  }

  // ─── Check if wearable data indicates movement (for auto check-in) ──
  async hasRecentMovement(hoursBack: number = 1): Promise<boolean> {
    if (!this.initialized) return false;

    if (Platform.OS === "android" && this.healthConnect) {
      try {
        const HC = this.healthConnect;
        const startTime = new Date(Date.now() - hoursBack * 3600000).toISOString();
        const endTime = new Date().toISOString();
        const steps = await HC.readRecords("Steps", {
          timeRangeFilter: { operator: "between", startTime, endTime },
        });
        const totalSteps = (steps.records || []).reduce(
          (sum: number, r: HealthConnectRecord) => sum + (r.count || 0),
          0
        );
        return totalSteps > 10; // any meaningful movement
      } catch {
        return false;
      }
    }

    // iOS: check HealthKit first, then pedometer fallback
    if (Platform.OS === "ios") {
      if (this.healthKitAvailable) {
        try {
          const summary = await this.readAppleHealthSummary(hoursBack);
          if (summary.steps && summary.steps > 10) return true;
        } catch {}
      }
      try {
        const available = await Pedometer.isAvailableAsync();
        if (!available) return false;
        const end = new Date();
        const start = new Date(end.getTime() - hoursBack * 3600000);
        const result = await Pedometer.getStepCountAsync(start, end);
        return (result?.steps || 0) > 10;
      } catch {
        return false;
      }
    }

    return false;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  isHealthKitAvailable(): boolean {
    return this.healthKitAvailable;
  }

  getPlatformName(): string {
    if (Platform.OS === "android") return "Samsung Health / Health Connect";
    if (Platform.OS === "ios") return "Apple Health";
    return "Não disponível";
  }
}

export const healthIntegrationService = new HealthIntegrationService();
