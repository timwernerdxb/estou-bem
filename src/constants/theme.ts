import { Dimensions, Platform } from "react-native";

const { width, height } = Dimensions.get("window");

const serifFont = Platform.OS === "ios" ? "Georgia" : "serif";

export const COLORS = {
  // Primary
  primary: "#2D4A3E",
  primaryDark: "#1E3329",
  primaryLight: "#3D6454",

  // Accent
  accent: "#C9A96E",
  accentLight: "#D9C49A",

  // Status
  success: "#2D4A3E",
  successLight: "#E8EEEB",
  warning: "#C9A96E",
  warningLight: "#F5EFE4",
  danger: "#8B3A3A",
  dangerLight: "#F0E0E0",

  // Neutral
  white: "#FFFFFF",
  background: "#F5F0EB",
  card: "#FFFFFF",
  border: "#E5DDD3",
  textPrimary: "#1A1A1A",
  textSecondary: "#5C5549",
  textLight: "#9A9189",
  disabled: "#C8C2BA",

  // Check-in specific
  checkinGreen: "#2D4A3E",
  checkinGreenDark: "#1E3329",
  checkinPending: "#C9A96E",
  checkinMissed: "#8B3A3A",

  // Tab bar
  tabBar: "#1A1A1A",
  tabBarActive: "#FFFFFF",
  tabBarInactive: "#9A9189",

  // Subscription tiers
  tierFree: "#9A9189",
  tierFamilia: "#2D4A3E",
  tierCentral: "#C9A96E",
} as const;

export const FONTS = {
  // Elder-facing: large, high contrast, serif headlines
  elderTitle: {
    fontSize: 32,
    fontWeight: "300" as const,
    fontFamily: serifFont,
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
    fontWeight: "600" as const,
    color: COLORS.white,
    letterSpacing: 1,
  },

  // Family-facing: standard sizes
  title: {
    fontSize: 24,
    fontWeight: "300" as const,
    fontFamily: serifFont,
    color: COLORS.textPrimary,
  },
  subtitle: {
    fontSize: 18,
    fontWeight: "400" as const,
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
  sm: 4,
  md: 4,
  lg: 4,
  xl: 4,
  full: 9999,
} as const;

export const SHADOWS = {
  small: {
    shadowColor: "transparent",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  medium: {
    shadowColor: "transparent",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  large: {
    shadowColor: "transparent",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
} as const;

export const SCREEN = { width, height } as const;

// Check-in configuration
export const CHECKIN_CONFIG = {
  defaultReminderMinutesBefore: 5,
  passiveCheckWindowMinutes: 15,
  maxCheckinsPerDay: {
    free: 1,
    pro: 10,
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
