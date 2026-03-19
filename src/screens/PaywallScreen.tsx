import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { PurchasesPackage } from "react-native-purchases";
import { COLORS, FONTS, SPACING, RADIUS, SHADOWS } from "../constants/theme";
import { PLANS, PlanDetails, OFFERING_ID } from "../constants/subscriptions";
import { useApp, useSubscription } from "../store/AppContext";
import { revenueCatService } from "../services/RevenueCatService";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { SubscriptionTier } from "../types";

export function PaywallScreen() {
  const navigation = useNavigation();
  const { dispatch } = useApp();
  const { tier: currentTier } = useSubscription();
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionTier>("familia");
  const [packages, setPackages] = useState<PurchasesPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);

  useEffect(() => {
    loadOfferings();
  }, []);

  const loadOfferings = async () => {
    try {
      const offering = await revenueCatService.getOfferings();
      if (offering?.availablePackages) {
        setPackages(offering.availablePackages);
      }
    } catch (error) {
      console.warn("[Paywall] Could not load offerings:", error);
    } finally {
      setLoading(false);
    }
  };

  const handlePurchase = async () => {
    const plan = PLANS.find((p) => p.tier === selectedPlan);
    if (!plan || plan.tier === "free") return;

    // Find matching RevenueCat package
    const pkg = packages.find(
      (p) =>
        p.product.identifier === plan.productIdIOS ||
        p.product.identifier === plan.productIdAndroid
    );

    if (!pkg) {
      // Fallback: if RevenueCat isn't configured, show info
      Alert.alert(
        "Assinatura",
        `Para assinar o plano ${plan.name} (${plan.price}), configure suas chaves RevenueCat no app.config.ts.\n\nEm produção, o pagamento será processado pela App Store / Google Play.`,
        [
          { text: "OK" },
          {
            text: "Simular assinatura",
            onPress: () => {
              dispatch({
                type: "SET_SUBSCRIPTION",
                payload: {
                  tier: selectedPlan,
                  isActive: true,
                  productId: plan.productIdIOS,
                },
              });
              navigation.goBack();
            },
          },
        ]
      );
      return;
    }

    setPurchasing(true);
    try {
      const result = await revenueCatService.purchasePackage(pkg);
      if (result) {
        dispatch({ type: "SET_SUBSCRIPTION", payload: result });
        Alert.alert(
          "🎉 Assinatura ativada!",
          `Seu plano ${plan.name} está ativo.`,
          [{ text: "OK", onPress: () => navigation.goBack() }]
        );
      }
    } catch (error: any) {
      Alert.alert("Erro", error.message || "Não foi possível completar a assinatura.");
    } finally {
      setPurchasing(false);
    }
  };

  const handleRestore = async () => {
    setLoading(true);
    try {
      const result = await revenueCatService.restorePurchases();
      dispatch({ type: "SET_SUBSCRIPTION", payload: result });
      if (result.tier !== "free") {
        Alert.alert("✅ Restaurado!", `Plano ${result.tier} restaurado.`);
      } else {
        Alert.alert("Info", "Nenhuma assinatura anterior encontrada.");
      }
    } catch {
      Alert.alert("Erro", "Não foi possível restaurar compras.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.closeBtn}
          >
            <Ionicons name="close" size={28} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>Escolha seu plano</Text>
          <Text style={styles.subtitle}>
            Proteja quem você ama com o plano ideal
          </Text>
        </View>

        {/* Plan Cards */}
        {PLANS.map((plan) => (
          <PlanCard
            key={plan.tier}
            plan={plan}
            isSelected={selectedPlan === plan.tier}
            isCurrent={currentTier === plan.tier}
            onSelect={() => setSelectedPlan(plan.tier)}
          />
        ))}

        {/* Purchase Button */}
        {selectedPlan !== "free" && selectedPlan !== currentTier && (
          <Button
            title={
              purchasing
                ? "Processando..."
                : `Assinar ${PLANS.find((p) => p.tier === selectedPlan)?.name}`
            }
            onPress={handlePurchase}
            size="elder"
            loading={purchasing}
            disabled={purchasing}
            style={{ marginTop: SPACING.lg, width: "100%" }}
          />
        )}

        {/* Restore */}
        <TouchableOpacity
          onPress={handleRestore}
          style={styles.restoreBtn}
        >
          <Text style={styles.restoreText}>Restaurar compras anteriores</Text>
        </TouchableOpacity>

        {/* Legal */}
        <Text style={styles.legal}>
          A assinatura será cobrada na sua conta do{" "}
          {Platform.OS === "ios" ? "iTunes" : "Google Play"} na confirmação da
          compra. A assinatura renova automaticamente a menos que a renovação
          automática seja desativada pelo menos 24 horas antes do final do
          período atual. O valor da renovação será cobrado nas 24 horas
          anteriores ao final do período atual.
        </Text>
        <View style={styles.legalLinks}>
          <TouchableOpacity>
            <Text style={styles.legalLink}>Termos de Uso</Text>
          </TouchableOpacity>
          <Text style={styles.legalSeparator}>|</Text>
          <TouchableOpacity>
            <Text style={styles.legalLink}>Política de Privacidade</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// Plan Card Component
function PlanCard({
  plan,
  isSelected,
  isCurrent,
  onSelect,
}: {
  plan: PlanDetails;
  isSelected: boolean;
  isCurrent: boolean;
  onSelect: () => void;
}) {
  return (
    <TouchableOpacity onPress={onSelect} activeOpacity={0.8}>
      <Card
        style={{
          ...styles.planCard,
          ...(isSelected ? styles.planCardSelected : {}),
          ...(plan.highlighted ? styles.planCardHighlighted : {}),
        }}
      >
        {plan.highlighted && (
          <View style={styles.popularBadge}>
            <Text style={styles.popularText}>MAIS POPULAR</Text>
          </View>
        )}

        {isCurrent && (
          <View style={styles.currentBadge}>
            <Text style={styles.currentText}>PLANO ATUAL</Text>
          </View>
        )}

        <View style={styles.planHeader}>
          <Text style={styles.planName}>{plan.name}</Text>
          <Text style={styles.planPrice}>{plan.price}</Text>
        </View>

        <Text style={styles.planDesc}>{plan.description}</Text>

        <View style={styles.featureList}>
          {plan.features.map((feature, i) => (
            <View key={i} style={styles.featureRow}>
              <Ionicons
                name={feature.included ? "checkmark-circle" : "close-circle"}
                size={18}
                color={feature.included ? COLORS.success : COLORS.disabled}
              />
              <Text
                style={[
                  styles.featureText,
                  !feature.included && styles.featureDisabled,
                ]}
              >
                {feature.text}
              </Text>
            </View>
          ))}
        </View>
      </Card>
    </TouchableOpacity>
  );
}

import { Platform } from "react-native";

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.md },
  header: { alignItems: "center", marginBottom: SPACING.lg },
  closeBtn: { alignSelf: "flex-end", padding: SPACING.xs },
  title: { ...FONTS.elderTitle, textAlign: "center" },
  subtitle: {
    ...FONTS.body,
    color: COLORS.textSecondary,
    textAlign: "center",
    marginTop: SPACING.xs,
  },
  planCard: {
    marginBottom: SPACING.md,
    borderWidth: 2,
    borderColor: "transparent",
    position: "relative",
    overflow: "visible",
  },
  planCardSelected: { borderColor: COLORS.primary },
  planCardHighlighted: { borderColor: COLORS.primary },
  popularBadge: {
    position: "absolute",
    top: -12,
    right: SPACING.md,
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.full,
  },
  popularText: { color: COLORS.white, fontSize: 11, fontWeight: "700" },
  currentBadge: {
    position: "absolute",
    top: -12,
    left: SPACING.md,
    backgroundColor: COLORS.success,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.full,
  },
  currentText: { color: COLORS.white, fontSize: 11, fontWeight: "700" },
  planHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: SPACING.xs,
  },
  planName: { ...FONTS.title },
  planPrice: { ...FONTS.subtitle, color: COLORS.primary },
  planDesc: { ...FONTS.caption, marginBottom: SPACING.md },
  featureList: { gap: SPACING.xs },
  featureRow: { flexDirection: "row", alignItems: "center", gap: SPACING.xs },
  featureText: { ...FONTS.caption, flex: 1 },
  featureDisabled: { color: COLORS.disabled },
  restoreBtn: { alignItems: "center", marginTop: SPACING.lg },
  restoreText: { ...FONTS.caption, color: COLORS.primary },
  legal: {
    ...FONTS.small,
    textAlign: "center",
    marginTop: SPACING.xl,
    lineHeight: 18,
  },
  legalLinks: {
    flexDirection: "row",
    justifyContent: "center",
    gap: SPACING.sm,
    marginTop: SPACING.sm,
    marginBottom: SPACING.xxl,
  },
  legalLink: { ...FONTS.small, color: COLORS.primary },
  legalSeparator: { ...FONTS.small },
});
