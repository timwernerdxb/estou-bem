// ─── User & Roles ───────────────────────────────────────────────
export type UserRole = "elder" | "family" | "caregiver";

export type SubscriptionTier = "free" | "pro";

export interface User {
  id: string;
  name: string;
  phone: string;
  email?: string;
  role: UserRole;
  avatarUrl?: string;
  createdAt: string;
  link_code?: string;
  linked_elder_id?: string;
  apiUrl?: string;
  token?: string;
}

export interface ElderProfile extends User {
  role: "elder";
  dateOfBirth?: string;
  bloodType?: string;
  allergies: string[];
  conditions: string[];
  doctorName?: string;
  doctorPhone?: string;
  address?: string;
  safeZoneRadius?: number; // meters
  safeZoneLatitude?: number;
  safeZoneLongitude?: number;
}

export interface FamilyProfile extends User {
  role: "family" | "caregiver";
  elderIds: string[];
  isEmergencyContact: boolean;
  notifyOnMissedCheckin: boolean;
  notifyOnSOS: boolean;
  notifyOnGeofence: boolean;
}

// ─── Check-in ───────────────────────────────────────────────────
export type CheckInStatus = "pending" | "confirmed" | "missed" | "auto_confirmed";

export interface CheckIn {
  id: string;
  elderId: string;
  scheduledAt: string;
  respondedAt?: string;
  status: CheckInStatus;
  autoConfirmSource?: "medication" | "wearable" | "accelerometer";
  sensorData?: SensorSnapshot;
}

export interface SensorSnapshot {
  accelerometerActive: boolean;
  lastMovementAt?: string;
  heartRate?: number;
  heartRateAt?: string;
  latitude?: number;
  longitude?: number;
  locationAt?: string;
  batteryLevel?: number;
}

// ─── Escalation ─────────────────────────────────────────────────
export type EscalationLevel =
  | "reminder_sent"
  | "passive_check"
  | "family_notified"
  | "call_elder"
  | "central_activated"
  | "emergency_services";

export interface EscalationEvent {
  id: string;
  checkinId: string;
  level: EscalationLevel;
  timestamp: string;
  details: string;
  resolvedAt?: string;
  resolvedBy?: string;
}

// ─── Medications ────────────────────────────────────────────────
export interface Medication {
  id: string;
  elderId: string;
  name: string;
  dosage: string;
  frequency: MedicationFrequency;
  times: string[]; // HH:mm format
  stockQuantity: number;
  stockUnit: string; // "pills", "ml", etc.
  lowStockThreshold: number;
  autoReorderEnabled: boolean;
  notes?: string;
  createdAt: string;
}

export type MedicationFrequency =
  | "daily"
  | "twice_daily"
  | "three_times_daily"
  | "weekly"
  | "as_needed";

export interface MedicationLog {
  id: string;
  medicationId: string;
  elderId: string;
  scheduledAt: string;
  takenAt?: string;
  skipped: boolean;
  skipReason?: string;
}

// ─── Health Log ─────────────────────────────────────────────────
export interface HealthEntry {
  id: string;
  elderId: string;
  timestamp: string;
  type: HealthMetricType;
  value: number;
  unit: string;
  notes?: string;
}

export type HealthMetricType =
  | "blood_pressure_systolic"
  | "blood_pressure_diastolic"
  | "heart_rate"
  | "blood_glucose"
  | "weight"
  | "temperature"
  | "oxygen_saturation";

// ─── Emergency Contacts ─────────────────────────────────────────
export interface EmergencyContact {
  id: string;
  elderId: string;
  name: string;
  phone: string;
  relationship: string;
  priority: number; // 1 = first to call
  notifyOnMissedCheckin: boolean;
  notifyOnSOS: boolean;
}

// ─── Subscription ───────────────────────────────────────────────
export interface SubscriptionInfo {
  tier: SubscriptionTier;
  isActive: boolean;
  expiresAt?: string;
  productId?: string;
  platform?: "ios" | "android";
}

// ─── Navigation ─────────────────────────────────────────────────
export type RootStackParamList = {
  Onboarding: undefined;
  Login: undefined;
  RoleSelect: undefined;
  ElderTabs: undefined;
  FamilyTabs: undefined;
  Paywall: undefined;
  CustomerCenter: undefined;
  Settings: undefined;
  MedicationDetail: { medicationId: string };
  AddMedication: undefined;
  EditElderProfile: undefined;
  EmergencyContacts: undefined;
  HealthLog: undefined;
  CheckInHistory: undefined;
  Gamification: undefined;
  HealthReport: undefined;
  MedicalProfile: undefined;
};

export type ElderTabParamList = {
  CheckIn: undefined;
  Medications: undefined;
  SOS: undefined;
  ElderSettings: undefined;
};

export type FamilyTabParamList = {
  Dashboard: undefined;
  Contacts: undefined;
  FamilyMedications: undefined;
  FamilySettings: undefined;
};

// ─── Attribution / Analytics ────────────────────────────────────
export type ConversionEvent =
  | "app_install"
  | "registration_complete"
  | "first_checkin"
  | "first_medication_logged"
  | "wearable_connected"
  | "family_member_added"
  | "paywall_viewed"
  | "trial_started"
  | "subscription_started"
  | "subscription_renewed"
  | "subscription_cancelled"
  | "b2b_lead_generated";
