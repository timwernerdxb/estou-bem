import * as Notifications from "expo-notifications";
import * as Haptics from "expo-haptics";
import { CheckIn, CheckInStatus, SensorSnapshot, EscalationLevel } from "../types";
import { CHECKIN_CONFIG } from "../constants/theme";

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

class CheckInService {
  // ─── Schedule check-in alarms ───────────────────────────────
  async scheduleCheckinAlarms(times: string[]): Promise<void> {
    // Cancel all existing check-in notifications
    await this.cancelAllCheckinAlarms();

    for (const time of times) {
      const [hours, minutes] = time.split(":").map(Number);

      await Notifications.scheduleNotificationAsync({
        content: {
          title: "Hora do Check-in! ✅",
          body: "Toque aqui para confirmar que está tudo bem",
          sound: "checkin-alarm.wav",
          priority: Notifications.AndroidNotificationPriority.MAX,
          data: { type: "checkin", scheduledTime: time },
          categoryIdentifier: "checkin",
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour: hours,
          minute: minutes,
        },
      });

      // Schedule pre-reminder
      const reminderMin = CHECKIN_CONFIG.defaultReminderMinutesBefore;
      let reminderHour = hours;
      let reminderMinute = minutes - reminderMin;
      if (reminderMinute < 0) {
        reminderMinute += 60;
        reminderHour -= 1;
        if (reminderHour < 0) reminderHour = 23;
      }

      await Notifications.scheduleNotificationAsync({
        content: {
          title: "Check-in em breve",
          body: `Seu check-in será em ${reminderMin} minutos`,
          data: { type: "checkin_reminder", scheduledTime: time },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour: reminderHour,
          minute: reminderMinute,
        },
      });
    }
  }

  async cancelAllCheckinAlarms(): Promise<void> {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const notif of scheduled) {
      const data = notif.content.data as Record<string, unknown> | undefined;
      if (
        data?.type === "checkin" ||
        data?.type === "checkin_reminder"
      ) {
        await Notifications.cancelScheduledNotificationAsync(notif.identifier);
      }
    }
  }

  // ─── Create a new check-in entry ────────────────────────────
  createCheckin(elderId: string, scheduledTime: string): CheckIn {
    return {
      id: generateId(),
      elderId,
      scheduledAt: new Date().toISOString(),
      status: "pending",
    };
  }

  // ─── Confirm check-in (elder tapped the button) ────────────
  confirmCheckin(checkin: CheckIn): CheckIn {
    return {
      ...checkin,
      status: "confirmed",
      respondedAt: new Date().toISOString(),
    };
  }

  // ─── Auto-confirm from passive source ───────────────────────
  autoConfirmCheckin(
    checkin: CheckIn,
    source: "medication" | "wearable" | "accelerometer"
  ): CheckIn {
    return {
      ...checkin,
      status: "auto_confirmed",
      respondedAt: new Date().toISOString(),
      autoConfirmSource: source,
    };
  }

  // ─── Mark as missed ─────────────────────────────────────────
  missCheckin(checkin: CheckIn, sensorData?: SensorSnapshot): CheckIn {
    return {
      ...checkin,
      status: "missed",
      sensorData,
    };
  }

  // ─── Trigger haptic feedback on check-in ────────────────────
  async hapticConfirm(): Promise<void> {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  // ─── Determine escalation level based on time elapsed ───────
  getEscalationLevel(minutesSinceScheduled: number): EscalationLevel {
    const delays = CHECKIN_CONFIG.escalationDelayMinutes;
    if (minutesSinceScheduled >= delays.emergencyServices) return "emergency_services";
    if (minutesSinceScheduled >= delays.centralActivate) return "central_activated";
    if (minutesSinceScheduled >= delays.callElder) return "call_elder";
    if (minutesSinceScheduled >= delays.familyNotify) return "family_notified";
    if (minutesSinceScheduled >= delays.passiveCheck) return "passive_check";
    return "reminder_sent";
  }

  // ─── Build escalation message for family notification ───────
  buildEscalationMessage(
    elderName: string,
    level: EscalationLevel,
    sensorData?: SensorSnapshot
  ): string {
    const base = `${elderName} não fez o check-in.`;
    const parts: string[] = [base];

    if (sensorData) {
      if (sensorData.lastMovementAt) {
        const ago = this.minutesAgo(sensorData.lastMovementAt);
        parts.push(`Último movimento detectado há ${ago} min.`);
      } else {
        parts.push("Sem movimento detectado.");
      }

      if (sensorData.heartRate) {
        parts.push(`Frequência cardíaca: ${sensorData.heartRate} bpm.`);
      }

      if (sensorData.latitude && sensorData.longitude) {
        parts.push("Localização disponível.");
      }
    }

    switch (level) {
      case "family_notified":
        parts.push("Por favor verifique.");
        break;
      case "call_elder":
        parts.push("Tentando ligar para o idoso.");
        break;
      case "central_activated":
        parts.push("Central de atendimento acionada.");
        break;
      case "emergency_services":
        parts.push("⚠️ Serviços de emergência sendo acionados.");
        break;
    }

    return parts.join(" ");
  }

  private minutesAgo(isoDate: string): number {
    return Math.round(
      (Date.now() - new Date(isoDate).getTime()) / (1000 * 60)
    );
  }

  // ─── Send family notification about missed check-in ─────────
  async notifyFamilyMissedCheckin(
    elderName: string,
    level: EscalationLevel,
    sensorData?: SensorSnapshot
  ): Promise<void> {
    const message = this.buildEscalationMessage(elderName, level, sensorData);
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "⚠️ Check-in não realizado",
        body: message,
        priority: Notifications.AndroidNotificationPriority.MAX,
        data: { type: "missed_checkin", level },
      },
      trigger: null, // Send immediately
    });
  }
}

export const checkInService = new CheckInService();
