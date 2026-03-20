import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { COLORS, RADIUS, SPACING } from "../constants/theme";
import { CheckInStatus } from "../types";

const STATUS_CONFIG: Record<CheckInStatus, { label: string; bg: string; text: string; borderColor: string }> = {
  confirmed: { label: "Confirmado", bg: COLORS.successLight, text: COLORS.success, borderColor: COLORS.success },
  auto_confirmed: { label: "Auto", bg: COLORS.successLight, text: COLORS.success, borderColor: COLORS.success },
  pending: { label: "Pendente", bg: COLORS.warningLight, text: "#8B7340", borderColor: COLORS.warning },
  missed: { label: "Perdido", bg: COLORS.dangerLight, text: COLORS.danger, borderColor: COLORS.danger },
};

export function StatusBadge({ status }: { status: CheckInStatus }) {
  const config = STATUS_CONFIG[status];
  return (
    <View style={[styles.badge, { backgroundColor: config.bg, borderColor: config.borderColor }]}>
      <Text style={[styles.text, { color: config.text }]}>{config.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: SPACING.sm + 4,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  text: {
    fontSize: 12,
    fontWeight: "500",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
});
