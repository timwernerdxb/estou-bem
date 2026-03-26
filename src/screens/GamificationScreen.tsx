import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { COLORS, FONTS, SPACING, RADIUS } from "../constants/theme";
import { useApp } from "../store/AppContext";
import { Card } from "../components/Card";
import { Button } from "../components/Button";

const serifFont = Platform.OS === "ios" ? "Georgia" : "serif";

interface GamificationData {
  streak_days: number;
  total_points: number;
  badges: string[];
}

const BADGE_CONFIG: Record<string, { label: string; icon: string; description: string; requirement: number }> = {
  streak_7: {
    label: "1 Semana",
    icon: "flame",
    description: "7 dias seguidos de check-in",
    requirement: 7,
  },
  streak_30: {
    label: "1 Mes",
    icon: "trophy",
    description: "30 dias seguidos de check-in",
    requirement: 30,
  },
  streak_100: {
    label: "100 Dias",
    icon: "star",
    description: "100 dias seguidos de check-in",
    requirement: 100,
  },
};

const ALL_BADGES = ["streak_7", "streak_30", "streak_100"];

export function GamificationScreen() {
  const navigation = useNavigation();
  const { state } = useApp();
  const [data, setData] = useState<GamificationData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchGamification();
  }, []);

  const fetchGamification = async () => {
    try {
      const API_URL = state.currentUser?.apiUrl || process.env.EXPO_PUBLIC_API_URL || "";
      const token = state.currentUser?.token;
      if (!API_URL || !token) {
        setData({ streak_days: 0, total_points: 0, badges: [] });
        setLoading(false);
        return;
      }
      const res = await fetch(`${API_URL}/api/gamification`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      setData(json);
    } catch {
      setData({ streak_days: 0, total_points: 0, badges: [] });
    } finally {
      setLoading(false);
    }
  };

  const getNextBadge = () => {
    if (!data) return null;
    for (const badgeKey of ALL_BADGES) {
      if (!data.badges.includes(badgeKey)) {
        return BADGE_CONFIG[badgeKey];
      }
    }
    return null;
  };

  const getProgress = () => {
    if (!data) return 0;
    const next = getNextBadge();
    if (!next) return 100;
    return Math.min((data.streak_days / next.requirement) * 100, 100);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const nextBadge = getNextBadge();
  const progress = getProgress();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Conquistas</Text>
        <View style={{ width: 32 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Conquistas</Text>

        {/* Streak & Points Summary */}
        <View style={styles.summaryRow}>
          <Card style={styles.summaryCard}>
            <Ionicons name="flame" size={32} color={COLORS.accent} />
            <Text style={styles.summaryValue}>{data?.streak_days || 0}</Text>
            <Text style={styles.summaryLabel}>Dias seguidos</Text>
          </Card>
          <Card style={styles.summaryCard}>
            <Ionicons name="star" size={32} color={COLORS.accent} />
            <Text style={styles.summaryValue}>{data?.total_points || 0}</Text>
            <Text style={styles.summaryLabel}>Pontos</Text>
          </Card>
        </View>

        {/* Progress to Next Badge */}
        {nextBadge && (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>Proxima conquista</Text>
            <View style={styles.nextBadgeRow}>
              <View style={styles.badgeIconLarge}>
                <Ionicons name={nextBadge.icon as any} size={28} color={COLORS.textLight} />
              </View>
              <View style={{ flex: 1, marginLeft: SPACING.md }}>
                <Text style={styles.nextBadgeName}>{nextBadge.label}</Text>
                <Text style={styles.nextBadgeDesc}>{nextBadge.description}</Text>
                <View style={styles.progressBar}>
                  <View style={[styles.progressFill, { width: `${progress}%` }]} />
                </View>
                <Text style={styles.progressText}>
                  {data?.streak_days || 0} / {nextBadge.requirement} dias
                </Text>
              </View>
            </View>
          </Card>
        )}

        {/* All Badges */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Medalhas</Text>
          {ALL_BADGES.map((badgeKey) => {
            const badge = BADGE_CONFIG[badgeKey];
            const earned = data?.badges.includes(badgeKey) || false;
            return (
              <View key={badgeKey} style={styles.badgeRow}>
                <View style={[styles.badgeIcon, earned && styles.badgeIconEarned]}>
                  <Ionicons
                    name={badge.icon as any}
                    size={24}
                    color={earned ? COLORS.white : COLORS.disabled}
                  />
                </View>
                <View style={{ flex: 1, marginLeft: SPACING.md }}>
                  <Text style={[styles.badgeName, !earned && styles.badgeNameLocked]}>
                    {badge.label}
                  </Text>
                  <Text style={styles.badgeDesc}>{badge.description}</Text>
                </View>
                {earned && (
                  <Ionicons name="checkmark-circle" size={22} color={COLORS.primary} />
                )}
              </View>
            );
          })}
        </Card>

        {/* Points Info */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Como ganhar pontos</Text>
          <View style={styles.pointsInfoRow}>
            <Ionicons name="checkmark-circle" size={20} color={COLORS.primary} />
            <Text style={styles.pointsInfoText}>Check-in diario: +10 pontos</Text>
          </View>
          <View style={styles.pointsInfoRow}>
            <Ionicons name="flame" size={20} color={COLORS.accent} />
            <Text style={styles.pointsInfoText}>Bonus 7 dias seguidos: +5 pontos</Text>
          </View>
          <View style={styles.pointsInfoRow}>
            <Ionicons name="trophy" size={20} color={COLORS.accent} />
            <Text style={styles.pointsInfoText}>Bonus 30 dias seguidos: +10 pontos</Text>
          </View>
        </Card>

        <Button
          title="Voltar"
          onPress={() => navigation.goBack()}
          variant="outline"
          size="large"
          style={{ marginTop: SPACING.lg, width: "100%" }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  backBtn: { padding: SPACING.xs },
  headerTitle: { ...FONTS.subtitle, fontWeight: "600" },
  content: { padding: SPACING.lg },
  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  title: {
    ...FONTS.title,
    fontSize: 28,
    marginBottom: SPACING.lg,
  },
  summaryRow: {
    flexDirection: "row",
    gap: SPACING.md,
    marginBottom: SPACING.md,
  },
  summaryCard: {
    flex: 1,
    alignItems: "center",
    paddingVertical: SPACING.lg,
  },
  summaryValue: {
    fontFamily: serifFont,
    fontSize: 36,
    fontWeight: "300",
    color: COLORS.primary,
    marginTop: SPACING.sm,
  },
  summaryLabel: {
    ...FONTS.caption,
    marginTop: SPACING.xs,
  },
  section: { marginBottom: SPACING.md },
  sectionTitle: { ...FONTS.subtitle, fontWeight: "500", marginBottom: SPACING.sm },
  nextBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  badgeIconLarge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.background,
    borderWidth: 2,
    borderColor: COLORS.border,
    borderStyle: "dashed",
    justifyContent: "center",
    alignItems: "center",
  },
  nextBadgeName: { ...FONTS.subtitle, fontWeight: "500" },
  nextBadgeDesc: { ...FONTS.caption, marginTop: 2 },
  progressBar: {
    height: 6,
    backgroundColor: COLORS.border,
    borderRadius: 3,
    marginTop: SPACING.sm,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: COLORS.accent,
    borderRadius: 3,
  },
  progressText: {
    ...FONTS.small,
    marginTop: SPACING.xs,
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  badgeIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.background,
    justifyContent: "center",
    alignItems: "center",
  },
  badgeIconEarned: {
    backgroundColor: COLORS.primary,
  },
  badgeName: { ...FONTS.body, fontWeight: "500" },
  badgeNameLocked: { color: COLORS.textLight },
  badgeDesc: { ...FONTS.small, marginTop: 2 },
  pointsInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  pointsInfoText: { ...FONTS.body, flex: 1 },
});
