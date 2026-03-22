import { Platform } from "react-native";
import Constants from "expo-constants";
import { ConversionEvent, SubscriptionTier } from "../types";

// AppsFlyer event names mapped to our conversion events
const AF_EVENT_MAP: Record<ConversionEvent, string> = {
  app_install: "af_install",
  registration_complete: "af_complete_registration",
  first_checkin: "af_first_checkin",
  first_medication_logged: "af_first_medication",
  wearable_connected: "af_wearable_connected",
  family_member_added: "af_family_added",
  paywall_viewed: "af_paywall_viewed",
  trial_started: "af_start_trial",
  subscription_started: "af_subscribe",
  subscription_renewed: "af_subscription_renewed",
  subscription_cancelled: "af_subscription_cancelled",
  b2b_lead_generated: "af_b2b_lead",
};

interface EventParams {
  [key: string]: string | number | boolean;
}

class AnalyticsService {
  private appsFlyer: any = null;
  private initialized = false;
  private pendingEvents: Array<{ event: string; params: EventParams }> = [];
  private userId: string | null = null;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const appsflyerModule = require("react-native-appsflyer");
      const appsFlyer = appsflyerModule.default || appsflyerModule;

      const devKey =
        Constants.expoConfig?.extra?.appsflyerDevKey || "YOUR_APPSFLYER_DEV_KEY";
      const appId =
        Constants.expoConfig?.extra?.appsflyerAppId || "YOUR_APP_ID";

      if (devKey === "YOUR_APPSFLYER_DEV_KEY") {
        console.log("[Analytics] AppsFlyer dev key not set, running in debug mode");
        this.initialized = true;
        this.flushPendingEvents();
        return;
      }

      await appsFlyer.initSdk({
        devKey,
        isDebug: __DEV__,
        appId: Platform.OS === "ios" ? appId : undefined,
        onInstallConversionDataListener: true,
        onDeepLinkListener: true,
        timeToWaitForATTUserAuthorization: 10,
      });

      this.appsFlyer = appsFlyer;
      this.initialized = true;
      console.log("[Analytics] AppsFlyer initialized");

      // Listen for attribution data
      appsFlyer.onInstallConversionData((data: any) => {
        console.log("[Analytics] Attribution:", JSON.stringify(data));
      });

      appsFlyer.onDeepLink((data: any) => {
        console.log("[Analytics] DeepLink:", JSON.stringify(data));
      });

      this.flushPendingEvents();
    } catch (err) {
      console.warn("[Analytics] AppsFlyer not available, using debug mode:", err);
      this.initialized = true;
      this.flushPendingEvents();
    }
  }

  setUserId(userId: string): void {
    this.userId = userId;
    if (this.appsFlyer) {
      this.appsFlyer.setCustomerUserId(userId);
    }
  }

  // ─── Track conversion event ─────────────────────────────────
  trackEvent(event: ConversionEvent, params: EventParams = {}): void {
    const afEvent = AF_EVENT_MAP[event] || event;
    const enrichedParams = {
      ...params,
      platform: Platform.OS,
      app_version: Constants.expoConfig?.version || "1.0.0",
      timestamp: new Date().toISOString(),
      ...(this.userId ? { user_id: this.userId } : {}),
    };

    if (!this.initialized) {
      this.pendingEvents.push({ event: afEvent, params: enrichedParams });
      return;
    }

    this.sendEvent(afEvent, enrichedParams);
  }

  // ─── Track custom event (non-conversion) ────────────────────
  trackCustomEvent(eventName: string, params: EventParams = {}): void {
    const enrichedParams = {
      ...params,
      platform: Platform.OS,
      timestamp: new Date().toISOString(),
    };

    if (!this.initialized) {
      this.pendingEvents.push({ event: eventName, params: enrichedParams });
      return;
    }

    this.sendEvent(eventName, enrichedParams);
  }

  // ─── Revenue tracking ──────────────────────────────────────
  trackRevenue(
    event: ConversionEvent,
    revenue: number,
    currency: string = "BRL",
    params: EventParams = {}
  ): void {
    this.trackEvent(event, {
      ...params,
      af_revenue: revenue,
      af_currency: currency,
    });
  }

  // ─── Subscription tracking ─────────────────────────────────
  trackSubscription(tier: SubscriptionTier, action: "started" | "renewed" | "cancelled"): void {
    const eventMap = {
      started: "subscription_started" as ConversionEvent,
      renewed: "subscription_renewed" as ConversionEvent,
      cancelled: "subscription_cancelled" as ConversionEvent,
    };

    const priceMap: Record<SubscriptionTier, number> = {
      free: 0,
      pro: 49.9,
    };

    this.trackEvent(eventMap[action], {
      af_content_type: "subscription",
      af_content_id: tier,
      af_revenue: action === "cancelled" ? 0 : priceMap[tier],
      af_currency: "BRL",
    });
  }

  // ─── Paywall tracking ──────────────────────────────────────
  trackPaywallViewed(source: string = "settings"): void {
    this.trackEvent("paywall_viewed", { source });
  }

  // ─── Check-in tracking ─────────────────────────────────────
  trackCheckin(isFirst: boolean, source: "manual" | "auto" | "medication" | "wearable"): void {
    this.trackCustomEvent("af_checkin", { source, is_first: isFirst });
    if (isFirst) {
      this.trackEvent("first_checkin", { source });
    }
  }

  // ─── Attribution data for affiliate system ──────────────────
  async getAttributionData(): Promise<Record<string, unknown> | null> {
    if (!this.appsFlyer) return null;
    try {
      return await new Promise((resolve) => {
        this.appsFlyer.onInstallConversionData((data: any) => {
          resolve(data?.data || null);
        });
        // Timeout after 5 seconds
        setTimeout(() => resolve(null), 5000);
      });
    } catch {
      return null;
    }
  }

  // ─── Postback URL configuration helper ──────────────────────
  getPostbackConfig(): Record<string, string> {
    return {
      install_postback: "https://YOUR_SERVER/api/postback/install?clickid={clickid}&af_siteid={af_siteid}",
      event_postback: "https://YOUR_SERVER/api/postback/event?clickid={clickid}&event={event_name}&revenue={revenue}",
      // Ad network postback URLs
      facebook: "https://www.facebook.com/tr?id={fb_pixel_id}&ev={event_name}",
      google: "https://www.googleadservices.com/pagead/conversion/{conversion_id}/?value={revenue}&currency=BRL",
    };
  }

  private sendEvent(eventName: string, params: EventParams): void {
    if (this.appsFlyer) {
      this.appsFlyer.logEvent(eventName, params);
    }

    if (__DEV__) {
      console.log(`[Analytics] ${eventName}:`, JSON.stringify(params));
    }
  }

  private flushPendingEvents(): void {
    for (const { event, params } of this.pendingEvents) {
      this.sendEvent(event, params);
    }
    this.pendingEvents = [];
  }
}

export const analyticsService = new AnalyticsService();
