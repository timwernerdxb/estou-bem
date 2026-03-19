import React, { ReactNode } from "react";
import { View, StyleSheet, ViewStyle } from "react-native";
import { COLORS, RADIUS, SPACING, SHADOWS } from "../constants/theme";

interface CardProps {
  children: ReactNode;
  style?: ViewStyle;
  padded?: boolean;
}

export function Card({ children, style, padded = true }: CardProps) {
  return (
    <View style={[styles.card, padded && styles.padded, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    ...SHADOWS.small,
  },
  padded: {
    padding: SPACING.md,
  },
});
