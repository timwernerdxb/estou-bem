import React, { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, FONTS } from "../constants/theme";
import { useApp } from "../store/AppContext";
import {
  RootStackParamList,
  ElderTabParamList,
  FamilyTabParamList,
} from "../types";
import { startProfileSync, stopProfileSync } from "../services/ProfileSyncService";
import { notificationService } from "../services/NotificationService";

// Screens
import { OnboardingScreen } from "../screens/OnboardingScreen";
import { ElderHomeScreen } from "../screens/ElderHomeScreen";
import { MedicationsScreen } from "../screens/MedicationsScreen";
import { SOSScreen } from "../screens/SOSScreen";
import { FamilyDashboardScreen } from "../screens/FamilyDashboardScreen";
import { EmergencyContactsScreen } from "../screens/EmergencyContactsScreen";
import { HealthLogScreen } from "../screens/HealthLogScreen";
import { PaywallScreen } from "../screens/PaywallScreen";
import { CustomerCenterScreen } from "../screens/CustomerCenterScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { CheckInHistoryScreen } from "../screens/CheckInHistoryScreen";
import { GamificationScreen } from "../screens/GamificationScreen";
import { HealthReportScreen } from "../screens/HealthReportScreen";
import { MedicalProfileScreen } from "../screens/MedicalProfileScreen";
import { ElderDetailScreen } from "../screens/ElderDetailScreen";
import { MapScreen } from "../screens/MapScreen";

const Stack = createNativeStackNavigator<RootStackParamList>();
const ElderTab = createBottomTabNavigator<ElderTabParamList>();
const FamilyTab = createBottomTabNavigator<FamilyTabParamList>();

// ─── Elder Tab Navigator ─────────────────────────────────────
function ElderTabNavigator() {
  return (
    <ElderTab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: COLORS.tabBarActive,
        tabBarInactiveTintColor: COLORS.tabBarInactive,
        tabBarStyle: {
          height: 90,
          paddingBottom: 20,
          paddingTop: 10,
          backgroundColor: COLORS.tabBar,
          borderTopWidth: 0,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: "500",
          letterSpacing: 0.5,
          textTransform: "uppercase",
        },
      }}
    >
      <ElderTab.Screen
        name="CheckIn"
        component={ElderHomeScreen}
        options={{
          tabBarLabel: "Check-in",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="checkmark-circle" size={size + 4} color={color} />
          ),
        }}
      />
      <ElderTab.Screen
        name="Medications"
        component={MedicationsScreen}
        options={{
          tabBarLabel: "Remedios",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="medical" size={size + 4} color={color} />
          ),
        }}
      />
      <ElderTab.Screen
        name="SOS"
        component={SOSScreen}
        options={{
          tabBarLabel: "SOS",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="warning" size={size + 4} color={COLORS.danger} />
          ),
          tabBarLabelStyle: {
            fontSize: 12,
            fontWeight: "600",
            letterSpacing: 0.5,
            textTransform: "uppercase",
            color: COLORS.danger,
          },
        }}
      />
      <ElderTab.Screen
        name="ElderSettings"
        component={SettingsScreen}
        options={{
          tabBarLabel: "Config",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings" size={size + 4} color={color} />
          ),
        }}
      />
    </ElderTab.Navigator>
  );
}

// ─── Family Tab Navigator ────────────────────────────────────
function FamilyTabNavigator() {
  return (
    <FamilyTab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: COLORS.tabBarActive,
        tabBarInactiveTintColor: COLORS.tabBarInactive,
        tabBarStyle: {
          height: 80,
          paddingBottom: 16,
          paddingTop: 8,
          backgroundColor: COLORS.tabBar,
          borderTopWidth: 0,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "500",
          letterSpacing: 0.5,
          textTransform: "uppercase",
        },
      }}
    >
      <FamilyTab.Screen
        name="Dashboard"
        component={FamilyDashboardScreen}
        options={{
          tabBarLabel: "Painel",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="grid" size={size} color={color} />
          ),
        }}
      />
      <FamilyTab.Screen
        name="Contacts"
        component={EmergencyContactsScreen}
        options={{
          tabBarLabel: "Contatos",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people" size={size} color={color} />
          ),
        }}
      />
      <FamilyTab.Screen
        name="FamilyMedications"
        component={MedicationsScreen}
        options={{
          tabBarLabel: "Remedios",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="medical" size={size} color={color} />
          ),
        }}
      />
      <FamilyTab.Screen
        name="FamilySettings"
        component={SettingsScreen}
        options={{
          tabBarLabel: "Config",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings" size={size} color={color} />
          ),
        }}
      />
    </FamilyTab.Navigator>
  );
}

// ─── Root Navigator ──────────────────────────────────────────
export function AppNavigator() {
  const { state, dispatch } = useApp();

  // Start periodic profile sync when user is logged in
  useEffect(() => {
    if (state.isOnboarded && state.currentUser?.token) {
      startProfileSync(state.currentUser, dispatch);
    }
    return () => {
      stopProfileSync();
    };
  }, [state.isOnboarded, state.currentUser?.token]);

  // Register push token every time the user is logged in
  // This ensures family/caretaker users (who skip onboarding) also register their token
  useEffect(() => {
    if (state.isOnboarded && state.currentUser?.token) {
      notificationService.initialize(state.currentUser).catch(() => {});
    }
  }, [state.currentUser?.token]);

  if (state.isLoading) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: COLORS.background,
        }}
      >
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  const isElder = state.currentUser?.role === "elder";

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          animation: "slide_from_right",
        }}
      >
        {!state.isOnboarded ? (
          <Stack.Screen name="Onboarding" component={OnboardingScreen} />
        ) : isElder ? (
          <>
            <Stack.Screen name="ElderTabs" component={ElderTabNavigator} />
            <Stack.Screen
              name="Paywall"
              component={PaywallScreen}
              options={{ presentation: "modal" }}
            />
            <Stack.Screen
              name="CustomerCenter"
              component={CustomerCenterScreen}
              options={{ presentation: "modal" }}
            />
            <Stack.Screen name="Settings" component={SettingsScreen} />
            <Stack.Screen
              name="EmergencyContacts"
              component={EmergencyContactsScreen}
            />
            <Stack.Screen name="HealthLog" component={HealthLogScreen} />
            <Stack.Screen
              name="CheckInHistory"
              component={CheckInHistoryScreen}
            />
            <Stack.Screen name="Gamification" component={GamificationScreen} />
            <Stack.Screen name="HealthReport" component={HealthReportScreen} />
            <Stack.Screen name="MedicalProfile" component={MedicalProfileScreen} />
            <Stack.Screen name="MapScreen" component={MapScreen} />
          </>
        ) : (
          <>
            <Stack.Screen name="FamilyTabs" component={FamilyTabNavigator} />
            <Stack.Screen
              name="Paywall"
              component={PaywallScreen}
              options={{ presentation: "modal" }}
            />
            <Stack.Screen
              name="CustomerCenter"
              component={CustomerCenterScreen}
              options={{ presentation: "modal" }}
            />
            <Stack.Screen name="Settings" component={SettingsScreen} />
            <Stack.Screen
              name="EmergencyContacts"
              component={EmergencyContactsScreen}
            />
            <Stack.Screen name="HealthLog" component={HealthLogScreen} />
            <Stack.Screen
              name="CheckInHistory"
              component={CheckInHistoryScreen}
            />
            <Stack.Screen name="Gamification" component={GamificationScreen} />
            <Stack.Screen name="HealthReport" component={HealthReportScreen} />
            <Stack.Screen name="MedicalProfile" component={MedicalProfileScreen} />
            <Stack.Screen name="ElderDetail" component={ElderDetailScreen} />
            <Stack.Screen name="MapScreen" component={MapScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
