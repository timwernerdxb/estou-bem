import AsyncStorage from "@react-native-async-storage/async-storage";
import { analyticsService } from "./AnalyticsService";

// Affiliate channel types
export type AffiliateChannel =
  | "influencer"
  | "paid_media"
  | "ad_network"
  | "organic"
  | "referral"
  | "b2b_partner";

export interface AffiliateInfo {
  code: string;
  channel: AffiliateChannel;
  partnerId: string;
  partnerName?: string;
  campaignId?: string;
  clickedAt: string;
}

export interface ReferralInfo {
  referrerUserId: string;
  referrerName: string;
  code: string;
  referredAt: string;
}

// Commission rates by channel and event
const COMMISSION_RATES: Record<AffiliateChannel, Record<string, number>> = {
  influencer: {
    registration: 0,
    trial_started: 5.0,      // R$5 per trial
    subscription_familia: 15.0, // R$15 per Familia subscription
    subscription_central: 25.0, // R$25 per Central subscription
    recurring_monthly: 0.10,    // 10% recurring
  },
  paid_media: {
    registration: 0,
    trial_started: 3.0,
    subscription_familia: 10.0,
    subscription_central: 18.0,
    recurring_monthly: 0.05,
  },
  ad_network: {
    registration: 2.0,
    trial_started: 4.0,
    subscription_familia: 12.0,
    subscription_central: 20.0,
    recurring_monthly: 0.08,
  },
  organic: {
    registration: 0,
    trial_started: 0,
    subscription_familia: 0,
    subscription_central: 0,
    recurring_monthly: 0,
  },
  referral: {
    registration: 0,
    trial_started: 0,
    subscription_familia: 10.0,
    subscription_central: 15.0,
    recurring_monthly: 0.05,
  },
  b2b_partner: {
    registration: 0,
    trial_started: 0,
    subscription_familia: 20.0,
    subscription_central: 35.0,
    recurring_monthly: 0.15,
  },
};

const API_BASE = "https://estou-bem-web-production.up.railway.app";

const AFFILIATE_STORAGE_KEY = "@estoubem_affiliate";
const REFERRAL_STORAGE_KEY = "@estoubem_referral";

class AffiliateService {
  private affiliateInfo: AffiliateInfo | null = null;
  private referralInfo: ReferralInfo | null = null;

  async initialize(): Promise<void> {
    try {
      const [afStr, refStr] = await Promise.all([
        AsyncStorage.getItem(AFFILIATE_STORAGE_KEY),
        AsyncStorage.getItem(REFERRAL_STORAGE_KEY),
      ]);
      if (afStr) this.affiliateInfo = JSON.parse(afStr);
      if (refStr) this.referralInfo = JSON.parse(refStr);
    } catch (err) {
      console.warn("[Affiliate] Load error:", err);
    }
  }

  // ─── Process deep link or referral code ─────────────────────
  async processAffiliateLink(params: Record<string, string>): Promise<void> {
    const code = params.ref || params.affiliate || params.af_sub1;
    const channel = (params.channel || "organic") as AffiliateChannel;
    const partnerId = params.partner_id || params.af_siteid || code || "";
    const campaignId = params.campaign_id || params.af_adset_id;

    if (!code) return;

    this.affiliateInfo = {
      code,
      channel,
      partnerId,
      partnerName: params.partner_name,
      campaignId,
      clickedAt: new Date().toISOString(),
    };

    await AsyncStorage.setItem(
      AFFILIATE_STORAGE_KEY,
      JSON.stringify(this.affiliateInfo)
    );

    analyticsService.trackCustomEvent("af_affiliate_click", {
      code,
      channel,
      partner_id: partnerId,
      campaign_id: campaignId || "",
    });
  }

  // ─── Process user-to-user referral ──────────────────────────
  async processReferralCode(
    code: string,
    referrerUserId: string,
    referrerName: string
  ): Promise<void> {
    this.referralInfo = {
      referrerUserId,
      referrerName,
      code,
      referredAt: new Date().toISOString(),
    };

    await AsyncStorage.setItem(
      REFERRAL_STORAGE_KEY,
      JSON.stringify(this.referralInfo)
    );

    analyticsService.trackCustomEvent("af_referral_used", {
      code,
      referrer_id: referrerUserId,
    });
  }

  // ─── Generate referral code for user ────────────────────────
  generateReferralCode(userId: string): string {
    // 6-char alphanumeric code derived from user ID
    const hash = userId
      .split("")
      .reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
    return "EB" + Math.abs(hash).toString(36).toUpperCase().slice(0, 4);
  }

  // ─── Calculate commission for a conversion event ────────────
  calculateCommission(
    event: string,
    channel?: AffiliateChannel
  ): { amount: number; channel: AffiliateChannel } | null {
    const ch = channel || this.affiliateInfo?.channel || "organic";
    const rates = COMMISSION_RATES[ch];
    if (!rates || !rates[event]) return null;

    return {
      amount: rates[event],
      channel: ch,
    };
  }

  // ─── Report conversion to backend for commission tracking ───
  async reportConversion(
    event: string,
    userId: string,
    revenue: number = 0
  ): Promise<void> {
    const affiliate = this.affiliateInfo;
    const referral = this.referralInfo;

    if (!affiliate && !referral) return;

    const payload = {
      event,
      userId,
      revenue,
      timestamp: new Date().toISOString(),
      affiliate: affiliate
        ? {
            code: affiliate.code,
            channel: affiliate.channel,
            partnerId: affiliate.partnerId,
            campaignId: affiliate.campaignId,
          }
        : null,
      referral: referral
        ? {
            referrerUserId: referral.referrerUserId,
            code: referral.code,
          }
        : null,
    };

    // Send to backend for commission calculation
    try {
      await fetch(`${API_BASE}/api/conversions/track`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event,
          revenue,
          affiliate_code: affiliate?.code,
          affiliate_channel: affiliate?.channel,
          partner_id: affiliate?.partnerId,
          campaign_id: affiliate?.campaignId,
          referrer_user_id: referral?.referrerUserId,
          metadata: { userId, timestamp: new Date().toISOString() },
        }),
      });

      analyticsService.trackCustomEvent("af_conversion_reported", {
        event,
        channel: affiliate?.channel || "referral",
        commission:
          this.calculateCommission(event, affiliate?.channel)?.amount || 0,
      });
    } catch (err) {
      console.warn("[Affiliate] Report error:", err);
    }
  }

  // ─── Get attribution summary ────────────────────────────────
  getAttribution(): {
    affiliate: AffiliateInfo | null;
    referral: ReferralInfo | null;
  } {
    return {
      affiliate: this.affiliateInfo,
      referral: this.referralInfo,
    };
  }

  getCommissionRates(): typeof COMMISSION_RATES {
    return COMMISSION_RATES;
  }
}

export const affiliateService = new AffiliateService();
