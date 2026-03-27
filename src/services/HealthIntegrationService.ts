import { Platform } from "react-native";
import { HealthEntry, HealthMetricType } from "../types";
import { postHealth } from "./ApiService";
// expo-sensors Pedometer for iOS step count fallback
import { Pedometer } from "expo-sensors";

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

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

  // ─── iOS: Apple HealthKit (via react-native-health or expo plugin) ──
  // TODO: Install react-native-health or expo-health-connect for full HealthKit
  // access (heart rate, SpO2, etc.) directly on iPhone without Watch.
  // For now, we read step count via expo-sensors Pedometer as a fallback.
  private async initAppleHealth(): Promise<boolean> {
    try {
      // Check if Pedometer is available for step counting
      const available = await Pedometer.isAvailableAsync();
      if (available) {
        console.log("[AppleHealth] Pedometer available — will read step count from iPhone");
      } else {
        console.log("[AppleHealth] Pedometer not available on this device");
      }
      this.initialized = true;
      console.log("[AppleHealth] Ready (pedometer + watch relay mode)");
      return true;
    } catch (err) {
      console.warn("[AppleHealth] Init error:", err);
      this.initialized = true;
      return true;
    }
  }

  // Read step count from iPhone Pedometer (iOS fallback without Watch)
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
      // Read step count from iPhone Pedometer (direct, no Watch needed)
      const pedometerEntries = await this.readIOSPedometerData(elderId, hoursBack);
      entries = [...entries, ...pedometerEntries];
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

    // iOS: check pedometer for recent movement
    if (Platform.OS === "ios") {
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

  getPlatformName(): string {
    if (Platform.OS === "android") return "Samsung Health / Health Connect";
    if (Platform.OS === "ios") return "Apple Health";
    return "Não disponível";
  }
}

export const healthIntegrationService = new HealthIntegrationService();
