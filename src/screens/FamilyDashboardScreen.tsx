import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Platform,
  ActivityIndicator,
  AppState,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from "../constants/theme";
import { useApp, useSubscription } from "../store/AppContext";
import { Card } from "../components/Card";
import { StatusBadge } from "../components/StatusBadge";
import { CheckIn } from "../types";
import { fetchElderStatus, fetchProfile, getElderLatestLocation, fetchUserHealthReadings } from "../services/ApiService";
import { useI18n } from "../i18n";
import { healthIntegrationService, HealthSummary } from "../services/HealthIntegrationService";

const serifFont = Platform.OS === "ios" ? "Georgia" : "serif";

interface ElderStatusData {
  linked: boolean;
  elderId?: number;
  elderName?: string;
  checkins?: Array<{
    id: number;
    time: string;
    status: string;
    date: string;
    confirmed_at?: string;
    created_at?: string;
  }>;
  medications?: Array<{
    id: number;
    name: string;
    dosage?: string;
    frequency?: string;
    time?: string;
    stock: number;
    unit: string;
    low_threshold: number;
  }>;
  health?: Array<{
    id: number;
    type: string;
    value: number;
    unit: string;
    time?: string;
    date?: string;
    notes?: string;
    created_at?: string;
  }>;
  lastActivity?: string;
}

export function FamilyDashboardScreen() {
  const { state, dispatch } = useApp();
  const { isFamilia, isCentral, tier } = useSubscription();
  const navigation = useNavigation<any>();
  const { t } = useI18n();
  const [refreshing, setRefreshing] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [elderData, setElderData] = React.useState<ElderStatusData | null>(null);
  const [myHealth, setMyHealth] = React.useState<HealthSummary>({});
  const [elderLocation, setElderLocation] = React.useState<{
    latitude: number;
    longitude: number;
    recorded_at: string;
  } | null>(null);

  // Load MY health data — tries local HealthKit first (real-time), falls back to server data
  // posted by the Watch. This way it works both with and without an Apple Watch.
  React.useEffect(() => {
    if (Platform.OS !== "ios") return;
    const myUserId = (state.currentUser as any)?.id;

    (async () => {
      // 1. Try direct HealthKit via the new NativeModule (works without Watch too)
      try {
        await healthIntegrationService.initialize();
        await healthIntegrationService.requestAppleHealthPermissions();
        const summary = await healthIntegrationService.readAppleHealthSummary(24);
        const hasData = summary.heartRate != null || summary.steps != null || summary.spo2 != null;
        if (hasData) { setMyHealth(summary); return; }
      } catch {}

      // 2. Fallback: server data posted by Watch (if HealthKit module still unavailable)
      if (!myUserId) return;
      try {
        const readings = await fetchUserHealthReadings(state.currentUser, myUserId);
        if (!readings?.length) return;
        const latest: Record<string, any> = {};
        for (const r of readings) {
          if (!latest[r.reading_type] || r.recorded_at > latest[r.reading_type].recorded_at) {
            latest[r.reading_type] = r;
          }
        }
        const timestamps = Object.values(latest).map((r: any) => r.recorded_at).sort().reverse();
        setMyHealth({
          heartRate: latest["heart_rate"]?.value ?? undefined,
          spo2: latest["spo2"]?.value ?? undefined,
          steps: latest["steps"]?.value ?? undefined,
          sleepHours: latest["sleep"]?.value ?? undefined,
          activeCalories: latest["active_calories"]?.value ?? undefined,
          lastUpdated: timestamps[0] ?? undefined,
        });
      } catch {}
    })();
  }, [(state.currentUser as any)?.id]);

  const loadElderData = React.useCallback(async () => {
    try {
      // First try fetchElderStatus
      const data = await fetchElderStatus(state.currentUser);
      if (data && data.elderName) {
        setElderData(data);
      } else {
        // Fallback: get elder name from profile endpoint
        const profile = await fetchProfile(state.currentUser);
        if (profile?.linked_elder_name) {
          setElderData({
            linked: true,
            elderId: profile.linked_elder_id,
            elderName: profile.linked_elder_name,
            checkins: [],
            medications: [],
            health: [],
            contacts: [],
            lastActivity: null,
          } as any);
        }
      }
    } catch (e) {
      console.warn("[FamilyDashboard] Failed to fetch elder status:", e);
    }

    // Fetch elder's latest location
    try {
      const locData = await getElderLatestLocation(state.currentUser);
      if (locData?.location) {
        setElderLocation(locData.location);
      }
    } catch (e) {
      console.warn("[FamilyDashboard] Failed to fetch elder location:", e);
    }
  }, [state.currentUser]);

  React.useEffect(() => {
    (async () => {
      await loadElderData();
      setLoading(false);
    })();
  }, [loadElderData]);

  // Retry after 3 seconds if elderData is still null (token might not have been ready)
  React.useEffect(() => {
    if (!elderData && state.currentUser?.token) {
      const timer = setTimeout(() => loadElderData(), 3000);
      return () => clearTimeout(timer);
    }
  }, [elderData, state.currentUser?.token, loadElderData]);

  // Auto-refresh every 60 seconds so Tim always sees Arla's latest data
  React.useEffect(() => {
    const interval = setInterval(loadElderData, 60 * 1000);
    return () => clearInterval(interval);
  }, [loadElderData]);

  // Re-fetch immediately when app comes back to foreground
  React.useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") loadElderData();
    });
    return () => sub.remove();
  }, [loadElderData]);

  // Sync subscription from server on mount
  React.useEffect(() => {
    (async () => {
      try {
        const profile = await fetchProfile(state.currentUser);
        if (!profile) return;

        // Update subscription from server (single source of truth)
        const serverSub = profile.subscription || "free";
        dispatch({
          type: "SET_SUBSCRIPTION",
          payload: {
            tier: serverSub !== "free" ? "pro" : "free",
            isActive: true,
          },
        });
      } catch (e) {
        console.warn("[FamilyDashboard] Failed to fetch profile:", e);
      }
    })();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadElderData();
    setRefreshing(false);
  };

  // Use server data if available, fall back to local state
  const elderName = elderData?.elderName || state.elderProfile?.name || "Idoso";
  const isLinked = elderData?.linked !== false;

  // Check-ins from server
  const checkins = React.useMemo(() => {
    if (elderData?.checkins && elderData.checkins.length > 0) {
      return elderData.checkins;
    }
    // Fallback to local state
    return state.checkins.map((c) => ({
      id: Number(c.id),
      time: new Date(c.scheduledAt).toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      status: c.status,
      date: new Date(c.scheduledAt).toISOString().slice(0, 10),
      confirmed_at: c.respondedAt || undefined,
      created_at: c.scheduledAt,
    }));
  }, [elderData, state.checkins]);

  // Today's check-ins
  const today = new Date().toISOString().slice(0, 10);
  const todayCheckins = checkins.filter((c) => c.date === today);
  const confirmed = todayCheckins.filter(
    (c) => c.status === "confirmed" || c.status === "auto_confirmed"
  );
  const manuallyConfirmed = todayCheckins.filter((c) => c.status === "confirmed");
  const autoConfirmed = todayCheckins.filter((c) => c.status === "auto_confirmed");
  const missed = todayCheckins.filter((c) => c.status === "missed");
  const pending = todayCheckins.filter((c) => c.status === "pending");

  // Last 7 days stats
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysStr = sevenDaysAgo.toISOString().slice(0, 10);
  const last7Days = checkins.filter((c) => c.date >= sevenDaysStr);
  const adherenceRate =
    last7Days.length > 0
      ? Math.round(
          (last7Days.filter(
            (c) => c.status === "confirmed" || c.status === "auto_confirmed"
          ).length /
            last7Days.length) *
            100
        )
      : 0;

  // Medications from server
  const medications = React.useMemo(() => {
    if (elderData?.medications && elderData.medications.length > 0) {
      return elderData.medications;
    }
    return state.medications.map((m) => ({
      id: Number(m.id),
      name: m.name,
      dosage: m.dosage,
      frequency: m.frequency,
      time: m.times?.[0],
      stock: m.stockQuantity,
      unit: m.stockUnit,
      low_threshold: m.lowStockThreshold,
    }));
  }, [elderData, state.medications]);

  const lowStockMeds = medications.filter(
    (m) => m.stock <= m.low_threshold
  );

  // Health data from server — group by type, preferring HealthKit-sourced readings
  // over manual health_entries for automatic types (steps, HR, SpO2, etc.)
  const healthEntries = elderData?.health || [];
  const latestByType = React.useMemo(() => {
    const map: Record<string, { type: string; value: number; unit: string; created_at?: string; date?: string; time?: string; notes?: string }> = {};
    healthEntries.forEach((h) => {
      const key = h.type;
      const existing = map[key];
      if (!existing) {
        map[key] = h;
        return;
      }
      const isNewFromKit = h.notes === "healthkit";
      const isExistingFromKit = existing.notes === "healthkit";
      // Prefer HealthKit over manual for the same type
      if (isNewFromKit && !isExistingFromKit) {
        map[key] = h;
      } else if (!isNewFromKit && isExistingFromKit) {
        // Keep existing HealthKit entry
      } else {
        // Both from same source — take the more recent one
        if (new Date(h.created_at || h.date || 0) > new Date(existing.created_at || existing.date || 0)) {
          map[key] = h;
        }
      }
    });
    return map;
  }, [healthEntries]);

  const latestHeartRate = latestByType["heart_rate"] || null;
  const latestSteps = latestByType["steps"] || null;
  const latestBpSystolic = latestByType["blood_pressure_systolic"] || null;
  const latestBpDiastolic = latestByType["blood_pressure_diastolic"] || null;
  const latestSpo2 = latestByType["oxygen_saturation"] || null;
  const latestSleep = latestByType["sleep"] || null;
  const latestCalories = latestByType["active_calories"] || null;

  // Relative time formatter for health readings
  const formatRelativeTime = (entry: { created_at?: string; date?: string; time?: string } | null): string => {
    if (!entry) return "";
    const recordedStr = entry.created_at || (entry.date ? `${entry.date}T${entry.time || "00:00"}` : null);
    if (!recordedStr) return "";
    const recorded = new Date(recordedStr);
    if (isNaN(recorded.getTime())) return "";
    const now = new Date();
    const diffMs = now.getTime() - recorded.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "agora";
    if (diffMin < 60) return `h\u00E1 ${diffMin} min`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `h\u00E1 ${diffHours}h`;
    // Check if yesterday
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (recorded.toDateString() === yesterday.toDateString()) return "ontem";
    // Older: show date
    return recorded.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  };

  const isOlderThanOneHour = (entry: { created_at?: string; date?: string; time?: string } | null): boolean => {
    if (!entry) return false;
    const recordedStr = entry.created_at || (entry.date ? `${entry.date}T${entry.time || "00:00"}` : null);
    if (!recordedStr) return false;
    const recorded = new Date(recordedStr);
    if (isNaN(recorded.getTime())) return false;
    return (Date.now() - recorded.getTime()) > 60 * 60 * 1000;
  };

  // Last activity
  const lastActivityText = React.useMemo(() => {
    if (!elderData?.lastActivity) return null;
    const d = new Date(elderData.lastActivity);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "Agora mesmo";
    if (diffMin < 60) return `Há ${diffMin} min`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `Há ${diffHours}h`;
    const diffDays = Math.floor(diffHours / 24);
    return `Há ${diffDays} dia${diffDays > 1 ? "s" : ""}`;
  }, [elderData?.lastActivity]);

  const getStatusColor = () => {
    if (missed.length > 0) return COLORS.danger;
    if (pending.length > 0) return COLORS.warning;
    if (confirmed.length > 0) return COLORS.primary;
    return COLORS.textLight;
  };

  const getStatusText = () => {
    if (missed.length > 0) return t("dashboard_missed_checkins", { count: missed.length });
    if (pending.length > 0) return `${pending.length} check-in(s) pendente(s)`;
    if (confirmed.length > 0) {
      if (manuallyConfirmed.length === confirmed.length) return "Todos os check-ins confirmados";
      if (autoConfirmed.length === confirmed.length) return "Check-ins confirmados automaticamente";
      return `${manuallyConfirmed.length} manual · ${autoConfirmed.length} automático`;
    }
    return "Nenhum check-in hoje ainda";
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Carregando dados...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!isLinked) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Ionicons name="link" size={48} color={COLORS.textLight} />
          <Text style={styles.notLinkedTitle}>Nenhum idoso vinculado</Text>
          <Text style={styles.notLinkedSubtitle}>
            Vá em Configurações para vincular o código do idoso
          </Text>
          <TouchableOpacity
            style={styles.linkButton}
            onPress={() => navigation.navigate("Settings")}
          >
            <Text style={styles.linkButtonText}>IR PARA CONFIGURAÇÕES</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Header */}
        <Text style={styles.title}>{t("dashboard_title")}</Text>

        {/* Elder Profile Card - tappable */}
        <TouchableOpacity
          onPress={() => navigation.navigate("ElderDetail" as any)}
          activeOpacity={0.7}
        >
          <Card style={styles.elderProfileCard}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <View style={styles.elderAvatar}>
                <Text style={styles.elderAvatarText}>
                  {elderName.charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.elderProfileName}>{elderName}</Text>
                <Text style={styles.elderProfileRole}>Pessoa Assistida</Text>
                {lastActivityText && (
                  <Text style={styles.elderProfileActivity}>
                    Última atividade: {lastActivityText}
                  </Text>
                )}
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
            </View>
          </Card>
        </TouchableOpacity>

        {/* Location Card */}
        <Card style={styles.locationCard}>
          <View style={styles.locationRow}>
            <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
              <Ionicons name="location" size={22} color={COLORS.primary} />
              <View style={{ marginLeft: 10, flex: 1 }}>
                <Text style={styles.locationTitle}>Localização</Text>
                {elderLocation ? (
                  <Text style={styles.locationSubtext}>
                    Última localização:{" "}
                    {(() => {
                      const diffMs = Date.now() - new Date(elderLocation.recorded_at).getTime();
                      const diffMin = Math.floor(diffMs / 60000);
                      if (diffMin < 1) return "agora";
                      if (diffMin < 60) return `há ${diffMin} min`;
                      const diffH = Math.floor(diffMin / 60);
                      if (diffH < 24) return `há ${diffH}h`;
                      return `há ${Math.floor(diffH / 24)} dia(s)`;
                    })()}
                  </Text>
                ) : (
                  <Text style={styles.locationSubtext}>Sem dados de localização</Text>
                )}
              </View>
            </View>
            <TouchableOpacity
              style={styles.mapButton}
              onPress={() => navigation.navigate("MapScreen" as any)}
            >
              <Ionicons name="map" size={14} color={COLORS.white} />
              <Text style={styles.mapButtonText}>Ver no Mapa</Text>
            </TouchableOpacity>
          </View>
        </Card>

        {/* Overall Status Card */}
        <Card
          style={{
            ...styles.statusCard,
            borderLeftColor: getStatusColor(),
            borderLeftWidth: 3,
          }}
        >
          <View style={styles.statusHeader}>
            <Ionicons
              name={
                missed.length > 0
                  ? "alert-circle"
                  : pending.length > 0
                  ? "time"
                  : "checkmark-circle"
              }
              size={32}
              color={getStatusColor()}
            />
            <View style={styles.statusInfo}>
              <Text style={styles.statusText}>{getStatusText()}</Text>
              <Text style={styles.statusSubtext}>
                {t("dashboard_confirmed_today", { confirmed: confirmed.length, total: todayCheckins.length })}
              </Text>
            </View>
          </View>
        </Card>

        {/* Stats Grid */}
        <View style={styles.statsGrid}>
          <Card style={styles.statCard}>
            <Text style={styles.statValue}>{adherenceRate}%</Text>
            <Text style={styles.statLabel}>{t("dashboard_adherence")}</Text>
          </Card>
          <Card style={styles.statCard}>
            <Text style={styles.statValue}>{medications.length}</Text>
            <Text style={styles.statLabel}>{t("dashboard_medications")}</Text>
          </Card>
          <Card style={styles.statCard}>
            <Text style={styles.statValue}>{checkins.length}</Text>
            <Text style={styles.statLabel}>{t("dashboard_total_checkins")}</Text>
          </Card>
          <Card style={styles.statCard}>
            <Text
              style={[
                styles.statValue,
                lowStockMeds.length > 0 && { color: COLORS.danger },
              ]}
            >
              {lowStockMeds.length}
            </Text>
            <Text style={styles.statLabel}>{t("dashboard_low_stock")}</Text>
          </Card>
        </View>

        {/* Health Card - always visible, shows ALL metrics with timestamps */}
        <Card style={styles.healthCard}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{t("health_title")}</Text>
          </View>
          <View style={styles.healthGridWrap}>
            {/* Row 1: Heart rate | SpO2 */}
            <View style={styles.healthGridRow}>
              <View style={styles.healthGridCell}>
                <Ionicons name="heart" size={20} color={COLORS.danger} />
                {latestHeartRate ? (
                  <>
                    <Text style={styles.healthValue}>{Math.round(latestHeartRate.value)}</Text>
                    <Text style={styles.healthUnit}>bpm</Text>
                    <Text style={styles.healthTimestamp}>{formatRelativeTime(latestHeartRate)}</Text>
                    {isOlderThanOneHour(latestHeartRate) && (
                      <Text style={styles.healthStaleLabel}>(último registro)</Text>
                    )}
                  </>
                ) : (
                  <>
                    <Text style={styles.healthValueEmpty}>{"\u2014"}</Text>
                    <Text style={styles.healthUnit}>bpm</Text>
                  </>
                )}
              </View>
              <View style={styles.healthGridCell}>
                <Ionicons name="water" size={20} color="#3498DB" />
                {latestSpo2 ? (
                  <>
                    <Text style={styles.healthValue}>{Math.round(latestSpo2.value)}%</Text>
                    <Text style={styles.healthUnit}>SpO2</Text>
                    <Text style={styles.healthTimestamp}>{formatRelativeTime(latestSpo2)}</Text>
                    {isOlderThanOneHour(latestSpo2) && (
                      <Text style={styles.healthStaleLabel}>(último registro)</Text>
                    )}
                  </>
                ) : (
                  <>
                    <Text style={styles.healthValueEmpty}>{"\u2014"}</Text>
                    <Text style={styles.healthUnit}>SpO2</Text>
                  </>
                )}
              </View>
            </View>
            {/* Row 2: Steps | Sleep */}
            <View style={styles.healthGridRow}>
              <View style={styles.healthGridCell}>
                <Ionicons name="footsteps" size={20} color={COLORS.primary} />
                {latestSteps ? (
                  <>
                    <Text style={styles.healthValue}>{Math.round(latestSteps.value).toLocaleString()}</Text>
                    <Text style={styles.healthUnit}>passos</Text>
                    <Text style={styles.healthTimestamp}>{formatRelativeTime(latestSteps)}</Text>
                    {isOlderThanOneHour(latestSteps) && (
                      <Text style={styles.healthStaleLabel}>(último registro)</Text>
                    )}
                  </>
                ) : (
                  <>
                    <Text style={styles.healthValueEmpty}>{"\u2014"}</Text>
                    <Text style={styles.healthUnit}>passos</Text>
                  </>
                )}
              </View>
              <View style={styles.healthGridCell}>
                <Ionicons name="moon" size={20} color="#8E44AD" />
                {latestSleep ? (
                  <>
                    <Text style={styles.healthValue}>{Number(latestSleep.value).toFixed(1)}h</Text>
                    <Text style={styles.healthUnit}>sono</Text>
                    <Text style={styles.healthTimestamp}>{formatRelativeTime(latestSleep)}</Text>
                    {isOlderThanOneHour(latestSleep) && (
                      <Text style={styles.healthStaleLabel}>(último registro)</Text>
                    )}
                  </>
                ) : (
                  <>
                    <Text style={styles.healthValueEmpty}>{"\u2014"}</Text>
                    <Text style={styles.healthUnit}>sono</Text>
                  </>
                )}
              </View>
            </View>
            {/* Row 3: Blood pressure + Calories */}
            <View style={styles.healthGridRow}>
              {(latestBpSystolic || latestBpDiastolic) ? (
                <View style={styles.healthGridCell}>
                  <Ionicons name="pulse" size={20} color={COLORS.accent} />
                  <Text style={styles.healthValue}>
                    {latestBpSystolic ? Math.round(latestBpSystolic.value) : "\u2014"}
                    {latestBpDiastolic ? `/${Math.round(latestBpDiastolic.value)}` : ""}
                  </Text>
                  <Text style={styles.healthUnit}>mmHg</Text>
                  <Text style={styles.healthTimestamp}>{formatRelativeTime(latestBpSystolic || latestBpDiastolic)}</Text>
                  {isOlderThanOneHour(latestBpSystolic || latestBpDiastolic) && (
                    <Text style={styles.healthStaleLabel}>(último registro)</Text>
                  )}
                </View>
              ) : (
                <View style={styles.healthGridCell}>
                  <Ionicons name="pulse" size={20} color={COLORS.textLight} />
                  <Text style={styles.healthValueEmpty}>{"\u2014"}</Text>
                  <Text style={styles.healthUnit}>mmHg</Text>
                </View>
              )}
              <View style={styles.healthGridCell}>
                <Ionicons name="flame" size={20} color="#F97316" />
                {latestCalories ? (
                  <>
                    <Text style={styles.healthValue}>{Math.round(latestCalories.value)}</Text>
                    <Text style={styles.healthUnit}>kcal</Text>
                    <Text style={styles.healthTimestamp}>{formatRelativeTime(latestCalories)}</Text>
                    {isOlderThanOneHour(latestCalories) && (
                      <Text style={styles.healthStaleLabel}>(último registro)</Text>
                    )}
                  </>
                ) : (
                  <>
                    <Text style={styles.healthValueEmpty}>{"\u2014"}</Text>
                    <Text style={styles.healthUnit}>kcal</Text>
                  </>
                )}
              </View>
            </View>
          </View>
        </Card>

        {/* My Health — reads THIS device's HealthKit (family member's own data) */}
        {Platform.OS === "ios" && (
          <Card style={styles.healthCard}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Minha Saúde</Text>
              {myHealth.lastUpdated && (
                <Text style={{ fontSize: 11, color: COLORS.textLight }}>
                  {new Date(myHealth.lastUpdated).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                </Text>
              )}
            </View>
            <View style={styles.healthGridWrap}>
              <View style={styles.healthGridRow}>
                <View style={styles.healthGridCell}>
                  <Ionicons name="heart" size={20} color={COLORS.danger} />
                  <Text style={myHealth.heartRate != null ? styles.healthValue : styles.healthValueEmpty}>
                    {myHealth.heartRate != null ? Math.round(myHealth.heartRate) : "\u2014"}
                  </Text>
                  <Text style={styles.healthUnit}>bpm</Text>
                </View>
                <View style={styles.healthGridCell}>
                  <Ionicons name="water" size={20} color="#3498DB" />
                  <Text style={myHealth.spo2 != null ? styles.healthValue : styles.healthValueEmpty}>
                    {myHealth.spo2 != null ? `${Math.round(myHealth.spo2)}%` : "\u2014"}
                  </Text>
                  <Text style={styles.healthUnit}>SpO2</Text>
                </View>
              </View>
              <View style={styles.healthGridRow}>
                <View style={styles.healthGridCell}>
                  <Ionicons name="footsteps" size={20} color={COLORS.primary} />
                  <Text style={myHealth.steps != null ? styles.healthValue : styles.healthValueEmpty}>
                    {myHealth.steps != null ? myHealth.steps.toLocaleString() : "\u2014"}
                  </Text>
                  <Text style={styles.healthUnit}>passos</Text>
                </View>
                <View style={styles.healthGridCell}>
                  <Ionicons name="moon" size={20} color="#8E44AD" />
                  <Text style={myHealth.sleepHours != null ? styles.healthValue : styles.healthValueEmpty}>
                    {myHealth.sleepHours != null ? `${myHealth.sleepHours}h` : "\u2014"}
                  </Text>
                  <Text style={styles.healthUnit}>sono</Text>
                </View>
              </View>
              <View style={styles.healthGridRow}>
                <View style={styles.healthGridCell}>
                  <Ionicons name="flame" size={20} color="#F97316" />
                  <Text style={myHealth.activeCalories != null ? styles.healthValue : styles.healthValueEmpty}>
                    {myHealth.activeCalories != null ? Math.round(myHealth.activeCalories) : "\u2014"}
                  </Text>
                  <Text style={styles.healthUnit}>kcal</Text>
                </View>
                <View style={styles.healthGridCell} />
              </View>
            </View>
          </Card>
        )}

        {/* Recent Check-ins */}
        <Card style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{t("checkin_recent")}</Text>
            <TouchableOpacity
              onPress={() => navigation.navigate("CheckInHistory")}
            >
              <Text style={styles.seeAll}>VER TODOS</Text>
            </TouchableOpacity>
          </View>
          {checkins.length === 0 ? (
            <Text style={styles.emptyText}>Nenhum check-in ainda</Text>
          ) : (
            checkins.slice(0, 5).map((ci) => (
              <View key={ci.id} style={styles.checkinRow}>
                <View>
                  <Text style={styles.checkinDate}>
                    {ci.date
                      ? `${ci.date.slice(8, 10)}/${ci.date.slice(5, 7)}`
                      : ""}{" "}
                    {ci.time}
                  </Text>
                </View>
                <StatusBadge status={ci.status as any} />
              </View>
            ))
          )}
        </Card>

        {/* Medications */}
        {medications.length > 0 && (
          <Card style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{t("dashboard_medications")}</Text>
            </View>
            {medications.map((m) => (
              <View key={m.id} style={styles.medRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.medName}>{m.name}</Text>
                  {m.dosage && (
                    <Text style={styles.medDosage}>{m.dosage}</Text>
                  )}
                </View>
                <Text
                  style={[
                    styles.medStock,
                    m.stock <= m.low_threshold && { color: COLORS.danger },
                  ]}
                >
                  {m.stock} {m.unit}
                </Text>
              </View>
            ))}
          </Card>
        )}

        {/* Low stock alerts */}
        {lowStockMeds.length > 0 && (
          <Card style={styles.alertCard}>
            <Text style={styles.alertTitle}>Medicamentos com estoque baixo</Text>
            {lowStockMeds.map((m) => (
              <View key={m.id} style={styles.alertRow}>
                <Text style={styles.alertMedName}>{m.name}</Text>
                <Text style={styles.alertStock}>
                  {m.stock} {m.unit}
                </Text>
              </View>
            ))}
          </Card>
        )}

        {/* Subscription info */}
        <Card style={styles.subCard}>
          <View style={styles.subRow}>
            <View>
              <Text style={styles.subLabel}>Plano atual</Text>
              <Text style={styles.subTier}>
                {tier === "free" ? "Gratuito" : "Estou Bem Pro"}
              </Text>
            </View>
            {tier === "free" && (
              <TouchableOpacity
                style={styles.upgradeButton}
                onPress={() => navigation.navigate("Paywall")}
              >
                <Text style={styles.upgradeText}>UPGRADE</Text>
              </TouchableOpacity>
            )}
          </View>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scrollContent: { padding: SPACING.lg },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: SPACING.xl,
  },
  loadingText: { ...FONTS.caption, marginTop: SPACING.md },
  notLinkedTitle: {
    ...FONTS.subtitle,
    marginTop: SPACING.md,
    textAlign: "center",
  },
  notLinkedSubtitle: {
    ...FONTS.caption,
    marginTop: SPACING.sm,
    textAlign: "center",
  },
  linkButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.md,
    marginTop: SPACING.lg,
  },
  linkButtonText: {
    color: COLORS.white,
    fontWeight: "600",
    fontSize: 13,
    letterSpacing: 1,
  },
  title: {
    ...FONTS.title,
    fontSize: 28,
    marginBottom: SPACING.xs,
  },
  subtitleRow: { marginBottom: SPACING.lg },
  subtitle: { ...FONTS.caption },
  lastActivity: { ...FONTS.small, color: COLORS.primary, marginTop: 2 },
  elderProfileCard: { marginBottom: SPACING.md, padding: SPACING.md },
  elderAvatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: COLORS.primary, justifyContent: "center", alignItems: "center",
  },
  elderAvatarText: {
    color: "#fff", fontSize: 20, fontWeight: "700",
    fontFamily: Platform.OS === "ios" ? "Georgia" : "serif",
  },
  elderProfileName: {
    fontSize: 18, fontWeight: "600", color: COLORS.textPrimary,
    fontFamily: Platform.OS === "ios" ? "Georgia" : "serif",
  },
  elderProfileRole: { fontSize: 13, color: COLORS.textLight, marginTop: 2 },
  elderProfileActivity: { fontSize: 12, color: COLORS.primary, marginTop: 2 },
  statusCard: { marginBottom: SPACING.md },
  statusHeader: { flexDirection: "row", alignItems: "center", gap: SPACING.md },
  statusInfo: { flex: 1 },
  statusText: { ...FONTS.subtitle, fontWeight: "500" },
  statusSubtext: { ...FONTS.caption, marginTop: 2 },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  statCard: {
    width: "48%",
    flexGrow: 1,
    alignItems: "center",
    paddingVertical: SPACING.md,
  },
  statValue: {
    fontSize: 28,
    fontWeight: "300",
    fontFamily: Platform.OS === "ios" ? "Georgia" : "serif",
    color: COLORS.primary,
  },
  statLabel: { ...FONTS.caption, marginTop: SPACING.xs, textAlign: "center" },
  healthCard: { marginBottom: SPACING.md },
  healthGridWrap: {
    paddingTop: SPACING.sm,
  },
  healthGridRow: {
    flexDirection: "row",
    marginBottom: SPACING.md,
  },
  healthGridCell: {
    flex: 1,
    alignItems: "center",
    gap: 3,
  },
  healthValue: {
    fontSize: 22,
    fontWeight: "300",
    fontFamily: Platform.OS === "ios" ? "Georgia" : "serif",
    color: COLORS.textPrimary,
  },
  healthValueEmpty: {
    fontSize: 22,
    fontWeight: "300",
    fontFamily: Platform.OS === "ios" ? "Georgia" : "serif",
    color: COLORS.textLight,
  },
  healthUnit: { ...FONTS.small, color: COLORS.textLight },
  healthTimestamp: {
    fontSize: 11,
    color: COLORS.textLight,
    marginTop: 1,
  },
  healthStaleLabel: {
    fontSize: 10,
    color: COLORS.textLight,
    fontStyle: "italic",
  },
  sectionCard: { marginBottom: SPACING.md },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: SPACING.sm,
  },
  sectionTitle: { ...FONTS.subtitle, fontWeight: "500" },
  seeAll: {
    ...FONTS.small,
    color: COLORS.primary,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  emptyText: { ...FONTS.caption, textAlign: "center", paddingVertical: SPACING.md },
  checkinRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  checkinDate: { ...FONTS.body },
  autoText: { ...FONTS.small, color: COLORS.primary },
  medRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  medName: { ...FONTS.body, fontWeight: "500" },
  medDosage: { ...FONTS.small, color: COLORS.textLight },
  medStock: { ...FONTS.body, color: COLORS.primary },
  alertCard: {
    marginBottom: SPACING.md,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.danger,
  },
  alertTitle: { ...FONTS.subtitle, color: COLORS.danger, fontWeight: "500", marginBottom: SPACING.sm },
  alertRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: SPACING.xs,
  },
  alertMedName: { ...FONTS.body },
  alertStock: { ...FONTS.body, color: COLORS.danger, fontWeight: "500" },
  subCard: { marginBottom: SPACING.xl },
  subRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  subLabel: { ...FONTS.caption },
  subTier: { ...FONTS.subtitle, color: COLORS.primary },
  upgradeButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
  },
  upgradeText: {
    color: COLORS.white,
    fontWeight: "600",
    fontSize: 12,
    letterSpacing: 1,
  },
  locationCard: { marginBottom: SPACING.md },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  locationTitle: { ...FONTS.subtitle, fontWeight: "500" },
  locationSubtext: { ...FONTS.caption, marginTop: 2 },
  mapButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    gap: 4,
  },
  mapButtonText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: "600",
  },
});
