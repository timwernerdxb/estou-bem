import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";

class NotificationService {
  private isInitialized = false;

  async initialize(
    user?: { id?: string | number; token?: string; apiUrl?: string } | null
  ): Promise<string | null> {
    if (this.isInitialized) return null;

    // Set notification handler for foreground
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
        priority: Notifications.AndroidNotificationPriority.MAX,
      }),
    });

    // Create notification categories for interactive notifications
    await Notifications.setNotificationCategoryAsync("checkin", [
      {
        identifier: "confirm",
        buttonTitle: "✅ Estou Bem",
        options: { opensAppToForeground: true },
      },
      {
        identifier: "help",
        buttonTitle: "🆘 Preciso de Ajuda",
        options: { opensAppToForeground: true },
      },
    ]);

    await Notifications.setNotificationCategoryAsync("fall_detected", [
      {
        identifier: "im_ok",
        buttonTitle: "✅ Estou Bem",
        options: { opensAppToForeground: false },
      },
      {
        identifier: "need_help",
        buttonTitle: "🆘 Preciso de Ajuda",
        options: { opensAppToForeground: true },
      },
    ]);

    // Set Android notification channel
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("checkin", {
        name: "Check-in",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 500, 200, 500],
        sound: "checkin-alarm.wav",
        lockscreenVisibility:
          Notifications.AndroidNotificationVisibility.PUBLIC,
        enableVibrate: true,
        enableLights: true,
        lightColor: "#4CAF50",
      });

      await Notifications.setNotificationChannelAsync("emergency", {
        name: "Emergência",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 1000, 500, 1000, 500, 1000],
        lockscreenVisibility:
          Notifications.AndroidNotificationVisibility.PUBLIC,
        enableVibrate: true,
        enableLights: true,
        lightColor: "#F44336",
      });

      await Notifications.setNotificationChannelAsync("critical-alerts", {
        name: "Alertas Criticos",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 1000, 500, 1000, 500, 1000],
        lockscreenVisibility:
          Notifications.AndroidNotificationVisibility.PUBLIC,
        enableVibrate: true,
        enableLights: true,
        lightColor: "#FF0000",
        bypassDnd: true,
      });

      await Notifications.setNotificationChannelAsync("medication", {
        name: "Medicamentos",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 300, 100, 300],
        lockscreenVisibility:
          Notifications.AndroidNotificationVisibility.PUBLIC,
        enableVibrate: true,
      });
    }

    this.isInitialized = true;
    return this.registerForPushNotifications(user);
  }

  async registerForPushNotifications(
    user?: { id?: string | number; token?: string; apiUrl?: string } | null
  ): Promise<string | null> {
    if (!Device.isDevice) {
      console.warn("[Notifications] Push notifications require a physical device");
      return null;
    }

    const { status: existingStatus } =
      await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== "granted") {
      console.warn("[Notifications] Permission not granted");
      return null;
    }

    try {
      const tokenData = await Notifications.getExpoPushTokenAsync({
        projectId: "2c5b816f-19cf-46ec-bc64-33fc65b47033",
      });
      const pushToken = tokenData.data;

      // Register token with the server
      this.registerTokenWithServer(pushToken, user);

      return pushToken;
    } catch (err) {
      console.warn("[Notifications] Failed to get push token:", err);
      return null;
    }
  }

  private async registerTokenWithServer(
    pushToken: string,
    user?: { id?: string | number; token?: string; apiUrl?: string } | null
  ): Promise<void> {
    try {
      const baseUrl = user?.apiUrl || "https://estou-bem-web-production.up.railway.app";
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (user?.token) {
        headers["Authorization"] = `Bearer ${user.token}`;
      }
      await fetch(
        `${baseUrl}/api/push-token`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            token: pushToken,
            platform: Platform.OS,
            user_id: user?.id || undefined,
          }),
        }
      );
      console.log("[Notifications] Push token registered with server");
    } catch (err) {
      console.warn("[Notifications] Failed to register token:", err);
    }
  }

  // Schedule medication reminder
  async scheduleMedicationReminder(
    medicationName: string,
    time: string, // HH:mm
    medicationId: string
  ): Promise<void> {
    const [hours, minutes] = time.split(":").map(Number);

    await Notifications.scheduleNotificationAsync({
      content: {
        title: "💊 Hora do medicamento",
        body: `Hora de tomar: ${medicationName}`,
        data: { type: "medication", medicationId },
        categoryIdentifier: "checkin",
        ...(Platform.OS === "android" && { channelId: "medication" }),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: hours,
        minute: minutes,
      },
    });
  }

  // Send SOS notification
  async sendSOSNotification(elderName: string, location?: string): Promise<void> {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "🚨 SOS - EMERGÊNCIA",
        body: `${elderName} acionou o botão de emergência!${
          location ? ` Localização: ${location}` : ""
        }`,
        priority: Notifications.AndroidNotificationPriority.MAX,
        data: { type: "sos" },
        ...(Platform.OS === "android" && { channelId: "emergency" }),
      },
      trigger: null,
    });
  }

  // Send low stock medication alert
  async sendLowStockAlert(medicationName: string, remaining: number): Promise<void> {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "📦 Estoque baixo de medicamento",
        body: `${medicationName}: restam apenas ${remaining} unidades. Hora de comprar mais!`,
        data: { type: "low_stock", medicationName },
        ...(Platform.OS === "android" && { channelId: "medication" }),
      },
      trigger: null,
    });
  }

  // Send fall detected notification (for family members)
  async sendFallDetectedNotification(
    elderName: string,
    heartRate?: number
  ): Promise<void> {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "ALERTA: Queda detectada!",
        body: `${elderName} pode ter sofrido uma queda!${
          heartRate ? ` FC: ${heartRate} BPM` : ""
        }`,
        priority: Notifications.AndroidNotificationPriority.MAX,
        data: { type: "fall_detected" },
        categoryIdentifier: "fall_detected",
        ...(Platform.OS === "android" && { channelId: "critical-alerts" }),
      },
      trigger: null,
    });
  }

  // Send fall cancelled notification (false alarm)
  async sendFallCancelledNotification(elderName: string): Promise<void> {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Queda cancelada",
        body: `${elderName} cancelou o alerta de queda. Falso alarme.`,
        data: { type: "fall_cancelled" },
        ...(Platform.OS === "android" && { channelId: "checkin" }),
      },
      trigger: null,
    });
  }

  // Send SAMU escalation notification (fall not responded)
  async sendFallSAMUEscalationNotification(elderName: string): Promise<void> {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "EMERGENCIA: SAMU acionado!",
        body: `${elderName} nao respondeu apos queda detectada. SAMU (192) foi acionado automaticamente.`,
        priority: Notifications.AndroidNotificationPriority.MAX,
        data: { type: "fall_samu_escalation" },
        ...(Platform.OS === "android" && { channelId: "critical-alerts" }),
      },
      trigger: null,
    });
  }

  // Handle incoming fall-related notification responses
  async handleFallNotificationResponse(
    response: Notifications.NotificationResponse,
    userId: number
  ): Promise<void> {
    const actionId = response.actionIdentifier;
    const data = response.notification.request.content.data;

    if (data?.type !== "fall_detected") return;

    if (actionId === "im_ok") {
      // Elder confirmed they're OK — cancel the fall alert
      try {
        await fetch(
          "https://estou-bem-web-production.up.railway.app/api/fall-cancelled",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: userId }),
          }
        );
        console.log("[Notifications] Fall alert cancelled via notification action");
      } catch (err) {
        console.warn("[Notifications] Failed to cancel fall alert:", err);
      }
    } else if (actionId === "need_help") {
      // Elder needs help — this is handled by the server escalation flow
      console.log("[Notifications] Elder confirmed they need help after fall");
    }
  }
}

export const notificationService = new NotificationService();
