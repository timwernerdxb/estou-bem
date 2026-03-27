/**
 * LocationService — GPS tracking and geofencing for elder safety.
 *
 * Handles:
 * - Foreground & background location permissions
 * - Background location task (posts to server every ~5 min)
 * - Local geofencing (expo-location)
 * - One-shot current location
 */

import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { postLocation } from "./ApiService";

const GEOFENCE_TASK = "ESTOUBEM_GEOFENCE_TASK";
const LOCATION_TASK = "ESTOUBEM_LOCATION_TASK";
const LOCATION_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Stored so the background task can access without React context
let _trackingToken: string | null = null;
let _trackingApiUrl: string | undefined = undefined;

// ── Background location task ──────────────────────────────────────────────────
// Must be defined at module top-level.
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }: any) => {
  if (error) {
    console.warn("[LocationService] Background task error:", error.message);
    return;
  }
  if (!data?.locations?.length) return;

  const loc: Location.LocationObject = data.locations[data.locations.length - 1];
  const { latitude, longitude, accuracy } = loc.coords;

  if (!_trackingToken) return;

  try {
    await postLocation(
      { token: _trackingToken, apiUrl: _trackingApiUrl },
      latitude,
      longitude,
      accuracy ?? undefined
    );
    console.log(
      `[LocationService] Posted: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
    );
  } catch (err) {
    console.warn(
      "[LocationService] Failed to post location:",
      (err as Error).message
    );
  }
});

// ── Geofence task (local on-device notification) ──────────────────────────────
TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }: any) => {
  if (error) {
    console.error("[Geofence] Error:", error);
    return;
  }
  if (data?.eventType === Location.GeofencingEventType.Exit) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "⚠️ Alerta de localização",
        body: "O idoso saiu da zona segura definida.",
        priority: Notifications.AndroidNotificationPriority.MAX,
        data: { type: "geofence_exit", region: data.region },
      },
      trigger: null,
    });
  }
});

class LocationService {
  // ── Permissions ────────────────────────────────────────────────────────────

  async requestPermissions(): Promise<boolean> {
    const { status: foreground } =
      await Location.requestForegroundPermissionsAsync();
    if (foreground !== "granted") return false;

    if (Platform.OS === "ios" || Platform.OS === "android") {
      const { status: background } =
        await Location.requestBackgroundPermissionsAsync();
      return background === "granted";
    }
    return true;
  }

  // ── Current location (one-shot) ────────────────────────────────────────────

  async getCurrentLocation(): Promise<Location.LocationObject | null> {
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== "granted") return null;

      return await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
    } catch {
      return null;
    }
  }

  // ── Background tracking (posts to server) ─────────────────────────────────

  /**
   * Request permissions and start background location updates.
   * Each update is POSTed to /api/location on the server.
   */
  async startTracking(
    user: { token?: string; apiUrl?: string } | null
  ): Promise<boolean> {
    if (!user?.token) return false;

    const { status: fgStatus } =
      await Location.requestForegroundPermissionsAsync();
    if (fgStatus !== "granted") {
      console.warn("[LocationService] Foreground permission denied");
      return false;
    }

    // Store for background task
    _trackingToken = user.token;
    _trackingApiUrl = user.apiUrl;

    // Request background permission (soft — fall back to foreground interval)
    const { status: bgStatus } =
      await Location.requestBackgroundPermissionsAsync();

    if (bgStatus === "granted") {
      try {
        const alreadyStarted =
          await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
        if (!alreadyStarted) {
          await Location.startLocationUpdatesAsync(LOCATION_TASK, {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: LOCATION_INTERVAL_MS,
            distanceInterval: 50,
            showsBackgroundLocationIndicator: true,
            foregroundService: {
              notificationTitle: "Estou Bem — Monitoramento",
              notificationBody:
                "Localização monitorada para sua segurança",
            },
            pausesUpdatesAutomatically: false,
            activityType: Location.ActivityType.Other,
          });
          console.log("[LocationService] Background tracking started");
        }
        return true;
      } catch (err) {
        console.warn(
          "[LocationService] Background task failed, using foreground fallback:",
          (err as Error).message
        );
      }
    } else {
      console.warn(
        "[LocationService] Background permission denied — using foreground fallback"
      );
    }

    // Foreground interval fallback
    this._startForegroundFallback(user);
    return true;
  }

  /**
   * Stop background location tracking.
   */
  async stopTracking(): Promise<void> {
    _trackingToken = null;
    _trackingApiUrl = undefined;
    this._stopForegroundFallback();
    try {
      const started =
        await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
      if (started) {
        await Location.stopLocationUpdatesAsync(LOCATION_TASK);
        console.log("[LocationService] Background tracking stopped");
      }
    } catch (err) {
      console.warn(
        "[LocationService] Error stopping background task:",
        (err as Error).message
      );
    }
  }

  // ── Local geofencing ───────────────────────────────────────────────────────

  async startGeofencing(
    latitude: number,
    longitude: number,
    radiusMeters: number = 200
  ): Promise<void> {
    const hasPermission = await this.requestPermissions();
    if (!hasPermission) return;

    const isRegistered =
      await TaskManager.isTaskRegisteredAsync(GEOFENCE_TASK);
    if (isRegistered) {
      await Location.stopGeofencingAsync(GEOFENCE_TASK);
    }

    await Location.startGeofencingAsync(GEOFENCE_TASK, [
      {
        identifier: "safe_zone",
        latitude,
        longitude,
        radius: radiusMeters,
        notifyOnEnter: false,
        notifyOnExit: true,
      },
    ]);
  }

  async stopGeofencing(): Promise<void> {
    const isRegistered =
      await TaskManager.isTaskRegisteredAsync(GEOFENCE_TASK);
    if (isRegistered) {
      await Location.stopGeofencingAsync(GEOFENCE_TASK);
    }
  }

  // ── Reverse geocode ────────────────────────────────────────────────────────

  async getLocationString(): Promise<string | undefined> {
    const location = await this.getCurrentLocation();
    if (!location) return undefined;

    try {
      const [address] = await Location.reverseGeocodeAsync({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });
      if (address) {
        return [address.street, address.city, address.region]
          .filter(Boolean)
          .join(", ");
      }
    } catch {
      // Fall back to coordinates
    }
    return `${location.coords.latitude.toFixed(4)}, ${location.coords.longitude.toFixed(4)}`;
  }

  // ── Foreground fallback ────────────────────────────────────────────────────

  private _fallbackInterval: ReturnType<typeof setInterval> | null = null;

  private _startForegroundFallback(
    user: { token?: string; apiUrl?: string }
  ): void {
    this._stopForegroundFallback();
    this._fallbackInterval = setInterval(async () => {
      if (!user.token) return;
      const loc = await this.getCurrentLocation();
      if (!loc) return;
      const { latitude, longitude, accuracy } = loc.coords;
      await postLocation(
        user,
        latitude,
        longitude,
        accuracy ?? undefined
      ).catch(() => {});
    }, LOCATION_INTERVAL_MS);
    console.log("[LocationService] Foreground fallback started");
  }

  private _stopForegroundFallback(): void {
    if (this._fallbackInterval) {
      clearInterval(this._fallbackInterval);
      this._fallbackInterval = null;
    }
  }
}

export const locationService = new LocationService();
