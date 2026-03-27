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
import { RootStackParamList, SensorSnapshot } from "../types";
import { affiliateService } from "../services/AffiliateService";
import { fallDetectionService } from "../services/FallDetectionService";
import { notificationService } from "../services/NotificationService";
import { putSettings, fetchSettings, postFallDetected, fetchProfile } from "../services/ApiService";
import Constants from "expo-constants";

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
  const [linkedElderName, setLinkedElderName] = useState<string | null>(null);
  const [linkedFamily, setLinkedFamily] = useState<Array<{ id: number; name: string; phone: string }>>([]);
  const [escalationMinutes, setEscalationMinutes] = useState("30");
  const [samuAutoCall, setSamuAutoCall] = useState(true);
  const [fallDetectionEnabled, setFallDetectionEnabled] = useState(fallDetectionService.isActive());

  // Interval check-in mode state
  const [scheduleMode, setScheduleMode] = useState<"scheduled" | "interval">("scheduled");
  const [intervalHours, setIntervalHours] = useState(2);
  const [windowStart, setWindowStart] = useState("07:00");
  const [windowEnd, setWindowEnd] = useState("22:00");

  const trialStart = (state.currentUser as any)?.trial_start as string | undefined;
  const trialDaysLeft = (() => {
    if (!trialStart) return null;
    const start = new Date(trialStart);
    const now = new Date();
    const elapsed = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(0, 7 - elapsed);
  })();

  React.useEffect(() => {
    setAutoCheckinMode(autoCheckinService.getMode());
    setHealthConnected(healthIntegrationService.isInitialized());

    // Fetch settings from server and merge with local
    (async () => {
      try {
        const serverSettings = await fetchSettings(state.currentUser);
        if (serverSettings?.checkin_times && Array.isArray(serverSettings.checkin_times)) {
          const serverTimes = (serverSettings.checkin_times as string[]).map((t: string) => {
            // Normalize times to HH:MM format (fix timezone-shifted values like "00:40")
            if (t && t.match(/^\d{2}:\d{2}$/)) return t;
            // If it's a full ISO string, extract local HH:MM
            try {
              const d = new Date(t);
              if (!isNaN(d.getTime())) {
                return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
              }
            } catch {}
            return t;
          });
          if (serverTimes.length > 0) {
            setCheckinTimes(serverTimes);
            dispatch({ type: "SET_CHECKIN_TIMES", payload: serverTimes });
          }
        }
        // Load interval mode settings from server
        if (serverSettings?.checkin_mode === "interval") {
          setScheduleMode("interval");
        }
        if (serverSettings?.checkin_interval_hours) {
          setIntervalHours(Number(serverSettings.checkin_interval_hours));
        }
        if (serverSettings?.checkin_window_start) {
          setWindowStart(String(serverSettings.checkin_window_start));
        }
        if (serverSettings?.checkin_window_end) {
          setWindowEnd(String(serverSettings.checkin_window_end));
        }
        // Load escalation settings from server
        if (serverSettings?.escalation_minutes != null) {
          setEscalationMinutes(String(serverSettings.escalation_minutes));
        }
        if (serverSettings?.samu_auto_call != null) {
          setSamuAutoCall(serverSettings.samu_auto_call);
        }
        // Apply server language preference
        if (serverSettings?.language) {
          setLang(serverSettings.language as any);
        }
      } catch (e) {
        console.warn("[Settings] Failed to fetch settings from server:", e);
      }
    })();

    // Fetch full profile from server to sync subscription, linked elder, etc.
    (async () => {
      try {
        const profile = await fetchProfile(state.currentUser);
        if (!profile) return;

        // Sync subscription from server (single source of truth)
        const serverSub = profile.subscription || "free";
        dispatch({
          type: "SET_SUBSCRIPTION",
          payload: {
            tier: serverSub !== "free" ? "pro" : "free",
            isActive: true,
            serverTier: serverSub, // "free" | "familia" | "central"
          } as any,
        });

        // Update linked elder info
        if (profile.linked_elder_id && state.currentUser) {
          dispatch({
            type: "SET_USER",
            payload: {
              ...state.currentUser,
              linked_elder_id: String(profile.linked_elder_id),
              link_code: profile.link_code || state.currentUser.link_code,
            },
          });
        }

        // Set linked elder name for family/caregiver users
        if (profile.linked_elder_name) {
          setLinkedElderName(profile.linked_elder_name);
        }

        // Set linked family members for elder users
        if (profile.linked_family && Array.isArray(profile.linked_family)) {
          setLinkedFamily(profile.linked_family);
        }
      } catch (e) {
        console.warn("[Settings] Failed to fetch profile from server:", e);
      }
    })();
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
    // Sync mode to server (fire-and-forget)
    putSettings(state.currentUser, { checkin_mode: mode }).catch(() => {});
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

  // Max check-ins based on subscription: free=1, familia/pro=5, central=10
  const serverSubscription = (state.subscription as any)?.serverTier || (tier === "pro" ? "familia" : "free");
  const maxCheckins = serverSubscription === "central" ? 10 : tier === "pro" ? 5 : 1;

  // Compute times from interval settings
  const computeIntervalTimes = (hours: number, start: string, end: string): string[] => {
    const [startH, startM] = start.split(":").map(Number);
    const [endH, endM] = end.split(":").map(Number);
    const startMinutes = startH * 60 + (startM || 0);
    const endMinutes = endH * 60 + (endM || 0);
    const times: string[] = [];
    for (let m = startMinutes; m <= endMinutes; m += hours * 60) {
      const h = Math.floor(m / 60);
      const min = m % 60;
      times.push(`${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`);
    }
    return times;
  };

  const intervalPreviewTimes = computeIntervalTimes(intervalHours, windowStart, windowEnd);

  const handleSaveInterval = async () => {
    const times = computeIntervalTimes(intervalHours, windowStart, windowEnd);
    setCheckinTimes(times);
    dispatch({ type: "SET_CHECKIN_TIMES", payload: times });
    await checkInService.scheduleCheckinAlarms(times);
    putSettings(state.currentUser, {
      checkin_times: times,
      checkin_mode: "interval",
      checkin_interval_hours: intervalHours,
      checkin_window_start: windowStart,
      checkin_window_end: windowEnd,
    } as any).catch(() => {});
  };

  // Format HH:MM input, fixing timezone / default issues (ensure pure HH:MM string)
  const formatTimeInput = (raw: string): string => {
    const clean = raw.replace(/[^0-9:]/g, "");
    if (clean.match(/^\d{2}:\d{2}$/)) {
      const [h, m] = clean.split(":").map(Number);
      if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
        return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      }
    }
    return clean;
  };

  const handleAddTime = async () => {
    const cleanTime = formatTimeInput(newTime);
    if (!cleanTime.match(/^\d{2}:\d{2}$/)) {
      Alert.alert("Formato invalido", "Use o formato HH:MM (ex: 14:30)");
      return;
    }
    const [h, m] = cleanTime.split(":").map(Number);
    if (h < 0 || h > 23 || m < 0 || m > 59) {
      Alert.alert("Hora invalida", "Use horas entre 00:00 e 23:59");
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

    const updated = [...checkinTimes, cleanTime].sort();
    setCheckinTimes(updated);
    dispatch({ type: "SET_CHECKIN_TIMES", payload: updated });
    await checkInService.scheduleCheckinAlarms(updated);
    // Sync to server (fire-and-forget)
    putSettings(state.currentUser, { checkin_times: updated, checkin_mode: "scheduled" } as any).catch(() => {});
    setNewTime("");
  };

  const handleRemoveTime = async (time: string) => {
    const updated = checkinTimes.filter((t) => t !== time);
    setCheckinTimes(updated);
    dispatch({ type: "SET_CHECKIN_TIMES", payload: updated });
    await checkInService.scheduleCheckinAlarms(updated);
    // Sync to server (fire-and-forget)
    putSettings(state.currentUser, { checkin_times: updated }).catch(() => {});
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
        // Update local state with linked elder info
        if (data.elderId && state.currentUser) {
          dispatch({
            type: "SET_USER",
            payload: { ...state.currentUser, linked_elder_id: String(data.elderId) },
          });
        }
        if (data.elderName) {
          setLinkedElderName(data.elderName);
        }
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

  const handleToggleFallDetection = async (enabled: boolean) => {
    if (enabled) {
      const handleFall = async (snapshot: SensorSnapshot) => {
        const name = state.elderProfile?.name || state.currentUser?.name || "Idoso";
        await notificationService.sendFallDetectedNotification(name, snapshot.heartRate);
        await postFallDetected(state.currentUser, {
          user_id: state.currentUser?.id ? Number(state.currentUser.id) : 0,
          timestamp: new Date().toISOString(),
          heart_rate: snapshot.heartRate,
        });
      };
      await fallDetectionService.startMonitoring(handleFall);
      setFallDetectionEnabled(true);
    } else {
      fallDetectionService.stopMonitoring();
      setFallDetectionEnabled(false);
    }
  };

  const handleLogout = () => {
    Alert.alert(t("confirm_logout"), t("confirm_logout_msg"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("confirm_logout"),
        style: "destructive",
        onPress: async () => {
          // Invalidate server session (fire-and-forget)
          try {
            const apiUrl = state.currentUser?.apiUrl || "https://estou-bem-web-production.up.railway.app";
            const token = state.currentUser?.token;
            if (token) {
              fetch(`${apiUrl}/api/logout`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${token}`,
                },
              }).catch(() => {});
            }
          } catch {}
          dispatch({ type: "LOGOUT" });
        },
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

        {/* Trial Period Banner */}
        {trialDaysLeft !== null && !isPro && (
          <Card style={[styles.section, trialDaysLeft <= 2 ? styles.trialUrgent : styles.trialBanner]}>
            <View style={styles.trialRow}>
              <Ionicons
                name={trialDaysLeft === 0 ? "alert-circle" : "time"}
                size={24}
                color={trialDaysLeft <= 2 ? COLORS.danger : COLORS.accent}
              />
              <View style={{ flex: 1, marginLeft: SPACING.sm }}>
                <Text style={styles.trialTitle}>
                  {trialDaysLeft === 0
                    ? "Periodo de teste encerrado"
                    : `${trialDaysLeft} dia${trialDaysLeft !== 1 ? "s" : ""} restante${trialDaysLeft !== 1 ? "s" : ""} de teste`}
                </Text>
                <Text style={styles.trialSubtitle}>
                  {trialDaysLeft === 0
                    ? "Faca upgrade para continuar usando todos os recursos."
                    : "Aproveite todos os recursos Pro durante o teste."}
                </Text>
              </View>
            </View>
            {trialDaysLeft <= 2 && (
              <TouchableOpacity
                style={styles.trialUpgradeBtn}
                onPress={() => navigation.navigate("Paywall")}
              >
                <Text style={styles.trialUpgradeBtnText}>FAZER UPGRADE</Text>
              </TouchableOpacity>
            )}
          </Card>
        )}

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
              onPress={() => {
                setLang(l.code);
                // Sync language preference to server
                putSettings(state.currentUser, { language: l.code } as any).catch(() => {});
              }}
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

            {/* Schedule mode toggle */}
            <View style={styles.segmentRow}>
              <TouchableOpacity
                style={[
                  styles.segmentBtn,
                  scheduleMode === "scheduled" && styles.segmentBtnActive,
                ]}
                onPress={() => setScheduleMode("scheduled")}
              >
                <Ionicons
                  name="time"
                  size={18}
                  color={scheduleMode === "scheduled" ? COLORS.white : COLORS.textSecondary}
                />
                <Text
                  style={[
                    styles.segmentText,
                    scheduleMode === "scheduled" && styles.segmentTextActive,
                  ]}
                >
                  Horarios fixos
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.segmentBtn,
                  scheduleMode === "interval" && styles.segmentBtnActive,
                ]}
                onPress={() => setScheduleMode("interval")}
              >
                <Ionicons
                  name="repeat"
                  size={18}
                  color={scheduleMode === "interval" ? COLORS.white : COLORS.textSecondary}
                />
                <Text
                  style={[
                    styles.segmentText,
                    scheduleMode === "interval" && styles.segmentTextActive,
                  ]}
                >
                  A cada X horas
                </Text>
              </TouchableOpacity>
            </View>

            {scheduleMode === "scheduled" ? (
              <>
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
                      onChangeText={(text) => setNewTime(formatTimeInput(text))}
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
              </>
            ) : (
              <>
                {/* Interval hours stepper */}
                <View style={styles.intervalRow}>
                  <Text style={styles.intervalLabel}>A cada</Text>
                  <View style={styles.stepperRow}>
                    <TouchableOpacity
                      style={styles.stepperBtn}
                      onPress={() => setIntervalHours(Math.max(1, intervalHours - 1))}
                    >
                      <Ionicons name="remove" size={20} color={COLORS.white} />
                    </TouchableOpacity>
                    <Text style={styles.stepperValue}>{intervalHours}h</Text>
                    <TouchableOpacity
                      style={styles.stepperBtn}
                      onPress={() => setIntervalHours(Math.min(6, intervalHours + 1))}
                    >
                      <Ionicons name="add" size={20} color={COLORS.white} />
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Window start/end */}
                <View style={styles.intervalRow}>
                  <Text style={styles.intervalLabel}>Das</Text>
                  <TextInput
                    style={styles.intervalTimeInput}
                    value={windowStart}
                    onChangeText={(text) => setWindowStart(formatTimeInput(text))}
                    keyboardType="numbers-and-punctuation"
                    maxLength={5}
                    placeholderTextColor={COLORS.textLight}
                  />
                  <Text style={styles.intervalLabel}>as</Text>
                  <TextInput
                    style={styles.intervalTimeInput}
                    value={windowEnd}
                    onChangeText={(text) => setWindowEnd(formatTimeInput(text))}
                    keyboardType="numbers-and-punctuation"
                    maxLength={5}
                    placeholderTextColor={COLORS.textLight}
                  />
                </View>

                {/* Preview */}
                <Text style={styles.intervalPreview}>
                  Check-ins as {intervalPreviewTimes.join(", ")}
                </Text>

                {/* Save button */}
                <TouchableOpacity
                  style={styles.intervalSaveBtn}
                  onPress={handleSaveInterval}
                >
                  <Text style={styles.intervalSaveBtnText}>SALVAR HORARIOS</Text>
                </TouchableOpacity>
              </>
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

        {/* Fall Detection Toggle */}
        {isElder && (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>{t("settings_fall_detection")}</Text>
            <Text style={styles.sectionSubtitle}>
              {t("settings_fall_detection_desc")}
            </Text>
            <View style={styles.menuRow}>
              <Ionicons
                name="fitness"
                size={22}
                color={fallDetectionEnabled ? COLORS.primary : COLORS.textLight}
              />
              <View style={{ flex: 1, marginLeft: SPACING.sm }}>
                <Text style={styles.menuText}>
                  {fallDetectionEnabled
                    ? t("settings_fall_detection_active")
                    : t("settings_fall_detection_inactive")}
                </Text>
              </View>
              <Switch
                value={fallDetectionEnabled}
                onValueChange={handleToggleFallDetection}
                trackColor={{ false: COLORS.border, true: COLORS.primary }}
                thumbColor={COLORS.white}
              />
            </View>
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
              {linkedFamily.length > 0 && (
                <View style={{ marginTop: SPACING.md }}>
                  <Text style={{ ...FONTS.caption, color: COLORS.textSecondary, marginBottom: SPACING.xs }}>
                    Familiares conectados ({linkedFamily.length}):
                  </Text>
                  {linkedFamily.map((f) => (
                    <View key={f.id} style={{ flexDirection: "row", alignItems: "center", paddingVertical: SPACING.xs, gap: SPACING.sm }}>
                      <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.primary, justifyContent: "center", alignItems: "center" }}>
                        <Text style={{ color: "#fff", fontWeight: "600", fontSize: 14 }}>{f.name?.charAt(0)?.toUpperCase() || "?"}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ ...FONTS.body, fontWeight: "500" }}>{f.name}</Text>
                        {f.phone ? <Text style={{ ...FONTS.small, color: COLORS.textLight }}>{f.phone}</Text> : null}
                      </View>
                      <View style={{ backgroundColor: "#E8F5E9", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 }}>
                        <Text style={{ fontSize: 11, color: COLORS.primary, fontWeight: "600" }}>Familiar</Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </>
          ) : (
            <>
              {(linkedElderName || state.currentUser?.linked_elder_id) && (
                <View style={{ backgroundColor: COLORS.successLight, padding: SPACING.md, borderRadius: RADIUS.md, marginBottom: SPACING.sm }}>
                  <Text style={{ ...FONTS.body, color: COLORS.primary, fontWeight: "500" }}>
                    Conectado com: {linkedElderName || "Idoso vinculado"}
                  </Text>
                </View>
              )}
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

          <TouchableOpacity
            style={styles.menuRow}
            onPress={() => navigation.navigate("Gamification" as any)}
          >
            <Ionicons name="trophy" size={22} color={COLORS.accent} />
            <Text style={styles.menuText}>Conquistas</Text>
            <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuRow}
            onPress={() => navigation.navigate("HealthReport" as any)}
          >
            <Ionicons name="document-text" size={22} color={COLORS.primary} />
            <Text style={styles.menuText}>Relatorio de Saude</Text>
            <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuRow}
            onPress={() => navigation.navigate("MedicalProfile" as any)}
          >
            <Ionicons name="person-circle" size={22} color={COLORS.primary} />
            <Text style={styles.menuText}>Perfil Medico</Text>
            <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
          </TouchableOpacity>
        </Card>

        {/* Escalation Config (Elder only) */}
        {isElder && (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>Configurar Alertas</Text>
            <Text style={styles.sectionSubtitle}>
              Configure quem e notificado e como funciona a escalacao de alertas
            </Text>

            <View style={styles.escalationRow}>
              <Ionicons name="time" size={22} color={COLORS.primary} />
              <View style={{ flex: 1, marginLeft: SPACING.sm }}>
                <Text style={styles.modeTitle}>Tempo para escalar (minutos)</Text>
                <Text style={styles.modeDesc}>
                  Tempo sem resposta antes de notificar familiares
                </Text>
              </View>
              <TextInput
                style={styles.escalationInput}
                value={escalationMinutes}
                onChangeText={(val) => {
                  setEscalationMinutes(val);
                  const num = parseInt(val);
                  if (!isNaN(num) && num > 0) {
                    putSettings(state.currentUser, { escalation_minutes: num }).catch(() => {});
                  }
                }}
                keyboardType="numeric"
                maxLength={3}
                placeholderTextColor={COLORS.textLight}
              />
            </View>

            <View style={styles.escalationRow}>
              <Ionicons name="call" size={22} color={COLORS.danger} />
              <View style={{ flex: 1, marginLeft: SPACING.sm }}>
                <Text style={styles.modeTitle}>Ligar SAMU automaticamente</Text>
                <Text style={styles.modeDesc}>
                  Liga 192 se ninguem responder apos a escalacao completa
                </Text>
              </View>
              <Switch
                value={samuAutoCall}
                onValueChange={(val) => {
                  setSamuAutoCall(val);
                  putSettings(state.currentUser, { samu_auto_call: val }).catch(() => {});
                }}
                trackColor={{ false: COLORS.border, true: COLORS.primaryLight }}
                thumbColor={samuAutoCall ? COLORS.primary : COLORS.disabled}
              />
            </View>

            <TouchableOpacity
              style={styles.menuRow}
              onPress={() => navigation.navigate("EmergencyContacts")}
            >
              <Ionicons name="people" size={22} color={COLORS.primary} />
              <Text style={styles.menuText}>Gerenciar contatos de emergencia</Text>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
            </TouchableOpacity>
          </Card>
        )}

        {/* Danger Zone */}
        <Button
          title={t("settings_logout")}
          onPress={handleLogout}
          variant="danger"
          size="large"
          style={{ marginTop: SPACING.xl, width: "100%" }}
        />

        <Text style={styles.version}>Estou Bem v{Constants.expoConfig?.version || '1.1.0'} ({Constants.expoConfig?.extra?.buildNumber || Constants.expoConfig?.ios?.buildNumber || Constants.expoConfig?.android?.versionCode || '1'})</Text>
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
  trialBanner: {
    borderWidth: 1,
    borderColor: COLORS.accent,
    backgroundColor: COLORS.warningLight,
  },
  trialUrgent: {
    borderWidth: 1,
    borderColor: COLORS.danger,
    backgroundColor: COLORS.dangerLight,
  },
  trialRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  trialTitle: {
    ...FONTS.subtitle,
    fontWeight: "500",
  },
  trialSubtitle: {
    ...FONTS.caption,
    marginTop: 2,
  },
  trialUpgradeBtn: {
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    alignItems: "center",
    marginTop: SPACING.md,
  },
  trialUpgradeBtnText: {
    color: COLORS.white,
    fontWeight: "600",
    fontSize: 13,
    letterSpacing: 1,
  },
  escalationRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  escalationInput: {
    width: 60,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    fontSize: 16,
    textAlign: "center",
    backgroundColor: COLORS.white,
    color: COLORS.textPrimary,
  },
  // Interval check-in mode styles
  segmentRow: {
    flexDirection: "row",
    backgroundColor: COLORS.background,
    borderRadius: RADIUS.md,
    padding: 3,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: SPACING.sm + 2,
    borderRadius: RADIUS.md,
  },
  segmentBtnActive: {
    backgroundColor: COLORS.primary,
  },
  segmentText: {
    ...FONTS.caption,
    fontWeight: "500",
    color: COLORS.textSecondary,
  },
  segmentTextActive: {
    color: COLORS.white,
  },
  intervalRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  intervalLabel: {
    ...FONTS.body,
    color: COLORS.textSecondary,
  },
  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
  },
  stepperBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  stepperValue: {
    ...FONTS.subtitle,
    fontWeight: "600",
    color: COLORS.primary,
    minWidth: 40,
    textAlign: "center",
  },
  intervalTimeInput: {
    width: 70,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    fontSize: 18,
    textAlign: "center",
    backgroundColor: COLORS.white,
    color: COLORS.textPrimary,
  },
  intervalPreview: {
    ...FONTS.caption,
    color: COLORS.textSecondary,
    fontStyle: "italic",
    marginBottom: SPACING.md,
  },
  intervalSaveBtn: {
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.md,
    alignItems: "center",
  },
  intervalSaveBtnText: {
    color: COLORS.white,
    fontWeight: "600",
    fontSize: 14,
    letterSpacing: 1,
  },
});
