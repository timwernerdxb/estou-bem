import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { COLORS, RADIUS, SPACING } from "../constants/theme";
import { CheckInStatus } from "../types";

const STATUS_CONFIG: Record<CheckInStatus, { label: string; bg: string; text: string }> = {
  confirmed: { label: "✅ Confirmado", bg: COLORS.successLight, text: COLORS.success },
  auto_confirmed: { label: "✅ Auto", bg: COLORS.successLight, text: COLORS.success },
  pending: { label: "⏳ Pendente", bg: COLORS.warningLight, text: COLORS.warning },
  missed: { label: "❌ Perdido", bg: COLORS.dangerLight, text: COLORS.danger },
};

export function StatusBadge({ status }: { status: CheckInStatus }) {
  const config = STATUS_CONFIG[status];
  return (
    <View style={[styles.badge, { backgroundColor: config.bg }]}>
      <Text style={[styles.text, { color: config.text }]}>{config.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.full,
    alignSelf: "flex-start",
  },
  text: {
    fontSize: 13,
    fontWeight: "600",
  },
});
