import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

const GEOFENCE_TASK = "ESTOUBEM_GEOFENCE_TASK";
const LOCATION_TASK = "ESTOUBEM_LOCATION_TASK";

// Register background task for geofencing
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

  async getCurrentLocation(): Promise<Location.LocationObject | null> {
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== "granted") return null;

      return await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
    } catch {
      return null;
    }
  }

  async startGeofencing(
    latitude: number,
    longitude: number,
    radiusMeters: number = 200
  ): Promise<void> {
    const hasPermission = await this.requestPermissions();
    if (!hasPermission) return;

    const isRegistered = await TaskManager.isTaskRegisteredAsync(GEOFENCE_TASK);
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
    const isRegistered = await TaskManager.isTaskRegisteredAsync(GEOFENCE_TASK);
    if (isRegistered) {
      await Location.stopGeofencingAsync(GEOFENCE_TASK);
    }
  }

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
}

export const locationService = new LocationService();
