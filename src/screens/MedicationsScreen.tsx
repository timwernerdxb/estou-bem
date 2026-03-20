import React, { useState } from "react";
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
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from "../constants/theme";
import { MEDICATION_CONFIG } from "../constants/theme";
import { useApp, useSubscription } from "../store/AppContext";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { Medication, MedicationFrequency } from "../types";
import { notificationService } from "../services/NotificationService";

const serifFont = Platform.OS === "ios" ? "Georgia" : "serif";

const FREQUENCY_LABELS: Record<MedicationFrequency, string> = {
  daily: "1x ao dia",
  twice_daily: "2x ao dia",
  three_times_daily: "3x ao dia",
  weekly: "Semanal",
  as_needed: "Quando necessario",
};

export function MedicationsScreen() {
  const { state, dispatch } = useApp();
  const { isFamilia } = useSubscription();
  const [showAddModal, setShowAddModal] = useState(false);
  const [newMed, setNewMed] = useState({
    name: "",
    dosage: "",
    frequency: "daily" as MedicationFrequency,
    time: "08:00",
    stockQuantity: "30",
    stockUnit: "comprimidos",
  });

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

    // Schedule notification for this medication
    notificationService.scheduleMedicationReminder(
      medication.name,
      newMed.time,
      medication.id
    );

    setShowAddModal(false);
    setNewMed({
      name: "",
      dosage: "",
      frequency: "daily",
      time: "08:00",
      stockQuantity: "30",
      stockUnit: "comprimidos",
    });
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
        "Estoque baixo",
        `${med.name}: restam ${updatedMed.stockQuantity} ${med.stockUnit}`
      );
    }

    Alert.alert("Registrado", `${med.name} tomado com sucesso.`);
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
          onPress: () => dispatch({ type: "REMOVE_MEDICATION", payload: med.id }),
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>Medicamentos</Text>

        {state.medications.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Ionicons name="medical-outline" size={48} color={COLORS.textLight} />
            <Text style={styles.emptyText}>
              Nenhum medicamento cadastrado
            </Text>
            <Text style={styles.emptySubtext}>
              Adicione seus medicamentos para receber lembretes
            </Text>
          </Card>
        ) : (
          state.medications.map((med) => (
            <Card key={med.id} style={styles.medCard}>
              <View style={styles.medHeader}>
                <View style={styles.medInfo}>
                  <Text style={styles.medName}>{med.name}</Text>
                  <Text style={styles.medDosage}>{med.dosage}</Text>
                  <Text style={styles.medFreq}>
                    {FREQUENCY_LABELS[med.frequency]} -- {med.times.join(", ")}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => handleDeleteMedication(med)}>
                  <Ionicons name="trash-outline" size={22} color={COLORS.danger} />
                </TouchableOpacity>
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
                  Estoque: {med.stockQuantity} {med.stockUnit}
                  {med.stockQuantity <= med.lowStockThreshold && " - Baixo"}
                </Text>
              </View>

              <TouchableOpacity
                style={styles.takeButton}
                onPress={() => handleTakeMedication(med)}
              >
                <Ionicons name="checkmark-circle" size={24} color={COLORS.white} />
                <Text style={styles.takeButtonText}>TOMEI</Text>
              </TouchableOpacity>
            </Card>
          ))
        )}

        <Button
          title="Adicionar Medicamento"
          onPress={() => setShowAddModal(true)}
          size="large"
          style={{ marginTop: SPACING.md, width: "100%" }}
        />
      </ScrollView>

      {/* Add Medication Modal */}
      <Modal visible={showAddModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Novo Medicamento</Text>
            <TouchableOpacity onPress={() => setShowAddModal(false)}>
              <Ionicons name="close" size={28} color={COLORS.textPrimary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.modalContent}>
            <Text style={styles.inputLabel}>Nome do medicamento *</Text>
            <TextInput
              style={styles.input}
              placeholder="Ex: Losartana"
              value={newMed.name}
              onChangeText={(t) => setNewMed({ ...newMed, name: t })}
              placeholderTextColor={COLORS.textLight}
            />

            <Text style={styles.inputLabel}>Dosagem</Text>
            <TextInput
              style={styles.input}
              placeholder="Ex: 50mg"
              value={newMed.dosage}
              onChangeText={(t) => setNewMed({ ...newMed, dosage: t })}
              placeholderTextColor={COLORS.textLight}
            />

            <Text style={styles.inputLabel}>Frequencia</Text>
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

            <Text style={styles.inputLabel}>Horario</Text>
            <TextInput
              style={styles.input}
              placeholder="08:00"
              value={newMed.time}
              onChangeText={(t) => setNewMed({ ...newMed, time: t })}
              placeholderTextColor={COLORS.textLight}
              keyboardType="numbers-and-punctuation"
            />

            <Text style={styles.inputLabel}>Quantidade em estoque</Text>
            <View style={styles.stockInputRow}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="30"
                value={newMed.stockQuantity}
                onChangeText={(t) => setNewMed({ ...newMed, stockQuantity: t })}
                placeholderTextColor={COLORS.textLight}
                keyboardType="numeric"
              />
              <TextInput
                style={[styles.input, { flex: 1, marginLeft: SPACING.sm }]}
                placeholder="comprimidos"
                value={newMed.stockUnit}
                onChangeText={(t) => setNewMed({ ...newMed, stockUnit: t })}
                placeholderTextColor={COLORS.textLight}
              />
            </View>

            <Button
              title="Salvar Medicamento"
              onPress={handleAddMedication}
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
});
