import { requireNativeModule, Platform } from "expo-modules-core";

interface BloodPressure {
  systolic: number;
  diastolic: number;
}

// Only load the native module on iOS
let ExpoHealthkit: any = null;
try {
  if (Platform.OS === "ios") {
    ExpoHealthkit = requireNativeModule("ExpoHealthkit");
  }
} catch {
  // Module failed to load — HealthKit unavailable or native module missing
  ExpoHealthkit = null;
}

/**
 * Check if HealthKit is available on this device.
 */
export async function isAvailable(): Promise<boolean> {
  if (!ExpoHealthkit) return false;
  try {
    return await ExpoHealthkit.isAvailable();
  } catch {
    return false;
  }
}

/**
 * Request HealthKit read authorization for heart rate, steps,
 * blood oxygen, blood pressure, and sleep analysis.
 */
export async function requestAuthorization(): Promise<boolean> {
  if (!ExpoHealthkit) return false;
  try {
    return await ExpoHealthkit.requestAuthorization();
  } catch {
    return false;
  }
}

/**
 * Get the latest heart rate reading from the last 24 hours.
 * Returns BPM or null if no data.
 */
export async function getHeartRate(): Promise<number | null> {
  if (!ExpoHealthkit) return null;
  try {
    return await ExpoHealthkit.getHeartRate();
  } catch {
    return null;
  }
}

/**
 * Get today's total step count.
 */
export async function getStepCount(): Promise<number> {
  if (!ExpoHealthkit) return 0;
  try {
    return (await ExpoHealthkit.getStepCount()) ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Get the latest blood oxygen (SpO2) percentage from the last 24 hours.
 * Returns percentage (0-100) or null if no data.
 */
export async function getBloodOxygen(): Promise<number | null> {
  if (!ExpoHealthkit) return null;
  try {
    return await ExpoHealthkit.getBloodOxygen();
  } catch {
    return null;
  }
}

/**
 * Get last night's total sleep hours (last 24 hours of asleep time).
 * Returns hours or null if no data.
 */
export async function getSleepHours(): Promise<number | null> {
  if (!ExpoHealthkit) return null;
  try {
    return await ExpoHealthkit.getSleepHours();
  } catch {
    return null;
  }
}

/**
 * Get the latest blood pressure reading from the last 24 hours.
 * Returns { systolic, diastolic } or null if no data.
 */
export async function getBloodPressure(): Promise<BloodPressure | null> {
  if (!ExpoHealthkit) return null;
  try {
    return await ExpoHealthkit.getBloodPressure();
  } catch {
    return null;
  }
}
