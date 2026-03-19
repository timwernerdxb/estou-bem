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

const ONBOARDING_SLIDES = [
  {
    icon: "shield-checkmark",
    title: "Bem-vindo ao Estou Bem",
    description:
      "O app que cuida de quem você ama. Check-ins diários para garantir que seu familiar idoso está seguro.",
  },
  {
    icon: "notifications",
    title: "Check-in Simples",
    description:
      "O idoso recebe um alarme e toca um botão. Se não responder, você é avisado imediatamente.",
  },
  {
    icon: "medical",
    title: "Medicamentos e Saúde",
    description:
      "Controle de medicamentos com estoque, lembretes e diário de saúde completo.",
  },
  {
    icon: "people",
    title: "Proteção em Família",
    description:
      "Conecte toda a família. Todos acompanham, todos cuidam. Juntos.",
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
          <Text style={styles.setupTitle}>Vamos começar!</Text>
          <Text style={styles.setupSubtitle}>
            Configure seu perfil para usar o Estou Bem
          </Text>

          {/* Role Selection */}
          <Text style={styles.label}>Quem é você?</Text>
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

          <Button
            title="Começar a usar!"
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
                size={80}
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
            <Button title="Próximo" onPress={handleNext} size="large" />
          </>
        ) : (
          <Button
            title="Começar!"
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
  container: { flex: 1, backgroundColor: COLORS.white },
  slide: {
    width: SCREEN.width,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: SPACING.xl,
  },
  iconCircle: {
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: COLORS.background,
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
    ...FONTS.elderBody,
    textAlign: "center",
    color: COLORS.textSecondary,
  },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
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
  skipText: { ...FONTS.body, color: COLORS.textSecondary },
  // Setup
  setupContainer: { flex: 1, padding: SPACING.xl },
  setupTitle: { ...FONTS.elderTitle, marginBottom: SPACING.xs },
  setupSubtitle: {
    ...FONTS.body,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xl,
  },
  label: {
    ...FONTS.subtitle,
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  roleRow: { flexDirection: "row", gap: SPACING.sm },
  roleCard: {
    flex: 1,
    alignItems: "center",
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 2,
    borderColor: COLORS.border,
    backgroundColor: COLORS.white,
  },
  roleCardActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary,
  },
  roleText: { ...FONTS.caption, marginTop: SPACING.xs, textAlign: "center" },
  roleTextActive: { color: COLORS.white, fontWeight: "600" },
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
