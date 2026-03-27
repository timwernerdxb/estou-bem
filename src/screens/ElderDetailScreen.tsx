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
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { COLORS, FONTS, SPACING, RADIUS } from "../constants/theme";
import { useApp } from "../store/AppContext";
import { Card } from "../components/Card";
import { StatusBadge } from "../components/StatusBadge";
import { fetchElderStatus, fetchContacts } from "../services/ApiService";
import { useI18n } from "../i18n";

const serifFont = Platform.OS === "ios" ? "Georgia" : "serif";

interface ElderStatusData {
  linked: boolean;
  elderId?: number;
  elderName?: string;
  elderPhone?: string;
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
  contacts?: Array<{
    id: number;
    name: string;
    phone: string;
    relationship?: string;
  }>;
}

export function ElderDetailScreen() {
  const { state } = useApp();
  const navigation = useNavigation<any>();
  const { t } = useI18n();
  const [refreshing, setRefreshing] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [elderData, setElderData] = React.useState<ElderStatusData | null>(null);
  const [elderContacts, setElderContacts] = React.useState<any[]>([]);

  const loadData = React.useCallback(async () => {
    try {
      const [data, contacts] = await Promise.all([
        fetchElderStatus(state.currentUser),
        fetchContacts(state.currentUser),
      ]);
      if (data) setElderData(data);
      if (contacts) setElderContacts(contacts);
    } catch (e) {
      console.warn("[ElderDetail] Failed to fetch data:", e);
    }
  }, [state.currentUser]);

  React.useEffect(() => {
    (async () => {
      await loadData();
      setLoading(false);
    })();
  }, [loadData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const elderName = elderData?.elderName || state.elderProfile?.name || t("role_elder");

  // Last activity text
  const lastActivityText = React.useMemo(() => {
    if (!elderData?.lastActivity) return null;
    const d = new Date(elderData.lastActivity);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return t("elder_detail_just_now");
    if (diffMin < 60) return t("elder_detail_time_minutes_ago", { count: diffMin });
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return t("elder_detail_time_hours_ago", { count: diffHours });
    const diffDays = Math.floor(diffHours / 24);
    return diffDays > 1
      ? t("elder_detail_time_days_ago_plural", { count: diffDays })
      : t("elder_detail_time_days_ago", { count: diffDays });
  }, [elderData?.lastActivity, t]);

  // Health data — group by type and take the most recent reading
  const healthEntries = elderData?.health || [];
  const latestByType = React.useMemo(() => {
    const map: Record<string, { type: string; value: number; unit: string; created_at?: string; date?: string; time?: string; notes?: string }> = {};
    healthEntries.forEach((h) => {
      const key = h.type;
      if (!map[key] || new Date(h.created_at || h.date || 0) > new Date(map[key].created_at || map[key].date || 0)) {
        map[key] = h;
      }
    });
    return map;
  }, [healthEntries]);

  const latestHeartRate = latestByType["heart_rate"] || null;
  const latestSteps = latestByType["steps"] || null;
  const latestSpO2 = latestByType["oxygen_saturation"] || null;
  const latestSleep = latestByType["sleep"] || null;
  const latestBpSystolic = latestByType["blood_pressure_systolic"] || null;
  const latestBpDiastolic = latestByType["blood_pressure_diastolic"] || null;

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
    if (diffMin < 1) return t("elder_detail_now");
    if (diffMin < 60) return t("elder_detail_time_minutes_ago", { count: diffMin });
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return t("elder_detail_time_hours_ago", { count: diffHours });
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (recorded.toDateString() === yesterday.toDateString()) return t("elder_detail_yesterday");
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

  // Today's check-ins
  const today = new Date().toISOString().slice(0, 10);
  const todayCheckins = (elderData?.checkins || []).filter((c) => c.date === today);

  // Medications
  const medications = elderData?.medications || [];

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>{t("elder_detail_loading")}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t("elder_detail_title")}</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Elder Profile Header */}
        <View style={styles.profileHeader}>
          <View style={styles.elderAvatar}>
            <Text style={styles.elderAvatarText}>
              {elderName.charAt(0).toUpperCase()}
            </Text>
          </View>
          <Text style={styles.elderName}>{elderName}</Text>
          {lastActivityText && (
            <Text style={styles.lastActivity}>
              {t("elder_detail_last_activity", { time: lastActivityText })}
            </Text>
          )}
        </View>

        {/* Saude Section — always show all metrics with timestamps */}
        <Card style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Ionicons name="heart" size={20} color={COLORS.danger} />
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
                      <Text style={styles.healthStaleLabel}>{t("elder_detail_last_record")}</Text>
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
                {latestSpO2 ? (
                  <>
                    <Text style={styles.healthValue}>{Math.round(latestSpO2.value)}%</Text>
                    <Text style={styles.healthUnit}>SpO2</Text>
                    <Text style={styles.healthTimestamp}>{formatRelativeTime(latestSpO2)}</Text>
                    {isOlderThanOneHour(latestSpO2) && (
                      <Text style={styles.healthStaleLabel}>{t("elder_detail_last_record")}</Text>
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
                    <Text style={styles.healthUnit}>{t("elder_detail_steps_unit")}</Text>
                    <Text style={styles.healthTimestamp}>{formatRelativeTime(latestSteps)}</Text>
                    {isOlderThanOneHour(latestSteps) && (
                      <Text style={styles.healthStaleLabel}>{t("elder_detail_last_record")}</Text>
                    )}
                  </>
                ) : (
                  <>
                    <Text style={styles.healthValueEmpty}>{"\u2014"}</Text>
                    <Text style={styles.healthUnit}>{t("elder_detail_steps_unit")}</Text>
                  </>
                )}
              </View>
              <View style={styles.healthGridCell}>
                <Ionicons name="moon" size={20} color="#8E44AD" />
                {latestSleep ? (
                  <>
                    <Text style={styles.healthValue}>{Number(latestSleep.value).toFixed(1)}h</Text>
                    <Text style={styles.healthUnit}>{t("elder_detail_sleep_unit")}</Text>
                    <Text style={styles.healthTimestamp}>{formatRelativeTime(latestSleep)}</Text>
                    {isOlderThanOneHour(latestSleep) && (
                      <Text style={styles.healthStaleLabel}>{t("elder_detail_last_record")}</Text>
                    )}
                  </>
                ) : (
                  <>
                    <Text style={styles.healthValueEmpty}>{"\u2014"}</Text>
                    <Text style={styles.healthUnit}>{t("elder_detail_sleep_unit")}</Text>
                  </>
                )}
              </View>
            </View>
            {/* Row 3: Blood pressure (only if available) */}
            {(latestBpSystolic || latestBpDiastolic) && (
              <View style={styles.healthGridRow}>
                <View style={styles.healthGridCell}>
                  <Ionicons name="pulse" size={20} color={COLORS.accent} />
                  <Text style={styles.healthValue}>
                    {latestBpSystolic ? Math.round(latestBpSystolic.value) : "\u2014"}
                    {latestBpDiastolic ? `/${Math.round(latestBpDiastolic.value)}` : ""}
                  </Text>
                  <Text style={styles.healthUnit}>mmHg</Text>
                  <Text style={styles.healthTimestamp}>{formatRelativeTime(latestBpSystolic || latestBpDiastolic)}</Text>
                  {isOlderThanOneHour(latestBpSystolic || latestBpDiastolic) && (
                    <Text style={styles.healthStaleLabel}>{t("elder_detail_last_record")}</Text>
                  )}
                </View>
                <View style={styles.healthGridCell} />
              </View>
            )}
          </View>
        </Card>

        {/* Check-ins hoje */}
        <Card style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Ionicons name="checkmark-circle" size={20} color={COLORS.primary} />
            <Text style={styles.sectionTitle}>{t("checkin_today")}</Text>
          </View>
          {todayCheckins.length === 0 ? (
            <Text style={styles.emptyText}>{t("elder_detail_no_checkins_today")}</Text>
          ) : (
            todayCheckins.map((ci) => (
              <View key={ci.id} style={styles.checkinRow}>
                <Text style={styles.checkinTime}>{ci.time}</Text>
                <StatusBadge status={ci.status as any} />
              </View>
            ))
          )}
        </Card>

        {/* Medicamentos */}
        <Card style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Ionicons name="medical" size={20} color={COLORS.primary} />
            <Text style={styles.sectionTitle}>{t("meds_title")}</Text>
          </View>
          {medications.length === 0 ? (
            <Text style={styles.emptyText}>{t("meds_empty")}</Text>
          ) : (
            medications.map((m) => (
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
            ))
          )}
        </Card>

        {/* Contatos de emergencia */}
        <Card style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Ionicons name="people" size={20} color={COLORS.primary} />
            <Text style={styles.sectionTitle}>{t("sos_emergency_contacts")}</Text>
          </View>
          {elderContacts.length === 0 ? (
            <Text style={styles.emptyText}>{t("contacts_empty")}</Text>
          ) : (
            elderContacts.map((c: any) => (
              <View key={c.id} style={styles.contactRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.contactName}>{c.name}</Text>
                  {c.relationship && (
                    <Text style={styles.contactRel}>{c.relationship}</Text>
                  )}
                  <Text style={styles.contactPhone}>{c.phone}</Text>
                </View>
                <TouchableOpacity onPress={() => Linking.openURL(`tel:${c.phone}`)}>
                  <Ionicons name="call" size={22} color={COLORS.success} />
                </TouchableOpacity>
              </View>
            ))
          )}
        </Card>

        {/* View Medical Profile button */}
        <TouchableOpacity
          style={styles.medProfileButton}
          onPress={() => navigation.navigate("MedicalProfile", { userId: elderData?.elderId })}
        >
          <Ionicons name="document-text" size={20} color={COLORS.white} />
          <Text style={styles.medProfileButtonText}>{t("elder_detail_view_medical_profile")}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: SPACING.xl,
  },
  loadingText: { ...FONTS.caption, marginTop: SPACING.md },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backBtn: { padding: SPACING.xs },
  headerTitle: { ...FONTS.subtitle, fontWeight: "600" },
  scrollContent: { padding: SPACING.lg },
  profileHeader: {
    alignItems: "center",
    marginBottom: SPACING.lg,
  },
  elderAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.primary,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: SPACING.sm,
  },
  elderAvatarText: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "700",
    fontFamily: serifFont,
  },
  elderName: {
    fontSize: 24,
    fontWeight: "300",
    fontFamily: serifFont,
    color: COLORS.textPrimary,
  },
  lastActivity: {
    ...FONTS.caption,
    color: COLORS.primary,
    marginTop: SPACING.xs,
  },
  sectionCard: { marginBottom: SPACING.md },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  sectionTitle: { ...FONTS.subtitle, fontWeight: "500" },
  emptyText: {
    ...FONTS.caption,
    textAlign: "center",
    paddingVertical: SPACING.md,
  },
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
    fontFamily: serifFont,
    color: COLORS.textPrimary,
  },
  healthValueEmpty: {
    fontSize: 22,
    fontWeight: "300",
    fontFamily: serifFont,
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
  checkinRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  checkinTime: { ...FONTS.body },
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
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    gap: SPACING.md,
  },
  contactName: { ...FONTS.body, fontWeight: "500" },
  contactRel: { ...FONTS.small, color: COLORS.textLight },
  contactPhone: { ...FONTS.caption, color: COLORS.primary },
  medProfileButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: SPACING.sm,
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.md,
    marginTop: SPACING.sm,
    marginBottom: SPACING.xl,
  },
  medProfileButtonText: {
    color: COLORS.white,
    fontWeight: "600",
    fontSize: 16,
  },
});
