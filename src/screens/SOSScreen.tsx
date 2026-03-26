import React, { useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Alert,
  Vibration,
  Linking,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { COLORS, FONTS, SPACING, SHADOWS, SCREEN, RADIUS } from "../constants/theme";
import { useApp } from "../store/AppContext";
import { notificationService } from "../services/NotificationService";
import { locationService } from "../services/LocationService";
import { postFallDetected, postFallCancelled } from "../services/ApiService";

const serifFont = Platform.OS === "ios" ? "Georgia" : "serif";
const HOLD_DURATION = 3000; // 3 seconds to activate SOS

export function SOSScreen() {
  const { state } = useApp();
  const [isHolding, setIsHolding] = useState(false);
  const [sosActivated, setSOSActivated] = useState(false);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const elderName = state.elderProfile?.name || state.currentUser?.name || "Idoso";

  const startHold = () => {
    setIsHolding(true);
    Vibration.vibrate([0, 100, 100, 100]);

    Animated.timing(progressAnim, {
      toValue: 1,
      duration: HOLD_DURATION,
      useNativeDriver: false,
    }).start();

    holdTimer.current = setTimeout(async () => {
      await activateSOS();
    }, HOLD_DURATION);
  };

  const cancelHold = () => {
    setIsHolding(false);
    progressAnim.setValue(0);
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };

  const activateSOS = async () => {
    setSOSActivated(true);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    Vibration.vibrate([0, 500, 200, 500, 200, 500]);

    // Get location
    const location = await locationService.getLocationString();

    // Notify all emergency contacts via local notification
    await notificationService.sendSOSNotification(elderName, location);

    // POST to server to trigger escalation pipeline (SMS, WhatsApp, voice calls)
    postFallDetected(state.currentUser, {
      user_id: state.currentUser?.id ? Number(state.currentUser.id) : 0,
      timestamp: new Date().toISOString(),
      location: undefined,
    }).catch(() => {});

    // Call first emergency contact
    if (state.emergencyContacts.length > 0) {
      const sorted = [...state.emergencyContacts].sort(
        (a, b) => a.priority - b.priority
      );
      const firstContact = sorted[0];

      Alert.alert(
        "SOS Ativado",
        `Emergencia enviada para ${state.emergencyContacts.length} contatos.\n\nDeseja ligar para ${firstContact.name}?`,
        [
          { text: "Nao", style: "cancel" },
          {
            text: `Ligar para ${firstContact.name}`,
            onPress: () => Linking.openURL(`tel:${firstContact.phone}`),
          },
          {
            text: "Ligar SAMU (192)",
            style: "destructive",
            onPress: () => Linking.openURL("tel:192"),
          },
        ]
      );
    } else {
      Alert.alert(
        "SOS Ativado",
        "Nenhum contato de emergencia cadastrado.\nDeseja ligar para o SAMU?",
        [
          { text: "Cancelar", style: "cancel" },
          {
            text: "Ligar SAMU (192)",
            onPress: () => Linking.openURL("tel:192"),
          },
        ]
      );
    }

  };

  const cancelSOS = () => {
    setSOSActivated(false);
    setIsHolding(false);
    progressAnim.setValue(0);
    // Notify server to cancel escalation
    postFallCancelled(state.currentUser, {
      user_id: state.currentUser?.id ? Number(state.currentUser.id) : 0,
    }).catch(() => {});
    Alert.alert("SOS Cancelado", "O alerta de emergencia foi cancelado.");
  };

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Emergencia</Text>
        <Text style={styles.subtitle}>
          {sosActivated
            ? "SOS ativado. Socorro a caminho."
            : "Segure o botao por 3 segundos para acionar emergencia"}
        </Text>

        {/* SOS Button */}
        <View style={styles.sosContainer}>
          <TouchableOpacity
            onPressIn={startHold}
            onPressOut={cancelHold}
            activeOpacity={0.9}
            style={[
              styles.sosButton,
              isHolding && styles.sosButtonHolding,
              sosActivated && styles.sosButtonActivated,
            ]}
          >
            <Ionicons
              name={sosActivated ? "alert-circle" : "warning"}
              size={80}
              color={COLORS.white}
            />
            <Text style={styles.sosText}>
              {sosActivated ? "SOS ATIVADO" : "SOS"}
            </Text>
          </TouchableOpacity>

          {/* Progress ring */}
          {isHolding && !sosActivated && (
            <View style={styles.progressContainer}>
              <Animated.View
                style={[styles.progressBar, { width: progressWidth }]}
              />
            </View>
          )}

          {/* Cancel SOS button */}
          {sosActivated && (
            <TouchableOpacity
              onPress={cancelSOS}
              style={styles.cancelSOSButton}
            >
              <Ionicons name="close-circle" size={24} color={COLORS.white} />
              <Text style={styles.cancelSOSText}>CANCELAR SOS</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Quick call buttons */}
        <View style={styles.quickCalls}>
          <TouchableOpacity
            style={styles.quickCallButton}
            onPress={() => Linking.openURL("tel:192")}
          >
            <Ionicons name="call" size={24} color={COLORS.danger} />
            <Text style={styles.quickCallText}>SAMU (192)</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickCallButton}
            onPress={() => Linking.openURL("tel:193")}
          >
            <Ionicons name="call" size={24} color={COLORS.danger} />
            <Text style={styles.quickCallText}>Bombeiros (193)</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickCallButton}
            onPress={() => Linking.openURL("tel:190")}
          >
            <Ionicons name="call" size={24} color={COLORS.danger} />
            <Text style={styles.quickCallText}>Policia (190)</Text>
          </TouchableOpacity>
        </View>

        {/* Emergency contacts */}
        {state.emergencyContacts.length > 0 && (
          <View style={styles.contactsSection}>
            <Text style={styles.contactsTitle}>Contatos de emergencia</Text>
            {state.emergencyContacts
              .sort((a, b) => a.priority - b.priority)
              .map((contact) => (
                <TouchableOpacity
                  key={contact.id}
                  style={styles.contactRow}
                  onPress={() => Linking.openURL(`tel:${contact.phone}`)}
                >
                  <View>
                    <Text style={styles.contactName}>{contact.name}</Text>
                    <Text style={styles.contactRel}>
                      {contact.relationship}
                    </Text>
                  </View>
                  <Ionicons name="call" size={24} color={COLORS.primary} />
                </TouchableOpacity>
              ))}
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const SOS_SIZE = Math.min(SCREEN.width * 0.55, 220);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { flex: 1, padding: SPACING.lg, alignItems: "center" },
  title: {
    ...FONTS.elderTitle,
    marginBottom: SPACING.xs,
    color: COLORS.danger,
  },
  subtitle: {
    ...FONTS.body,
    fontSize: 18,
    color: COLORS.textSecondary,
    textAlign: "center",
    marginBottom: SPACING.xl,
    lineHeight: 26,
  },
  sosContainer: { alignItems: "center", marginBottom: SPACING.xl },
  sosButton: {
    width: SOS_SIZE,
    height: SOS_SIZE,
    borderRadius: SOS_SIZE / 2,
    backgroundColor: COLORS.danger,
    justifyContent: "center",
    alignItems: "center",
  },
  sosButtonHolding: { backgroundColor: "#6B2A2A", transform: [{ scale: 0.95 }] },
  sosButtonActivated: { backgroundColor: "#4A1E1E" },
  sosText: { ...FONTS.elderButton, marginTop: SPACING.xs, letterSpacing: 2 },
  progressContainer: {
    width: SOS_SIZE + 20,
    height: 6,
    backgroundColor: COLORS.border,
    borderRadius: 3,
    marginTop: SPACING.md,
    overflow: "hidden",
  },
  progressBar: { height: "100%", backgroundColor: COLORS.danger, borderRadius: 3 },
  quickCalls: { width: "100%", gap: SPACING.sm, marginBottom: SPACING.lg },
  quickCallButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.white,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: SPACING.sm,
  },
  quickCallText: { ...FONTS.subtitle, color: COLORS.danger, fontWeight: "500" },
  contactsSection: { width: "100%" },
  contactsTitle: { ...FONTS.subtitle, marginBottom: SPACING.sm },
  contactRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: COLORS.white,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.xs,
  },
  contactName: { ...FONTS.body, fontWeight: "500" },
  contactRel: { ...FONTS.caption },
  cancelSOSButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.textSecondary,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    marginTop: SPACING.lg,
    gap: SPACING.xs,
  },
  cancelSOSText: {
    color: COLORS.white,
    fontWeight: "600",
    fontSize: 16,
    letterSpacing: 1,
  },
});
