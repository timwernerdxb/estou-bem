import { Dimensions } from "react-native";

const { width, height } = Dimensions.get("window");

export const COLORS = {
  // Primary
  primary: "#4A90D9",
  primaryDark: "#2E6DB4",
  primaryLight: "#7CB3E8",

  // Status
  success: "#4CAF50",
  successLight: "#C8E6C9",
  warning: "#FF9800",
  warningLight: "#FFE0B2",
  danger: "#F44336",
  dangerLight: "#FFCDD2",

  // Neutral
  white: "#FFFFFF",
  background: "#F5F7FA",
  card: "#FFFFFF",
  border: "#E0E6ED",
  textPrimary: "#1A1A2E",
  textSecondary: "#6B7280",
  textLight: "#9CA3AF",
  disabled: "#D1D5DB",

  // Check-in specific
  checkinGreen: "#4CAF50",
  checkinGreenDark: "#388E3C",
  checkinPending: "#FF9800",
  checkinMissed: "#F44336",

  // Subscription tiers
  tierFree: "#9E9E9E",
  tierFamilia: "#4A90D9",
  tierCentral: "#9C27B0",
} as const;

export const FONTS = {
  // Elder-facing: large, high contrast
  elderTitle: {
    fontSize: 32,
    fontWeight: "700" as const,
    color: COLORS.textPrimary,
  },
  elderBody: {
    fontSize: 22,
    fontWeight: "400" as const,
    color: COLORS.textPrimary,
    lineHeight: 30,
  },
  elderButton: {
    fontSize: 24,
    fontWeight: "700" as const,
    color: COLORS.white,
  },

  // Family-facing: standard sizes
  title: {
    fontSize: 24,
    fontWeight: "700" as const,
    color: COLORS.textPrimary,
  },
  subtitle: {
    fontSize: 18,
    fontWeight: "600" as const,
    color: COLORS.textPrimary,
  },
  body: {
    fontSize: 16,
    fontWeight: "400" as const,
    color: COLORS.textPrimary,
    lineHeight: 24,
  },
  caption: {
    fontSize: 14,
    fontWeight: "400" as const,
    color: COLORS.textSecondary,
  },
  small: {
    fontSize: 12,
    fontWeight: "400" as const,
    color: COLORS.textLight,
  },
} as const;

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const RADIUS = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
} as const;

export const SHADOWS = {
  small: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  medium: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  large: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
  },
} as const;

export const SCREEN = { width, height } as const;

// Check-in configuration
export const CHECKIN_CONFIG = {
  defaultReminderMinutesBefore: 5,
  passiveCheckWindowMinutes: 15,
  maxCheckinsPerDay: {
    free: 1,
    familia: 3,
    central: 5,
  },
  escalationDelayMinutes: {
    reminder: 0,
    passiveCheck: 5,
    familyNotify: 15,
    callElder: 20,
    centralActivate: 30,
    emergencyServices: 45,
  },
} as const;

// Medication stock
export const MEDICATION_CONFIG = {
  lowStockDaysWarning: 7,
  defaultLowStockThreshold: 5,
} as const;
