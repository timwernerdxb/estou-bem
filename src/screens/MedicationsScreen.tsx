import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  TextInput,
  Modal,
  Platform,
} from "react-native";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from "../constants/theme";
import { MEDICATION_CONFIG } from "../constants/theme";
import { useApp, useSubscription } from "../store/AppContext";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Medication, MedicationFrequency } from "../types";
import { notificationService } from "../services/NotificationService";
import { useI18n } from "../i18n";
import {
  fetchMedications,
  postMedication,
  putMedication,
  deleteMedication as deleteMedicationApi,
  fetchElderStatus,
} from "../services/ApiService";

const serifFont = Platform.OS === "ios" ? "Georgia" : "serif";

export function MedicationsScreen() {
  const { state, dispatch } = useApp();
  const { isFamilia } = useSubscription();
  const { t } = useI18n();

  const FREQUENCY_LABELS: Record<MedicationFrequency, string> = {
    daily: t("meds_freq_1x"),
    twice_daily: t("meds_freq_2x"),
    three_times_daily: t("meds_freq_3x"),
    weekly: t("meds_freq_weekly"),
    as_needed: t("meds_freq_asneeded"),
  };
  const isFamily = state.currentUser?.role === "family" || state.currentUser?.role === "caregiver";
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingMed, setEditingMed] = useState<Medication | null>(null);
  const [elderMedications, setElderMedications] = useState<Medication[]>([]);
  const BLANK_MED = {
    name: "",
    dosage: "",
    frequency: "daily" as MedicationFrequency,
    time: "08:00",
    stockQuantity: "30",
    stockUnit: "comprimidos",
  };

  const [newMed, setNewMed] = useState(BLANK_MED);

  // Android time picker visibility
  const [showTimePicker, setShowTimePicker] = useState(false);

  /** Parse "HH:MM" string into a Date object (today's date, local time). */
  function timeStringToDate(t: string): Date {
    const [hStr, mStr] = t.split(":");
    const d = new Date();
    d.setHours(parseInt(hStr, 10) || 8, parseInt(mStr, 10) || 0, 0, 0);
    return d;
  }

  /** Format a Date into "HH:MM". */
  function dateToTimeString(d: Date): string {
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  }

  function handleTimeChange(_event: DateTimePickerEvent, selected?: Date) {
    // On Android, hide the picker after selection
    if (Platform.OS === "android") {
      setShowTimePicker(false);
    }
    if (selected) {
      setNewMed((prev) => ({ ...prev, time: dateToTimeString(selected) }));
    }
  }

  // Fetch medications from server on mount
  useEffect(() => {
    (async () => {
      try {
        if (isFamily) {
          // Family user: fetch elder's medications via elder-status endpoint
          const data = await fetchElderStatus(state.currentUser);
          if (data?.medications) {
            const meds: Medication[] = data.medications.map((row: any) => ({
              id: String(row.id),
              elderId: String(row.user_id),
              name: row.name,
              dosage: row.dosage || "",
              frequency: (row.frequency as MedicationFrequency) || "daily",
              times: row.time ? [row.time] : ["08:00"],
              stockQuantity: row.stock ?? 30,
              stockUnit: row.unit || "comprimidos",
              lowStockThreshold: row.low_threshold ?? 5,
              autoReorderEnabled: false,
              createdAt: row.created_at || new Date().toISOString(),
            }));
            setElderMedications(meds);
          }
        } else {
          // Elder user: fetch own medications and merge with local
          const rows = await fetchMedications(state.currentUser);
          if (rows && rows.length > 0) {
            for (const row of rows) {
              const exists = state.medications.some(
                (m) => m.id === String(row.id) || m.name === row.name
              );
              if (!exists) {
                const med: Medication = {
                  id: String(row.id),
                  elderId: String(row.user_id),
                  name: row.name,
                  dosage: row.dosage || "",
                  frequency: (row.frequency as MedicationFrequency) || "daily",
                  times: row.time ? [row.time] : ["08:00"],
                  stockQuantity: row.stock ?? 30,
                  stockUnit: row.unit || "comprimidos",
                  lowStockThreshold: row.low_threshold ?? 5,
                  autoReorderEnabled: false,
                  createdAt: row.created_at || new Date().toISOString(),
                };
                dispatch({ type: "ADD_MEDICATION", payload: med });
              }
            }
          }
        }
      } catch (e) {
        console.warn("[Medications] Failed to fetch from server:", e);
      }
    })();
  }, []);

  const displayMedications = isFamily ? elderMedications : state.medications;

  const handleAddMedication = () => {
    if (!newMed.name.trim()) {
      Alert.alert("Erro", "Digite o nome do medicamento");
      return;
    }

    const medication: Medication = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 9),
      elderId: state.elderProfile?.id || state.currentUser?.id || "",
      name: newMed.name.trim(),
      dosage: newMed.dosage.trim(),
      frequency: newMed.frequency,
      times: [newMed.time],
      stockQuantity: parseInt(newMed.stockQuantity) || 0,
      stockUnit: newMed.stockUnit,
      lowStockThreshold: MEDICATION_CONFIG.defaultLowStockThreshold,
      autoReorderEnabled: false,
      createdAt: new Date().toISOString(),
    };

    dispatch({ type: "ADD_MEDICATION", payload: medication });

    // Sync to server and update local state with server-returned ID
    postMedication(state.currentUser, {
      name: medication.name,
      dosage: medication.dosage,
      frequency: medication.frequency,
      time: newMed.time,
      stock: medication.stockQuantity,
      unit: medication.stockUnit,
      low_threshold: medication.lowStockThreshold,
    }).then((serverResult) => {
      if (serverResult?.id) {
        // Replace local temp ID with server ID
        dispatch({ type: "REMOVE_MEDICATION", payload: medication.id });
        dispatch({ type: "ADD_MEDICATION", payload: { ...medication, id: String(serverResult.id) } });
      }
    }).catch(() => {});

    // Schedule notification for this medication
    notificationService.scheduleMedicationReminder(
      medication.name,
      newMed.time,
      medication.id
    );

    setShowAddModal(false);
    setNewMed(BLANK_MED);
  };

  const handleTakeMedication = (med: Medication) => {
    if (med.stockQuantity <= 0) {
      Alert.alert("Estoque vazio", `${med.name} esta sem estoque.`);
      return;
    }

    const updatedMed: Medication = {
      ...med,
      stockQuantity: med.stockQuantity - 1,
    };
    dispatch({ type: "UPDATE_MEDICATION", payload: updatedMed });

    // Sync stock update to server (fire-and-forget)
    putMedication(state.currentUser, med.id, {
      stock: updatedMed.stockQuantity,
    }).catch(() => {});

    // Log the medication
    dispatch({
      type: "ADD_MEDICATION_LOG",
      payload: {
        id: Date.now().toString(36),
        medicationId: med.id,
        elderId: med.elderId,
        scheduledAt: new Date().toISOString(),
        takenAt: new Date().toISOString(),
        skipped: false,
      },
    });

    // Check low stock
    if (updatedMed.stockQuantity <= updatedMed.lowStockThreshold) {
      notificationService.sendLowStockAlert(
        med.name,
        updatedMed.stockQuantity
      );
      Alert.alert(
        t("meds_stock_low"),
        `${med.name}: restam ${updatedMed.stockQuantity} ${med.stockUnit}`
      );
    }

    Alert.alert("Registrado", `${med.name} tomado com sucesso.`);
  };

  const handleEditMedication = (med: Medication) => {
    setEditingMed(med);
    setNewMed({
      name: med.name,
      dosage: med.dosage || "",
      frequency: med.frequency,
      time: med.times?.[0] || "08:00",
      stockQuantity: String(med.stockQuantity),
      stockUnit: med.stockUnit || "comprimidos",
    });
    setShowAddModal(true);
  };

  const handleSaveEdit = () => {
    if (!editingMed || !newMed.name.trim()) return;
    const updated: Medication = {
      ...editingMed,
      name: newMed.name.trim(),
      dosage: newMed.dosage.trim(),
      frequency: newMed.frequency,
      times: [newMed.time],
      stockQuantity: parseInt(newMed.stockQuantity) || 0,
      stockUnit: newMed.stockUnit,
    };
    dispatch({ type: "UPDATE_MEDICATION", payload: updated });
    putMedication(state.currentUser, editingMed.id, {
      name: updated.name,
      dosage: updated.dosage,
      frequency: updated.frequency,
      time: newMed.time,
      stock: updated.stockQuantity,
      unit: updated.stockUnit,
    }).catch(() => {});
    setShowAddModal(false);
    setEditingMed(null);
    setNewMed(BLANK_MED);
  };

  const handleDeleteMedication = (med: Medication) => {
    Alert.alert(
      "Remover medicamento",
      `Deseja remover ${med.name}?`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Remover",
          style: "destructive",
          onPress: () => {
            dispatch({ type: "REMOVE_MEDICATION", payload: med.id });
            deleteMedicationApi(state.currentUser, med.id).catch(() => {});
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>{t("meds_title")}</Text>

        {displayMedications.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Ionicons name="medical-outline" size={48} color={COLORS.textLight} />
            <Text style={styles.emptyText}>
              {t("meds_empty")}
            </Text>
            {!isFamily && (
              <Text style={styles.emptySubtext}>
                {t("meds_empty_desc")}
              </Text>
            )}
          </Card>
        ) : (
          displayMedications.map((med) => (
            <Card key={med.id} style={styles.medCard}>
              <View style={styles.medHeader}>
                <View style={styles.medInfo}>
                  <Text style={styles.medName}>{med.name}</Text>
                  <Text style={styles.medDosage}>{med.dosage}</Text>
                  <Text style={styles.medFreq}>
                    {FREQUENCY_LABELS[med.frequency]} -- {med.times.join(", ")}
                  </Text>
                </View>
                {!isFamily && (
                  <View style={{ flexDirection: "row", gap: 12 }}>
                    <TouchableOpacity onPress={() => handleEditMedication(med)}>
                      <Ionicons name="create-outline" size={22} color={COLORS.primary} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleDeleteMedication(med)}>
                      <Ionicons name="trash-outline" size={22} color={COLORS.danger} />
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              {/* Stock indicator */}
              <View style={styles.stockRow}>
                <Ionicons
                  name="cube-outline"
                  size={18}
                  color={
                    med.stockQuantity <= med.lowStockThreshold
                      ? COLORS.danger
                      : COLORS.textSecondary
                  }
                />
                <Text
                  style={[
                    styles.stockText,
                    med.stockQuantity <= med.lowStockThreshold && {
                      color: COLORS.danger,
                      fontWeight: "500",
                    },
                  ]}
                >
                  {t("meds_stock")}: {med.stockQuantity} {med.stockUnit}
                  {med.stockQuantity <= med.lowStockThreshold && ` - ${t("meds_stock_low")}`}
                </Text>
              </View>

              {!isFamily && (
                <TouchableOpacity
                  style={styles.takeButton}
                  onPress={() => handleTakeMedication(med)}
                >
                  <Ionicons name="checkmark-circle" size={24} color={COLORS.white} />
                  <Text style={styles.takeButtonText}>{t("meds_took")}</Text>
                </TouchableOpacity>
              )}
            </Card>
          ))
        )}

        {!isFamily && (
          <Button
            title={t("meds_add")}
            onPress={() => { setEditingMed(null); setNewMed(BLANK_MED); setShowAddModal(true); }}
            size="large"
            style={{ marginTop: SPACING.md, width: "100%" }}
          />
        )}
      </ScrollView>

      {/* Add Medication Modal */}
      <Modal visible={showAddModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{editingMed ? "Editar Medicamento" : t("meds_new")}</Text>
            <TouchableOpacity onPress={() => { setShowAddModal(false); setEditingMed(null); setNewMed(BLANK_MED); }}>
              <Ionicons name="close" size={28} color={COLORS.textPrimary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.modalContent}>
            <Text style={styles.inputLabel}>{t("meds_name")} *</Text>
            <TextInput
              style={styles.input}
              placeholder="Ex: Losartana"
              value={newMed.name}
              onChangeText={(v) => setNewMed({ ...newMed, name: v })}
              placeholderTextColor={COLORS.textLight}
            />

            <Text style={styles.inputLabel}>{t("meds_dosage")}</Text>
            <TextInput
              style={styles.input}
              placeholder="Ex: 50mg"
              value={newMed.dosage}
              onChangeText={(v) => setNewMed({ ...newMed, dosage: v })}
              placeholderTextColor={COLORS.textLight}
            />

            <Text style={styles.inputLabel}>{t("meds_frequency")}</Text>
            <View style={styles.freqRow}>
              {(Object.keys(FREQUENCY_LABELS) as MedicationFrequency[]).map(
                (freq) => (
                  <TouchableOpacity
                    key={freq}
                    style={[
                      styles.freqChip,
                      newMed.frequency === freq && styles.freqChipActive,
                    ]}
                    onPress={() => setNewMed({ ...newMed, frequency: freq })}
                  >
                    <Text
                      style={[
                        styles.freqChipText,
                        newMed.frequency === freq && styles.freqChipTextActive,
                      ]}
                    >
                      {FREQUENCY_LABELS[freq]}
                    </Text>
                  </TouchableOpacity>
                )
              )}
            </View>

            <Text style={styles.inputLabel}>{t("meds_time")}</Text>
            {Platform.OS === "ios" ? (
              <DateTimePicker
                value={timeStringToDate(newMed.time)}
                mode="time"
                display="spinner"
                onChange={handleTimeChange}
                style={styles.timePicker}
              />
            ) : (
              <>
                <TouchableOpacity
                  style={styles.input}
                  onPress={() => setShowTimePicker(true)}
                >
                  <Text style={{ fontSize: 18, color: COLORS.textPrimary }}>{newMed.time}</Text>
                </TouchableOpacity>
                {showTimePicker && (
                  <DateTimePicker
                    value={timeStringToDate(newMed.time)}
                    mode="time"
                    display="clock"
                    onChange={handleTimeChange}
                  />
                )}
              </>
            )}

            <Text style={styles.inputLabel}>{t("meds_stock")}</Text>
            <View style={styles.stockInputRow}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="30"
                value={newMed.stockQuantity}
                onChangeText={(v) => setNewMed({ ...newMed, stockQuantity: v })}
                placeholderTextColor={COLORS.textLight}
                keyboardType="numeric"
              />
              <TextInput
                style={[styles.input, { flex: 1, marginLeft: SPACING.sm }]}
                placeholder="comprimidos"
                value={newMed.stockUnit}
                onChangeText={(v) => setNewMed({ ...newMed, stockUnit: v })}
                placeholderTextColor={COLORS.textLight}
              />
            </View>

            <Button
              title={t("meds_save")}
              onPress={editingMed ? handleSaveEdit : handleAddMedication}
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
  scrollContent: { padding: SPACING.lg },
  title: {
    ...FONTS.title,
    fontSize: 28,
    marginBottom: SPACING.lg,
  },
  emptyCard: { alignItems: "center", paddingVertical: SPACING.xxl },
  emptyText: { ...FONTS.subtitle, color: COLORS.textSecondary, marginTop: SPACING.md },
  emptySubtext: { ...FONTS.caption, marginTop: SPACING.xs, textAlign: "center" },
  medCard: { marginBottom: SPACING.md },
  medHeader: { flexDirection: "row", justifyContent: "space-between" },
  medInfo: { flex: 1 },
  medName: { ...FONTS.subtitle, fontWeight: "500" },
  medDosage: { ...FONTS.body, color: COLORS.textSecondary },
  medFreq: { ...FONTS.caption, marginTop: SPACING.xs },
  stockRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.xs,
    marginTop: SPACING.sm,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  stockText: { ...FONTS.caption },
  takeButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.sm,
    marginTop: SPACING.sm,
    gap: SPACING.xs,
  },
  takeButtonText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
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
  inputLabel: { ...FONTS.body, fontWeight: "500", marginTop: SPACING.md, marginBottom: SPACING.xs },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    fontSize: 18,
    backgroundColor: COLORS.white,
    color: COLORS.textPrimary,
  },
  freqRow: { flexDirection: "row", flexWrap: "wrap", gap: SPACING.xs },
  freqChip: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.white,
  },
  freqChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  freqChipText: { ...FONTS.caption },
  freqChipTextActive: { color: COLORS.white, fontWeight: "500" },
  stockInputRow: { flexDirection: "row" },
  timePicker: {
    alignSelf: "flex-start",
    marginTop: SPACING.xs,
  },
});
