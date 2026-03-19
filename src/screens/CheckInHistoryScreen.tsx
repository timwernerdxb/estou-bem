import React from "react";
import { View, Text, StyleSheet, FlatList } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { COLORS, FONTS, SPACING } from "../constants/theme";
import { useApp } from "../store/AppContext";
import { Card } from "../components/Card";
import { StatusBadge } from "../components/StatusBadge";
import { CheckIn } from "../types";

export function CheckInHistoryScreen() {
  const { state } = useApp();

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
      <Text style={styles.title}>Histórico de Check-ins</Text>
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
