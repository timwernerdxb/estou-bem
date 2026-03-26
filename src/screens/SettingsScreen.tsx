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
  Platform,
  Share,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { COLORS, FONTS, SPACING, RADIUS, CHECKIN_CONFIG } from "../constants/theme";
import { useApp, useSubscription } from "../store/AppContext";
import { useI18n, SUPPORTED_LANGUAGES, SupportedLang } from "../i18n";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { checkInService } from "../services/CheckInService";
import { autoCheckinService, CheckinMode } from "../services/AutoCheckinService";
import { healthIntegrationService } from "../services/HealthIntegrationService";
import { RootStackParamList } from "../types";
import { affiliateService } from "../services/AffiliateService";

const serifFont = Platform.OS === "ios" ? "Georgia" : "serif";

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function SettingsScreen() {
  const navigation = useNavigation<Nav>();
  const { state, dispatch } = useApp();
  const { tier, isPro } = useSubscription();
  const { t, lang, setLang } = useI18n();
  const isElder = state.currentUser?.role === "elder";

  const [checkinTimes, setCheckinTimes] = useState(state.checkinTimes);
  const [newTime, setNewTime] = useState("");
  const [autoCheckinMode, setAutoCheckinMode] = useState<CheckinMode>("manual");
  const [healthConnected, setHealthConnected] = useState(false);
  const [myReferralCode, setMyReferralCode] = useState("");
  const [linkCode, setLinkCode] = useState("");
  const [linkLoading, setLinkLoading] = useState(false);

  React.useEffect(() => {
    setAutoCheckinMode(autoCheckinService.getMode());
    setHealthConnected(healthIntegrationService.isInitialized());
  }, []);

  React.useEffect(() => {
    if (state.currentUser?.id) {
      setMyReferralCode(affiliateService.generateReferralCode(state.currentUser.id));
    }
  }, [state.currentUser?.id]);

  const handleAutoCheckinChange = async (mode: CheckinMode) => {
    if (mode === "auto_wearable" && !healthConnected) {
      const ok = await healthIntegrationService.initialize();
      if (!ok) {
        Alert.alert("Nao disponivel", "Nao foi possivel conectar ao servico de saude.");
        return;
      }
      setHealthConnected(true);
    }
    await autoCheckinService.setMode(mode);
    setAutoCheckinMode(mode);
  };

  const handleConnectHealth = async () => {
    const ok = await healthIntegrationService.initialize();
    if (ok) {
      setHealthConnected(true);
      Alert.alert("Conectado", `${healthIntegrationService.getPlatformName()} conectado.`);
    } else {
      Alert.alert("Erro", "Nao foi possivel conectar. Verifique se o app de saude esta instalado.");
    }
  };

  const maxCheckins = CHECKIN_CONFIG.maxCheckinsPerDay[tier];

  const handleAddTime = async () => {
    if (!newTime.match(/^\d{2}:\d{2}$/)) {
      Alert.alert("Formato invalido", "Use o formato HH:MM (ex: 14:30)");
      return;
    }
    if (checkinTimes.length >= maxCheckins) {
      Alert.alert(
        "Limite atingido",
        `Seu plano permite ate ${maxCheckins} check-in(s) por dia. Faca upgrade para adicionar mais.`,
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

  const handleLinkElder = async () => {
    const code = linkCode.trim().toUpperCase();
    if (!code) {
      Alert.alert("Erro", "Digite o codigo de vinculacao do idoso.");
      return;
    }
    setLinkLoading(true);
    try {
      const API_URL = state.currentUser?.apiUrl || process.env.EXPO_PUBLIC_API_URL || "";
      const token = state.currentUser?.token;
      if (!API_URL || !token) {
        Alert.alert("Erro", "Nao foi possivel conectar ao servidor.");
        setLinkLoading(false);
        return;
      }
      const res = await fetch(`${API_URL}/api/link-elder`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) {
        Alert.alert("Erro", data.error || "Codigo invalido.");
      } else {
        Alert.alert("Vinculado!", `Voce foi vinculado(a) a ${data.elderName}.`);
        setLinkCode("");
      }
    } catch {
      Alert.alert("Erro", "Nao foi possivel conectar ao servidor.");
    } finally {
      setLinkLoading(false);
    }
  };

  const handleShareLinkCode = () => {
    const code = state.currentUser?.link_code;
    if (!code) return;
    Share.share({
      message: `Use meu codigo de vinculacao no Estou Bem para acompanhar meu bem-estar: ${code}`,
    });
  };

  const handleLogout = () => {
    Alert.alert(t("confirm_logout"), t("confirm_logout_msg"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("confirm_logout"),
        style: "destructive",
        onPress: () => dispatch({ type: "LOGOUT" }),
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t("settings_title")}</Text>

        {/* Profile */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>{t("settings_profile")}</Text>
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
                  ? t("role_elder")
                  : state.currentUser?.role === "family"
                  ? t("role_family")
                  : t("role_caregiver")}
              </Text>
            </View>
          </View>
        </Card>

        {/* Language Selector */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>{t("settings_language")}</Text>
          {SUPPORTED_LANGUAGES.map((l) => (
            <TouchableOpacity
              key={l.code}
              style={[
                styles.langOption,
                lang === l.code && styles.langOptionActive,
              ]}
              onPress={() => setLang(l.code)}
            >
              <Text
                style={[
                  styles.langLabel,
                  lang === l.code && { color: COLORS.primary, fontWeight: "600" },
                ]}
              >
                {l.label}
              </Text>
              {lang === l.code && (
                <Ionicons name="checkmark-circle" size={20} color={COLORS.primary} />
              )}
            </TouchableOpacity>
          ))}
        </Card>

        {/* Check-in Schedule */}
        {isElder && (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>{t("checkin_schedule")}</Text>
            <Text style={styles.sectionSubtitle}>
              Seu plano permite ate {maxCheckins} check-in(s)/dia
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

        {/* Auto Check-in Mode */}
        {isElder && (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>Modo de Check-in</Text>
            <Text style={styles.sectionSubtitle}>
              Escolha como deseja confirmar seus check-ins
            </Text>

            {(["manual", "auto_movement", "auto_wearable"] as CheckinMode[]).map((mode) => {
              const labels: Record<CheckinMode, { title: string; desc: string; icon: string }> = {
                manual: { title: "Manual", desc: "Voce toca o botao para confirmar", icon: "hand-left" },
                auto_movement: { title: "Automatico (movimento)", desc: "Confirmado se o celular detectar movimento", icon: "phone-portrait" },
                auto_wearable: { title: "Automatico (relogio/pulseira)", desc: "Confirmado se o wearable detectar atividade", icon: "watch" },
              };
              const l = labels[mode];
              return (
                <TouchableOpacity
                  key={mode}
                  style={[
                    styles.modeOption,
                    autoCheckinMode === mode && styles.modeOptionActive,
                  ]}
                  onPress={() => handleAutoCheckinChange(mode)}
                >
                  <Ionicons
                    name={l.icon as any}
                    size={24}
                    color={autoCheckinMode === mode ? COLORS.primary : COLORS.textLight}
                  />
                  <View style={{ flex: 1, marginLeft: SPACING.sm }}>
                    <Text style={[styles.modeTitle, autoCheckinMode === mode && { color: COLORS.primary }]}>
                      {l.title}
                    </Text>
                    <Text style={styles.modeDesc}>{l.desc}</Text>
                  </View>
                  {autoCheckinMode === mode && (
                    <Ionicons name="checkmark-circle" size={22} color={COLORS.primary} />
                  )}
                </TouchableOpacity>
              );
            })}
          </Card>
        )}

        {/* Health Integration */}
        {isElder && (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>{t("settings_health_data")}</Text>
            <TouchableOpacity style={styles.menuRow} onPress={handleConnectHealth}>
              <Ionicons name="heart" size={22} color={healthConnected ? COLORS.primary : COLORS.textLight} />
              <View style={{ flex: 1, marginLeft: SPACING.sm }}>
                <Text style={styles.menuText}>{healthIntegrationService.getPlatformName()}</Text>
                <Text style={styles.sectionSubtitle}>
                  {healthConnected ? t("settings_health_connected") : t("settings_health_tap")}
                </Text>
              </View>
              <Ionicons
                name={healthConnected ? "checkmark-circle" : "chevron-forward"}
                size={20}
                color={healthConnected ? COLORS.primary : COLORS.textLight}
              />
            </TouchableOpacity>
          </Card>
        )}

        {/* Vincular */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>
            {isElder ? t("settings_link_family") : t("settings_link_elder")}
          </Text>
          {isElder ? (
            <>
              <Text style={styles.sectionSubtitle}>
                Compartilhe este codigo com seus familiares para que eles possam acompanhar seu bem-estar
              </Text>
              {state.currentUser?.link_code ? (
                <View style={styles.referralRow}>
                  <View style={styles.referralCodeBox}>
                    <Text style={styles.referralCode}>{state.currentUser.link_code}</Text>
                  </View>
                  <TouchableOpacity style={styles.shareBtn} onPress={handleShareLinkCode}>
                    <Ionicons name="share-social" size={20} color={COLORS.white} />
                    <Text style={styles.shareBtnText}>ENVIAR</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <Text style={styles.sectionSubtitle}>Codigo de vinculacao nao disponivel.</Text>
              )}
            </>
          ) : (
            <>
              <Text style={styles.sectionSubtitle}>
                Digite o codigo de vinculacao do idoso para acompanhar seu bem-estar
              </Text>
              <View style={styles.addTimeRow}>
                <TextInput
                  style={styles.timeInput}
                  placeholder="Codigo"
                  value={linkCode}
                  onChangeText={setLinkCode}
                  autoCapitalize="characters"
                  placeholderTextColor={COLORS.textLight}
                />
                <TouchableOpacity
                  style={[styles.planBtn, { paddingVertical: SPACING.md }]}
                  onPress={handleLinkElder}
                  disabled={linkLoading}
                >
                  <Text style={styles.planBtnText}>
                    {linkLoading ? "..." : "VINCULAR"}
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </Card>

        {/* Subscription */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>{t("settings_subscription")}</Text>
          <View style={styles.subRow}>
            <View>
              <Text style={styles.subTier}>
                {isPro ? "Estou Bem Pro" : t("settings_plan_free")}
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
              onPress={() =>
                navigation.navigate(isPro ? "CustomerCenter" : "Paywall")
              }
            >
              <Text style={styles.planBtnText}>
                {isPro ? t("settings_manage") : t("settings_upgrade")}
              </Text>
            </TouchableOpacity>
          </View>
        </Card>

        {/* Referral */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>{t("settings_referral")}</Text>
          <Text style={styles.sectionSubtitle}>
            Compartilhe seu codigo e ganhe descontos quando seus amigos assinarem
          </Text>
          <View style={styles.referralRow}>
            <View style={styles.referralCodeBox}>
              <Text style={styles.referralCode}>{myReferralCode}</Text>
            </View>
            <TouchableOpacity
              style={styles.shareBtn}
              onPress={() => {
                Share.share({
                  message: `Cuide de quem voce ama com o Estou Bem! Use meu codigo ${myReferralCode} e ganhe 7 dias gratis: https://estoubem.com/invite?ref=${myReferralCode}`,
                });
              }}
            >
              <Ionicons name="share-social" size={20} color={COLORS.white} />
              <Text style={styles.shareBtnText}>COMPARTILHAR</Text>
            </TouchableOpacity>
          </View>
        </Card>

        {/* Navigation shortcuts */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>{t("settings_more")}</Text>

          <TouchableOpacity
            style={styles.menuRow}
            onPress={() => navigation.navigate("EmergencyContacts")}
          >
            <Ionicons name="call" size={22} color={COLORS.primary} />
            <Text style={styles.menuText}>{t("settings_emergency_contacts")}</Text>
            <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuRow}
            onPress={() => navigation.navigate("HealthLog")}
          >
            <Ionicons name="analytics" size={22} color={COLORS.primary} />
            <Text style={styles.menuText}>{t("health_data_title")}</Text>
            <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
          </TouchableOpacity>
        </Card>

        {/* Danger Zone */}
        <Button
          title={t("settings_logout")}
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
  title: {
    ...FONTS.title,
    fontSize: 28,
    marginBottom: SPACING.lg,
  },
  section: { marginBottom: SPACING.md },
  sectionTitle: { ...FONTS.subtitle, fontWeight: "500", marginBottom: SPACING.sm },
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
  avatarText: { color: COLORS.white, fontSize: 22, fontWeight: "300" },
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
    borderRadius: RADIUS.md,
  },
  planBtnText: {
    color: COLORS.white,
    fontWeight: "600",
    fontSize: 12,
    letterSpacing: 1,
  },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  menuText: { ...FONTS.body, flex: 1 },
  modeOption: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    borderRadius: RADIUS.md,
    marginBottom: SPACING.xs,
  },
  modeOptionActive: {
    backgroundColor: COLORS.successLight,
    borderColor: COLORS.primary,
    borderWidth: 1,
  },
  modeTitle: { ...FONTS.body, fontWeight: "500" },
  modeDesc: { ...FONTS.small, marginTop: 2 },
  referralRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    marginTop: SPACING.sm,
  },
  referralCodeBox: {
    flex: 1,
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: "#C9A96E",
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    alignItems: "center",
  },
  referralCode: {
    fontFamily: Platform.OS === "ios" ? "Georgia" : "serif",
    fontSize: 20,
    fontWeight: "600",
    color: COLORS.primary,
    letterSpacing: 3,
  },
  shareBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.md,
  },
  shareBtnText: {
    color: COLORS.white,
    fontWeight: "600",
    fontSize: 11,
    letterSpacing: 1,
  },
  langOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xs,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  langOptionActive: {
    backgroundColor: COLORS.successLight,
    borderRadius: RADIUS.md,
    borderBottomWidth: 0,
    marginBottom: 1,
    paddingHorizontal: SPACING.sm,
  },
  langLabel: {
    ...FONTS.body,
    color: COLORS.textPrimary,
  },
  version: {
    ...FONTS.small,
    textAlign: "center",
    marginTop: SPACING.lg,
    marginBottom: SPACING.xxl,
  },
});
