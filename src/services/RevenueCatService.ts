import { Platform } from "react-native";
import Purchases, {
  PurchasesPackage,
  CustomerInfo,
  LOG_LEVEL,
  PurchasesOffering,
} from "react-native-purchases";
import Constants from "expo-constants";
import { SubscriptionInfo, SubscriptionTier } from "../types";
import { ENTITLEMENTS, OFFERING_ID } from "../constants/subscriptions";

const APPLE_API_KEY =
  Constants.expoConfig?.extra?.revenueCatAppleApiKey || "";
const GOOGLE_API_KEY =
  Constants.expoConfig?.extra?.revenueCatGoogleApiKey || "";

class RevenueCatService {
  private initialized = false;

  async initialize(userId?: string): Promise<void> {
    if (this.initialized) return;

    const apiKey = Platform.OS === "ios" ? APPLE_API_KEY : GOOGLE_API_KEY;

    if (!apiKey || apiKey.includes("YOUR_KEY")) {
      console.warn(
        "[RevenueCat] No API key configured. Subscriptions will not work."
      );
      return;
    }

    Purchases.setLogLevel(LOG_LEVEL.DEBUG);
    await Purchases.configure({ apiKey, appUserID: userId });
    this.initialized = true;
  }

  async getOfferings(): Promise<PurchasesOffering | null> {
    if (!this.initialized) return null;
    try {
      const offerings = await Purchases.getOfferings();
      return offerings.current;
    } catch (error) {
      console.error("[RevenueCat] Error fetching offerings:", error);
      return null;
    }
  }

  async purchasePackage(pkg: PurchasesPackage): Promise<SubscriptionInfo | null> {
    if (!this.initialized) return null;
    try {
      const { customerInfo } = await Purchases.purchasePackage(pkg);
      return this.mapCustomerInfo(customerInfo);
    } catch (error: any) {
      if (error.userCancelled) {
        return null; // User cancelled — not an error
      }
      throw error;
    }
  }

  async restorePurchases(): Promise<SubscriptionInfo> {
    if (!this.initialized) {
      return { tier: "free", isActive: true };
    }
    try {
      const customerInfo = await Purchases.restorePurchases();
      return this.mapCustomerInfo(customerInfo);
    } catch {
      return { tier: "free", isActive: true };
    }
  }

  async getSubscriptionStatus(): Promise<SubscriptionInfo> {
    if (!this.initialized) {
      return { tier: "free", isActive: true };
    }
    try {
      const customerInfo = await Purchases.getCustomerInfo();
      return this.mapCustomerInfo(customerInfo);
    } catch {
      return { tier: "free", isActive: true };
    }
  }

  async setUserId(userId: string): Promise<void> {
    if (!this.initialized) return;
    try {
      await Purchases.logIn(userId);
    } catch (error) {
      console.error("[RevenueCat] Error setting user ID:", error);
    }
  }

  async logout(): Promise<void> {
    if (!this.initialized) return;
    try {
      await Purchases.logOut();
    } catch (error) {
      console.error("[RevenueCat] Error logging out:", error);
    }
  }

  private mapCustomerInfo(info: CustomerInfo): SubscriptionInfo {
    const hasCentral =
      info.entitlements.active[ENTITLEMENTS.central]?.isActive ?? false;
    const hasFamilia =
      info.entitlements.active[ENTITLEMENTS.familia]?.isActive ?? false;

    let tier: SubscriptionTier = "free";
    let expiresAt: string | undefined;
    let productId: string | undefined;

    if (hasCentral) {
      tier = "central";
      const ent = info.entitlements.active[ENTITLEMENTS.central];
      expiresAt = ent?.expirationDate ?? undefined;
      productId = ent?.productIdentifier;
    } else if (hasFamilia) {
      tier = "familia";
      const ent = info.entitlements.active[ENTITLEMENTS.familia];
      expiresAt = ent?.expirationDate ?? undefined;
      productId = ent?.productIdentifier;
    }

    return {
      tier,
      isActive: tier !== "free",
      expiresAt,
      productId,
      platform: Platform.OS === "ios" ? "ios" : "android",
    };
  }
}

export const revenueCatService = new RevenueCatService();
