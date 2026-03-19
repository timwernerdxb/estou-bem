import { Accelerometer, AccelerometerMeasurement } from "expo-sensors";
import * as Notifications from "expo-notifications";
import * as Haptics from "expo-haptics";
import { SensorSnapshot } from "../types";

// Fall detection thresholds based on research
// A fall typically shows: free-fall (low g) → impact (high g) → rest
const FREE_FALL_THRESHOLD = 0.4; // g - below this suggests free-fall
const IMPACT_THRESHOLD = 3.0; // g - above this suggests impact
const POST_FALL_REST_THRESHOLD = 0.8; // g - near 1g = lying still
const DETECTION_WINDOW_MS = 2000;
const POST_IMPACT_WINDOW_MS = 3000;
const ACTIVITY_CHECK_INTERVAL_MS = 60000; // 1 minute

type FallCallback = (snapshot: SensorSnapshot) => void;

class FallDetectionService {
  private subscription: ReturnType<typeof Accelerometer.addListener> | null = null;
  private isMonitoring = false;
  private onFallDetected: FallCallback | null = null;
  private lastMovementTime: Date = new Date();

  // State for fall detection algorithm
  private recentReadings: { magnitude: number; timestamp: number }[] = [];
  private freeFallDetected = false;
  private freeFallTime = 0;

  async startMonitoring(onFall: FallCallback): Promise<void> {
    if (this.isMonitoring) return;

    const { status } = await Accelerometer.requestPermissionsAsync();
    if (status !== "granted") {
      console.warn("[FallDetection] Permission not granted");
      return;
    }

    this.onFallDetected = onFall;
    this.isMonitoring = true;

    Accelerometer.setUpdateInterval(100); // 10Hz

    this.subscription = Accelerometer.addListener(
      (data: AccelerometerMeasurement) => {
        this.processReading(data);
      }
    );
  }

  stopMonitoring(): void {
    this.subscription?.remove();
    this.subscription = null;
    this.isMonitoring = false;
    this.onFallDetected = null;
    this.recentReadings = [];
  }

  private processReading(data: AccelerometerMeasurement): void {
    const magnitude = Math.sqrt(data.x ** 2 + data.y ** 2 + data.z ** 2);
    const now = Date.now();

    // Track activity
    if (Math.abs(magnitude - 1.0) > 0.15) {
      this.lastMovementTime = new Date();
    }

    // Maintain sliding window
    this.recentReadings.push({ magnitude, timestamp: now });
    this.recentReadings = this.recentReadings.filter(
      (r) => now - r.timestamp < DETECTION_WINDOW_MS + POST_IMPACT_WINDOW_MS
    );

    // Phase 1: Detect free-fall
    if (!this.freeFallDetected && magnitude < FREE_FALL_THRESHOLD) {
      this.freeFallDetected = true;
      this.freeFallTime = now;
      return;
    }

    // Phase 2: Detect impact after free-fall
    if (this.freeFallDetected) {
      const timeSinceFreeFall = now - this.freeFallTime;

      if (timeSinceFreeFall > DETECTION_WINDOW_MS) {
        // Too long since free-fall, reset
        this.freeFallDetected = false;
        return;
      }

      if (magnitude > IMPACT_THRESHOLD) {
        // Impact detected! Check for post-fall rest
        this.checkPostFallRest(now);
        this.freeFallDetected = false;
      }
    }
  }

  private checkPostFallRest(impactTime: number): void {
    // Wait briefly then check if person is lying still
    setTimeout(() => {
      const postImpactReadings = this.recentReadings.filter(
        (r) => r.timestamp > impactTime
      );

      if (postImpactReadings.length === 0) return;

      const avgMagnitude =
        postImpactReadings.reduce((sum, r) => sum + r.magnitude, 0) /
        postImpactReadings.length;

      // If relatively still after impact (near 1g = lying on ground)
      if (
        avgMagnitude > POST_FALL_REST_THRESHOLD &&
        avgMagnitude < 1.3 &&
        Math.max(...postImpactReadings.map((r) => r.magnitude)) -
          Math.min(...postImpactReadings.map((r) => r.magnitude)) <
          0.5
      ) {
        this.triggerFallAlert();
      }
    }, POST_IMPACT_WINDOW_MS);
  }

  private async triggerFallAlert(): Promise<void> {
    // Haptic alert
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

    const snapshot = this.getCurrentSnapshot();

    // Notify via callback
    this.onFallDetected?.(snapshot);

    // Send local notification
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "⚠️ Possível queda detectada!",
        body: "Estou Bem detectou uma possível queda. Toque aqui se estiver bem.",
        priority: Notifications.AndroidNotificationPriority.MAX,
        data: { type: "fall_detected" },
      },
      trigger: null,
    });
  }

  getCurrentSnapshot(): SensorSnapshot {
    return {
      accelerometerActive: this.isMonitoring,
      lastMovementAt: this.lastMovementTime.toISOString(),
    };
  }

  getLastMovementTime(): Date {
    return this.lastMovementTime;
  }

  isActive(): boolean {
    return this.isMonitoring;
  }

  // Check if phone has been stationary (used in passive check-in)
  hasRecentActivity(withinMinutes: number = 15): boolean {
    const cutoff = Date.now() - withinMinutes * 60 * 1000;
    return this.lastMovementTime.getTime() > cutoff;
  }
}

export const fallDetectionService = new FallDetectionService();
