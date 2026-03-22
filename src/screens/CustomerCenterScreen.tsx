import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import RevenueCatUI from "react-native-purchases-ui";
import { COLORS, FONTS, SPACING } from "../constants/theme";
import { useApp } from "../store/AppContext";
import { revenueCatService } from "../services/RevenueCatService";

/**
 * CustomerCenterScreen presents the RevenueCat Customer Center UI,
 * which allows users to manage their subscription (cancel, change plan,
 * request refund, etc.) without leaving the app.
 */
export function CustomerCenterScreen() {
  const navigation = useNavigation();
  const { dispatch } = useApp();
  const [loading, setLoading] = useState(false);

  const handlePresentCustomerCenter = useCallback(async () => {
    if (!revenueCatService.isInitialized()) {
      Alert.alert(
        "Indisponivel",
        "O servico de assinatura nao esta disponivel no momento."
      );
      return;
    }

    setLoading(true);
    try {
      await RevenueCatUI.presentCustomerCenter();

      // After the customer center closes, refresh subscription status
      const subscriptionInfo =
        await revenueCatService.getSubscriptionStatus();
      dispatch({ type: "SET_SUBSCRIPTION", payload: subscriptionInfo });
    } catch (error: any) {
      console.error("[CustomerCenter] Error:", error);
      Alert.alert(
        "Erro",
        "Nao foi possivel abrir a central do assinante. Tente novamente."
      );
    } finally {
      setLoading(false);
    }
  }, [dispatch]);

  // Auto-present on mount
  React.useEffect(() => {
    handlePresentCustomerCenter();
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.closeBtn}
        >
          <Ionicons name="close" size={28} color={COLORS.textPrimary} />
        </TouchableOpacity>

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.loadingText}>
              Abrindo central do assinante...
            </Text>
          </View>
        ) : (
          <View style={styles.fallbackContainer}>
            <Ionicons name="person-circle" size={64} color={COLORS.primary} />
            <Text style={styles.title}>Central do Assinante</Text>
            <Text style={styles.subtitle}>
              Gerencie sua assinatura, altere seu plano ou solicite
              reembolso.
            </Text>

            <TouchableOpacity
              style={styles.primaryButton}
              onPress={handlePresentCustomerCenter}
            >
              <Text style={styles.primaryButtonText}>
                Abrir central do assinante
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
});
