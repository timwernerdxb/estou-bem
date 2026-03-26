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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from "../constants/theme";
import { useApp, useSubscription } from "../store/AppContext";
import { Card } from "../components/Card";
import { StatusBadge } from "../components/StatusBadge";
import { CheckIn } from "../types";
import { fetchElderStatus } from "../services/ApiService";

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
  const { state } = useApp();
  const { isFamilia, isCentral, tier } = useSubscription();
  const navigation = useNavigation<any>();
  const [refreshing, setRefreshing] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [elderData, setElderData] = React.useState<ElderStatusData | null>(null);

  const loadElderData = React.useCallback(async () => {
    try {
      const data = await fetchElderStatus(state.currentUser);
      if (data) {
        setElderData(data);
      }
    } catch (e) {
      console.warn("[FamilyDashboard] Failed to fetch elder status:", e);
    }
  }, [state.currentUser]);

  React.useEffect(() => {
    (async () => {
      await loadElderData();
      setLoading(false);
    })();
  }, [loadElderData]);

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

  // Health data from server
  const healthEntries = elderData?.health || [];
  const latestHeartRate = healthEntries.find((h) => h.type === "heart_rate");
  const latestSteps = healthEntries.find((h) => h.type === "steps");
  const latestBpSystolic = healthEntries.find(
    (h) => h.type === "blood_pressure_systolic"
  );
  const latestBpDiastolic = healthEntries.find(
    (h) => h.type === "blood_pressure_diastolic"
  );
  const hasHealthData =
    !!latestHeartRate || !!latestSteps || !!latestBpSystolic;

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
    if (missed.length > 0) return `${missed.length} check-in(s) perdido(s)`;
    if (pending.length > 0) return `${pending.length} check-in(s) pendente(s)`;
    if (confirmed.length > 0) return "Todos os check-ins confirmados";
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
        <Text style={styles.title}>Painel Familiar</Text>
        <View style={styles.subtitleRow}>
          <Text style={styles.subtitle}>Acompanhando: {elderName}</Text>
          {lastActivityText && (
            <Text style={styles.lastActivity}>
              Última atividade: {lastActivityText}
            </Text>
          )}
        </View>

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
                {confirmed.length}/{todayCheckins.length} check-ins confirmados
                hoje
              </Text>
            </View>
          </View>
        </Card>

        {/* Stats Grid */}
        <View style={styles.statsGrid}>
          <Card style={styles.statCard}>
            <Text style={styles.statValue}>{adherenceRate}%</Text>
            <Text style={styles.statLabel}>Aderência (7 dias)</Text>
          </Card>
          <Card style={styles.statCard}>
            <Text style={styles.statValue}>{medications.length}</Text>
            <Text style={styles.statLabel}>Medicamentos</Text>
          </Card>
          <Card style={styles.statCard}>
            <Text style={styles.statValue}>{checkins.length}</Text>
            <Text style={styles.statLabel}>Check-ins total</Text>
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
            <Text style={styles.statLabel}>Estoque baixo</Text>
          </Card>
        </View>

        {/* Health Card */}
        {hasHealthData && (
          <Card style={styles.healthCard}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Saúde</Text>
            </View>
            <View style={styles.healthGrid}>
              {latestHeartRate && (
                <View style={styles.healthItem}>
                  <Ionicons name="heart" size={20} color={COLORS.danger} />
                  <Text style={styles.healthValue}>
                    {Math.round(latestHeartRate.value)}
                  </Text>
                  <Text style={styles.healthUnit}>bpm</Text>
                </View>
              )}
              {latestSteps && (
                <View style={styles.healthItem}>
                  <Ionicons name="footsteps" size={20} color={COLORS.primary} />
                  <Text style={styles.healthValue}>
                    {Math.round(latestSteps.value).toLocaleString()}
                  </Text>
                  <Text style={styles.healthUnit}>passos</Text>
                </View>
              )}
              {latestBpSystolic && (
                <View style={styles.healthItem}>
                  <Ionicons name="pulse" size={20} color={COLORS.accent} />
                  <Text style={styles.healthValue}>
                    {Math.round(latestBpSystolic.value)}
                    {latestBpDiastolic
                      ? `/${Math.round(latestBpDiastolic.value)}`
                      : ""}
                  </Text>
                  <Text style={styles.healthUnit}>mmHg</Text>
                </View>
              )}
            </View>
          </Card>
        )}

        {/* Recent Check-ins */}
        <Card style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Check-ins Recentes</Text>
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
              <Text style={styles.sectionTitle}>Medicamentos</Text>
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
  healthGrid: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingTop: SPACING.sm,
  },
  healthItem: { alignItems: "center", gap: 4 },
  healthValue: {
    fontSize: 22,
    fontWeight: "300",
    fontFamily: Platform.OS === "ios" ? "Georgia" : "serif",
    color: COLORS.textPrimary,
  },
  healthUnit: { ...FONTS.small, color: COLORS.textLight },
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
});
