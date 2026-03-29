import React, { useState, useRef, useMemo } from "react";
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
  ScrollView,
  Platform,
  ActivityIndicator,
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
import { fetchSettings, postConsent, fetchMedications, fetchContacts, fetchHealth } from "../services/ApiService";
import { analyticsService } from "../services/AnalyticsService";
import { useI18n, SUPPORTED_LANGUAGES, SupportedLang } from "../i18n";

const API_URL = "https://estou-bem-web-production.up.railway.app";

const serifFont = Platform.OS === "ios" ? "Georgia" : "serif";

const LANG_FLAGS: Record<SupportedLang, string> = {
  "pt-BR": "🇧🇷",
  en: "🇺🇸",
  es: "🇪🇸",
  de: "🇩🇪",
};

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function OnboardingScreen() {
  const navigation = useNavigation<Nav>();
  const { dispatch } = useApp();
  const { t, lang, setLang } = useI18n();
  const flatListRef = useRef<FlatList>(null);

  const ONBOARDING_SLIDES = useMemo(() => [
    { icon: "shield-checkmark", title: t("onboarding_welcome"), description: t("onboarding_welcome_desc") },
    { icon: "notifications",    title: t("onboarding_checkin"), description: t("onboarding_checkin_desc") },
    { icon: "medical",          title: t("onboarding_meds"),    description: t("onboarding_meds_desc") },
    { icon: "people",           title: t("onboarding_family"),  description: t("onboarding_family_desc") },
  ], [t]);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [showSetup, setShowSetup] = useState(false);
  const [role, setRole] = useState<UserRole | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [lgpdConsent, setLgpdConsent] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);

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
      Alert.alert("Erro", t("error_enter_name"));
      return;
    }
    if (!role) {
      Alert.alert("Erro", "Selecione seu perfil");
      return;
    }
    if (!email.trim() || !email.includes("@")) {
      Alert.alert("Erro", "Digite um e-mail valido");
      return;
    }
    if (!password || password.length < 8) {
      Alert.alert("Erro", "A senha deve ter no minimo 8 caracteres");
      return;
    }
    if (!lgpdConsent) {
      Alert.alert("Erro", "Voce precisa aceitar os termos de uso para continuar");
      return;
    }

    setIsRegistering(true);

    try {
      const res = await fetch(`${API_URL}/api/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
          name: name.trim(),
          phone: phone.trim(),
          role,
          referral_code: referralCode.trim() || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        // Handle specific server errors
        const errorMsg =
          data.error === "Email already registered"
            ? t("error_email_exists")
            : data.error === "phone_exists"
            ? data.message || "Este numero ja esta cadastrado."
            : data.error || "Erro ao criar conta. Tente novamente.";
        Alert.alert("Erro", errorMsg);
        setIsRegistering(false);
        return;
      }

      const user = data.user;
      const token = data.token;

      if (role === "elder") {
        const profile: ElderProfile = {
          id: String(user.id),
          name: user.name,
          phone: user.phone || "",
          email: user.email,
          role: "elder",
          allergies: [],
          conditions: [],
          createdAt: new Date().toISOString(),
          link_code: user.link_code,
          apiUrl: API_URL,
          token,
        };
        dispatch({ type: "SET_USER", payload: profile });
        dispatch({ type: "SET_ELDER_PROFILE", payload: profile });
      } else {
        const profile: FamilyProfile = {
          id: String(user.id),
          name: user.name,
          phone: user.phone || "",
          email: user.email,
          role: role,
          elderIds: [],
          isEmergencyContact: true,
          notifyOnMissedCheckin: true,
          notifyOnSOS: true,
          notifyOnGeofence: true,
          createdAt: new Date().toISOString(),
          link_code: user.link_code,
          apiUrl: API_URL,
          token,
        };
        dispatch({ type: "SET_USER", payload: profile });
        dispatch({ type: "ADD_FAMILY_PROFILE", payload: profile });
      }

      // Sync subscription from server — convert string to SubscriptionInfo object
      const regServerSub = user.subscription || "free";
      dispatch({
        type: "SET_SUBSCRIPTION",
        payload: {
          tier: regServerSub !== "free" ? "pro" : "free",
          isActive: true,
        },
      });

      // Sync LGPD consent to server
      const userForApi = { apiUrl: API_URL, token };
      postConsent(userForApi, { type: "lgpd", accepted: true }).catch(() => {});

      // Track registration
      analyticsService.trackEvent("registration_complete");

      // Initialize notifications (pass user for push token auth)
      const userForNotif = { id: String(user.id), token, apiUrl: API_URL };
      await notificationService.initialize(userForNotif);

      // Fetch user's saved check-in times, fall back to default
      if (role === "elder") {
        try {
          const settings = await fetchSettings(userForApi);
          const times = settings?.checkin_times?.length ? settings.checkin_times : ["09:00"];
          await checkInService.scheduleCheckinAlarms(times);
        } catch {
          await checkInService.scheduleCheckinAlarms(["09:00"]);
        }
      }

      dispatch({ type: "SET_ONBOARDED", payload: true });
    } catch (e) {
      Alert.alert("Erro", "Nao foi possivel conectar ao servidor. Verifique sua conexao.");
    } finally {
      setIsRegistering(false);
    }
  };

  const handleLogin = async () => {
    if (!loginEmail.trim() || !loginPassword.trim()) {
      Alert.alert("Erro", "Digite e-mail e senha");
      return;
    }
    setIsLoggingIn(true);
    try {
      const res = await fetch(`${API_URL}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginEmail.trim(), password: loginPassword.trim() }),
      });
      const data = await res.json();
      if (data.ok && data.user) {
        const user = data.user;
        const token = data.token;
        const userRole = user.role || "elder";

        if (userRole === "elder") {
          const profile: ElderProfile = {
            id: String(user.id),
            name: user.name,
            phone: user.phone || "",
            email: user.email,
            role: "elder",
            allergies: [],
            conditions: [],
            createdAt: new Date().toISOString(),
            link_code: user.link_code,
            apiUrl: API_URL,
            token,
            trial_start: user.trial_start,
          } as any;
          dispatch({ type: "SET_USER", payload: profile });
          dispatch({ type: "SET_ELDER_PROFILE", payload: profile });
        } else {
          const profile: FamilyProfile = {
            id: String(user.id),
            name: user.name,
            phone: user.phone || "",
            email: user.email,
            role: userRole as "family" | "caregiver",
            elderIds: user.linked_elder_id ? [String(user.linked_elder_id)] : [],
            linked_elder_id: user.linked_elder_id ? String(user.linked_elder_id) : undefined,
            isEmergencyContact: true,
            notifyOnMissedCheckin: true,
            notifyOnSOS: true,
            notifyOnGeofence: true,
            createdAt: new Date().toISOString(),
            link_code: user.link_code,
            apiUrl: API_URL,
            token,
            trial_start: user.trial_start,
          } as any;
          dispatch({ type: "SET_USER", payload: profile });
          dispatch({ type: "ADD_FAMILY_PROFILE", payload: profile });
        }

        // Sync subscription from server — convert string to SubscriptionInfo object
        const serverSub = user.subscription || "free";
        dispatch({
          type: "SET_SUBSCRIPTION",
          payload: {
            tier: serverSub !== "free" ? "pro" : "free",
            isActive: true,
          },
        });

        // Track login
        analyticsService.trackEvent("login");

        const userForNotif = { id: String(user.id), token, apiUrl: API_URL };
        await notificationService.initialize(userForNotif);

        // Fetch user's saved check-in times, fall back to default
        const userForApi = { apiUrl: API_URL, token };
        if (userRole === "elder") {
          try {
            const settings = await fetchSettings(userForApi);
            const times = settings?.checkin_times?.length ? settings.checkin_times : ["09:00"];
            await checkInService.scheduleCheckinAlarms(times);

            // Language preference from server will be applied on SettingsScreen mount
          } catch {
            await checkInService.scheduleCheckinAlarms(["09:00"]);
          }
        }

        // Pre-fetch medications, contacts, and health data (fire-and-forget)
        fetchMedications(userForApi).then((meds) => {
          if (meds && meds.length > 0) {
            for (const med of meds) {
              dispatch({ type: "ADD_MEDICATION", payload: { id: String(med.id), name: med.name, dosage: med.dosage || "", frequency: med.frequency || "daily", times: med.times || [], stock: med.stock, elderId: String(med.user_id || ""), notes: med.notes } as any });
            }
          }
        }).catch(() => {});

        fetchContacts(userForApi).then((contacts) => {
          if (contacts && contacts.length > 0) {
            dispatch({ type: "SET_EMERGENCY_CONTACTS", payload: contacts.map((c: any) => ({ id: String(c.id), name: c.name, phone: c.phone, relationship: c.relationship || "", isPrimary: c.is_primary || false, elderId: String(c.elder_id || c.user_id || ""), priority: c.priority || 1, notifyOnMissedCheckin: c.notify_on_missed_checkin ?? true, notifyOnSOS: c.notify_on_sos ?? true })) });
          }
        }).catch(() => {});

        fetchHealth(userForApi, 50).then((entries) => {
          if (entries && entries.length > 0) {
            for (const entry of entries) {
              dispatch({ type: "ADD_HEALTH_ENTRY", payload: { id: String(entry.id), elderId: String(entry.user_id || ""), timestamp: entry.date || entry.created_at || new Date().toISOString(), type: entry.type || entry.reading_type, value: entry.value, unit: entry.unit || "" } as any });
            }
          }
        }).catch(() => {});

        dispatch({ type: "SET_ONBOARDED", payload: true });
      } else {
        Alert.alert("Erro", data.error || "E-mail ou senha incorretos");
      }
    } catch (e) {
      Alert.alert("Erro", t("error_server"));
    } finally {
      setIsLoggingIn(false);
    }
  };

  if (showLogin) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.langBar}>
          {SUPPORTED_LANGUAGES.map(({ code }) => (
            <TouchableOpacity key={code} onPress={() => setLang(code)} style={[styles.langBtn, lang === code && styles.langBtnActive]}>
              <Text style={styles.langBtnText}>{LANG_FLAGS[code]}</Text>
              <Text style={[styles.langBtnLabel, lang === code && styles.langBtnLabelActive]}>{code === "pt-BR" ? "PT" : code.toUpperCase()}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <ScrollView
          style={styles.setupContainer}
          contentContainerStyle={{ paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.setupTitle}>{t("login_title")}</Text>
          <Text style={styles.setupSubtitle}>{t("login_subtitle")}</Text>

          <Text style={styles.label}>{t("login_email")}</Text>
          <TextInput
            style={styles.input}
            placeholder="seu@email.com"
            value={loginEmail}
            onChangeText={setLoginEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            placeholderTextColor={COLORS.textLight}
          />

          <Text style={styles.label}>{t("login_password")}</Text>
          <TextInput
            style={styles.input}
            placeholder={t("login_password_placeholder")}
            value={loginPassword}
            onChangeText={setLoginPassword}
            secureTextEntry
            placeholderTextColor={COLORS.textLight}
          />

          <Button
            title={isLoggingIn ? t("login_loading") : t("login_button")}
            onPress={handleLogin}
            size="elder"
            disabled={isLoggingIn}
            style={{ marginTop: SPACING.xl, width: "100%" }}
          />
          {isLoggingIn && (
            <ActivityIndicator size="small" color={COLORS.primary} style={{ marginTop: SPACING.md }} />
          )}

          <TouchableOpacity
            onPress={() => setShowLogin(false)}
            style={{ marginTop: SPACING.lg, alignItems: "center" }}
          >
            <Text style={{ color: COLORS.textSecondary, fontSize: 14 }}>
              {t("login_no_account")}{" "}
              <Text style={{ color: COLORS.accent, fontWeight: "500" }}>{t("login_create_account")}</Text>
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (showSetup) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.langBar}>
          {SUPPORTED_LANGUAGES.map(({ code }) => (
            <TouchableOpacity key={code} onPress={() => setLang(code)} style={[styles.langBtn, lang === code && styles.langBtnActive]}>
              <Text style={styles.langBtnText}>{LANG_FLAGS[code]}</Text>
              <Text style={[styles.langBtnLabel, lang === code && styles.langBtnLabelActive]}>{code === "pt-BR" ? "PT" : code.toUpperCase()}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView
            style={styles.setupContainer}
            contentContainerStyle={{ paddingBottom: 40 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
          <Text style={styles.setupTitle}>{t("register_title")}</Text>
          <Text style={styles.setupSubtitle}>{t("register_subtitle")}</Text>

          {/* Role Selection */}
          <Text style={styles.label}>{t("register_who")}</Text>
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
                {t("register_role_elder")}
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
                {t("register_role_family")}
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
                {t("register_role_caregiver")}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Name */}
          <Text style={styles.label}>{t("register_name")}</Text>
          <TextInput
            style={styles.input}
            placeholder={t("register_name_placeholder")}
            value={name}
            onChangeText={setName}
            placeholderTextColor={COLORS.textLight}
            autoCapitalize="words"
          />

          {/* Phone */}
          <Text style={styles.label}>{t("register_phone")}</Text>
          <TextInput
            style={styles.input}
            placeholder="(11) 99999-9999"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholderTextColor={COLORS.textLight}
          />

          {/* Email */}
          <Text style={styles.label}>{t("register_email")}</Text>
          <TextInput
            style={styles.input}
            placeholder="seu@email.com"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            placeholderTextColor={COLORS.textLight}
          />

          {/* Password */}
          <Text style={styles.label}>{t("register_password")}</Text>
          <TextInput
            style={styles.input}
            placeholder={t("register_password_placeholder")}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholderTextColor={COLORS.textLight}
          />

          {/* Referral Code */}
          <Text style={styles.label}>{t("register_referral")}</Text>
          <TextInput
            style={styles.input}
            placeholder="Ex: EB4K2A"
            value={referralCode}
            onChangeText={(v) => setReferralCode(v.toUpperCase())}
            autoCapitalize="characters"
            maxLength={10}
            placeholderTextColor={COLORS.textLight}
          />

          {/* LGPD Consent */}
          <TouchableOpacity
            style={styles.lgpdRow}
            onPress={() => setLgpdConsent(!lgpdConsent)}
            activeOpacity={0.7}
          >
            <Ionicons
              name={lgpdConsent ? "checkbox" : "square-outline"}
              size={24}
              color={lgpdConsent ? COLORS.primary : COLORS.textLight}
            />
            <Text style={styles.lgpdText}>{t("register_lgpd")}</Text>
          </TouchableOpacity>

          <Button
            title={isRegistering ? t("register_loading") : t("register_button")}
            onPress={handleComplete}
            size="elder"
            disabled={isRegistering}
            style={{ marginTop: SPACING.xl, width: "100%" }}
          />
          {isRegistering && (
            <ActivityIndicator size="small" color={COLORS.primary} style={{ marginTop: SPACING.md }} />
          )}

          <TouchableOpacity
            onPress={() => setShowLogin(true)}
            style={{ marginTop: SPACING.lg, alignItems: "center" }}
          >
            <Text style={{ color: COLORS.textSecondary, fontSize: 14 }}>
              {t("register_has_account")}{" "}
              <Text style={{ color: COLORS.accent, fontWeight: "500" }}>{t("login_button")}</Text>
            </Text>
          </TouchableOpacity>
          </ScrollView>
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
                size={Math.min(48, SCREEN.height * 0.06)}
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
              <Text style={styles.skipText}>{t("onboarding_skip")}</Text>
            </TouchableOpacity>
            <Button title={t("onboarding_next")} onPress={handleNext} size="large" />
          </>
        ) : (
          <Button
            title={t("onboarding_start")}
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
    paddingVertical: SPACING.md,
  },
  iconCircle: {
    width: Math.min(120, SCREEN.height * 0.14),
    height: Math.min(120, SCREEN.height * 0.14),
    borderRadius: Math.min(60, SCREEN.height * 0.07),
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.border,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: SPACING.lg,
  },
  slideTitle: {
    ...FONTS.elderTitle,
    fontSize: Math.min(32, SCREEN.height * 0.04),
    textAlign: "center",
    marginBottom: SPACING.sm,
  },
  slideDesc: {
    ...FONTS.body,
    fontSize: Math.min(16, SCREEN.height * 0.02),
    textAlign: "center",
    color: COLORS.textSecondary,
    lineHeight: Math.min(24, SCREEN.height * 0.03),
    paddingHorizontal: SPACING.md,
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
  roleRow: { flexDirection: "row", gap: SPACING.sm, paddingHorizontal: 2 },
  roleCard: {
    flex: 1,
    alignItems: "center",
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xs,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.white,
    minHeight: 90,
    justifyContent: "center",
  },
  roleCardActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary,
  },
  roleText: { ...FONTS.caption, marginTop: SPACING.xs, textAlign: "center", fontSize: 12, lineHeight: 16 },
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
  lgpdRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: SPACING.sm,
    marginTop: SPACING.lg,
    paddingRight: SPACING.md,
  },
  lgpdText: {
    ...FONTS.caption,
    flex: 1,
    lineHeight: 18,
    color: COLORS.textSecondary,
  },
  // Language picker bar shown at top of login / register screens
  langBar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: SPACING.xs,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xs,
  },
  langBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.white,
  },
  langBtnActive: {
    borderColor: COLORS.primary,
    backgroundColor: "#EEF6F0",
  },
  langBtnText: { fontSize: 16 },
  langBtnLabel: { fontSize: 12, color: COLORS.textSecondary, fontWeight: "500" },
  langBtnLabelActive: { color: COLORS.primary },
});
