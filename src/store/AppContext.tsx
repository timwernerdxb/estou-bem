import React, { createContext, useContext, useReducer, useEffect, ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  User,
  ElderProfile,
  FamilyProfile,
  UserRole,
  SubscriptionTier,
  CheckIn,
  Medication,
  MedicationLog,
  HealthEntry,
  EmergencyContact,
  SubscriptionInfo,
} from "../types";

// ─── State ──────────────────────────────────────────────────────
export interface AppState {
  isLoading: boolean;
  isOnboarded: boolean;
  currentUser: User | null;
  elderProfile: ElderProfile | null;
  familyProfiles: FamilyProfile[];
  subscription: SubscriptionInfo;
  checkins: CheckIn[];
  medications: Medication[];
  medicationLogs: MedicationLog[];
  healthEntries: HealthEntry[];
  emergencyContacts: EmergencyContact[];
  checkinTimes: string[]; // HH:mm
}

const initialState: AppState = {
  isLoading: true,
  isOnboarded: false,
  currentUser: null,
  elderProfile: null,
  familyProfiles: [],
  subscription: { tier: "free", isActive: true },
  checkins: [],
  medications: [],
  medicationLogs: [],
  healthEntries: [],
  emergencyContacts: [],
  checkinTimes: ["09:00"],
};

// ─── Actions ────────────────────────────────────────────────────
type Action =
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_ONBOARDED"; payload: boolean }
  | { type: "SET_USER"; payload: User }
  | { type: "SET_ELDER_PROFILE"; payload: ElderProfile }
  | { type: "ADD_FAMILY_PROFILE"; payload: FamilyProfile }
  | { type: "REMOVE_FAMILY_PROFILE"; payload: string }
  | { type: "SET_SUBSCRIPTION"; payload: SubscriptionInfo }
  | { type: "ADD_CHECKIN"; payload: CheckIn }
  | { type: "UPDATE_CHECKIN"; payload: CheckIn }
  | { type: "ADD_MEDICATION"; payload: Medication }
  | { type: "UPDATE_MEDICATION"; payload: Medication }
  | { type: "REMOVE_MEDICATION"; payload: string }
  | { type: "ADD_MEDICATION_LOG"; payload: MedicationLog }
  | { type: "ADD_HEALTH_ENTRY"; payload: HealthEntry }
  | { type: "SET_EMERGENCY_CONTACTS"; payload: EmergencyContact[] }
  | { type: "ADD_EMERGENCY_CONTACT"; payload: EmergencyContact }
  | { type: "REMOVE_EMERGENCY_CONTACT"; payload: string }
  | { type: "SET_CHECKIN_TIMES"; payload: string[] }
  | { type: "RESTORE_STATE"; payload: Partial<AppState> }
  | { type: "LOGOUT" };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "SET_LOADING":
      return { ...state, isLoading: action.payload };
    case "SET_ONBOARDED":
      return { ...state, isOnboarded: action.payload };
    case "SET_USER":
      return { ...state, currentUser: action.payload };
    case "SET_ELDER_PROFILE":
      return { ...state, elderProfile: action.payload };
    case "ADD_FAMILY_PROFILE":
      return { ...state, familyProfiles: [...state.familyProfiles, action.payload] };
    case "REMOVE_FAMILY_PROFILE":
      return {
        ...state,
        familyProfiles: state.familyProfiles.filter((p) => p.id !== action.payload),
      };
    case "SET_SUBSCRIPTION":
      return { ...state, subscription: action.payload };
    case "ADD_CHECKIN":
      return { ...state, checkins: [action.payload, ...state.checkins] };
    case "UPDATE_CHECKIN":
      return {
        ...state,
        checkins: state.checkins.map((c) =>
          c.id === action.payload.id ? action.payload : c
        ),
      };
    case "ADD_MEDICATION":
      return { ...state, medications: [...state.medications, action.payload] };
    case "UPDATE_MEDICATION":
      return {
        ...state,
        medications: state.medications.map((m) =>
          m.id === action.payload.id ? action.payload : m
        ),
      };
    case "REMOVE_MEDICATION":
      return {
        ...state,
        medications: state.medications.filter((m) => m.id !== action.payload),
      };
    case "ADD_MEDICATION_LOG":
      return { ...state, medicationLogs: [action.payload, ...state.medicationLogs] };
    case "ADD_HEALTH_ENTRY":
      return { ...state, healthEntries: [action.payload, ...state.healthEntries] };
    case "SET_EMERGENCY_CONTACTS":
      return { ...state, emergencyContacts: action.payload };
    case "ADD_EMERGENCY_CONTACT":
      return {
        ...state,
        emergencyContacts: [...state.emergencyContacts, action.payload],
      };
    case "REMOVE_EMERGENCY_CONTACT":
      return {
        ...state,
        emergencyContacts: state.emergencyContacts.filter(
          (c) => c.id !== action.payload
        ),
      };
    case "SET_CHECKIN_TIMES":
      return { ...state, checkinTimes: action.payload };
    case "RESTORE_STATE":
      return { ...state, ...action.payload, isLoading: false };
    case "LOGOUT":
      return { ...initialState, isLoading: false, isOnboarded: false };
    default:
      return state;
  }
}

// ─── Context ────────────────────────────────────────────────────
interface AppContextType {
  state: AppState;
  dispatch: React.Dispatch<Action>;
}

const AppContext = createContext<AppContextType>({
  state: initialState,
  dispatch: () => {},
});

const STORAGE_KEY = "@estoubem_state";

const PERSISTED_KEYS: (keyof AppState)[] = [
  "isOnboarded",
  "currentUser",
  "elderProfile",
  "familyProfiles",
  "subscription",
  "checkins",
  "medications",
  "medicationLogs",
  "healthEntries",
  "emergencyContacts",
  "checkinTimes",
];

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  // Restore persisted state on mount
  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          dispatch({ type: "RESTORE_STATE", payload: parsed });
        } else {
          dispatch({ type: "SET_LOADING", payload: false });
        }
      } catch {
        dispatch({ type: "SET_LOADING", payload: false });
      }
    })();
  }, []);

  // Persist state on change
  useEffect(() => {
    if (state.isLoading) return;
    const toPersist: Record<string, unknown> = {};
    for (const key of PERSISTED_KEYS) {
      toPersist[key] = state[key];
    }
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(toPersist)).catch(() => {});
  }, [state]);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}

export function useSubscription() {
  const { state } = useApp();
  const tier = state.subscription.tier;
  return {
    tier,
    isActive: state.subscription.isActive,
    isFamilia: tier === "familia" || tier === "central",
    isCentral: tier === "central",
    isPaid: tier !== "free",
  };
}
