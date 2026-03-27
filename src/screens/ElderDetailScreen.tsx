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

  const elderName = elderData?.elderName || state.elderProfile?.name || "Idoso";

  // Last activity text
  const lastActivityText = React.useMemo(() => {
    if (!elderData?.lastActivity) return null;
    const d = new Date(elderData.lastActivity);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "Agora mesmo";
    if (diffMin < 60) return `Ha ${diffMin} min`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `Ha ${diffHours}h`;
    const diffDays = Math.floor(diffHours / 24);
    return `Ha ${diffDays} dia${diffDays > 1 ? "s" : ""}`;
  }, [elderData?.lastActivity]);

  // Health data
  const healthEntries = elderData?.health || [];
  const latestHeartRate = healthEntries.find((h) => h.type === "heart_rate");
  const latestSteps = healthEntries.find((h) => h.type === "steps");
  const latestSpO2 = healthEntries.find((h) => h.type === "oxygen_saturation");

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
          <Text style={styles.loadingText}>Carregando dados...</Text>
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
        <Text style={styles.headerTitle}>Detalhes</Text>
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
              Ultima atividade: {lastActivityText}
            </Text>
          )}
        </View>

        {/* Saude Section */}
        <Card style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Ionicons name="heart" size={20} color={COLORS.danger} />
            <Text style={styles.sectionTitle}>Saude</Text>
          </View>
          {latestHeartRate || latestSteps || latestSpO2 ? (
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
              {latestSpO2 && (
                <View style={styles.healthItem}>
                  <Ionicons name="water" size={20} color={COLORS.accent} />
                  <Text style={styles.healthValue}>
                    {Math.round(latestSpO2.value)}%
                  </Text>
                  <Text style={styles.healthUnit}>SpO2</Text>
                </View>
              )}
            </View>
          ) : (
            <Text style={styles.emptyText}>Aguardando dados de saude</Text>
          )}
        </Card>

        {/* Check-ins hoje */}
        <Card style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Ionicons name="checkmark-circle" size={20} color={COLORS.primary} />
            <Text style={styles.sectionTitle}>Check-ins hoje</Text>
          </View>
          {todayCheckins.length === 0 ? (
            <Text style={styles.emptyText}>Nenhum check-in hoje ainda</Text>
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
            <Text style={styles.sectionTitle}>Medicamentos</Text>
          </View>
          {medications.length === 0 ? (
            <Text style={styles.emptyText}>Nenhum medicamento cadastrado</Text>
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
            <Text style={styles.sectionTitle}>Contatos de emergencia</Text>
          </View>
          {elderContacts.length === 0 ? (
            <Text style={styles.emptyText}>Nenhum contato cadastrado</Text>
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
          <Text style={styles.medProfileButtonText}>Ver Perfil Medico Completo</Text>
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
  healthGrid: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingTop: SPACING.sm,
  },
  healthItem: { alignItems: "center", gap: 4 },
  healthValue: {
    fontSize: 22,
    fontWeight: "300",
    fontFamily: serifFont,
    color: COLORS.textPrimary,
  },
  healthUnit: { ...FONTS.small, color: COLORS.textLight },
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
