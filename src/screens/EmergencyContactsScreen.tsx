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
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from "../constants/theme";
import { useApp } from "../store/AppContext";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import { EmergencyContact } from "../types";
import {
  fetchContacts,
  postContact,
  deleteContact as deleteContactApi,
} from "../services/ApiService";

export function EmergencyContactsScreen() {
  const navigation = useNavigation();
  const { state, dispatch } = useApp();
  const [showAdd, setShowAdd] = useState(false);
  const [newContact, setNewContact] = useState({
    name: "",
    phone: "",
    relationship: "",
  });

  // Fetch contacts from server on mount and merge with local
  useEffect(() => {
    (async () => {
      try {
        const rows = await fetchContacts(state.currentUser);
        if (rows && rows.length > 0) {
          const serverContacts: EmergencyContact[] = rows.map((row: any) => ({
            id: String(row.id),
            elderId: String(row.user_id),
            name: row.name,
            phone: row.phone,
            relationship: row.relationship || "",
            priority: row.priority || 1,
            notifyOnMissedCheckin: true,
            notifyOnSOS: true,
          }));
          // Replace local list with server data if server has data
          dispatch({ type: "SET_EMERGENCY_CONTACTS", payload: serverContacts });
        }
      } catch (e) {
        console.warn("[Contacts] Failed to fetch from server:", e);
      }
    })();
  }, []);

  const handleAdd = () => {
    if (!newContact.name.trim() || !newContact.phone.trim()) {
      Alert.alert("Erro", "Nome e telefone são obrigatórios");
      return;
    }

    const contact: EmergencyContact = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 9),
      elderId: state.elderProfile?.id || state.currentUser?.id || "",
      name: newContact.name.trim(),
      phone: newContact.phone.trim(),
      relationship: newContact.relationship.trim(),
      priority: state.emergencyContacts.length + 1,
      notifyOnMissedCheckin: true,
      notifyOnSOS: true,
    };

    dispatch({ type: "ADD_EMERGENCY_CONTACT", payload: contact });

    // Sync to server and update local state with server-returned ID
    postContact(state.currentUser, {
      name: contact.name,
      phone: contact.phone,
      relationship: contact.relationship,
      priority: contact.priority,
    }).then((serverResult) => {
      if (serverResult?.id) {
        // Replace local temp ID with server ID
        dispatch({ type: "REMOVE_EMERGENCY_CONTACT", payload: contact.id });
        dispatch({ type: "ADD_EMERGENCY_CONTACT", payload: { ...contact, id: String(serverResult.id) } });
      }
    }).catch(() => {});

    setShowAdd(false);
    setNewContact({ name: "", phone: "", relationship: "" });
  };

  const handleDelete = (contact: EmergencyContact) => {
    Alert.alert("Remover contato", `Remover ${contact.name}?`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Remover",
        style: "destructive",
        onPress: () => {
          dispatch({ type: "REMOVE_EMERGENCY_CONTACT", payload: contact.id });
          deleteContactApi(state.currentUser, contact.id).catch(() => {});
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Contatos de Emergencia</Text>
        <View style={{ width: 32 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Contatos de Emergencia</Text>
        <Text style={styles.subtitle}>
          Essas pessoas serão notificadas quando um check-in for perdido ou o
          SOS for acionado
        </Text>

        {state.emergencyContacts
          .sort((a, b) => a.priority - b.priority)
          .map((contact, index) => (
            <Card key={contact.id} style={styles.contactCard}>
              <View style={styles.contactRow}>
                <View style={styles.priorityBadge}>
                  <Text style={styles.priorityText}>{index + 1}º</Text>
                </View>
                <View style={styles.contactInfo}>
                  <Text style={styles.contactName}>{contact.name}</Text>
                  <Text style={styles.contactRel}>
                    {contact.relationship || "Não informado"}
                  </Text>
                  <Text style={styles.contactPhone}>{contact.phone}</Text>
                </View>
                <View style={styles.contactActions}>
                  <TouchableOpacity
                    onPress={() => Linking.openURL(`tel:${contact.phone}`)}
                  >
                    <Ionicons name="call" size={24} color={COLORS.success} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => handleDelete(contact)}>
                    <Ionicons
                      name="trash-outline"
                      size={24}
                      color={COLORS.danger}
                    />
                  </TouchableOpacity>
                </View>
              </View>
            </Card>
          ))}

        {state.emergencyContacts.length === 0 && (
          <Card style={styles.emptyCard}>
            <Ionicons name="people-outline" size={48} color={COLORS.textLight} />
            <Text style={styles.emptyText}>
              Nenhum contato de emergência cadastrado
            </Text>
          </Card>
        )}

        <Button
          title="+ Adicionar Contato"
          onPress={() => setShowAdd(true)}
          size="large"
          style={{ marginTop: SPACING.md, width: "100%" }}
        />
      </ScrollView>

      <Modal visible={showAdd} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Novo Contato</Text>
            <TouchableOpacity onPress={() => setShowAdd(false)}>
              <Ionicons name="close" size={28} color={COLORS.textPrimary} />
            </TouchableOpacity>
          </View>
          <View style={styles.modalContent}>
            <Text style={styles.inputLabel}>Nome *</Text>
            <TextInput
              style={styles.input}
              placeholder="Nome do contato"
              value={newContact.name}
              onChangeText={(t) => setNewContact({ ...newContact, name: t })}
              placeholderTextColor={COLORS.textLight}
            />

            <Text style={styles.inputLabel}>Telefone *</Text>
            <TextInput
              style={styles.input}
              placeholder="(11) 99999-9999"
              value={newContact.phone}
              onChangeText={(t) => setNewContact({ ...newContact, phone: t })}
              keyboardType="phone-pad"
              placeholderTextColor={COLORS.textLight}
            />

            <Text style={styles.inputLabel}>Parentesco</Text>
            <TextInput
              style={styles.input}
              placeholder="Ex: Filho(a), Vizinho(a)"
              value={newContact.relationship}
              onChangeText={(t) =>
                setNewContact({ ...newContact, relationship: t })
              }
              placeholderTextColor={COLORS.textLight}
            />

            <Button
              title="Salvar Contato"
              onPress={handleAdd}
              size="large"
              style={{ marginTop: SPACING.lg, width: "100%" }}
            />
          </View>
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
  title: { ...FONTS.elderTitle, marginBottom: SPACING.xs },
  subtitle: { ...FONTS.body, color: COLORS.textSecondary, marginBottom: SPACING.lg },
  contactCard: { marginBottom: SPACING.sm },
  contactRow: { flexDirection: "row", alignItems: "center", gap: SPACING.md },
  priorityBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.primaryLight,
    justifyContent: "center",
    alignItems: "center",
  },
  priorityText: { color: COLORS.white, fontWeight: "700", fontSize: 14 },
  contactInfo: { flex: 1 },
  contactName: { ...FONTS.subtitle },
  contactRel: { ...FONTS.caption },
  contactPhone: { ...FONTS.body, color: COLORS.primary },
  contactActions: { gap: SPACING.md },
  emptyCard: { alignItems: "center", paddingVertical: SPACING.xxl },
  emptyText: { ...FONTS.body, color: COLORS.textSecondary, marginTop: SPACING.md },
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
  inputLabel: {
    ...FONTS.body,
    fontWeight: "600",
    marginTop: SPACING.md,
    marginBottom: SPACING.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    fontSize: 18,
    backgroundColor: COLORS.white,
    color: COLORS.textPrimary,
  },
});
