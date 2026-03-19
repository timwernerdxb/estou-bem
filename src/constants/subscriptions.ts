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
  description: string;
  features: PlanFeature[];
  productIdIOS: string;
  productIdAndroid: string;
  entitlementId: string;
  highlighted?: boolean;
}

export const PLANS: PlanDetails[] = [
  {
    tier: "free",
    name: "Gratuito",
    nameEn: "Free",
    price: "R$ 0",
    priceValue: 0,
    period: "",
    description: "Check-in básico para sua tranquilidade",
    entitlementId: "",
    productIdIOS: "",
    productIdAndroid: "",
    features: [
      { text: "1 check-in diário", included: true },
      { text: "Alarme de lembrete", included: true },
      { text: "Notificação para até 3 familiares", included: true },
      { text: "Botão de SOS", included: true },
      { text: "Histórico de 7 dias", included: true },
      { text: "Múltiplos check-ins por dia", included: false },
      { text: "Integração com medicamentos", included: false },
      { text: "Detecção passiva (sensores)", included: false },
      { text: "GPS e geofencing", included: false },
      { text: "Central de atendimento 24h", included: false },
      { text: "Telemedicina", included: false },
    ],
  },
  {
    tier: "familia",
    name: "Família",
    nameEn: "Family",
    price: "R$ 49,90/mês",
    priceValue: 4990,
    period: "mês",
    description: "Monitoramento completo para a família",
    highlighted: true,
    entitlementId: "familia",
    productIdIOS: "com.estoubem.familia.monthly",
    productIdAndroid: "com.estoubem.familia.monthly",
    features: [
      { text: "Até 3 check-ins por dia", included: true },
      { text: "Alarme de lembrete", included: true },
      { text: "Familiares ilimitados", included: true },
      { text: "Botão de SOS", included: true },
      { text: "Histórico ilimitado", included: true },
      { text: "Integração com medicamentos", included: true },
      { text: "Controle de estoque de remédios", included: true },
      { text: "Detecção passiva (acelerômetro + wearable)", included: true },
      { text: "GPS e geofencing", included: true },
      { text: "Dashboard familiar completo", included: true },
      { text: "Central de atendimento 24h", included: false },
      { text: "Telemedicina", included: false },
    ],
  },
  {
    tier: "central",
    name: "Central",
    nameEn: "Central",
    price: "R$ 89,90/mês",
    priceValue: 8990,
    period: "mês",
    description: "Proteção total com central humana 24h",
    entitlementId: "central",
    productIdIOS: "com.estoubem.central.monthly",
    productIdAndroid: "com.estoubem.central.monthly",
    features: [
      { text: "Até 5 check-ins por dia", included: true },
      { text: "Alarme de lembrete", included: true },
      { text: "Familiares ilimitados", included: true },
      { text: "Botão de SOS", included: true },
      { text: "Histórico ilimitado", included: true },
      { text: "Integração com medicamentos", included: true },
      { text: "Controle de estoque de remédios", included: true },
      { text: "Detecção passiva (acelerômetro + wearable)", included: true },
      { text: "GPS e geofencing", included: true },
      { text: "Dashboard familiar completo", included: true },
      { text: "Central de atendimento humana 24h", included: true },
      { text: "Telemedicina integrada", included: true },
      { text: "Acionamento SAMU com GPS", included: true },
      { text: "Relatório mensal de saúde", included: true },
    ],
  },
];

// RevenueCat offering identifier
export const OFFERING_ID = "default";

// Entitlement identifiers in RevenueCat
export const ENTITLEMENTS = {
  familia: "familia",
  central: "central",
} as const;
