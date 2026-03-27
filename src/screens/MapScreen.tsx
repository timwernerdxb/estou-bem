/**
 * MapScreen — Shows elder's last known location and manages geofences.
 *
 * Note: react-native-maps is not currently installed. This screen shows
 * coordinates as text and provides full geofence CRUD. To add a visual map,
 * install react-native-maps and replace the placeholder section.
 */

import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  RefreshControl,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from "../constants/theme";
import { useApp } from "../store/AppContext";
import { Card } from "../components/Card";
import {
  getElderLatestLocation,
  getGeofences,
  createGeofence,
  updateGeofence,
  deleteGeofence,
} from "../services/ApiService";

interface GeofenceRow {
  id: number;
  elder_id: number;
  name: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  is_active: boolean;
  created_at: string;
}

interface LocationData {
  latitude: number;
  longitude: number;
  accuracy?: number;
  recorded_at: string;
}

export function MapScreen() {
  const navigation = useNavigation<any>();
  const { state } = useApp();

  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [location, setLocation] = React.useState<LocationData | null>(null);
  const [geofences, setGeofences] = React.useState<GeofenceRow[]>([]);

  // Add geofence form state
  const [showAddForm, setShowAddForm] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [newLat, setNewLat] = React.useState("");
  const [newLng, setNewLng] = React.useState("");
  const [newRadius, setNewRadius] = React.useState("200");
  const [saving, setSaving] = React.useState(false);

  const loadData = React.useCallback(async () => {
    try {
      const [locData, gfData] = await Promise.all([
        getElderLatestLocation(state.currentUser),
        getGeofences(state.currentUser),
      ]);
      if (locData?.location) setLocation(locData.location);
      if (gfData) setGeofences(gfData);
    } catch (e) {
      console.warn("[MapScreen] Failed to load data:", e);
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

  const prefillCurrentLocation = () => {
    if (location) {
      setNewLat(String(location.latitude));
      setNewLng(String(location.longitude));
    }
  };

  const handleAddGeofence = async () => {
    const lat = parseFloat(newLat);
    const lng = parseFloat(newLng);
    const radius = parseInt(newRadius, 10);

    if (isNaN(lat) || isNaN(lng)) {
      Alert.alert("Erro", "Latitude e longitude devem ser números válidos.");
      return;
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      Alert.alert("Erro", "Coordenadas fora do intervalo válido.");
      return;
    }
    if (isNaN(radius) || radius < 50 || radius > 50000) {
      Alert.alert("Erro", "Raio deve ser entre 50 e 50000 metros.");
      return;
    }

    setSaving(true);
    try {
      const result = await createGeofence(state.currentUser, {
        name: newName.trim() || "Zona Segura",
        latitude: lat,
        longitude: lng,
        radius_meters: radius,
      });
      if (result) {
        setGeofences((prev) => [result, ...prev]);
        setShowAddForm(false);
        setNewName("");
        setNewLat("");
        setNewLng("");
        setNewRadius("200");
      }
    } catch (e) {
      Alert.alert("Erro", "Não foi possível criar a cerca virtual.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (gf: GeofenceRow) => {
    const updated = await updateGeofence(state.currentUser, gf.id, {
      is_active: !gf.is_active,
    });
    if (updated) {
      setGeofences((prev) => prev.map((g) => (g.id === gf.id ? updated : g)));
    }
  };

  const handleDelete = (gf: GeofenceRow) => {
    Alert.alert(
      "Excluir cerca virtual",
      `Tem certeza que deseja excluir "${gf.name}"?`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Excluir",
          style: "destructive",
          onPress: async () => {
            const ok = await deleteGeofence(state.currentUser, gf.id);
            if (ok) {
              setGeofences((prev) => prev.filter((g) => g.id !== gf.id));
            }
          },
        },
      ]
    );
  };

  const formatRelativeTime = (dateStr: string): string => {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "agora";
    if (diffMin < 60) return `há ${diffMin} min`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `há ${diffH}h`;
    return `há ${Math.floor(diffH / 24)} dia(s)`;
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Carregando...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Localização</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Current Location Card */}
        <Card style={styles.locationCard}>
          <View style={styles.sectionHeader}>
            <Ionicons name="location" size={20} color={COLORS.primary} />
            <Text style={styles.sectionTitle}>Última Localização Conhecida</Text>
          </View>

          {/* Map placeholder */}
          <View style={styles.mapPlaceholder}>
            <Ionicons name="map-outline" size={48} color={COLORS.textLight} />
            <Text style={styles.mapPlaceholderTitle}>Visualização de Mapa</Text>
            <Text style={styles.mapPlaceholderNote}>
              Instale react-native-maps para exibir o mapa visual.
            </Text>
          </View>

          {location ? (
            <View style={styles.coordBox}>
              <View style={styles.coordRow}>
                <Text style={styles.coordLabel}>Latitude</Text>
                <Text style={styles.coordValue}>
                  {Number(location.latitude).toFixed(6)}
                </Text>
              </View>
              <View style={styles.coordRow}>
                <Text style={styles.coordLabel}>Longitude</Text>
                <Text style={styles.coordValue}>
                  {Number(location.longitude).toFixed(6)}
                </Text>
              </View>
              {location.accuracy != null && (
                <View style={styles.coordRow}>
                  <Text style={styles.coordLabel}>Precisão</Text>
                  <Text style={styles.coordValue}>
                    ±{Math.round(location.accuracy)}m
                  </Text>
                </View>
              )}
              <View style={styles.coordRow}>
                <Text style={styles.coordLabel}>Atualizado</Text>
                <Text style={styles.coordValue}>
                  {formatRelativeTime(location.recorded_at)}
                </Text>
              </View>
            </View>
          ) : (
            <Text style={styles.noDataText}>
              Sem dados de localização disponíveis.{"\n"}O idoso precisa abrir o
              app para enviar a localização.
            </Text>
          )}
        </Card>

        {/* Geofences Section */}
        <Card style={styles.geofenceCard}>
          <View style={styles.sectionHeaderRow}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Ionicons name="shield-checkmark" size={20} color={COLORS.primary} />
              <Text style={styles.sectionTitle}>
                Cercas Virtuais ({geofences.length})
              </Text>
            </View>
            <TouchableOpacity
              style={styles.addButton}
              onPress={() => setShowAddForm((v) => !v)}
            >
              <Ionicons
                name={showAddForm ? "close" : "add"}
                size={18}
                color={COLORS.white}
              />
              <Text style={styles.addButtonText}>
                {showAddForm ? "Cancelar" : "Adicionar"}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Add form */}
          {showAddForm && (
            <View style={styles.addForm}>
              <Text style={styles.formLabel}>Nome</Text>
              <TextInput
                style={styles.input}
                value={newName}
                onChangeText={setNewName}
                placeholder="Ex: Casa, Parque, Mercado"
                placeholderTextColor={COLORS.textLight}
              />

              <Text style={styles.formLabel}>Latitude</Text>
              <TextInput
                style={styles.input}
                value={newLat}
                onChangeText={setNewLat}
                placeholder="-23.550520"
                placeholderTextColor={COLORS.textLight}
                keyboardType="decimal-pad"
              />

              <Text style={styles.formLabel}>Longitude</Text>
              <TextInput
                style={styles.input}
                value={newLng}
                onChangeText={setNewLng}
                placeholder="-46.633308"
                placeholderTextColor={COLORS.textLight}
                keyboardType="decimal-pad"
              />

              {location && (
                <TouchableOpacity
                  style={styles.prefillButton}
                  onPress={prefillCurrentLocation}
                >
                  <Ionicons name="locate" size={14} color={COLORS.primary} />
                  <Text style={styles.prefillText}>
                    Usar última localização do idoso
                  </Text>
                </TouchableOpacity>
              )}

              <Text style={styles.formLabel}>Raio (metros)</Text>
              <TextInput
                style={styles.input}
                value={newRadius}
                onChangeText={setNewRadius}
                placeholder="200"
                placeholderTextColor={COLORS.textLight}
                keyboardType="number-pad"
              />

              <TouchableOpacity
                style={[styles.saveButton, saving && { opacity: 0.6 }]}
                onPress={handleAddGeofence}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator size="small" color={COLORS.white} />
                ) : (
                  <Text style={styles.saveButtonText}>Salvar Cerca Virtual</Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* Geofence list */}
          {geofences.length === 0 && !showAddForm ? (
            <Text style={styles.noDataText}>
              Nenhuma cerca virtual criada.{"\n"}Adicione uma zona segura para
              receber alertas quando o idoso sair dela.
            </Text>
          ) : (
            geofences.map((gf) => (
              <View key={gf.id} style={styles.geofenceRow}>
                <View style={styles.geofenceInfo}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Ionicons
                      name="radio-button-on"
                      size={14}
                      color={gf.is_active ? COLORS.primary : COLORS.textLight}
                    />
                    <Text style={styles.geofenceName}>{gf.name}</Text>
                  </View>
                  <Text style={styles.geofenceCoords}>
                    {Number(gf.latitude).toFixed(5)},{" "}
                    {Number(gf.longitude).toFixed(5)}
                  </Text>
                  <Text style={styles.geofenceRadius}>
                    Raio: {gf.radius_meters}m
                    {!gf.is_active && " · Inativa"}
                  </Text>
                </View>
                <View style={styles.geofenceActions}>
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => handleToggleActive(gf)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons
                      name={gf.is_active ? "pause-circle" : "play-circle"}
                      size={22}
                      color={gf.is_active ? COLORS.warning : COLORS.primary}
                    />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => handleDelete(gf)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="trash" size={22} color={COLORS.danger} />
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </Card>

        <Text style={styles.installNote}>
          Para visualizar o mapa interativo, instale:{"\n"}
          npx expo install react-native-maps
        </Text>
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
  },
  loadingText: { ...FONTS.caption, marginTop: SPACING.sm },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: { width: 40 },
  headerTitle: { ...FONTS.subtitle, fontWeight: "600", fontSize: 17 },
  scrollContent: { padding: SPACING.lg, paddingBottom: SPACING.xl * 2 },

  locationCard: { marginBottom: SPACING.md },
  geofenceCard: { marginBottom: SPACING.md },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: SPACING.md,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: SPACING.md,
  },
  sectionTitle: { ...FONTS.subtitle, fontWeight: "500" },

  mapPlaceholder: {
    height: 180,
    backgroundColor: COLORS.border,
    borderRadius: RADIUS.sm,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: SPACING.md,
    gap: 8,
  },
  mapPlaceholderTitle: {
    ...FONTS.body,
    fontWeight: "500",
    color: COLORS.textLight,
  },
  mapPlaceholderNote: {
    ...FONTS.small,
    color: COLORS.textLight,
    textAlign: "center",
    paddingHorizontal: SPACING.lg,
  },

  coordBox: {
    backgroundColor: COLORS.background,
    borderRadius: RADIUS.sm,
    padding: SPACING.sm,
    gap: 4,
  },
  coordRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
  },
  coordLabel: { ...FONTS.caption, color: COLORS.textLight },
  coordValue: { ...FONTS.caption, fontWeight: "500", color: COLORS.textPrimary },

  noDataText: {
    ...FONTS.caption,
    color: COLORS.textLight,
    textAlign: "center",
    paddingVertical: SPACING.md,
    lineHeight: 20,
  },

  addButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.md,
    gap: 4,
  },
  addButtonText: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: "600",
  },

  addForm: {
    backgroundColor: COLORS.background,
    borderRadius: RADIUS.sm,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 6,
  },
  formLabel: { ...FONTS.caption, fontWeight: "500", marginBottom: 2 },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.sm,
    padding: SPACING.sm,
    ...FONTS.body,
    color: COLORS.textPrimary,
    backgroundColor: COLORS.card,
  },
  prefillButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: SPACING.xs,
  },
  prefillText: { ...FONTS.small, color: COLORS.primary },
  saveButton: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: "center",
    marginTop: SPACING.sm,
  },
  saveButtonText: {
    color: COLORS.white,
    fontWeight: "600",
    fontSize: 14,
    letterSpacing: 0.5,
  },

  geofenceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  geofenceInfo: { flex: 1, gap: 2 },
  geofenceName: { ...FONTS.body, fontWeight: "500" },
  geofenceCoords: { ...FONTS.small, color: COLORS.textLight, fontFamily: Platform.OS === "ios" ? "Courier" : "monospace" },
  geofenceRadius: { ...FONTS.small, color: COLORS.textLight },
  geofenceActions: {
    flexDirection: "row",
    gap: SPACING.sm,
    alignItems: "center",
  },
  actionButton: { padding: 4 },

  installNote: {
    ...FONTS.small,
    color: COLORS.textLight,
    textAlign: "center",
    marginTop: SPACING.sm,
    lineHeight: 18,
  },
});
