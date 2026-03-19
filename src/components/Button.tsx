import React from "react";
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ViewStyle,
  TextStyle,
  ActivityIndicator,
} from "react-native";
import { COLORS, RADIUS, SPACING, SHADOWS } from "../constants/theme";

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger" | "outline" | "ghost";
  size?: "small" | "medium" | "large" | "elder";
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
  icon?: React.ReactNode;
}

export function Button({
  title,
  onPress,
  variant = "primary",
  size = "medium",
  disabled = false,
  loading = false,
  style,
  textStyle,
  icon,
}: ButtonProps) {
  const bgColor = {
    primary: COLORS.primary,
    secondary: COLORS.success,
    danger: COLORS.danger,
    outline: "transparent",
    ghost: "transparent",
  }[variant];

  const txtColor = {
    primary: COLORS.white,
    secondary: COLORS.white,
    danger: COLORS.white,
    outline: COLORS.primary,
    ghost: COLORS.primary,
  }[variant];

  const sizeStyles: Record<string, { paddingV: number; paddingH: number; fontSize: number }> = {
    small: { paddingV: 8, paddingH: 16, fontSize: 14 },
    medium: { paddingV: 12, paddingH: 24, fontSize: 16 },
    large: { paddingV: 16, paddingH: 32, fontSize: 18 },
    elder: { paddingV: 20, paddingH: 40, fontSize: 24 },
  };

  const s = sizeStyles[size];

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.7}
      style={[
        styles.base,
        {
          backgroundColor: disabled ? COLORS.disabled : bgColor,
          paddingVertical: s.paddingV,
          paddingHorizontal: s.paddingH,
          borderWidth: variant === "outline" ? 2 : 0,
          borderColor: COLORS.primary,
        },
        variant !== "ghost" && SHADOWS.small,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={txtColor} />
      ) : (
        <>
          {icon}
          <Text
            style={[
              {
                color: disabled ? COLORS.textLight : txtColor,
                fontSize: s.fontSize,
                fontWeight: "700",
                marginLeft: icon ? 8 : 0,
              },
              textStyle,
            ]}
          >
            {title}
          </Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: RADIUS.md,
    minWidth: 100,
  },
});
