import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from "../constants/theme";
import { useApp, useSubscription } from "../store/AppContext";
import { Card } from "../components/Card";
import { StatusBadge } from "../components/StatusBadge";
import { CheckIn } from "../types";

const serifFont = Platform.OS === "ios" ? "Georgia" : "serif";

export function FamilyDashboardScreen() {
  const { state } = useApp();
  const { isFamilia, isCentral, tier } = useSubscription();
  const navigation = useNavigation<any>();
  const [refreshing, setRefreshing] = React.useState(false);

  const elderName = state.elderProfile?.name || "Idoso";

  // Today's check-ins
  const today = new Date().toDateString();
  const todayCheckins = state.checkins.filter(
    (c) => new Date(c.scheduledAt).toDateString() === today
  );
  const confirmed = todayCheckins.filter(
    (c) => c.status === "confirmed" || c.status === "auto_confirmed"
  );
  const missed = todayCheckins.filter((c) => c.status === "missed");
  const pending = todayCheckins.filter((c) => c.status === "pending");

  // Last 7 days stats
  const last7Days = state.checkins.filter((c) => {
    const d = new Date(c.scheduledAt);
    const now = new Date();
    return now.getTime() - d.getTime() < 7 * 24 * 60 * 60 * 1000;
  });
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

  // Low stock medications
  const lowStockMeds = state.medications.filter(
    (m) => m.stockQuantity <= m.lowStockThreshold
  );

  const onRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1000);
  };

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
        <Text style={styles.subtitle}>Acompanhando: {elderName}</Text>

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
            <Text style={styles.statLabel}>Aderencia (7 dias)</Text>
          </Card>
          <Card style={styles.statCard}>
            <Text style={styles.statValue}>{state.medications.length}</Text>
            <Text style={styles.statLabel}>Medicamentos</Text>
          </Card>
          <Card style={styles.statCard}>
            <Text style={styles.statValue}>{state.checkins.length}</Text>
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
          {state.checkins.length === 0 ? (
            <Text style={styles.emptyText}>Nenhum check-in ainda</Text>
          ) : (
            state.checkins.slice(0, 5).map((ci) => (
              <View key={ci.id} style={styles.checkinRow}>
                <View>
                  <Text style={styles.checkinDate}>
                    {new Date(ci.scheduledAt).toLocaleDateString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                    })}{" "}
                    {new Date(ci.scheduledAt).toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </Text>
                  {ci.autoConfirmSource && (
                    <Text style={styles.autoText}>
                      Auto: {ci.autoConfirmSource}
                    </Text>
                  )}
                </View>
                <StatusBadge status={ci.status} />
              </View>
            ))
          )}
        </Card>

        {/* Low stock alerts */}
        {lowStockMeds.length > 0 && (
          <Card style={styles.alertCard}>
            <Text style={styles.alertTitle}>Medicamentos com estoque baixo</Text>
            {lowStockMeds.map((m) => (
              <View key={m.id} style={styles.alertRow}>
                <Text style={styles.alertMedName}>{m.name}</Text>
                <Text style={styles.alertStock}>
                  {m.stockQuantity} {m.stockUnit}
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
  title: {
    ...FONTS.title,
    fontSize: 28,
    marginBottom: SPACING.xs,
  },
  subtitle: { ...FONTS.caption, marginBottom: SPACING.lg },
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
