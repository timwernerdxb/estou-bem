import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Vibration,
  ScrollView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, FONTS, SPACING, SHADOWS, RADIUS, SCREEN } from "../constants/theme";
import { useApp, useSubscription } from "../store/AppContext";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useNavigation } from "@react-navigation/native";
import { checkInService } from "../services/CheckInService";
import { fallDetectionService } from "../services/FallDetectionService";
import { postCheckin, putCheckin, fetchCheckins, postFallDetected, postCheckinReward, fetchNapStatus, postActivityUpdate, fetchGamification } from "../services/ApiService";
import { locationService } from "../services/LocationService";
import { autoCheckinService } from "../services/AutoCheckinService";
import { notificationService } from "../services/NotificationService";
import { healthIntegrationService, HealthSummary } from "../services/HealthIntegrationService";
import { useI18n } from "../i18n";
import { StatusBadge } from "../components/StatusBadge";
import { Card } from "../components/Card";
import { CheckIn, SensorSnapshot } from "../types";

const serifFont = Platform.OS === "ios" ? "Georgia" : "serif";

// Soho House colors
const SH_GREEN = "#2D4A3E";
const SH_GREEN_DARK = "#1E352B";
const SH_CREAM = "#F5F0EB";
const SH_GOLD = "#C9A96E";
const SH_GRAY = "#9A9189";

type CheckinDisplayState = "pending" | "completed" | "waiting";

export function ElderHomeScreen() {
  const { state, dispatch } = useApp();
  const { isFamilia } = useSubscription();
  const { t } = useI18n();
  const [pulseAnim] = useState(new Animated.Value(1));
  const [lastCheckin, setLastCheckin] = useState<CheckIn | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [checkinDisplayState, setCheckinDisplayState] = useState<CheckinDisplayState>("pending");
  const [confirmedTime, setConfirmedTime] = useState<string | null>(null);
  const [nextCheckinTime, setNextCheckinTime] = useState<string | null>(null);
  const [isNapping, setIsNapping] = useState(false);
  const [napUntil, setNapUntil] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [streakDays, setStreakDays] = useState(0);
  const [healthSummary, setHealthSummary] = useState<HealthSummary>({});
  const elderName = state.elderProfile?.name || state.currentUser?.name || "Voce";

  // Read check-in times directly from state (set by SettingsScreen dispatch)
  const scheduleTimes = state.checkinTimes && state.checkinTimes.length > 0 ? state.checkinTimes : ["09:00"];

  // Track server-confirmed check-in times for today (e.g. ["09:00", "14:00"])
  const [serverConfirmedTimes, setServerConfirmedTimes] = useState<string[]>([]);

  const todayCheckins = state.checkins.filter((c) => {
    const today = new Date().toDateString();
    return new Date(c.scheduledAt).toDateString() === today;
  });

  const pendingCheckin = todayCheckins.find((c) => c.status === "pending");
  const confirmedToday = todayCheckins.filter(
    (c) => c.status === "confirmed" || c.status === "auto_confirmed"
  ).length;

  // Fetch today's confirmed check-ins from server to know which scheduled times are confirmed
  const fetchServerConfirmedCheckins = useCallback(async () => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const rows = await fetchCheckins(state.currentUser, { date: today, limit: 50 });
      if (rows && rows.length > 0) {
        const confirmedTimes = rows
          .filter((r: any) => r.status === "confirmed" || r.status === "auto_confirmed")
          .map((r: any) => r.time)
          .filter(Boolean);
        setServerConfirmedTimes(confirmedTimes);
      } else {
        setServerConfirmedTimes([]);
      }
    } catch (e) {
      console.warn("[ElderHome] Failed to fetch server confirmed checkins:", e);
    }
  }, [state.currentUser]);

  // Helper: check if a scheduled time is within the check-in window (+-15 min of current time)
  const isWithinCheckinWindow = useCallback((scheduleTime: string, nowMins: number): boolean => {
    const [h, m] = scheduleTime.split(":").map(Number);
    const scheduleMins = h * 60 + m;
    return Math.abs(nowMins - scheduleMins) <= 15;
  }, []);

  // Helper: check if a scheduled time is confirmed on server
  const isTimeConfirmedOnServer = useCallback((scheduleTime: string): boolean => {
    return serverConfirmedTimes.includes(scheduleTime);
  }, [serverConfirmedTimes]);

  // Determine check-in display state using server-confirmed data
  const computeDisplayState = useCallback(() => {
    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();

    // No schedule set at all -- backwards compatible, show as pending
    if (!scheduleTimes || scheduleTimes.length === 0) {
      setCheckinDisplayState("pending");
      setNextCheckinTime(null);
      return;
    }

    // Find scheduled times that have passed (within their window)
    const pastTimes = scheduleTimes.filter((t) => {
      const [h, m] = t.split(":").map(Number);
      return h * 60 + m <= nowMins + 15; // include times within current window
    });

    // Find scheduled times where we are currently in the check-in window
    const currentWindowTimes = scheduleTimes.filter((t) => isWithinCheckinWindow(t, nowMins));

    // Check if any current-window time is NOT confirmed on the server
    const unconfirmedCurrentWindow = currentWindowTimes.filter((t) => !isTimeConfirmedOnServer(t));

    if (unconfirmedCurrentWindow.length > 0) {
      // There is a check-in window active right now that hasn't been confirmed - show as pending
      setCheckinDisplayState("pending");
      const nextTime = scheduleTimes.find((t) => {
        const [h, m] = t.split(":").map(Number);
        return h * 60 + m > nowMins;
      });
      setNextCheckinTime(nextTime || null);
      return;
    }

    // Check past times that are NOT confirmed (outside current window)
    const pastNotInWindow = pastTimes.filter((t) => !isWithinCheckinWindow(t, nowMins));
    const unconfirmedPast = pastNotInWindow.filter((t) => !isTimeConfirmedOnServer(t));

    // Also check local pending checkins for backwards compatibility
    if (pendingCheckin || unconfirmedPast.length > 0) {
      // Past check-in time that was missed / not confirmed - show as pending
      setCheckinDisplayState("pending");
      const nextTime = scheduleTimes.find((t) => {
        const [h, m] = t.split(":").map(Number);
        return h * 60 + m > nowMins;
      });
      setNextCheckinTime(nextTime || null);
      return;
    }

    // All past times are confirmed
    const confirmedCheckins = todayCheckins.filter(
      (c) => c.status === "confirmed" || c.status === "auto_confirmed"
    );

    if (pastTimes.length > 0 && (confirmedCheckins.length > 0 || serverConfirmedTimes.length > 0)) {
      setCheckinDisplayState("completed");
      const lastConfirmed = confirmedCheckins[confirmedCheckins.length - 1];
      if (lastConfirmed?.respondedAt) {
        const respondedAt = new Date(lastConfirmed.respondedAt);
        setConfirmedTime(
          respondedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
        );
      } else {
        // Use the latest server confirmed time
        const latestServerTime = serverConfirmedTimes[serverConfirmedTimes.length - 1];
        setConfirmedTime(latestServerTime || null);
      }
      const nextTime = scheduleTimes.find((t) => {
        const [h, m] = t.split(":").map(Number);
        return h * 60 + m > nowMins;
      });
      setNextCheckinTime(nextTime || null);
      return;
    }

    // Waiting for next checkin (no scheduled time has passed yet)
    const nextTime = scheduleTimes.find((t) => {
      const [h, m] = t.split(":").map(Number);
      return h * 60 + m > nowMins;
    });

    if (nextTime) {
      setCheckinDisplayState("waiting");
      setNextCheckinTime(nextTime);
    } else {
      // All times passed and all confirmed
      setCheckinDisplayState("waiting");
      setNextCheckinTime(scheduleTimes[0] || "09:00");
    }
  }, [pendingCheckin, todayCheckins, scheduleTimes, serverConfirmedTimes, isWithinCheckinWindow, isTimeConfirmedOnServer]);

  // Fetch check-in history from server on mount and refresh confirmed times
  useEffect(() => {
    (async () => {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const rows = await fetchCheckins(state.currentUser, { date: today, limit: 20 });
        if (rows && rows.length > 0) {
          for (const row of rows) {
            const mapped: CheckIn = {
              id: String(row.id),
              elderId: String(row.user_id),
              scheduledAt: row.created_at || new Date().toISOString(),
              respondedAt: row.confirmed_at || undefined,
              status: row.status === "confirmed" || row.status === "auto_confirmed"
                ? row.status
                : row.status === "missed"
                ? "missed"
                : "pending",
            };
            // Only add if not already present locally
            const exists = state.checkins.some((c) => c.id === mapped.id);
            if (!exists) {
              dispatch({ type: "ADD_CHECKIN", payload: mapped });
            }
          }
        }
        // Also fetch confirmed times from server
        await fetchServerConfirmedCheckins();
      } catch (e) {
        console.warn("[ElderHome] Failed to fetch checkins from server:", e);
      }
    })();
  }, []); // run once on mount

  // Re-fetch server confirmed checkins when a notification arrives (app becomes active)
  // and periodically to catch new check-in windows
  useEffect(() => {
    const refreshInterval = setInterval(() => {
      fetchServerConfirmedCheckins();
    }, 60000); // every 60 seconds
    return () => clearInterval(refreshInterval);
  }, [fetchServerConfirmedCheckins]);

  // Check nap status from server on mount
  useEffect(() => {
    (async () => {
      try {
        const nap = await fetchNapStatus(state.currentUser);
        if (nap && nap.napping && nap.nap_until) {
          setIsNapping(true);
          setNapUntil(nap.nap_until);
          const remaining = new Date(nap.nap_until).getTime() - Date.now();
          if (remaining > 0) {
            setTimeout(() => { setIsNapping(false); setNapUntil(null); }, remaining);
          }
        }
      } catch {}
    })();
  }, []);

  // Start GPS tracking when elder is logged in
  useEffect(() => {
    if (!state.currentUser?.token) return;
    locationService.startTracking(state.currentUser).catch((err) =>
      console.warn("[ElderHome] Location tracking failed to start:", err)
    );
    return () => {
      locationService.stopTracking().catch(() => {});
    };
  }, [state.currentUser?.token]);

  // Fetch gamification data (streak) from server on mount
  useEffect(() => {
    (async () => {
      try {
        const data = await fetchGamification(state.currentUser);
        if (data && data.streak_days != null) {
          setStreakDays(data.streak_days);
        }
      } catch {}
    })();
  }, []);

  // Initialize HealthKit for elder users and start periodic health sync
  useEffect(() => {
    if (state.currentUser?.role !== "elder") return;

    let cancelled = false;

    (async () => {
      try {
        // Show cached data immediately
        const cached = await healthIntegrationService.getCachedHealthSummary();
        if (!cancelled && cached.lastUpdated) {
          setHealthSummary(cached);
        }

        // Initialize and request permissions (only prompts once)
        await healthIntegrationService.initialize();
        if (Platform.OS === "ios") {
          await healthIntegrationService.requestAppleHealthPermissions();
        }

        // Read fresh data
        const summary = await healthIntegrationService.readAppleHealthSummary(24);
        if (!cancelled && summary.lastUpdated) {
          setHealthSummary(summary);
        }

        // Start periodic sync every 5 minutes
        const elderId = state.elderProfile?.id || state.currentUser?.id || "elder";
        healthIntegrationService.startPeriodicSync(state.currentUser, elderId);
      } catch (err) {
        console.warn("[ElderHome] HealthKit init error:", err);
      }
    })();

    return () => {
      cancelled = true;
      healthIntegrationService.stopPeriodicSync();
    };
  }, [state.currentUser?.id]);

  // Refresh health summary every 5 minutes (UI update)
  useEffect(() => {
    if (state.currentUser?.role !== "elder") return;
    if (Platform.OS !== "ios") return;

    const refreshHealth = async () => {
      try {
        const summary = await healthIntegrationService.readAppleHealthSummary(24);
        if (summary.lastUpdated) {
          setHealthSummary(summary);
        }
      } catch {}
    };

    const healthRefreshInterval = setInterval(refreshHealth, 5 * 60 * 1000);
    return () => clearInterval(healthRefreshInterval);
  }, [state.currentUser?.id]);

  // Compute state on mount and every 30 seconds
  useEffect(() => {
    computeDisplayState();
    intervalRef.current = setInterval(computeDisplayState, 30000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [computeDisplayState]);

  // Pulse animation for the check-in button — only when pending
  useEffect(() => {
    if (checkinDisplayState === "pending") {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.08,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [checkinDisplayState]);

  // Start fall detection monitoring for elder users
  useEffect(() => {
    if (state.currentUser?.role !== "elder") return;

    const handleFallDetected = async (snapshot: SensorSnapshot) => {
      const name = state.elderProfile?.name || state.currentUser?.name || "Idoso";

      // Notify family via local notification
      await notificationService.sendFallDetectedNotification(name, snapshot.heartRate);

      // Report fall to server
      await postFallDetected(state.currentUser, {
        user_id: state.currentUser?.id ? Number(state.currentUser.id) : 0,
        timestamp: new Date().toISOString(),
        heart_rate: snapshot.heartRate,
      });
    };

    fallDetectionService.startMonitoring(handleFallDetected);

    // Periodically send wearable health data to server
    const healthInterval = setInterval(() => {
      const snapshot = fallDetectionService.getCurrentSnapshot();
      if (snapshot && (snapshot.heartRate || snapshot.lastMovementAt)) {
        postActivityUpdate(state.currentUser, {
          user_id: state.currentUser?.id ? Number(state.currentUser.id) : 0,
          movement_detected: !!snapshot.lastMovementAt,
          heart_rate: snapshot.heartRate,
        }).catch(() => {});
      }
    }, 5 * 60 * 1000); // every 5 minutes

    return () => {
      fallDetectionService.stopMonitoring();
      clearInterval(healthInterval);
    };
  }, [state.currentUser?.id]);

  // Auto check-in: when a pending check-in exists and mode is not manual, try auto-confirm
  useEffect(() => {
    if (!pendingCheckin) return;
    if (autoCheckinService.getMode() === "manual") return;

    const tryAutoCheckin = async () => {
      const result = await autoCheckinService.processCheckin(pendingCheckin);
      if (result) {
        dispatch({ type: "UPDATE_CHECKIN", payload: result });
        autoCheckinService.resetMovementCounter();
        computeDisplayState();
      }
    };

    // Try immediately, then every 60 seconds
    tryAutoCheckin();
    const autoInterval = setInterval(tryAutoCheckin, 60000);
    return () => clearInterval(autoInterval);
  }, [pendingCheckin?.id]);

  const handleCheckin = useCallback(async () => {
    // Only allow check-in when in pending state
    if (checkinDisplayState !== "pending") return;
    if (isConfirming) return;
    setIsConfirming(true);

    await checkInService.hapticConfirm();
    Vibration.vibrate(200);

    if (pendingCheckin) {
      const confirmed = checkInService.confirmCheckin(pendingCheckin);
      dispatch({ type: "UPDATE_CHECKIN", payload: confirmed });
      setLastCheckin(confirmed);
      const now = new Date();
      const timeStr = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", hour12: false });
      // If the pending check-in came from the server (numeric ID), update it via PUT
      const serverId = Number(pendingCheckin.id);
      if (!isNaN(serverId)) {
        putCheckin(state.currentUser, serverId, { status: "confirmed", time: timeStr }).catch(() => {});
      } else {
        postCheckin(state.currentUser, {
          time: timeStr,
          status: "confirmed",
          date: now.toISOString().slice(0, 10),
        }).catch(() => {});
      }
    } else {
      // Create and immediately confirm a new check-in (no scheduled pending exists)
      const elderId = state.elderProfile?.id || state.currentUser?.id || "elder";
      const newCheckin = checkInService.createCheckin(elderId, new Date().toISOString());
      const confirmed = checkInService.confirmCheckin(newCheckin);
      dispatch({ type: "ADD_CHECKIN", payload: confirmed });
      setLastCheckin(confirmed);
      const now = new Date();
      const nowMins = now.getHours() * 60 + now.getMinutes();
      // Use the nearest scheduled time instead of clock time so the server
      // recognises this as confirming that slot (prevents duplicate check-ins)
      const nearestScheduledTime = scheduleTimes.reduce((best, t) => {
        const [h, m] = t.split(":").map(Number);
        const diff = Math.abs(h * 60 + m - nowMins);
        const [bh, bm] = best.split(":").map(Number);
        return diff < Math.abs(bh * 60 + bm - nowMins) ? t : best;
      }, scheduleTimes[0] || now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", hour12: false }));
      postCheckin(state.currentUser, {
        time: nearestScheduledTime,
        status: "confirmed",
        date: now.toISOString().slice(0, 10),
      }).catch(() => {});
    }

    // Award gamification points for check-in (fire-and-forget)
    postCheckinReward(state.currentUser).catch(() => {});

    // Recompute state after confirming — also refresh server confirmed times
    setTimeout(async () => {
      setIsConfirming(false);
      await fetchServerConfirmedCheckins();
      computeDisplayState();
    }, 2000);
  }, [checkinDisplayState, pendingCheckin, isConfirming, state.elderProfile, state.currentUser, computeDisplayState]);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return t("greeting_morning");
    if (hour < 18) return t("greeting_afternoon");
    return t("greeting_evening");
  };

  const streak = streakDays;

  const handleNap = async (minutes: number) => {
    try {
      const API_URL = state.currentUser?.apiUrl || process.env.EXPO_PUBLIC_API_URL || "";
      const token = state.currentUser?.token;
      if (!API_URL || !token) return;
      const res = await fetch(`${API_URL}/api/nap`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ minutes }),
      });
      const data = await res.json();
      if (data.success) {
        setIsNapping(true);
        setNapUntil(data.nap_until);
        Vibration.vibrate(100);
        // Auto-cancel after duration
        setTimeout(() => { setIsNapping(false); setNapUntil(null); }, minutes * 60 * 1000);
      }
    } catch (e) {
      console.error("Nap error:", e);
    }
  };

  const cancelNap = async () => {
    try {
      const API_URL = state.currentUser?.apiUrl || process.env.EXPO_PUBLIC_API_URL || "";
      const token = state.currentUser?.token;
      if (!API_URL || !token) return;
      await fetch(`${API_URL}/api/nap`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      setIsNapping(false);
      setNapUntil(null);
    } catch (e) {
      console.error("Cancel nap error:", e);
    }
  };

  const renderCheckinArea = () => {
    if (isConfirming) {
      // Show brief confirmation animation
      return (
        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
          <View
            style={[
              styles.checkinButton,
              { backgroundColor: SH_GREEN_DARK },
            ]}
          >
            <Ionicons name="checkmark-circle" size={80} color={COLORS.white} />
            <Text style={styles.checkinButtonText}>{t("checkin_confirmed")}</Text>
          </View>
        </Animated.View>
      );
    }

    if (checkinDisplayState === "pending") {
      return (
        <>
          <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
            <TouchableOpacity
              onPress={handleCheckin}
              activeOpacity={0.8}
              style={[
                styles.checkinButton,
                styles.pendingButton,
              ]}
            >
              <View style={styles.checkinButtonInner}>
                <Text style={styles.checkinButtonTitle}>{t("checkin_done")}</Text>
                <View style={styles.checkinDivider} />
                <Ionicons name="finger-print" size={44} color={COLORS.white} />
                <Text style={styles.checkinButtonSub}>Toque para confirmar</Text>
              </View>
            </TouchableOpacity>
          </Animated.View>
          <Text style={styles.pendingText}>
            Voce tem um check-in pendente
          </Text>
        </>
      );
    }

    if (checkinDisplayState === "completed") {
      return (
        <>
          <View style={styles.completedCard}>
            <Ionicons name="checkmark-circle" size={56} color={SH_GREEN} />
            <Text style={styles.completedTitle}>Check-in confirmado</Text>
            {confirmedTime && (
              <Text style={styles.completedTime}>{`\u00E0s ${confirmedTime}`}</Text>
            )}
            {streak > 0 && (
              <Text style={styles.completedStreak}>{`${streak} dias seguidos`}</Text>
            )}
          </View>
          {nextCheckinTime && (
            <Text style={styles.nextCheckinText}>
              {`Pr\u00F3ximo check-in \u00E0s ${nextCheckinTime}`}
            </Text>
          )}
        </>
      );
    }

    // waiting state
    return (
      <>
        <View
          style={[
            styles.checkinButton,
            styles.waitingButton,
          ]}
        >
          <View style={styles.checkinButtonInner}>
            <Text style={[styles.checkinButtonTitle, { opacity: 0.6 }]}>{t("checkin_done")}</Text>
            <View style={[styles.checkinDivider, { opacity: 0.3 }]} />
            <Ionicons name="finger-print" size={44} color={COLORS.white} style={{ opacity: 0.5 }} />
            <Text style={[styles.checkinButtonSub, { opacity: 0.6 }]}>
              {nextCheckinTime ? `Pr\u00F3ximo \u00E0s ${nextCheckinTime}` : `Pr\u00F3ximo check-in`}
            </Text>
          </View>
        </View>
      </>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <Text style={styles.greeting}>
          {getGreeting()}, {elderName}
        </Text>
        <Text style={styles.dateText}>
          {new Date().toLocaleDateString("pt-BR", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </Text>

        {/* Main Check-in Area */}
        <View style={styles.checkinContainer}>
          {renderCheckinArea()}
        </View>

        {/* Nap Mode */}
        {isNapping ? (
          <TouchableOpacity
            onPress={cancelNap}
            style={{
              flexDirection: "row", alignItems: "center", justifyContent: "center",
              backgroundColor: SH_GOLD, borderRadius: 12, padding: 14, marginBottom: 16,
            }}
          >
            <Ionicons name="moon" size={20} color="#FFF" style={{ marginRight: 8 }} />
            <Text style={{ color: "#FFF", fontFamily: serifFont, fontSize: 15 }}>
              Cochilando ate {napUntil ? new Date(napUntil).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : ""} — toque para acordar
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={() => handleNap(60)}
            style={{
              flexDirection: "row", alignItems: "center", justifyContent: "center",
              backgroundColor: "#FFF", borderRadius: 12, padding: 14, marginBottom: 16,
              borderWidth: 1, borderColor: SH_GOLD,
            }}
          >
            <Ionicons name="moon-outline" size={20} color={SH_GOLD} style={{ marginRight: 8 }} />
            <Text style={{ color: SH_GREEN, fontFamily: serifFont, fontSize: 15 }}>
              Vou cochilar (pausar 1 hora)
            </Text>
          </TouchableOpacity>
        )}

        {/* Health Summary Card — always show for elders */}
        {state.currentUser?.role === "elder" && (
          <Card style={styles.healthSummaryCard}>
            <View style={styles.healthSummaryHeader}>
              <Ionicons name="heart-circle" size={22} color={SH_GREEN} />
              <Text style={styles.healthSummaryTitle}>{t("health_title")}</Text>
              {healthSummary.lastUpdated && (
                <Text style={styles.healthSummaryTimestamp}>
                  {(() => {
                    const d = new Date(healthSummary.lastUpdated!);
                    const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
                    if (diffMin < 1) return "agora";
                    if (diffMin < 60) return `há ${diffMin} min`;
                    const diffH = Math.floor(diffMin / 60);
                    if (diffH < 24) return `há ${diffH}h`;
                    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
                  })()}
                </Text>
              )}
            </View>
            <View style={styles.healthSummaryGrid}>
              <View style={styles.healthSummaryItem}>
                <Ionicons name="heart" size={18} color="#E74C3C" />
                <Text style={healthSummary.heartRate != null ? styles.healthSummaryValue : styles.healthSummaryValueEmpty}>
                  {healthSummary.heartRate != null ? healthSummary.heartRate : "\u2014"}
                </Text>
                <Text style={styles.healthSummaryUnit}>bpm</Text>
              </View>
              <View style={styles.healthSummaryItem}>
                <Ionicons name="footsteps" size={18} color={SH_GREEN} />
                <Text style={healthSummary.steps != null ? styles.healthSummaryValue : styles.healthSummaryValueEmpty}>
                  {healthSummary.steps != null ? healthSummary.steps.toLocaleString() : "\u2014"}
                </Text>
                <Text style={styles.healthSummaryUnit}>passos</Text>
              </View>
              <View style={styles.healthSummaryItem}>
                <Ionicons name="moon" size={18} color="#8E44AD" />
                <Text style={healthSummary.sleepHours != null ? styles.healthSummaryValue : styles.healthSummaryValueEmpty}>
                  {healthSummary.sleepHours != null ? `${healthSummary.sleepHours}h` : "\u2014"}
                </Text>
                <Text style={styles.healthSummaryUnit}>sono</Text>
              </View>
              <View style={styles.healthSummaryItem}>
                <Ionicons name="water" size={18} color="#3498DB" />
                <Text style={healthSummary.spo2 != null ? styles.healthSummaryValue : styles.healthSummaryValueEmpty}>
                  {healthSummary.spo2 != null ? `${healthSummary.spo2}%` : "\u2014"}
                </Text>
                <Text style={styles.healthSummaryUnit}>SpO2</Text>
              </View>
            </View>
          </Card>
        )}

        {/* Today's Status */}
        <Card style={styles.statusCard}>
          <View style={styles.statusRow}>
            <Ionicons name="today" size={24} color={COLORS.primary} />
            <Text style={styles.statusLabel}>{t("checkin_today")}</Text>
            <Text style={styles.statusValue}>{confirmedToday}</Text>
          </View>

          {todayCheckins.length > 0 && (
            <View style={styles.checkinList}>
              {todayCheckins.slice(0, 5).map((ci) => (
                <View key={ci.id} style={styles.checkinItem}>
                  <Text style={styles.checkinTime}>
                    {new Date(ci.scheduledAt).toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </Text>
                  <StatusBadge status={ci.status} />
                </View>
              ))}
            </View>
          )}
        </Card>

        {/* Quick info cards */}
        <View style={styles.infoRow}>
          <Card style={styles.infoCard}>
            <Ionicons name="medical" size={28} color={COLORS.primary} />
            <Text style={styles.infoValue}>{state.medications.length}</Text>
            <Text style={styles.infoLabel}>{t("meds_title")}</Text>
          </Card>

          <Card style={styles.infoCard}>
            <Ionicons name="people" size={28} color={COLORS.primary} />
            <Text style={styles.infoValue}>
              {state.emergencyContacts.length}
            </Text>
            <Text style={styles.infoLabel}>Contatos</Text>
          </Card>
        </View>

        {/* Fall detection status */}
        {isFamilia && (
          <Card style={styles.sensorCard}>
            <View style={styles.sensorRow}>
              <Ionicons name="fitness" size={20} color={COLORS.primary} />
              <Text style={styles.sensorText}>
                Deteccao de quedas: {fallDetectionService.isActive() ? "Ativa" : "Inativa"}
              </Text>
            </View>
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const BUTTON_SIZE = Math.min(SCREEN.width * 0.7, 320);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    padding: SPACING.lg,
    alignItems: "center",
  },
  greeting: {
    ...FONTS.elderTitle,
    textAlign: "center",
    marginTop: SPACING.md,
  },
  dateText: {
    ...FONTS.elderBody,
    color: COLORS.textSecondary,
    fontSize: 18,
    textAlign: "center",
    marginTop: SPACING.xs,
    textTransform: "capitalize",
  },
  checkinContainer: {
    alignItems: "center",
    marginVertical: SPACING.xl,
  },
  checkinButton: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  pendingButton: {
    backgroundColor: SH_GREEN,
    borderWidth: 3,
    borderColor: SH_GOLD,
  },
  waitingButton: {
    backgroundColor: "#3D5A4E",
    borderWidth: 2,
    borderColor: "rgba(201,169,110,0.3)",
  },
  checkinButtonInner: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    width: BUTTON_SIZE * 0.68, // constrain to inscribed circle area
  },
  checkinButtonTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: COLORS.white,
    letterSpacing: 2,
    fontFamily: Platform.OS === "ios" ? "Georgia" : "serif",
    textAlign: "center",
  },
  checkinDivider: {
    width: 40,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.5)",
    marginVertical: 8,
  },
  checkinButtonSub: {
    fontSize: 12,
    color: "rgba(255,255,255,0.85)",
    marginTop: 6,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  checkinButtonText: {
    ...FONTS.elderButton,
    marginTop: SPACING.sm,
    textAlign: "center",
  },
  pendingText: {
    ...FONTS.elderBody,
    color: COLORS.warning,
    fontSize: 18,
    marginTop: SPACING.md,
    fontWeight: "500",
  },
  // Completed state
  completedCard: {
    backgroundColor: "#E8F0EC",
    borderWidth: 1,
    borderColor: SH_GREEN,
    borderRadius: 8,
    paddingVertical: 28,
    paddingHorizontal: 32,
    alignItems: "center",
    width: BUTTON_SIZE,
  },
  completedTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: SH_GREEN,
    marginTop: SPACING.sm,
    letterSpacing: 0.3,
  },
  completedTime: {
    fontSize: 15,
    color: "#5C5549",
    marginTop: 4,
  },
  completedStreak: {
    fontSize: 13,
    color: SH_GOLD,
    marginTop: SPACING.md,
    fontWeight: "600",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  nextCheckinText: {
    fontSize: 14,
    color: SH_GRAY,
    marginTop: SPACING.md,
    letterSpacing: 0.3,
  },
  // Waiting state
  waitingTimeText: {
    fontSize: 16,
    color: SH_GRAY,
    marginTop: SPACING.md,
    fontWeight: "500",
    letterSpacing: 0.4,
  },
  // Status card
  statusCard: {
    width: "100%",
    marginBottom: SPACING.md,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
  },
  statusLabel: {
    ...FONTS.subtitle,
    flex: 1,
  },
  statusValue: {
    ...FONTS.title,
    color: COLORS.primary,
  },
  checkinList: {
    marginTop: SPACING.md,
    gap: SPACING.sm,
  },
  checkinItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: SPACING.xs,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  checkinTime: {
    ...FONTS.body,
    fontWeight: "500",
  },
  infoRow: {
    flexDirection: "row",
    gap: SPACING.md,
    width: "100%",
    marginBottom: SPACING.md,
  },
  infoCard: {
    flex: 1,
    alignItems: "center",
    paddingVertical: SPACING.lg,
  },
  infoValue: {
    ...FONTS.title,
    color: COLORS.primary,
    marginTop: SPACING.xs,
  },
  infoLabel: {
    ...FONTS.caption,
    marginTop: SPACING.xs,
  },
  // Health summary card
  healthSummaryCard: {
    width: "100%",
    marginBottom: SPACING.md,
  },
  healthSummaryHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.xs,
    marginBottom: SPACING.sm,
  },
  healthSummaryTitle: {
    ...FONTS.subtitle,
    fontWeight: "500",
    flex: 1,
  },
  healthSummaryTimestamp: {
    ...FONTS.small,
    color: COLORS.textLight,
    fontStyle: "italic",
  },
  healthSummaryValueEmpty: {
    fontSize: 20,
    fontWeight: "300",
    fontFamily: Platform.OS === "ios" ? "Georgia" : "serif",
    color: COLORS.textLight,
    marginTop: 4,
  },
  healthSummaryGrid: {
    flexDirection: "row",
    justifyContent: "space-around",
    flexWrap: "wrap",
  },
  healthSummaryItem: {
    alignItems: "center",
    minWidth: 70,
    paddingVertical: SPACING.xs,
  },
  healthSummaryValue: {
    fontSize: 20,
    fontWeight: "300",
    fontFamily: Platform.OS === "ios" ? "Georgia" : "serif",
    color: COLORS.textPrimary,
    marginTop: 4,
  },
  healthSummaryUnit: {
    ...FONTS.small,
    color: COLORS.textLight,
    marginTop: 2,
  },
  sensorCard: {
    width: "100%",
  },
  sensorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
  },
  sensorText: {
    ...FONTS.body,
  },
});
