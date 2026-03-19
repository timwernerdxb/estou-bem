import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Accelerometer } from "expo-sensors";
import { healthIntegrationService } from "./HealthIntegrationService";
import { checkInService } from "./CheckInService";
import { CheckIn } from "../types";

export type CheckinMode = "manual" | "auto_movement" | "auto_wearable";

interface AutoCheckinConfig {
  mode: CheckinMode;
  movementThreshold: number; // min steps or movement events to auto-confirm
  windowMinutes: number; // how many minutes around scheduled time to check
}

const CONFIG_KEY = "@estoubem_autocheckin_config";
const DEFAULT_CONFIG: AutoCheckinConfig = {
  mode: "manual",
  movementThreshold: 10, // 10 steps minimum
  windowMinutes: 30, // check 30 min around scheduled time
};

class AutoCheckinService {
  private config: AutoCheckinConfig = DEFAULT_CONFIG;
  private accelSubscription: ReturnType<typeof Accelerometer.addListener> | null = null;
  private lastSignificantMovement: Date = new Date();
  private movementCount = 0;
  private isMonitoring = false;

  async initialize(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(CONFIG_KEY);
      if (stored) this.config = { ...DEFAULT_CONFIG, ...JSON.parse(stored) };
    } catch (err) {
      console.warn("[AutoCheckin] Load config error:", err);
    }
  }

  async setMode(mode: CheckinMode): Promise<void> {
    this.config.mode = mode;
    await this.saveConfig();

    if (mode === "manual") {
      this.stopMonitoring();
    } else {
      await this.startMonitoring();
    }
  }

  getMode(): CheckinMode {
    return this.config.mode;
  }

  getConfig(): AutoCheckinConfig {
    return { ...this.config };
  }

  async updateConfig(partial: Partial<AutoCheckinConfig>): Promise<void> {
    this.config = { ...this.config, ...partial };
    await this.saveConfig();
  }

  // ─── Start monitoring movement ──────────────────────────────
  async startMonitoring(): Promise<void> {
    if (this.isMonitoring || this.config.mode === "manual") return;

    if (this.config.mode === "auto_movement") {
      await this.startAccelerometerMonitoring();
    }

    if (this.config.mode === "auto_wearable") {
      await healthIntegrationService.initialize();
    }

    this.isMonitoring = true;
    console.log(`[AutoCheckin] Monitoring started (mode: ${this.config.mode})`);
  }

  stopMonitoring(): void {
    this.accelSubscription?.remove();
    this.accelSubscription = null;
    this.isMonitoring = false;
    this.movementCount = 0;
    console.log("[AutoCheckin] Monitoring stopped");
  }

  // ─── Check if we should auto-confirm a pending check-in ─────
  async shouldAutoConfirm(pendingCheckin: CheckIn): Promise<{
    shouldConfirm: boolean;
    source: "wearable" | "accelerometer";
  }> {
    if (this.config.mode === "manual") {
      return { shouldConfirm: false, source: "accelerometer" };
    }

    // Check wearable data (Health Connect / Apple Health)
    if (this.config.mode === "auto_wearable") {
      const hasMovement = await healthIntegrationService.hasRecentMovement(1);
      if (hasMovement) {
        return { shouldConfirm: true, source: "wearable" };
      }
    }

    // Check phone accelerometer movement
    if (this.config.mode === "auto_movement") {
      const recentMovement = this.hasRecentPhoneMovement();
      if (recentMovement) {
        return { shouldConfirm: true, source: "accelerometer" };
      }
    }

    return { shouldConfirm: false, source: "accelerometer" };
  }

  // ─── Process pending check-in with auto-confirm logic ───────
  async processCheckin(pendingCheckin: CheckIn): Promise<CheckIn | null> {
    const { shouldConfirm, source } = await this.shouldAutoConfirm(pendingCheckin);

    if (shouldConfirm) {
      console.log(`[AutoCheckin] Auto-confirming via ${source}`);
      return checkInService.autoConfirmCheckin(pendingCheckin, source);
    }

    return null; // Not auto-confirmed, needs manual action
  }

  // ─── Phone accelerometer monitoring ─────────────────────────
  private async startAccelerometerMonitoring(): Promise<void> {
    try {
      const { status } = await Accelerometer.requestPermissionsAsync();
      if (status !== "granted") {
        console.warn("[AutoCheckin] Accelerometer permission denied");
        return;
      }

      Accelerometer.setUpdateInterval(1000); // 1Hz for battery efficiency

      this.accelSubscription = Accelerometer.addListener((data) => {
        const magnitude = Math.sqrt(data.x ** 2 + data.y ** 2 + data.z ** 2);
        // Significant movement = deviation from resting (1g)
        if (Math.abs(magnitude - 1.0) > 0.3) {
          this.movementCount++;
          this.lastSignificantMovement = new Date();
        }
      });
    } catch (err) {
      console.warn("[AutoCheckin] Accelerometer error:", err);
    }
  }

  private hasRecentPhoneMovement(withinMinutes: number = 30): boolean {
    const cutoff = Date.now() - withinMinutes * 60 * 1000;
    return (
      this.lastSignificantMovement.getTime() > cutoff &&
      this.movementCount >= this.config.movementThreshold
    );
  }

  // ─── Reset movement counter (call after auto-confirm) ───────
  resetMovementCounter(): void {
    this.movementCount = 0;
  }

  private async saveConfig(): Promise<void> {
    try {
      await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(this.config));
    } catch (err) {
      console.warn("[AutoCheckin] Save config error:", err);
    }
  }
}

export const autoCheckinService = new AutoCheckinService();
