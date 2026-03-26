import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  TouchableOpacity,
  Share,
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

interface MedicalProfile {
  user_id: number;
  full_name?: string;
  date_of_birth?: string;
  blood_type?: string;
  allergies?: string;
  chronic_conditions?: string;
  current_medications?: string;
  emergency_notes?: string;
  cpf?: string;
  health_plan?: string;
  health_plan_number?: string;
  primary_doctor?: string;
  doctor_phone?: string;
  address?: string;
}

interface EmergencyCard {
  name: string;
  age: number | null;
  date_of_birth: string | null;
  phone: string | null;
  blood_type: string | null;
  allergies: string | null;
  chronic_conditions: string | null;
  current_medications: string | null;
  emergency_notes: string | null;
  cpf: string | null;
  health_plan: string | null;
  health_plan_number: string | null;
  primary_doctor: string | null;
  doctor_phone: string | null;
  address: string | null;
  emergency_contacts: Array<{ name: string; phone: string; relationship: string }>;
}

const BLOOD_TYPES = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

export function MedicalProfileScreen() {
  const navigation = useNavigation();
  const { state } = useApp();
  const [profile, setProfile] = useState<MedicalProfile>({} as MedicalProfile);
  const [emergencyCard, setEmergencyCard] = useState<EmergencyCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showEmergencyCard, setShowEmergencyCard] = useState(false);

  const userId = state.currentUser?.id;

  useEffect(() => {
    fetchProfile();
  }, []);

  const getApiHeaders = () => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${state.currentUser?.token}`,
  });

  const getApiUrl = () =>
    state.currentUser?.apiUrl || process.env.EXPO_PUBLIC_API_URL || "";

  const fetchProfile = async () => {
    try {
      const API_URL = getApiUrl();
      const token = state.currentUser?.token;
      if (!API_URL || !token || !userId) {
        setLoading(false);
        return;
      }
      const res = await fetch(`${API_URL}/api/medical-profile/${userId}`, {
        headers: getApiHeaders(),
      });
      const json = await res.json();
      setProfile(json);
    } catch {
      // Profile may not exist yet
    } finally {
      setLoading(false);
    }
  };

  const fetchEmergencyCard = async () => {
    try {
      const API_URL = getApiUrl();
      const res = await fetch(`${API_URL}/api/medical-profile/${userId}/emergency-card`, {
        headers: getApiHeaders(),
      });
      const json = await res.json();
      setEmergencyCard(json);
      setShowEmergencyCard(true);
    } catch {
      Alert.alert("Erro", "Nao foi possivel carregar o cartao de emergencia.");
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const API_URL = getApiUrl();
      const res = await fetch(`${API_URL}/api/medical-profile/${userId}`, {
        method: "PUT",
        headers: getApiHeaders(),
        body: JSON.stringify(profile),
      });
      if (res.ok) {
        const json = await res.json();
        setProfile(json);
        setEditing(false);
        Alert.alert("Salvo", "Perfil medico atualizado com sucesso.");
      } else {
        Alert.alert("Erro", "Nao foi possivel salvar o perfil.");
      }
    } catch {
      Alert.alert("Erro", "Erro ao conectar ao servidor.");
    } finally {
      setSaving(false);
    }
  };

  const handleShareEmergencyCard = () => {
    if (!emergencyCard) return;
    const lines = [
      `CARTAO DE EMERGENCIA`,
      `Nome: ${emergencyCard.name}`,
      emergencyCard.age ? `Idade: ${emergencyCard.age} anos` : null,
      emergencyCard.blood_type ? `Tipo sanguineo: ${emergencyCard.blood_type}` : null,
      emergencyCard.phone ? `Telefone: ${emergencyCard.phone}` : null,
      emergencyCard.allergies ? `Alergias: ${emergencyCard.allergies}` : null,
      emergencyCard.chronic_conditions ? `Condicoes: ${emergencyCard.chronic_conditions}` : null,
      emergencyCard.current_medications ? `Medicamentos: ${emergencyCard.current_medications}` : null,
      emergencyCard.health_plan ? `Plano de saude: ${emergencyCard.health_plan} (${emergencyCard.health_plan_number || ""})` : null,
      emergencyCard.primary_doctor ? `Medico: ${emergencyCard.primary_doctor} (${emergencyCard.doctor_phone || ""})` : null,
      emergencyCard.emergency_notes ? `Notas: ${emergencyCard.emergency_notes}` : null,
      ``,
      `Contatos de emergencia:`,
      ...emergencyCard.emergency_contacts.map(
        (c) => `  ${c.name} (${c.relationship}): ${c.phone}`
      ),
    ];
    Share.share({ message: lines.filter(Boolean).join("\n") });
  };

  const updateField = (field: keyof MedicalProfile, value: string) => {
    setProfile((prev) => ({ ...prev, [field]: value }));
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (showEmergencyCard && emergencyCard) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>Cartao de Emergencia</Text>

          <Card style={[styles.emergencyCard]}>
            <View style={styles.emergencyHeader}>
              <Ionicons name="medical" size={28} color={COLORS.danger} />
              <Text style={styles.emergencyHeaderText}>EMERGENCIA</Text>
            </View>

            <View style={styles.emergencyDivider} />

            <Text style={styles.emergencyName}>{emergencyCard.name}</Text>
            {emergencyCard.age && (
              <Text style={styles.emergencyDetail}>{emergencyCard.age} anos</Text>
            )}

            {emergencyCard.blood_type && (
              <View style={styles.emergencyRow}>
                <Text style={styles.emergencyLabel}>Tipo sanguineo</Text>
                <View style={styles.bloodTypeBadge}>
                  <Text style={styles.bloodTypeText}>{emergencyCard.blood_type}</Text>
                </View>
              </View>
            )}

            {emergencyCard.allergies && (
              <View style={styles.emergencyRow}>
                <Text style={styles.emergencyLabel}>Alergias</Text>
                <Text style={styles.emergencyValue}>{emergencyCard.allergies}</Text>
              </View>
            )}

            {emergencyCard.chronic_conditions && (
              <View style={styles.emergencyRow}>
                <Text style={styles.emergencyLabel}>Condicoes</Text>
                <Text style={styles.emergencyValue}>{emergencyCard.chronic_conditions}</Text>
              </View>
            )}

            {emergencyCard.current_medications && (
              <View style={styles.emergencyRow}>
                <Text style={styles.emergencyLabel}>Medicamentos</Text>
                <Text style={styles.emergencyValue}>{emergencyCard.current_medications}</Text>
              </View>
            )}

            {emergencyCard.health_plan && (
              <View style={styles.emergencyRow}>
                <Text style={styles.emergencyLabel}>Plano de saude</Text>
                <Text style={styles.emergencyValue}>
                  {emergencyCard.health_plan}
                  {emergencyCard.health_plan_number ? ` (${emergencyCard.health_plan_number})` : ""}
                </Text>
              </View>
            )}

            {emergencyCard.primary_doctor && (
              <View style={styles.emergencyRow}>
                <Text style={styles.emergencyLabel}>Medico</Text>
                <Text style={styles.emergencyValue}>
                  {emergencyCard.primary_doctor}
                  {emergencyCard.doctor_phone ? ` - ${emergencyCard.doctor_phone}` : ""}
                </Text>
              </View>
            )}

            {emergencyCard.emergency_notes && (
              <View style={styles.emergencyRow}>
                <Text style={styles.emergencyLabel}>Notas</Text>
                <Text style={styles.emergencyValue}>{emergencyCard.emergency_notes}</Text>
              </View>
            )}

            {emergencyCard.emergency_contacts.length > 0 && (
              <>
                <View style={styles.emergencyDivider} />
                <Text style={styles.emergencyContactsTitle}>Contatos de Emergencia</Text>
                {emergencyCard.emergency_contacts.map((c, i) => (
                  <View key={i} style={styles.emergencyContactRow}>
                    <Ionicons name="call" size={18} color={COLORS.primary} />
                    <View style={{ flex: 1, marginLeft: SPACING.sm }}>
                      <Text style={styles.emergencyContactName}>
                        {c.name} ({c.relationship})
                      </Text>
                      <Text style={styles.emergencyContactPhone}>{c.phone}</Text>
                    </View>
                  </View>
                ))}
              </>
            )}
          </Card>

          <Button
            title="Compartilhar"
            onPress={handleShareEmergencyCard}
            variant="primary"
            size="large"
            icon={<Ionicons name="share-social" size={18} color={COLORS.white} />}
            style={{ marginTop: SPACING.md, width: "100%" }}
          />
          <Button
            title="Voltar"
            onPress={() => setShowEmergencyCard(false)}
            variant="outline"
            size="large"
            style={{ marginTop: SPACING.sm, width: "100%" }}
          />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Perfil Medico</Text>
        <View style={{ width: 32 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Perfil Medico</Text>

        {/* Emergency Card Button */}
        <TouchableOpacity style={styles.emergencyCardBtn} onPress={fetchEmergencyCard}>
          <Ionicons name="card" size={22} color={COLORS.danger} />
          <Text style={styles.emergencyCardBtnText}>Ver Cartao de Emergencia</Text>
          <Ionicons name="chevron-forward" size={20} color={COLORS.textLight} />
        </TouchableOpacity>

        {/* Personal Info */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Dados Pessoais</Text>

          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Nome completo</Text>
            {editing ? (
              <TextInput
                style={styles.fieldInput}
                value={profile.full_name || ""}
                onChangeText={(v) => updateField("full_name", v)}
                placeholder="Nome completo"
                placeholderTextColor={COLORS.textLight}
              />
            ) : (
              <Text style={styles.fieldValue}>{profile.full_name || "Nao informado"}</Text>
            )}
          </View>

          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Data de nascimento</Text>
            {editing ? (
              <TextInput
                style={styles.fieldInput}
                value={profile.date_of_birth || ""}
                onChangeText={(v) => updateField("date_of_birth", v)}
                placeholder="AAAA-MM-DD"
                placeholderTextColor={COLORS.textLight}
              />
            ) : (
              <Text style={styles.fieldValue}>
                {profile.date_of_birth
                  ? new Date(profile.date_of_birth).toLocaleDateString("pt-BR")
                  : "Nao informado"}
              </Text>
            )}
          </View>

          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>CPF</Text>
            {editing ? (
              <TextInput
                style={styles.fieldInput}
                value={profile.cpf || ""}
                onChangeText={(v) => updateField("cpf", v)}
                placeholder="000.000.000-00"
                placeholderTextColor={COLORS.textLight}
                keyboardType="numeric"
              />
            ) : (
              <Text style={styles.fieldValue}>{profile.cpf || "Nao informado"}</Text>
            )}
          </View>

          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Endereco</Text>
            {editing ? (
              <TextInput
                style={styles.fieldInput}
                value={profile.address || ""}
                onChangeText={(v) => updateField("address", v)}
                placeholder="Endereco completo"
                placeholderTextColor={COLORS.textLight}
                multiline
              />
            ) : (
              <Text style={styles.fieldValue}>{profile.address || "Nao informado"}</Text>
            )}
          </View>
        </Card>

        {/* Medical Info */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Informacoes Medicas</Text>

          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Tipo sanguineo</Text>
            {editing ? (
              <View style={styles.bloodTypeSelector}>
                {BLOOD_TYPES.map((bt) => (
                  <TouchableOpacity
                    key={bt}
                    style={[
                      styles.bloodTypeOption,
                      profile.blood_type === bt && styles.bloodTypeOptionActive,
                    ]}
                    onPress={() => updateField("blood_type", bt)}
                  >
                    <Text
                      style={[
                        styles.bloodTypeOptionText,
                        profile.blood_type === bt && styles.bloodTypeOptionTextActive,
                      ]}
                    >
                      {bt}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <Text style={styles.fieldValue}>{profile.blood_type || "Nao informado"}</Text>
            )}
          </View>

          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Alergias</Text>
            {editing ? (
              <TextInput
                style={styles.fieldInput}
                value={profile.allergies || ""}
                onChangeText={(v) => updateField("allergies", v)}
                placeholder="Ex: Penicilina, Dipirona"
                placeholderTextColor={COLORS.textLight}
                multiline
              />
            ) : (
              <Text style={styles.fieldValue}>{profile.allergies || "Nenhuma informada"}</Text>
            )}
          </View>

          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Condicoes cronicas</Text>
            {editing ? (
              <TextInput
                style={styles.fieldInput}
                value={profile.chronic_conditions || ""}
                onChangeText={(v) => updateField("chronic_conditions", v)}
                placeholder="Ex: Diabetes, Hipertensao"
                placeholderTextColor={COLORS.textLight}
                multiline
              />
            ) : (
              <Text style={styles.fieldValue}>
                {profile.chronic_conditions || "Nenhuma informada"}
              </Text>
            )}
          </View>

          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Medicamentos atuais</Text>
            {editing ? (
              <TextInput
                style={styles.fieldInput}
                value={profile.current_medications || ""}
                onChangeText={(v) => updateField("current_medications", v)}
                placeholder="Ex: Losartana 50mg, Metformina 500mg"
                placeholderTextColor={COLORS.textLight}
                multiline
              />
            ) : (
              <Text style={styles.fieldValue}>
                {profile.current_medications || "Nenhum informado"}
              </Text>
            )}
          </View>

          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Notas de emergencia</Text>
            {editing ? (
              <TextInput
                style={styles.fieldInput}
                value={profile.emergency_notes || ""}
                onChangeText={(v) => updateField("emergency_notes", v)}
                placeholder="Informacoes importantes para socorristas"
                placeholderTextColor={COLORS.textLight}
                multiline
              />
            ) : (
              <Text style={styles.fieldValue}>
                {profile.emergency_notes || "Nenhuma nota"}
              </Text>
            )}
          </View>
        </Card>

        {/* Health Plan & Doctor */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Plano de Saude e Medico</Text>

          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Plano de saude</Text>
            {editing ? (
              <TextInput
                style={styles.fieldInput}
                value={profile.health_plan || ""}
                onChangeText={(v) => updateField("health_plan", v)}
                placeholder="Nome do plano"
                placeholderTextColor={COLORS.textLight}
              />
            ) : (
              <Text style={styles.fieldValue}>{profile.health_plan || "Nao informado"}</Text>
            )}
          </View>

          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Numero do plano</Text>
            {editing ? (
              <TextInput
                style={styles.fieldInput}
                value={profile.health_plan_number || ""}
                onChangeText={(v) => updateField("health_plan_number", v)}
                placeholder="Numero da carteirinha"
                placeholderTextColor={COLORS.textLight}
              />
            ) : (
              <Text style={styles.fieldValue}>
                {profile.health_plan_number || "Nao informado"}
              </Text>
            )}
          </View>

          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Medico principal</Text>
            {editing ? (
              <TextInput
                style={styles.fieldInput}
                value={profile.primary_doctor || ""}
                onChangeText={(v) => updateField("primary_doctor", v)}
                placeholder="Nome do medico"
                placeholderTextColor={COLORS.textLight}
              />
            ) : (
              <Text style={styles.fieldValue}>
                {profile.primary_doctor || "Nao informado"}
              </Text>
            )}
          </View>

          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Telefone do medico</Text>
            {editing ? (
              <TextInput
                style={styles.fieldInput}
                value={profile.doctor_phone || ""}
                onChangeText={(v) => updateField("doctor_phone", v)}
                placeholder="(00) 00000-0000"
                placeholderTextColor={COLORS.textLight}
                keyboardType="phone-pad"
              />
            ) : (
              <Text style={styles.fieldValue}>
                {profile.doctor_phone || "Nao informado"}
              </Text>
            )}
          </View>
        </Card>

        {/* Action Buttons */}
        {editing ? (
          <View style={styles.actionRow}>
            <Button
              title="Salvar"
              onPress={handleSave}
              variant="primary"
              size="large"
              loading={saving}
              style={{ flex: 1 }}
            />
            <Button
              title="Cancelar"
              onPress={() => {
                setEditing(false);
                fetchProfile();
              }}
              variant="outline"
              size="large"
              style={{ flex: 1 }}
            />
          </View>
        ) : (
          <Button
            title="Editar Perfil"
            onPress={() => setEditing(true)}
            variant="primary"
            size="large"
            icon={<Ionicons name="create" size={18} color={COLORS.white} />}
            style={{ width: "100%" }}
          />
        )}

        <Button
          title="Voltar"
          onPress={() => navigation.goBack()}
          variant="outline"
          size="large"
          style={{ marginTop: SPACING.sm, width: "100%" }}
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
  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  title: {
    ...FONTS.title,
    fontSize: 28,
    marginBottom: SPACING.lg,
  },
  section: { marginBottom: SPACING.md },
  sectionTitle: { ...FONTS.subtitle, fontWeight: "500", marginBottom: SPACING.sm },
  emergencyCardBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    backgroundColor: COLORS.dangerLight,
    borderWidth: 1,
    borderColor: COLORS.danger,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  emergencyCardBtnText: {
    ...FONTS.body,
    flex: 1,
    fontWeight: "500",
    color: COLORS.danger,
  },
  fieldRow: {
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  fieldLabel: { ...FONTS.caption, marginBottom: SPACING.xs },
  fieldValue: { ...FONTS.body },
  fieldInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    fontSize: 16,
    backgroundColor: COLORS.white,
    color: COLORS.textPrimary,
  },
  bloodTypeSelector: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: SPACING.xs,
  },
  bloodTypeOption: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.white,
  },
  bloodTypeOptionActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  bloodTypeOptionText: { ...FONTS.body, color: COLORS.textPrimary },
  bloodTypeOptionTextActive: { color: COLORS.white },
  actionRow: {
    flexDirection: "row",
    gap: SPACING.md,
  },
  // Emergency card styles
  emergencyCard: {
    borderWidth: 2,
    borderColor: COLORS.danger,
  },
  emergencyHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: SPACING.sm,
  },
  emergencyHeaderText: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.danger,
    letterSpacing: 2,
  },
  emergencyDivider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: SPACING.md,
  },
  emergencyName: {
    fontFamily: serifFont,
    fontSize: 24,
    fontWeight: "300",
    color: COLORS.textPrimary,
    textAlign: "center",
  },
  emergencyDetail: {
    ...FONTS.body,
    color: COLORS.textSecondary,
    textAlign: "center",
    marginTop: SPACING.xs,
  },
  emergencyRow: {
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  emergencyLabel: { ...FONTS.caption, marginBottom: 2 },
  emergencyValue: { ...FONTS.body },
  bloodTypeBadge: {
    backgroundColor: COLORS.danger,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.md,
    alignSelf: "flex-start",
    marginTop: SPACING.xs,
  },
  bloodTypeText: {
    color: COLORS.white,
    fontWeight: "700",
    fontSize: 18,
  },
  emergencyContactsTitle: {
    ...FONTS.subtitle,
    fontWeight: "500",
    marginBottom: SPACING.sm,
  },
  emergencyContactRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  emergencyContactName: { ...FONTS.body, fontWeight: "500" },
  emergencyContactPhone: { ...FONTS.caption, marginTop: 2 },
});
