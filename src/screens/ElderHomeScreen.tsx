import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Vibration,
  ScrollView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, FONTS, SPACING, SHADOWS, RADIUS, SCREEN } from "../constants/theme";
import { useApp, useSubscription } from "../store/AppContext";
import { checkInService } from "../services/CheckInService";
import { fallDetectionService } from "../services/FallDetectionService";
import { StatusBadge } from "../components/StatusBadge";
import { Card } from "../components/Card";
import { CheckIn } from "../types";

const serifFont = Platform.OS === "ios" ? "Georgia" : "serif";

// Soho House colors
const SH_GREEN = "#2D4A3E";
const SH_GREEN_DARK = "#1E352B";
const SH_CREAM = "#F5F0EB";
const SH_GOLD = "#C9A96E";
const SH_GRAY = "#9A9189";

type CheckinDisplayState = "pending" | "completed" | "waiting";

export function ElderHomeScreen() {
  const { state, dispatch } = useApp();
  const { isFamilia } = useSubscription();
  const [pulseAnim] = useState(new Animated.Value(1));
  const [lastCheckin, setLastCheckin] = useState<CheckIn | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [checkinDisplayState, setCheckinDisplayState] = useState<CheckinDisplayState>("pending");
  const [confirmedTime, setConfirmedTime] = useState<string | null>(null);
  const [nextCheckinTime, setNextCheckinTime] = useState<string | null>(null);
  const [isNapping, setIsNapping] = useState(false);
  const [napUntil, setNapUntil] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const elderName = state.elderProfile?.name || state.currentUser?.name || "Voce";
  const todayCheckins = state.checkins.filter((c) => {
    const today = new Date().toDateString();
    return new Date(c.scheduledAt).toDateString() === today;
  });

  const pendingCheckin = todayCheckins.find((c) => c.status === "pending");
  const confirmedToday = todayCheckins.filter(
    (c) => c.status === "confirmed" || c.status === "auto_confirmed"
  ).length;

  // Determine check-in display state from local data
  const computeDisplayState = useCallback(() => {
    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();

    // Default schedule times — ideally these come from settings
    const scheduleTimes = ["09:00", "18:00"];

    if (pendingCheckin) {
      setCheckinDisplayState("pending");
      // Find next scheduled time after now
      const nextTime = scheduleTimes.find((t) => {
        const [h, m] = t.split(":").map(Number);
        return h * 60 + m > nowMins;
      });
      setNextCheckinTime(nextTime || null);
      return;
    }

    // Check if we have confirmed checkins today
    const confirmedCheckins = todayCheckins.filter(
      (c) => c.status === "confirmed" || c.status === "auto_confirmed"
    );

    // Check if any scheduled time has passed
    const pastTimes = scheduleTimes.filter((t) => {
      const [h, m] = t.split(":").map(Number);
      return h * 60 + m <= nowMins;
    });

    if (pastTimes.length > 0 && confirmedCheckins.length > 0) {
      setCheckinDisplayState("completed");
      const lastConfirmed = confirmedCheckins[confirmedCheckins.length - 1];
      const respondedAt = lastConfirmed.respondedAt
        ? new Date(lastConfirmed.respondedAt)
        : new Date();
      setConfirmedTime(
        respondedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
      );
      const nextTime = scheduleTimes.find((t) => {
        const [h, m] = t.split(":").map(Number);
        return h * 60 + m > nowMins;
      });
      setNextCheckinTime(nextTime || null);
      return;
    }

    // No schedule set at all — backwards compatible, show as pending
    if (!scheduleTimes || scheduleTimes.length === 0) {
      setCheckinDisplayState("pending");
      setNextCheckinTime(null);
      return;
    }

    // Waiting for next checkin
    const nextTime = scheduleTimes.find((t) => {
      const [h, m] = t.split(":").map(Number);
      return h * 60 + m > nowMins;
    });

    if (nextTime) {
      setCheckinDisplayState("waiting");
      setNextCheckinTime(nextTime);
    } else {
      // All times passed, nothing confirmed, nothing pending
      setCheckinDisplayState("waiting");
      setNextCheckinTime(scheduleTimes[0] || "09:00");
    }
  }, [pendingCheckin, todayCheckins]);

  // Compute state on mount and every 30 seconds
  useEffect(() => {
    computeDisplayState();
    intervalRef.current = setInterval(computeDisplayState, 30000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [computeDisplayState]);

  // Pulse animation for the check-in button — only when pending
  useEffect(() => {
    if (checkinDisplayState === "pending") {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.08,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [checkinDisplayState]);

  const handleCheckin = useCallback(async () => {
    // Only allow check-in when in pending state
    if (checkinDisplayState !== "pending") return;
    if (isConfirming) return;
    setIsConfirming(true);

    await checkInService.hapticConfirm();
    Vibration.vibrate(200);

    if (pendingCheckin) {
      const confirmed = checkInService.confirmCheckin(pendingCheckin);
      dispatch({ type: "UPDATE_CHECKIN", payload: confirmed });
      setLastCheckin(confirmed);
    } else {
      // Create and immediately confirm a new check-in (backwards compat)
      const elderId = state.elderProfile?.id || state.currentUser?.id || "elder";
      const newCheckin = checkInService.createCheckin(elderId, new Date().toISOString());
      const confirmed = checkInService.confirmCheckin(newCheckin);
      dispatch({ type: "ADD_CHECKIN", payload: confirmed });
      setLastCheckin(confirmed);
    }

    // Recompute state after confirming
    setTimeout(() => {
      setIsConfirming(false);
      computeDisplayState();
    }, 2000);
  }, [checkinDisplayState, pendingCheckin, isConfirming, state.elderProfile, state.currentUser, computeDisplayState]);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Bom dia";
    if (hour < 18) return "Boa tarde";
    return "Boa noite";
  };

  const streak = (state as any).gamification?.streak || 0;

  const handleNap = async (minutes: number) => {
    try {
      const API_URL = state.currentUser?.apiUrl || process.env.EXPO_PUBLIC_API_URL || "";
      const token = state.currentUser?.token;
      if (!API_URL || !token) return;
      const res = await fetch(`${API_URL}/api/nap`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ minutes }),
      });
      const data = await res.json();
      if (data.success) {
        setIsNapping(true);
        setNapUntil(data.nap_until);
        Vibration.vibrate(100);
        // Auto-cancel after duration
        setTimeout(() => { setIsNapping(false); setNapUntil(null); }, minutes * 60 * 1000);
      }
    } catch (e) {
      console.error("Nap error:", e);
    }
  };

  const cancelNap = async () => {
    try {
      const API_URL = state.currentUser?.apiUrl || process.env.EXPO_PUBLIC_API_URL || "";
      const token = state.currentUser?.token;
      if (!API_URL || !token) return;
      await fetch(`${API_URL}/api/nap`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      setIsNapping(false);
      setNapUntil(null);
    } catch (e) {
      console.error("Cancel nap error:", e);
    }
  };

  const renderCheckinArea = () => {
    if (isConfirming) {
      // Show brief confirmation animation
      return (
        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
          <View
            style={[
              styles.checkinButton,
              { backgroundColor: SH_GREEN_DARK },
            ]}
          >
            <Ionicons name="checkmark-circle" size={80} color={COLORS.white} />
            <Text style={styles.checkinButtonText}>Confirmado</Text>
          </View>
        </Animated.View>
      );
    }

    if (checkinDisplayState === "pending") {
      return (
        <>
          <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
            <TouchableOpacity
              onPress={handleCheckin}
              activeOpacity={0.8}
              style={[
                styles.checkinButton,
                { backgroundColor: SH_GREEN },
              ]}
            >
              <Ionicons name="hand-left" size={80} color={COLORS.white} />
              <Text style={styles.checkinButtonText}>TOQUE AQUI</Text>
            </TouchableOpacity>
          </Animated.View>
          <Text style={styles.pendingText}>
            Voce tem um check-in pendente
          </Text>
        </>
      );
    }

    if (checkinDisplayState === "completed") {
      return (
        <>
          <View style={styles.completedCard}>
            <Ionicons name="checkmark-circle" size={56} color={SH_GREEN} />
            <Text style={styles.completedTitle}>Check-in confirmado</Text>
            {confirmedTime && (
              <Text style={styles.completedTime}>{`\u00E0s ${confirmedTime}`}</Text>
            )}
            {streak > 0 && (
              <Text style={styles.completedStreak}>{`${streak} dias seguidos`}</Text>
            )}
          </View>
          {nextCheckinTime && (
            <Text style={styles.nextCheckinText}>
              {`Pr\u00F3ximo check-in \u00E0s ${nextCheckinTime}`}
            </Text>
          )}
        </>
      );
    }

    // waiting state
    return (
      <>
        <View
          style={[
            styles.checkinButton,
            styles.waitingButton,
          ]}
        >
          <Ionicons name="hand-left" size={80} color={COLORS.white} style={{ opacity: 0.6 }} />
          <Text style={[styles.checkinButtonText, { opacity: 0.8 }]}>
            {`Pr\u00F3ximo check-in`}
          </Text>
        </View>
        {nextCheckinTime && (
          <Text style={styles.waitingTimeText}>
            {`\u00C0s ${nextCheckinTime}`}
          </Text>
        )}
      </>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <Text style={styles.greeting}>
          {getGreeting()}, {elderName}
        </Text>
        <Text style={styles.dateText}>
          {new Date().toLocaleDateString("pt-BR", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </Text>

        {/* Main Check-in Area */}
        <View style={styles.checkinContainer}>
          {renderCheckinArea()}
        </View>

        {/* Nap Mode */}
        {isNapping ? (
          <TouchableOpacity
            onPress={cancelNap}
            style={{
              flexDirection: "row", alignItems: "center", justifyContent: "center",
              backgroundColor: SH_GOLD, borderRadius: 12, padding: 14, marginBottom: 16,
            }}
          >
            <Ionicons name="moon" size={20} color="#FFF" style={{ marginRight: 8 }} />
            <Text style={{ color: "#FFF", fontFamily: serifFont, fontSize: 15 }}>
              Cochilando ate {napUntil ? new Date(napUntil).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : ""} — toque para acordar
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={() => handleNap(60)}
            style={{
              flexDirection: "row", alignItems: "center", justifyContent: "center",
              backgroundColor: "#FFF", borderRadius: 12, padding: 14, marginBottom: 16,
              borderWidth: 1, borderColor: SH_GOLD,
            }}
          >
            <Ionicons name="moon-outline" size={20} color={SH_GOLD} style={{ marginRight: 8 }} />
            <Text style={{ color: SH_GREEN, fontFamily: serifFont, fontSize: 15 }}>
              Vou cochilar (pausar 1 hora)
            </Text>
          </TouchableOpacity>
        )}

        {/* Today's Status */}
        <Card style={styles.statusCard}>
          <View style={styles.statusRow}>
            <Ionicons name="today" size={24} color={COLORS.primary} />
            <Text style={styles.statusLabel}>Check-ins hoje</Text>
            <Text style={styles.statusValue}>{confirmedToday}</Text>
          </View>

          {todayCheckins.length > 0 && (
            <View style={styles.checkinList}>
              {todayCheckins.slice(0, 5).map((ci) => (
                <View key={ci.id} style={styles.checkinItem}>
                  <Text style={styles.checkinTime}>
                    {new Date(ci.scheduledAt).toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </Text>
                  <StatusBadge status={ci.status} />
                </View>
              ))}
            </View>
          )}
        </Card>

        {/* Quick info cards */}
        <View style={styles.infoRow}>
          <Card style={styles.infoCard}>
            <Ionicons name="medical" size={28} color={COLORS.primary} />
            <Text style={styles.infoValue}>{state.medications.length}</Text>
            <Text style={styles.infoLabel}>Medicamentos</Text>
          </Card>

          <Card style={styles.infoCard}>
            <Ionicons name="people" size={28} color={COLORS.primary} />
            <Text style={styles.infoValue}>
              {state.emergencyContacts.length}
            </Text>
            <Text style={styles.infoLabel}>Contatos</Text>
          </Card>
        </View>

        {/* Fall detection status */}
        {isFamilia && (
          <Card style={styles.sensorCard}>
            <View style={styles.sensorRow}>
              <Ionicons name="fitness" size={20} color={COLORS.primary} />
              <Text style={styles.sensorText}>
                Deteccao de quedas: {fallDetectionService.isActive() ? "Ativa" : "Inativa"}
              </Text>
            </View>
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const BUTTON_SIZE = Math.min(SCREEN.width * 0.6, 250);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    padding: SPACING.lg,
    alignItems: "center",
  },
  greeting: {
    ...FONTS.elderTitle,
    textAlign: "center",
    marginTop: SPACING.md,
  },
  dateText: {
    ...FONTS.elderBody,
    color: COLORS.textSecondary,
    fontSize: 18,
    textAlign: "center",
    marginTop: SPACING.xs,
    textTransform: "capitalize",
  },
  checkinContainer: {
    alignItems: "center",
    marginVertical: SPACING.xl,
  },
  checkinButton: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    justifyContent: "center",
    alignItems: "center",
  },
  waitingButton: {
    backgroundColor: SH_GRAY,
    opacity: 0.85,
  },
  checkinButtonText: {
    ...FONTS.elderButton,
    marginTop: SPACING.sm,
    textAlign: "center",
  },
  pendingText: {
    ...FONTS.elderBody,
    color: COLORS.warning,
    fontSize: 18,
    marginTop: SPACING.md,
    fontWeight: "500",
  },
  // Completed state
  completedCard: {
    backgroundColor: "#E8F0EC",
    borderWidth: 1,
    borderColor: SH_GREEN,
    borderRadius: 8,
    paddingVertical: 28,
    paddingHorizontal: 32,
    alignItems: "center",
    width: BUTTON_SIZE,
  },
  completedTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: SH_GREEN,
    marginTop: SPACING.sm,
    letterSpacing: 0.3,
  },
  completedTime: {
    fontSize: 15,
    color: "#5C5549",
    marginTop: 4,
  },
  completedStreak: {
    fontSize: 13,
    color: SH_GOLD,
    marginTop: SPACING.md,
    fontWeight: "600",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  nextCheckinText: {
    fontSize: 14,
    color: SH_GRAY,
    marginTop: SPACING.md,
    letterSpacing: 0.3,
  },
  // Waiting state
  waitingTimeText: {
    fontSize: 16,
    color: SH_GRAY,
    marginTop: SPACING.md,
    fontWeight: "500",
    letterSpacing: 0.4,
  },
  // Status card
  statusCard: {
    width: "100%",
    marginBottom: SPACING.md,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
  },
  statusLabel: {
    ...FONTS.subtitle,
    flex: 1,
  },
  statusValue: {
    ...FONTS.title,
    color: COLORS.primary,
  },
  checkinList: {
    marginTop: SPACING.md,
    gap: SPACING.sm,
  },
  checkinItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: SPACING.xs,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  checkinTime: {
    ...FONTS.body,
    fontWeight: "500",
  },
  infoRow: {
    flexDirection: "row",
    gap: SPACING.md,
    width: "100%",
    marginBottom: SPACING.md,
  },
  infoCard: {
    flex: 1,
    alignItems: "center",
    paddingVertical: SPACING.lg,
  },
  infoValue: {
    ...FONTS.title,
    color: COLORS.primary,
    marginTop: SPACING.xs,
  },
  infoLabel: {
    ...FONTS.caption,
    marginTop: SPACING.xs,
  },
  sensorCard: {
    width: "100%",
  },
  sensorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
  },
  sensorText: {
    ...FONTS.body,
  },
});
