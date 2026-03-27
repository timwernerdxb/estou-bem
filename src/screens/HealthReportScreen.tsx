import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { COLORS, FONTS, SPACING, RADIUS } from "../constants/theme";
import { useApp } from "../store/AppContext";
import { Card } from "../components/Card";
import { Button } from "../components/Button";

const serifFont = Platform.OS === "ios" ? "Georgia" : "serif";

interface HealthSummary {
  patient: string;
  month: string;
  generated: string;
  checkins: {
    total: number;
    confirmed: number;
    missed: number;
    rate: string;
  };
  health: Record<
    string,
    {
      count: number;
      avg: string | null;
      min: number | null;
      max: number | null;
      unit: string;
      entries: Array<{ value: number; unit: string; date: string; time: string }>;
    }
  >;
  medications: Array<{ name: string; dosage: string; frequency: string }>;
}

interface ReportData {
  summary: HealthSummary | string;
}

const METRIC_LABELS: Record<string, { label: string; icon: string }> = {
  heart_rate: { label: "Frequencia cardiaca", icon: "pulse" },
  blood_pressure_systolic: { label: "Pressao (sistolica)", icon: "heart" },
  blood_pressure_diastolic: { label: "Pressao (diastolica)", icon: "heart" },
  blood_glucose: { label: "Glicemia", icon: "water" },
  weight: { label: "Peso", icon: "scale" },
  temperature: { label: "Temperatura", icon: "thermometer" },
  oxygen_saturation: { label: "Saturacao O2", icon: "fitness" },
};

export function HealthReportScreen() {
  const navigation = useNavigation();
  const { state } = useApp();
  const isFamily = state.currentUser?.role === "family" || state.currentUser?.role === "caregiver";
  const [report, setReport] = useState<HealthSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });

  useEffect(() => {
    fetchReport();
  }, [selectedMonth]);

  const fetchReport = async () => {
    setLoading(true);
    setError(null);
    try {
      const API_URL = state.currentUser?.apiUrl || process.env.EXPO_PUBLIC_API_URL || "";
      const token = state.currentUser?.token;
      if (!API_URL || !token) {
        setError("Nao conectado ao servidor.");
        setLoading(false);
        return;
      }
      // Family users fetch the elder's report; elders fetch their own
      const endpoint = isFamily
        ? `${API_URL}/api/health-report/elder/${selectedMonth}`
        : `${API_URL}/api/health-report/${selectedMonth}`;
      const res = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 403) {
        setError("Recurso disponivel apenas no plano Pro.");
        setLoading(false);
        return;
      }
      if (!res.ok) {
        setError("Erro ao carregar relatorio.");
        setLoading(false);
        return;
      }
      const json: ReportData = await res.json();
      const summary = typeof json.summary === "string" ? JSON.parse(json.summary) : json.summary;
      setReport(summary);
    } catch {
      setError("Erro ao conectar ao servidor.");
    } finally {
      setLoading(false);
    }
  };

  const changeMonth = (direction: -1 | 1) => {
    const [year, month] = selectedMonth.split("-").map(Number);
    const d = new Date(year, month - 1 + direction, 1);
    setSelectedMonth(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    );
  };

  const formatMonth = (m: string) => {
    const [year, month] = m.split("-").map(Number);
    const d = new Date(year, month - 1, 1);
    return d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Relatorio de Saude</Text>
        <View style={{ width: 32 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Relatorio de Saude</Text>

        {/* Month Selector */}
        <Card style={styles.monthSelector}>
          <TouchableOpacity onPress={() => changeMonth(-1)} style={styles.monthArrow}>
            <Ionicons name="chevron-back" size={24} color={COLORS.primary} />
          </TouchableOpacity>
          <Text style={styles.monthText}>{formatMonth(selectedMonth)}</Text>
          <TouchableOpacity onPress={() => changeMonth(1)} style={styles.monthArrow}>
            <Ionicons name="chevron-forward" size={24} color={COLORS.primary} />
          </TouchableOpacity>
        </Card>

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={COLORS.primary} />
          </View>
        ) : error ? (
          <Card style={styles.section}>
            <View style={styles.errorContainer}>
              <Ionicons name="alert-circle" size={32} color={COLORS.warning} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          </Card>
        ) : report ? (
          <>
            {/* Check-in Compliance */}
            <Card style={styles.section}>
              <Text style={styles.sectionTitle}>Check-ins</Text>
              <View style={styles.complianceRow}>
                <View style={styles.complianceStat}>
                  <Text style={styles.complianceValue}>{report.checkins.rate}</Text>
                  <Text style={styles.complianceLabel}>Taxa de resposta</Text>
                </View>
                <View style={styles.complianceStat}>
                  <Text style={styles.complianceValue}>{report.checkins.confirmed}</Text>
                  <Text style={styles.complianceLabel}>Confirmados</Text>
                </View>
                <View style={styles.complianceStat}>
                  <Text style={[styles.complianceValue, report.checkins.missed > 0 && { color: COLORS.danger }]}>
                    {report.checkins.missed}
                  </Text>
                  <Text style={styles.complianceLabel}>Perdidos</Text>
                </View>
              </View>
              <View style={styles.complianceBar}>
                <View
                  style={[
                    styles.complianceBarFill,
                    {
                      width: report.checkins.total
                        ? `${(report.checkins.confirmed / report.checkins.total) * 100}%`
                        : "0%",
                    },
                  ]}
                />
              </View>
            </Card>

            {/* Health Metrics */}
            {Object.keys(report.health).length > 0 && (
              <Card style={styles.section}>
                <Text style={styles.sectionTitle}>Indicadores de Saude</Text>
                {Object.entries(report.health).map(([type, metric]) => {
                  const meta = METRIC_LABELS[type] || { label: type, icon: "analytics" };
                  return (
                    <View key={type} style={styles.metricRow}>
                      <Ionicons name={meta.icon as any} size={22} color={COLORS.primary} />
                      <View style={{ flex: 1, marginLeft: SPACING.sm }}>
                        <Text style={styles.metricLabel}>{meta.label}</Text>
                        <View style={styles.metricValues}>
                          <Text style={styles.metricAvg}>
                            Media: {metric.avg || "N/A"} {metric.unit}
                          </Text>
                          {metric.min != null && metric.max != null && (
                            <Text style={styles.metricRange}>
                              {metric.min} - {metric.max} {metric.unit}
                            </Text>
                          )}
                        </View>
                      </View>
                      <Text style={styles.metricCount}>{metric.count}x</Text>
                    </View>
                  );
                })}
              </Card>
            )}

            {/* Medications */}
            {report.medications && report.medications.length > 0 && (
              <Card style={styles.section}>
                <Text style={styles.sectionTitle}>Medicamentos</Text>
                {report.medications.map((med, i) => (
                  <View key={i} style={styles.medRow}>
                    <Ionicons name="medical" size={20} color={COLORS.primary} />
                    <View style={{ flex: 1, marginLeft: SPACING.sm }}>
                      <Text style={styles.medName}>{med.name}</Text>
                      <Text style={styles.medDosage}>
                        {med.dosage} - {med.frequency}
                      </Text>
                    </View>
                  </View>
                ))}
              </Card>
            )}

            {/* No Data */}
            {Object.keys(report.health).length === 0 && (
              <Card style={styles.section}>
                <View style={styles.emptyContainer}>
                  <Ionicons name="analytics-outline" size={40} color={COLORS.textLight} />
                  <Text style={styles.emptyText}>
                    Nenhum dado de saude registrado neste mes.
                  </Text>
                  <Text style={styles.emptySubtext}>
                    Registre seus dados no Diario de Saude para gerar relatorios.
                  </Text>
                </View>
              </Card>
            )}
          </>
        ) : null}

        <Button
          title="Voltar"
          onPress={() => navigation.goBack()}
          variant="outline"
          size="large"
          style={{ marginTop: SPACING.lg, width: "100%" }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  backBtn: { padding: SPACING.xs },
  headerTitle: { ...FONTS.subtitle, fontWeight: "600" },
  content: { padding: SPACING.lg },
  loadingContainer: { paddingVertical: SPACING.xxl, alignItems: "center" },
  title: {
    ...FONTS.title,
    fontSize: 28,
    marginBottom: SPACING.lg,
  },
  monthSelector: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: SPACING.md,
  },
  monthArrow: { padding: SPACING.sm },
  monthText: {
    fontFamily: serifFont,
    fontSize: 18,
    fontWeight: "300",
    color: COLORS.textPrimary,
    textTransform: "capitalize",
  },
  section: { marginBottom: SPACING.md },
  sectionTitle: { ...FONTS.subtitle, fontWeight: "500", marginBottom: SPACING.sm },
  errorContainer: { alignItems: "center", paddingVertical: SPACING.lg },
  errorText: { ...FONTS.body, color: COLORS.textSecondary, marginTop: SPACING.sm, textAlign: "center" },
  complianceRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginBottom: SPACING.md,
  },
  complianceStat: { alignItems: "center" },
  complianceValue: {
    fontFamily: serifFont,
    fontSize: 28,
    fontWeight: "300",
    color: COLORS.primary,
  },
  complianceLabel: { ...FONTS.small, marginTop: SPACING.xs },
  complianceBar: {
    height: 6,
    backgroundColor: COLORS.border,
    borderRadius: 3,
    overflow: "hidden",
  },
  complianceBarFill: {
    height: "100%",
    backgroundColor: COLORS.primary,
    borderRadius: 3,
  },
  metricRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  metricLabel: { ...FONTS.body, fontWeight: "500" },
  metricValues: {
    flexDirection: "row",
    gap: SPACING.md,
    marginTop: 2,
  },
  metricAvg: { ...FONTS.caption },
  metricRange: { ...FONTS.small },
  metricCount: { ...FONTS.caption, color: COLORS.textLight },
  medRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  medName: { ...FONTS.body, fontWeight: "500" },
  medDosage: { ...FONTS.caption, marginTop: 2 },
  emptyContainer: { alignItems: "center", paddingVertical: SPACING.lg },
  emptyText: { ...FONTS.body, color: COLORS.textSecondary, marginTop: SPACING.sm, textAlign: "center" },
  emptySubtext: { ...FONTS.caption, marginTop: SPACING.xs, textAlign: "center" },
});
