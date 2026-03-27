import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { COLORS, FONTS, SPACING, RADIUS } from "../constants/theme";
import { useApp } from "../store/AppContext";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { HealthEntry, HealthMetricType } from "../types";
import { postHealth, fetchHealth, fetchElderStatus } from "../services/ApiService";

const METRIC_CONFIG: Record<
  HealthMetricType,
  { label: string; unit: string; icon: string }
> = {
  blood_pressure_systolic: { label: "Pressão (sistólica)", unit: "mmHg", icon: "heart" },
  blood_pressure_diastolic: { label: "Pressão (diastólica)", unit: "mmHg", icon: "heart" },
  heart_rate: { label: "Frequência cardíaca", unit: "bpm", icon: "pulse" },
  blood_glucose: { label: "Glicemia", unit: "mg/dL", icon: "water" },
  weight: { label: "Peso", unit: "kg", icon: "scale" },
  temperature: { label: "Temperatura", unit: "°C", icon: "thermometer" },
  oxygen_saturation: { label: "Saturação O₂", unit: "%", icon: "cloud" },
};

export function HealthLogScreen() {
  const navigation = useNavigation();
  const { state, dispatch } = useApp();
  const isFamily = state.currentUser?.role === "family" || state.currentUser?.role === "caregiver";
  const [showAdd, setShowAdd] = useState(false);
  const [selectedType, setSelectedType] = useState<HealthMetricType>("blood_pressure_systolic");
  const [value, setValue] = useState("");
  const [notes, setNotes] = useState("");
  const [elderHealthEntries, setElderHealthEntries] = useState<HealthEntry[]>([]);

  // Fetch health entries from server on mount
  useEffect(() => {
    (async () => {
      try {
        if (isFamily) {
          // Family user: fetch elder's health entries via elder-status endpoint
          const data = await fetchElderStatus(state.currentUser);
          if (data?.health) {
            const entries: HealthEntry[] = data.health.map((row: any) => ({
              id: String(row.id),
              elderId: String(row.user_id),
              timestamp: row.created_at || new Date().toISOString(),
              type: row.type as HealthMetricType,
              value: row.value,
              unit: row.unit || "",
              notes: row.notes || undefined,
            }));
            setElderHealthEntries(entries);
          }
        } else {
          // Elder user: fetch own health entries and merge with local state
          const rows = await fetchHealth(state.currentUser, 200);
          if (rows && rows.length > 0) {
            for (const row of rows) {
              const exists = state.healthEntries.some((e) => e.id === String(row.id));
              if (!exists) {
                const entry: HealthEntry = {
                  id: String(row.id),
                  elderId: String(row.user_id),
                  timestamp: row.created_at || new Date().toISOString(),
                  type: row.type as HealthMetricType,
                  value: row.value,
                  unit: row.unit || "",
                  notes: row.notes || undefined,
                };
                dispatch({ type: "ADD_HEALTH_ENTRY", payload: entry });
              }
            }
          }
        }
      } catch (e) {
        console.warn("[HealthLog] Failed to fetch health entries:", e);
      }
    })();
  }, []);

  const displayHealthEntries = isFamily ? elderHealthEntries : state.healthEntries;

  const handleAdd = () => {
    const numValue = parseFloat(value);
    if (isNaN(numValue)) {
      Alert.alert("Erro", "Digite um valor numérico válido");
      return;
    }

    const entry: HealthEntry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 9),
      elderId: state.elderProfile?.id || state.currentUser?.id || "",
      timestamp: new Date().toISOString(),
      type: selectedType,
      value: numValue,
      unit: METRIC_CONFIG[selectedType].unit,
      notes: notes.trim() || undefined,
    };

    dispatch({ type: "ADD_HEALTH_ENTRY", payload: entry });

    // Sync to server (fire-and-forget)
    const ts = new Date(entry.timestamp);
    postHealth(state.currentUser, {
      type: entry.type,
      value: entry.value,
      unit: entry.unit,
      time: ts.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", hour12: false }),
      date: ts.toISOString().slice(0, 10),
      notes: entry.notes,
    }).catch(() => {});

    setShowAdd(false);
    setValue("");
    setNotes("");
  };

  // Group entries by date
  const groupedEntries: Record<string, HealthEntry[]> = {};
  for (const entry of displayHealthEntries) {
    const dateKey = new Date(entry.timestamp).toLocaleDateString("pt-BR");
    if (!groupedEntries[dateKey]) groupedEntries[dateKey] = [];
    groupedEntries[dateKey].push(entry);
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Diario de Saude</Text>
        <View style={{ width: 32 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Diario de Saude</Text>

        {Object.keys(groupedEntries).length === 0 ? (
          <Card style={styles.emptyCard}>
            <Ionicons name="analytics-outline" size={48} color={COLORS.textLight} />
            <Text style={styles.emptyText}>Nenhum registro de saúde</Text>
            <Text style={styles.emptySubtext}>
              Registre pressão, glicemia, peso e mais
            </Text>
          </Card>
        ) : (
          Object.entries(groupedEntries).map(([date, entries]) => (
            <View key={date} style={styles.dateGroup}>
              <Text style={styles.dateLabel}>{date}</Text>
              {entries.map((entry) => {
                const config = METRIC_CONFIG[entry.type];
                return (
                  <Card key={entry.id} style={styles.entryCard}>
                    <View style={styles.entryRow}>
                      <Ionicons
                        name={config.icon as any}
                        size={20}
                        color={COLORS.primary}
                      />
                      <View style={styles.entryInfo}>
                        <Text style={styles.entryLabel}>{config.label}</Text>
                        <Text style={styles.entryTime}>
                          {new Date(entry.timestamp).toLocaleTimeString(
                            "pt-BR",
                            { hour: "2-digit", minute: "2-digit" }
                          )}
                        </Text>
                      </View>
                      <Text style={styles.entryValue}>
                        {entry.value} {entry.unit}
                      </Text>
                    </View>
                    {entry.notes && (
                      <Text style={styles.entryNotes}>{entry.notes}</Text>
                    )}
                  </Card>
                );
              })}
            </View>
          ))
        )}

        {!isFamily && (
          <Button
            title="+ Registrar Medição"
            onPress={() => setShowAdd(true)}
            size="large"
            style={{ marginTop: SPACING.md, width: "100%" }}
          />
        )}
      </ScrollView>

      <Modal visible={showAdd} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Nova Medição</Text>
            <TouchableOpacity onPress={() => setShowAdd(false)}>
              <Ionicons name="close" size={28} color={COLORS.textPrimary} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalContent}>
            <Text style={styles.inputLabel}>Tipo de medição</Text>
            <View style={styles.typeGrid}>
              {(Object.keys(METRIC_CONFIG) as HealthMetricType[]).map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[
                    styles.typeChip,
                    selectedType === type && styles.typeChipActive,
                  ]}
                  onPress={() => setSelectedType(type)}
                >
                  <Ionicons
                    name={METRIC_CONFIG[type].icon as any}
                    size={16}
                    color={selectedType === type ? COLORS.white : COLORS.textSecondary}
                  />
                  <Text
                    style={[
                      styles.typeChipText,
                      selectedType === type && styles.typeChipTextActive,
                    ]}
                  >
                    {METRIC_CONFIG[type].label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.inputLabel}>
              Valor ({METRIC_CONFIG[selectedType].unit})
            </Text>
            <TextInput
              style={styles.input}
              placeholder={`Ex: 120`}
              value={value}
              onChangeText={setValue}
              keyboardType="decimal-pad"
              placeholderTextColor={COLORS.textLight}
            />

            <Text style={styles.inputLabel}>Observações (opcional)</Text>
            <TextInput
              style={[styles.input, { height: 80 }]}
              placeholder="Alguma observação?"
              value={notes}
              onChangeText={setNotes}
              multiline
              placeholderTextColor={COLORS.textLight}
            />

            <Button
              title="Salvar"
              onPress={handleAdd}
              size="large"
              style={{ marginTop: SPACING.lg, width: "100%" }}
            />
          </ScrollView>
        </SafeAreaView>
      </Modal>
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
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backBtn: { padding: SPACING.xs },
  headerTitle: { ...FONTS.subtitle, fontWeight: "600" },
  content: { padding: SPACING.lg },
  title: { ...FONTS.title, marginBottom: SPACING.lg },
  emptyCard: { alignItems: "center", paddingVertical: SPACING.xxl },
  emptyText: { ...FONTS.subtitle, color: COLORS.textSecondary, marginTop: SPACING.md },
  emptySubtext: { ...FONTS.caption, marginTop: SPACING.xs },
  dateGroup: { marginBottom: SPACING.md },
  dateLabel: { ...FONTS.subtitle, marginBottom: SPACING.sm },
  entryCard: { marginBottom: SPACING.xs },
  entryRow: { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  entryInfo: { flex: 1 },
  entryLabel: { ...FONTS.body, fontWeight: "600" },
  entryTime: { ...FONTS.small },
  entryValue: { ...FONTS.subtitle, color: COLORS.primary },
  entryNotes: { ...FONTS.caption, marginTop: SPACING.xs, fontStyle: "italic" },
  modalContainer: { flex: 1, backgroundColor: COLORS.background },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modalTitle: { ...FONTS.title },
  modalContent: { padding: SPACING.lg },
  inputLabel: { ...FONTS.body, fontWeight: "600", marginTop: SPACING.md, marginBottom: SPACING.xs },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    fontSize: 18,
    backgroundColor: COLORS.white,
    color: COLORS.textPrimary,
  },
  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: SPACING.xs },
  typeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.white,
  },
  typeChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  typeChipText: { ...FONTS.small },
  typeChipTextActive: { color: COLORS.white, fontWeight: "600" },
});
