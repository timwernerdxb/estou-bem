import { SubscriptionTier } from "../types";

export interface PlanFeature {
  text: string;
  included: boolean;
}

export interface PlanDetails {
  tier: SubscriptionTier;
  name: string;
  nameEn: string;
  price: string;
  priceValue: number; // BRL cents
  period: string;
  periodKey: "monthly" | "yearly" | "lifetime" | "";
  description: string;
  features: PlanFeature[];
  productIdIOS: string;
  productIdAndroid: string;
  entitlementId: string;
  highlighted?: boolean;
  savingsLabel?: string;
}

// RevenueCat entitlement identifier
export const ENTITLEMENT_ID = "estoubem Pro";

// RevenueCat offering identifier
export const OFFERING_ID = "default";

// Legacy entitlements mapping (kept for migration)
export const ENTITLEMENTS = {
  pro: "estoubem Pro",
} as const;

// Product identifiers (must match RevenueCat dashboard)
export const PRODUCT_IDS = {
  monthlyIOS: "com.estoubem.pro.monthly",
  yearlyIOS: "com.estoubem.pro.yearly",
  lifetimeIOS: "com.estoubem.pro.lifetime",
  monthlyAndroid: "com.estoubem.pro.monthly",
  yearlyAndroid: "com.estoubem.pro.yearly",
  lifetimeAndroid: "com.estoubem.pro.lifetime",
} as const;

export const PRO_FEATURES: PlanFeature[] = [
  { text: "Check-ins ilimitados por dia", included: true },
  { text: "Alarme de lembrete", included: true },
  { text: "Familiares ilimitados", included: true },
  { text: "Botao de SOS", included: true },
  { text: "Historico ilimitado", included: true },
  { text: "Integracao com medicamentos", included: true },
  { text: "Controle de estoque de remedios", included: true },
  { text: "Deteccao passiva (acelerometro + wearable)", included: true },
  { text: "GPS e geofencing", included: true },
  { text: "Dashboard familiar completo", included: true },
  { text: "Apple Watch companion app", included: true },
];

export const FREE_FEATURES: PlanFeature[] = [
  { text: "1 check-in diario", included: true },
  { text: "Alarme de lembrete", included: true },
  { text: "Notificacao para ate 3 familiares", included: true },
  { text: "Botao de SOS", included: true },
  { text: "Historico de 7 dias", included: true },
  { text: "Multiplos check-ins por dia", included: false },
  { text: "Integracao com medicamentos", included: false },
  { text: "Deteccao passiva (sensores)", included: false },
  { text: "GPS e geofencing", included: false },
];

export const PLANS: PlanDetails[] = [
  {
    tier: "free",
    name: "Gratuito",
    nameEn: "Free",
    price: "R$ 0",
    priceValue: 0,
    period: "",
    periodKey: "",
    description: "Check-in basico para sua tranquilidade",
    entitlementId: "",
    productIdIOS: "",
    productIdAndroid: "",
    features: FREE_FEATURES,
  },
  {
    tier: "pro",
    name: "Pro Mensal",
    nameEn: "Pro Monthly",
    price: "R$ 49,90/mes",
    priceValue: 4990,
    period: "mes",
    periodKey: "monthly",
    description: "Monitoramento completo para a familia",
    highlighted: true,
    entitlementId: ENTITLEMENT_ID,
    productIdIOS: PRODUCT_IDS.monthlyIOS,
    productIdAndroid: PRODUCT_IDS.monthlyAndroid,
    features: PRO_FEATURES,
  },
  {
    tier: "pro",
    name: "Pro Anual",
    nameEn: "Pro Yearly",
    price: "R$ 399,90/ano",
    priceValue: 39990,
    period: "ano",
    periodKey: "yearly",
    description: "Economize 33% com o plano anual",
    savingsLabel: "Economize 33%",
    entitlementId: ENTITLEMENT_ID,
    productIdIOS: PRODUCT_IDS.yearlyIOS,
    productIdAndroid: PRODUCT_IDS.yearlyAndroid,
    features: PRO_FEATURES,
  },
  {
    tier: "pro",
    name: "Pro Vitalicio",
    nameEn: "Pro Lifetime",
    price: "R$ 999,90",
    priceValue: 99990,
    period: "unico",
    periodKey: "lifetime",
    description: "Pague uma vez, use para sempre",
    savingsLabel: "Melhor valor",
    entitlementId: ENTITLEMENT_ID,
    productIdIOS: PRODUCT_IDS.lifetimeIOS,
    productIdAndroid: PRODUCT_IDS.lifetimeAndroid,
    features: PRO_FEATURES,
  },
];
