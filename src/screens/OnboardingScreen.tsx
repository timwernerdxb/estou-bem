import React, { useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  FlatList,
  TouchableOpacity,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { COLORS, FONTS, SPACING, RADIUS, SCREEN } from "../constants/theme";
import { useApp } from "../store/AppContext";
import { Button } from "../components/Button";
import { UserRole, ElderProfile, FamilyProfile, RootStackParamList } from "../types";
import { notificationService } from "../services/NotificationService";
import { checkInService } from "../services/CheckInService";
import { affiliateService } from "../services/AffiliateService";

const serifFont = Platform.OS === "ios" ? "Georgia" : "serif";

const ONBOARDING_SLIDES = [
  {
    icon: "shield-checkmark",
    title: "Bem-vindo ao Estou Bem",
    description:
      "O app que cuida de quem voce ama. Check-ins diarios para garantir que seu familiar idoso esta seguro.",
  },
  {
    icon: "notifications",
    title: "Check-in Simples",
    description:
      "O idoso recebe um alarme e toca um botao. Se nao responder, voce e avisado imediatamente.",
  },
  {
    icon: "medical",
    title: "Medicamentos e Saude",
    description:
      "Controle de medicamentos com estoque, lembretes e diario de saude completo.",
  },
  {
    icon: "people",
    title: "Protecao em Familia",
    description:
      "Conecte toda a familia. Todos acompanham, todos cuidam. Juntos.",
  },
];

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function OnboardingScreen() {
  const navigation = useNavigation<Nav>();
  const { dispatch } = useApp();
  const flatListRef = useRef<FlatList>(null);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [showSetup, setShowSetup] = useState(false);
  const [role, setRole] = useState<UserRole | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [referralCode, setReferralCode] = useState("");

  const handleNext = () => {
    if (currentSlide < ONBOARDING_SLIDES.length - 1) {
      flatListRef.current?.scrollToIndex({ index: currentSlide + 1 });
      setCurrentSlide(currentSlide + 1);
    } else {
      setShowSetup(true);
    }
  };

  const handleComplete = async () => {
    if (!name.trim()) {
      Alert.alert("Erro", "Digite seu nome");
      return;
    }
    if (!role) {
      Alert.alert("Erro", "Selecione seu perfil");
      return;
    }

    const userId =
      Date.now().toString(36) + Math.random().toString(36).slice(2, 9);

    if (role === "elder") {
      const profile: ElderProfile = {
        id: userId,
        name: name.trim(),
        phone: phone.trim(),
        role: "elder",
        allergies: [],
        conditions: [],
        createdAt: new Date().toISOString(),
      };
      dispatch({ type: "SET_USER", payload: profile });
      dispatch({ type: "SET_ELDER_PROFILE", payload: profile });
    } else {
      const profile: FamilyProfile = {
        id: userId,
        name: name.trim(),
        phone: phone.trim(),
        role: role,
        elderIds: [],
        isEmergencyContact: true,
        notifyOnMissedCheckin: true,
        notifyOnSOS: true,
        notifyOnGeofence: true,
        createdAt: new Date().toISOString(),
      };
      dispatch({ type: "SET_USER", payload: profile });
      dispatch({ type: "ADD_FAMILY_PROFILE", payload: profile });
    }

    // Initialize notifications
    await notificationService.initialize();

    // Process referral code if entered
    if (referralCode.trim()) {
      await affiliateService.processReferralCode(referralCode.trim(), "", "");
    }

    // Schedule default check-in if elder
    if (role === "elder") {
      await checkInService.scheduleCheckinAlarms(["09:00"]);
    }

    dispatch({ type: "SET_ONBOARDED", payload: true });
  };

  if (showSetup) {
    return (
      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.setupContainer}
        >
          <Text style={styles.setupTitle}>Vamos comecar</Text>
          <Text style={styles.setupSubtitle}>
            Configure seu perfil para usar o Estou Bem
          </Text>

          {/* Role Selection */}
          <Text style={styles.label}>Quem e voce?</Text>
          <View style={styles.roleRow}>
            <TouchableOpacity
              style={[styles.roleCard, role === "elder" && styles.roleCardActive]}
              onPress={() => setRole("elder")}
            >
              <Ionicons
                name="person"
                size={32}
                color={role === "elder" ? COLORS.white : COLORS.primary}
              />
              <Text
                style={[
                  styles.roleText,
                  role === "elder" && styles.roleTextActive,
                ]}
              >
                Sou o Idoso
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.roleCard, role === "family" && styles.roleCardActive]}
              onPress={() => setRole("family")}
            >
              <Ionicons
                name="people"
                size={32}
                color={role === "family" ? COLORS.white : COLORS.primary}
              />
              <Text
                style={[
                  styles.roleText,
                  role === "family" && styles.roleTextActive,
                ]}
              >
                Sou Familiar
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.roleCard,
                role === "caregiver" && styles.roleCardActive,
              ]}
              onPress={() => setRole("caregiver")}
            >
              <Ionicons
                name="medkit"
                size={32}
                color={role === "caregiver" ? COLORS.white : COLORS.primary}
              />
              <Text
                style={[
                  styles.roleText,
                  role === "caregiver" && styles.roleTextActive,
                ]}
              >
                Sou Cuidador
              </Text>
            </TouchableOpacity>
          </View>

          {/* Name */}
          <Text style={styles.label}>Seu nome</Text>
          <TextInput
            style={styles.input}
            placeholder="Como devemos te chamar?"
            value={name}
            onChangeText={setName}
            placeholderTextColor={COLORS.textLight}
            autoCapitalize="words"
          />

          {/* Phone */}
          <Text style={styles.label}>Telefone (opcional)</Text>
          <TextInput
            style={styles.input}
            placeholder="(11) 99999-9999"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholderTextColor={COLORS.textLight}
          />

          {/* Referral Code */}
          <Text style={styles.label}>Codigo de indicacao (opcional)</Text>
          <TextInput
            style={styles.input}
            placeholder="Ex: EB4K2A"
            value={referralCode}
            onChangeText={(t) => setReferralCode(t.toUpperCase())}
            autoCapitalize="characters"
            maxLength={10}
            placeholderTextColor={COLORS.textLight}
          />

          <Button
            title="Comecar"
            onPress={handleComplete}
            size="elder"
            style={{ marginTop: SPACING.xl, width: "100%" }}
          />
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        ref={flatListRef}
        data={ONBOARDING_SLIDES}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => {
          const index = Math.round(
            e.nativeEvent.contentOffset.x / SCREEN.width
          );
          setCurrentSlide(index);
        }}
        keyExtractor={(_, i) => i.toString()}
        renderItem={({ item }) => (
          <View style={styles.slide}>
            <View style={styles.iconCircle}>
              <Ionicons
                name={item.icon as any}
                size={64}
                color={COLORS.primary}
              />
            </View>
            <Text style={styles.slideTitle}>{item.title}</Text>
            <Text style={styles.slideDesc}>{item.description}</Text>
          </View>
        )}
      />

      {/* Dots */}
      <View style={styles.dots}>
        {ONBOARDING_SLIDES.map((_, i) => (
          <View
            key={i}
            style={[styles.dot, i === currentSlide && styles.dotActive]}
          />
        ))}
      </View>

      <View style={styles.bottomRow}>
        {currentSlide < ONBOARDING_SLIDES.length - 1 ? (
          <>
            <TouchableOpacity onPress={() => setShowSetup(true)}>
              <Text style={styles.skipText}>Pular</Text>
            </TouchableOpacity>
            <Button title="Proximo" onPress={handleNext} size="large" />
          </>
        ) : (
          <Button
            title="Comecar"
            onPress={handleNext}
            size="elder"
            style={{ width: "100%" }}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  slide: {
    width: SCREEN.width,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: SPACING.xl,
  },
  iconCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: SPACING.xl,
  },
  slideTitle: {
    ...FONTS.elderTitle,
    textAlign: "center",
    marginBottom: SPACING.md,
  },
  slideDesc: {
    ...FONTS.body,
    fontSize: 18,
    textAlign: "center",
    color: COLORS.textSecondary,
    lineHeight: 28,
  },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.border,
  },
  dotActive: { backgroundColor: COLORS.primary, width: 24 },
  bottomRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: SPACING.xl,
    paddingBottom: SPACING.xl,
  },
  skipText: {
    ...FONTS.body,
    color: COLORS.textSecondary,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    fontSize: 14,
  },
  // Setup
  setupContainer: { flex: 1, padding: SPACING.xl },
  setupTitle: {
    ...FONTS.elderTitle,
    marginBottom: SPACING.xs,
  },
  setupSubtitle: {
    ...FONTS.body,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xl,
  },
  label: {
    ...FONTS.subtitle,
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
    fontWeight: "500",
  },
  roleRow: { flexDirection: "row", gap: SPACING.sm },
  roleCard: {
    flex: 1,
    alignItems: "center",
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.white,
  },
  roleCardActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary,
  },
  roleText: { ...FONTS.caption, marginTop: SPACING.xs, textAlign: "center" },
  roleTextActive: { color: COLORS.white, fontWeight: "500" },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    fontSize: 18,
    backgroundColor: COLORS.white,
    color: COLORS.textPrimary,
  },
});
