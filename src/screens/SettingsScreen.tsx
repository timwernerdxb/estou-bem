import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { COLORS, FONTS, SPACING, RADIUS, CHECKIN_CONFIG } from "../constants/theme";
import { useApp, useSubscription } from "../store/AppContext";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { checkInService } from "../services/CheckInService";
import { RootStackParamList } from "../types";

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function SettingsScreen() {
  const navigation = useNavigation<Nav>();
  const { state, dispatch } = useApp();
  const { tier, isFamilia, isCentral } = useSubscription();
  const isElder = state.currentUser?.role === "elder";

  const [checkinTimes, setCheckinTimes] = useState(state.checkinTimes);
  const [newTime, setNewTime] = useState("");

  const maxCheckins = CHECKIN_CONFIG.maxCheckinsPerDay[tier];

  const handleAddTime = async () => {
    if (!newTime.match(/^\d{2}:\d{2}$/)) {
      Alert.alert("Formato inválido", "Use o formato HH:MM (ex: 14:30)");
      return;
    }
    if (checkinTimes.length >= maxCheckins) {
      Alert.alert(
        "Limite atingido",
        `Seu plano permite até ${maxCheckins} check-in(s) por dia. Faça upgrade para adicionar mais.`,
        [
          { text: "OK" },
          { text: "Ver planos", onPress: () => navigation.navigate("Paywall") },
        ]
      );
      return;
    }

    const updated = [...checkinTimes, newTime].sort();
    setCheckinTimes(updated);
    dispatch({ type: "SET_CHECKIN_TIMES", payload: updated });
    await checkInService.scheduleCheckinAlarms(updated);
    setNewTime("");
  };

  const handleRemoveTime = async (time: string) => {
    const updated = checkinTimes.filter((t) => t !== time);
    setCheckinTimes(updated);
    dispatch({ type: "SET_CHECKIN_TIMES", payload: updated });
    await checkInService.scheduleCheckinAlarms(updated);
  };

  const handleLogout = () => {
    Alert.alert("Sair", "Deseja sair e apagar seus dados locais?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Sair",
        style: "destructive",
        onPress: () => dispatch({ type: "LOGOUT" }),
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>⚙️ Configurações</Text>

        {/* Profile */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Perfil</Text>
          <View style={styles.profileRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {(state.currentUser?.name || "?")[0].toUpperCase()}
              </Text>
            </View>
            <View style={styles.profileInfo}>
              <Text style={styles.profileName}>{state.currentUser?.name}</Text>
              <Text style={styles.profileRole}>
                {state.currentUser?.role === "elder"
                  ? "Idoso"
                  : state.currentUser?.role === "family"
                  ? "Familiar"
                  : "Cuidador"}
              </Text>
            </View>
          </View>
        </Card>

        {/* Check-in Schedule */}
        {isElder && (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>Horários de Check-in</Text>
            <Text style={styles.sectionSubtitle}>
              Seu plano permite até {maxCheckins} check-in(s)/dia
            </Text>

            {checkinTimes.map((time) => (
              <View key={time} style={styles.timeRow}>
                <Ionicons name="alarm" size={22} color={COLORS.primary} />
                <Text style={styles.timeText}>{time}</Text>
                <TouchableOpacity onPress={() => handleRemoveTime(time)}>
                  <Ionicons name="close-circle" size={22} color={COLORS.danger} />
                </TouchableOpacity>
              </View>
            ))}

            {checkinTimes.length < maxCheckins && (
              <View style={styles.addTimeRow}>
                <TextInput
                  style={styles.timeInput}
                  placeholder="HH:MM"
                  value={newTime}
                  onChangeText={setNewTime}
                  keyboardType="numbers-and-punctuation"
                  maxLength={5}
                  placeholderTextColor={COLORS.textLight}
                />
                <TouchableOpacity
                  style={styles.addTimeBtn}
                  onPress={handleAddTime}
                >
                  <Ionicons name="add-circle" size={32} color={COLORS.primary} />
                </TouchableOpacity>
              </View>
            )}
          </Card>
        )}

        {/* Subscription */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Assinatura</Text>
          <View style={styles.subRow}>
            <View>
              <Text style={styles.subTier}>
                Plano{" "}
                {tier === "free"
                  ? "Gratuito"
                  : tier === "familia"
                  ? "Família"
                  : "Central"}
              </Text>
              {state.subscription.expiresAt && (
                <Text style={styles.subExpiry}>
                  Renova em:{" "}
                  {new Date(state.subscription.expiresAt).toLocaleDateString(
                    "pt-BR"
                  )}
                </Text>
              )}
            </View>
            <TouchableOpacity
              style={styles.planBtn}
              onPress={() => navigation.navigate("Paywall")}
            >
              <Text style={styles.planBtnText}>
                {tier === "free" ? "Upgrade" : "Gerenciar"}
              </Text>
            </TouchableOpacity>
          </View>
        </Card>

        {/* Navigation shortcuts */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Mais</Text>

          <TouchableOpacity
            style={styles.menuRow}
            onPress={() => navigation.navigate("EmergencyContacts")}
          >
            <Ionicons name="call" size={22} color={COLORS.primary} />
            <Text style={styles.menuText}>Contatos de Emergência</Text>
            <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuRow}
            onPress={() => navigation.navigate("HealthLog")}
          >
            <Ionicons name="analytics" size={22} color={COLORS.primary} />
            <Text style={styles.menuText}>Diário de Saúde</Text>
            <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
          </TouchableOpacity>
        </Card>

        {/* Danger Zone */}
        <Button
          title="Sair da conta"
          onPress={handleLogout}
          variant="danger"
          size="large"
          style={{ marginTop: SPACING.xl, width: "100%" }}
        />

        <Text style={styles.version}>Estou Bem v1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.lg },
  title: { ...FONTS.title, marginBottom: SPACING.lg },
  section: { marginBottom: SPACING.md },
  sectionTitle: { ...FONTS.subtitle, marginBottom: SPACING.sm },
  sectionSubtitle: { ...FONTS.caption, marginBottom: SPACING.sm },
  profileRow: { flexDirection: "row", alignItems: "center", gap: SPACING.md },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: COLORS.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: { color: COLORS.white, fontSize: 22, fontWeight: "700" },
  profileInfo: {},
  profileName: { ...FONTS.subtitle },
  profileRole: { ...FONTS.caption },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  timeText: { ...FONTS.subtitle, flex: 1 },
  addTimeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    marginTop: SPACING.sm,
  },
  timeInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    fontSize: 18,
    textAlign: "center",
    backgroundColor: COLORS.white,
    color: COLORS.textPrimary,
  },
  addTimeBtn: {},
  subRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  subTier: { ...FONTS.subtitle, color: COLORS.primary },
  subExpiry: { ...FONTS.caption },
  planBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.full,
  },
  planBtnText: { color: COLORS.white, fontWeight: "700" },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  menuText: { ...FONTS.body, flex: 1 },
  version: {
    ...FONTS.small,
    textAlign: "center",
    marginTop: SPACING.lg,
    marginBottom: SPACING.xxl,
  },
});
