import React, { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";
import { AppProvider } from "./src/store/AppContext";
import { AppNavigator } from "./src/navigation/AppNavigator";
import { notificationService } from "./src/services/NotificationService";
import { revenueCatService } from "./src/services/RevenueCatService";
import { analyticsService } from "./src/services/AnalyticsService";
import { affiliateService } from "./src/services/AffiliateService";
import { healthIntegrationService } from "./src/services/HealthIntegrationService";
import { autoCheckinService } from "./src/services/AutoCheckinService";

export default function App() {
  useEffect(() => {
    // Initialize core services
    notificationService.initialize();
    revenueCatService.initialize();
    analyticsService.initialize();
    affiliateService.initialize();
    healthIntegrationService.initialize();
    autoCheckinService.initialize();

    // Handle notification responses (e.g., check-in button tapped)
    const responseSubscription =
      Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data as
          | Record<string, unknown>
          | undefined;
        const actionId = response.actionIdentifier;

        if (data?.type === "checkin") {
          if (actionId === "confirm") {
            console.log("[App] Check-in confirmed via notification");
          } else if (actionId === "help") {
            console.log("[App] Help requested via notification");
          }
        }

        if (data?.type === "fall_detected") {
          if (actionId === "im_ok") {
            console.log("[App] User confirmed OK after fall detection");
          } else if (actionId === "need_help") {
            console.log("[App] User needs help after fall detection");
          }
        }
      });

    return () => {
      responseSubscription.remove();
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppProvider>
          <StatusBar style="dark" />
          <AppNavigator />
        </AppProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
