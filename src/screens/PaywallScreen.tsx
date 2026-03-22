import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import RevenueCatUI from "react-native-purchases-ui";
import { COLORS, FONTS, SPACING } from "../constants/theme";
import { useApp } from "../store/AppContext";
import { revenueCatService } from "../services/RevenueCatService";

export function PaywallScreen() {
  const navigation = useNavigation();
  const { dispatch } = useApp();
  const [loading, setLoading] = useState(false);

  const handlePresentPaywall = useCallback(async () => {
    if (!revenueCatService.isInitialized()) {
      Alert.alert(
        "Assinatura",
        "O servico de assinatura nao esta disponivel no momento. Tente novamente mais tarde.",
        [{ text: "OK" }]
      );
      return;
    }

    setLoading(true);
    try {
      const result = await RevenueCatUI.presentPaywall();

      // RevenueCatUI.presentPaywall() returns a PAYWALL_RESULT enum
      // Possible values: NOT_PRESENTED, PURCHASED, RESTORED, ERROR, CANCELLED
      if (
        result === "PURCHASED" ||
        result === "RESTORED"
      ) {
        // Refresh subscription status from RevenueCat
        const subscriptionInfo =
          await revenueCatService.getSubscriptionStatus();
        dispatch({ type: "SET_SUBSCRIPTION", payload: subscriptionInfo });

        Alert.alert(
          result === "PURCHASED"
            ? "Assinatura ativada!"
            : "Compra restaurada!",
          "Seu plano Estou Bem Pro esta ativo. Aproveite todos os recursos!",
          [{ text: "OK", onPress: () => navigation.goBack() }]
        );
      }
      // CANCELLED and NOT_PRESENTED need no action
    } catch (error: any) {
      console.error("[Paywall] Error presenting paywall:", error);
      Alert.alert(
        "Erro",
        "Nao foi possivel abrir a tela de assinatura. Tente novamente."
      );
    } finally {
      setLoading(false);
    }
  }, [dispatch, navigation]);

  const handlePresentPaywallIfNeeded = useCallback(async () => {
    if (!revenueCatService.isInitialized()) {
      // Fall back to always showing the paywall
      handlePresentPaywall();
      return;
    }

    setLoading(true);
    try {
      const result = await RevenueCatUI.presentPaywallIfNeeded({
        requiredEntitlementIdentifier: "estoubem Pro",
      });

      if (
        result === "PURCHASED" ||
        result === "RESTORED"
      ) {
        const subscriptionInfo =
          await revenueCatService.getSubscriptionStatus();
        dispatch({ type: "SET_SUBSCRIPTION", payload: subscriptionInfo });
        navigation.goBack();
      } else if (result === "NOT_PRESENTED") {
        // User already has the entitlement
        Alert.alert(
          "Voce ja e Pro!",
          "Seu plano Estou Bem Pro ja esta ativo."
        );
        navigation.goBack();
      }
    } catch (error: any) {
      console.error("[Paywall] Error:", error);
      handlePresentPaywall();
    } finally {
      setLoading(false);
    }
  }, [dispatch, navigation, handlePresentPaywall]);

  const handleRestore = useCallback(async () => {
    setLoading(true);
    try {
      const result = await revenueCatService.restorePurchases();
      dispatch({ type: "SET_SUBSCRIPTION", payload: result });
      if (result.tier !== "free") {
        Alert.alert("Restaurado!", "Seu plano Pro foi restaurado.", [
          { text: "OK", onPress: () => navigation.goBack() },
        ]);
      } else {
        Alert.alert("Info", "Nenhuma assinatura anterior encontrada.");
      }
    } catch {
      Alert.alert("Erro", "Nao foi possivel restaurar compras.");
    } finally {
      setLoading(false);
    }
  }, [dispatch, navigation]);

  // Auto-present the RevenueCat paywall on mount
  React.useEffect(() => {
    handlePresentPaywallIfNeeded();
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* Header with close button */}
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.closeBtn}
        >
          <Ionicons name="close" size={28} color={COLORS.textPrimary} />
        </TouchableOpacity>

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.loadingText}>Carregando...</Text>
          </View>
        ) : (
          <View style={styles.fallbackContainer}>
            <Ionicons
              name="shield-checkmark"
              size={64}
              color={COLORS.primary}
            />
            <Text style={styles.title}>Estou Bem Pro</Text>
            <Text style={styles.subtitle}>
              Monitoramento completo para a seguranca de quem voce ama
            </Text>

            <TouchableOpacity
              style={styles.primaryButton}
              onPress={handlePresentPaywall}
            >
              <Text style={styles.primaryButtonText}>Ver planos</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleRestore}
              style={styles.restoreBtn}
            >
              <Text style={styles.restoreText}>
                Restaurar compras anteriores
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { flex: 1, padding: SPACING.lg },
  closeBtn: {
    alignSelf: "flex-end",
    padding: SPACING.xs,
    zIndex: 10,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: SPACING.md,
  },
  loadingText: {
    ...FONTS.body,
    color: COLORS.textSecondary,
  },
  fallbackContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: SPACING.md,
    paddingHorizontal: SPACING.xl,
  },
  title: {
    ...FONTS.elderTitle,
    textAlign: "center",
    marginTop: SPACING.md,
  },
  subtitle: {
    ...FONTS.body,
    color: COLORS.textSecondary,
    textAlign: "center",
    marginBottom: SPACING.lg,
  },
  primaryButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xxl,
    borderRadius: 12,
    width: "100%",
    alignItems: "center",
  },
  primaryButtonText: {
    color: COLORS.white,
    fontSize: 18,
    fontWeight: "600",
  },
  restoreBtn: { marginTop: SPACING.lg },
  restoreText: {
    ...FONTS.caption,
    color: COLORS.primary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontSize: 12,
  },
});
