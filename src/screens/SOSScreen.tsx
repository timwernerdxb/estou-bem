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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { COLORS, FONTS, SPACING, SHADOWS, SCREEN, RADIUS } from "../constants/theme";
import { useApp } from "../store/AppContext";
import { notificationService } from "../services/NotificationService";
import { locationService } from "../services/LocationService";

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

    // Call first emergency contact
    if (state.emergencyContacts.length > 0) {
      const sorted = [...state.emergencyContacts].sort(
        (a, b) => a.priority - b.priority
      );
      const firstContact = sorted[0];

      Alert.alert(
        "🚨 SOS Ativado!",
        `Emergência enviada para ${state.emergencyContacts.length} contatos.\n\nDeseja ligar para ${firstContact.name}?`,
        [
          { text: "Não", style: "cancel" },
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
        "🚨 SOS Ativado!",
        "Nenhum contato de emergência cadastrado.\nDeseja ligar para o SAMU?",
        [
          { text: "Cancelar", style: "cancel" },
          {
            text: "Ligar SAMU (192)",
            onPress: () => Linking.openURL("tel:192"),
          },
        ]
      );
    }

    // Reset after 10 seconds
    setTimeout(() => {
      setSOSActivated(false);
      setIsHolding(false);
      progressAnim.setValue(0);
    }, 10000);
  };

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>🆘 Emergência</Text>
        <Text style={styles.subtitle}>
          {sosActivated
            ? "SOS ativado! Socorro a caminho."
            : "Segure o botão por 3 segundos para acionar emergência"}
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
            <Text style={styles.quickCallText}>Polícia (190)</Text>
          </TouchableOpacity>
        </View>

        {/* Emergency contacts */}
        {state.emergencyContacts.length > 0 && (
          <View style={styles.contactsSection}>
            <Text style={styles.contactsTitle}>Contatos de emergência</Text>
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
  title: { ...FONTS.elderTitle, marginBottom: SPACING.xs },
  subtitle: {
    ...FONTS.elderBody,
    color: COLORS.textSecondary,
    textAlign: "center",
    marginBottom: SPACING.xl,
  },
  sosContainer: { alignItems: "center", marginBottom: SPACING.xl },
  sosButton: {
    width: SOS_SIZE,
    height: SOS_SIZE,
    borderRadius: SOS_SIZE / 2,
    backgroundColor: COLORS.danger,
    justifyContent: "center",
    alignItems: "center",
    ...SHADOWS.large,
  },
  sosButtonHolding: { backgroundColor: "#D32F2F", transform: [{ scale: 0.95 }] },
  sosButtonActivated: { backgroundColor: "#B71C1C" },
  sosText: { ...FONTS.elderButton, marginTop: SPACING.xs },
  progressContainer: {
    width: SOS_SIZE + 20,
    height: 8,
    backgroundColor: COLORS.border,
    borderRadius: 4,
    marginTop: SPACING.md,
    overflow: "hidden",
  },
  progressBar: { height: "100%", backgroundColor: COLORS.danger, borderRadius: 4 },
  quickCalls: { width: "100%", gap: SPACING.sm, marginBottom: SPACING.lg },
  quickCallButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.white,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    gap: SPACING.sm,
    ...SHADOWS.small,
  },
  quickCallText: { ...FONTS.subtitle, color: COLORS.danger },
  contactsSection: { width: "100%" },
  contactsTitle: { ...FONTS.subtitle, marginBottom: SPACING.sm },
  contactRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: COLORS.white,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    marginBottom: SPACING.xs,
    ...SHADOWS.small,
  },
  contactName: { ...FONTS.body, fontWeight: "600" },
  contactRel: { ...FONTS.caption },
});
