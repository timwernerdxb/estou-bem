import React, { useEffect } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { COLORS, FONTS, SPACING } from "../constants/theme";
import { useApp } from "../store/AppContext";
import { Card } from "../components/Card";
import { StatusBadge } from "../components/StatusBadge";
import { CheckIn } from "../types";
import { fetchCheckins } from "../services/ApiService";

export function CheckInHistoryScreen() {
  const navigation = useNavigation();
  const { state, dispatch } = useApp();

  // Fetch check-ins from server on mount and merge with local state
  useEffect(() => {
    (async () => {
      try {
        const rows = await fetchCheckins(state.currentUser, { limit: 100 });
        if (rows && rows.length > 0) {
          for (const row of rows) {
            const mapped: CheckIn = {
              id: String(row.id),
              elderId: String(row.user_id),
              scheduledAt: row.created_at || new Date().toISOString(),
              respondedAt: row.confirmed_at || undefined,
              status: row.status === "confirmed" || row.status === "auto_confirmed"
                ? row.status
                : row.status === "missed"
                ? "missed"
                : "pending",
            };
            const exists = state.checkins.some((c) => c.id === mapped.id);
            if (!exists) {
              dispatch({ type: "ADD_CHECKIN", payload: mapped });
            }
          }
        }
      } catch (e) {
        console.warn("[CheckInHistory] Failed to fetch checkins:", e);
      }
    })();
  }, []);

  const renderItem = ({ item }: { item: CheckIn }) => (
    <Card style={styles.card}>
      <View style={styles.row}>
        <View style={styles.info}>
          <Text style={styles.date}>
            {new Date(item.scheduledAt).toLocaleDateString("pt-BR", {
              weekday: "short",
              day: "2-digit",
              month: "2-digit",
            })}
          </Text>
          <Text style={styles.time}>
            {new Date(item.scheduledAt).toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </Text>
          {item.respondedAt && (
            <Text style={styles.responded}>
              Respondido:{" "}
              {new Date(item.respondedAt).toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </Text>
          )}
          {item.autoConfirmSource && (
            <Text style={styles.auto}>Auto: {item.autoConfirmSource}</Text>
          )}
        </View>
        <StatusBadge status={item.status} />
      </View>
    </Card>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Historico de Check-ins</Text>
        <View style={{ width: 32 }} />
      </View>
      <Text style={styles.title}>Historico de Check-ins</Text>
      <FlatList
        data={state.checkins}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>Nenhum check-in registrado ainda</Text>
        }
      />
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
  title: { ...FONTS.title, padding: SPACING.lg, paddingBottom: SPACING.sm },
  list: { padding: SPACING.md },
  card: { marginBottom: SPACING.sm },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  info: {},
  date: { ...FONTS.body, fontWeight: "600" },
  time: { ...FONTS.caption },
  responded: { ...FONTS.small, color: COLORS.success },
  auto: { ...FONTS.small, color: COLORS.primary },
  empty: { ...FONTS.body, textAlign: "center", marginTop: SPACING.xxl, color: COLORS.textSecondary },
});
