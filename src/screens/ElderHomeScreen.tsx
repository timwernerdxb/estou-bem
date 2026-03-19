import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Vibration,
  ScrollView,
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

export function ElderHomeScreen() {
  const { state, dispatch } = useApp();
  const { isFamilia } = useSubscription();
  const [pulseAnim] = useState(new Animated.Value(1));
  const [lastCheckin, setLastCheckin] = useState<CheckIn | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);

  const elderName = state.elderProfile?.name || state.currentUser?.name || "Você";
  const todayCheckins = state.checkins.filter((c) => {
    const today = new Date().toDateString();
    return new Date(c.scheduledAt).toDateString() === today;
  });

  const pendingCheckin = todayCheckins.find((c) => c.status === "pending");
  const confirmedToday = todayCheckins.filter(
    (c) => c.status === "confirmed" || c.status === "auto_confirmed"
  ).length;

  // Pulse animation for the check-in button
  useEffect(() => {
    if (pendingCheckin) {
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
    }
  }, [pendingCheckin]);

  const handleCheckin = useCallback(async () => {
    if (isConfirming) return;
    setIsConfirming(true);

    await checkInService.hapticConfirm();
    Vibration.vibrate(200);

    if (pendingCheckin) {
      const confirmed = checkInService.confirmCheckin(pendingCheckin);
      dispatch({ type: "UPDATE_CHECKIN", payload: confirmed });
      setLastCheckin(confirmed);
    } else {
      // Create and immediately confirm a new check-in
      const elderId = state.elderProfile?.id || state.currentUser?.id || "elder";
      const newCheckin = checkInService.createCheckin(elderId, new Date().toISOString());
      const confirmed = checkInService.confirmCheckin(newCheckin);
      dispatch({ type: "ADD_CHECKIN", payload: confirmed });
      setLastCheckin(confirmed);
    }

    setTimeout(() => setIsConfirming(false), 2000);
  }, [pendingCheckin, isConfirming, state.elderProfile, state.currentUser]);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Bom dia";
    if (hour < 18) return "Boa tarde";
    return "Boa noite";
  };

  const buttonColor = pendingCheckin
    ? COLORS.checkinPending
    : isConfirming
    ? COLORS.checkinGreen
    : COLORS.checkinGreen;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <Text style={styles.greeting}>
          {getGreeting()}, {elderName}! 👋
        </Text>
        <Text style={styles.dateText}>
          {new Date().toLocaleDateString("pt-BR", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </Text>

        {/* Main Check-in Button */}
        <View style={styles.checkinContainer}>
          <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
            <TouchableOpacity
              onPress={handleCheckin}
              activeOpacity={0.8}
              style={[
                styles.checkinButton,
                { backgroundColor: buttonColor },
                isConfirming && styles.checkinConfirmed,
              ]}
            >
              <Ionicons
                name={isConfirming ? "checkmark-circle" : "hand-left"}
                size={80}
                color={COLORS.white}
              />
              <Text style={styles.checkinButtonText}>
                {isConfirming
                  ? "Confirmado! ✅"
                  : pendingCheckin
                  ? "TOQUE AQUI"
                  : "ESTOU BEM"}
              </Text>
            </TouchableOpacity>
          </Animated.View>

          {pendingCheckin && (
            <Text style={styles.pendingText}>
              Você tem um check-in pendente
            </Text>
          )}
        </View>

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
              <Ionicons name="fitness" size={20} color={COLORS.success} />
              <Text style={styles.sensorText}>
                Detecção de quedas: {fallDetectionService.isActive() ? "Ativa" : "Inativa"}
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
    ...SHADOWS.large,
  },
  checkinConfirmed: {
    backgroundColor: COLORS.checkinGreenDark,
  },
  checkinButtonText: {
    ...FONTS.elderButton,
    marginTop: SPACING.sm,
    textAlign: "center",
  },
  pendingText: {
    ...FONTS.elderBody,
    color: COLORS.warning,
    marginTop: SPACING.md,
    fontWeight: "600",
  },
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
    fontWeight: "600",
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
