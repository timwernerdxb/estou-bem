/**
 * ApiService — thin wrapper around fetch for syncing local data to the backend.
 *
 * Every public method is fire-and-forget safe: if the server is unreachable the
 * app keeps working locally.  Results are returned so callers can merge server
 * state when they choose to.
 */

const DEFAULT_API_URL = "https://estou-bem-web-production.up.railway.app";

function getApiUrl(user: { apiUrl?: string } | null | undefined): string {
  return user?.apiUrl || process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL;
}

function getHeaders(token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

/** Return null instead of throwing when the network is down. */
async function safeFetch(
  url: string,
  opts: RequestInit
): Promise<Response | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, { ...opts, signal: controller.signal });
    clearTimeout(timeoutId);
    return res;
  } catch (err) {
    console.warn("[ApiService] Network error for", url, ":", (err as Error).message);
    return null;
  }
}

// ─── Check-ins ────────────────────────────────────────────────

export async function fetchCheckins(
  user: { apiUrl?: string; token?: string } | null,
  params?: { date?: string; limit?: number }
): Promise<any[] | null> {
  if (!user?.token) return null;
  const qs = new URLSearchParams();
  if (params?.date) qs.set("date", params.date);
  if (params?.limit) qs.set("limit", String(params.limit));
  const url = `${getApiUrl(user)}/api/checkins${qs.toString() ? "?" + qs : ""}`;
  const res = await safeFetch(url, { method: "GET", headers: getHeaders(user.token) });
  if (!res || !res.ok) return null;
  return res.json();
}

export async function postCheckin(
  user: { apiUrl?: string; token?: string } | null,
  body: { time: string; status: string; date?: string }
): Promise<any | null> {
  if (!user?.token) return null;
  const res = await safeFetch(`${getApiUrl(user)}/api/checkins`, {
    method: "POST",
    headers: getHeaders(user.token),
    body: JSON.stringify(body),
  });
  if (!res || !res.ok) return null;
  return res.json();
}

export async function putCheckin(
  user: { apiUrl?: string; token?: string } | null,
  id: number | string,
  body: { status: string; time?: string }
): Promise<any | null> {
  if (!user?.token) return null;
  const res = await safeFetch(`${getApiUrl(user)}/api/checkins/${id}`, {
    method: "PUT",
    headers: getHeaders(user.token),
    body: JSON.stringify(body),
  });
  if (!res || !res.ok) return null;
  return res.json();
}

// ─── Medications ──────────────────────────────────────────────

export async function fetchMedications(
  user: { apiUrl?: string; token?: string } | null
): Promise<any[] | null> {
  if (!user?.token) return null;
  const res = await safeFetch(`${getApiUrl(user)}/api/medications`, {
    method: "GET",
    headers: getHeaders(user.token),
  });
  if (!res || !res.ok) return null;
  return res.json();
}

export async function postMedication(
  user: { apiUrl?: string; token?: string } | null,
  body: {
    name: string;
    dosage?: string;
    frequency?: string;
    time?: string;
    stock?: number;
    unit?: string;
    low_threshold?: number;
  }
): Promise<any | null> {
  if (!user?.token) return null;
  const res = await safeFetch(`${getApiUrl(user)}/api/medications`, {
    method: "POST",
    headers: getHeaders(user.token),
    body: JSON.stringify(body),
  });
  if (!res || !res.ok) return null;
  return res.json();
}

export async function putMedication(
  user: { apiUrl?: string; token?: string } | null,
  id: number | string,
  body: { stock?: number; name?: string; dosage?: string; frequency?: string; time?: string; unit?: string; low_threshold?: number }
): Promise<any | null> {
  if (!user?.token) return null;
  const res = await safeFetch(`${getApiUrl(user)}/api/medications/${id}`, {
    method: "PUT",
    headers: getHeaders(user.token),
    body: JSON.stringify(body),
  });
  if (!res || !res.ok) return null;
  return res.json();
}

export async function deleteMedication(
  user: { apiUrl?: string; token?: string } | null,
  id: number | string
): Promise<boolean> {
  if (!user?.token) return false;
  const res = await safeFetch(`${getApiUrl(user)}/api/medications/${id}`, {
    method: "DELETE",
    headers: getHeaders(user.token),
  });
  return !!res && res.ok;
}

// ─── Emergency Contacts ──────────────────────────────────────

export async function fetchContacts(
  user: { apiUrl?: string; token?: string } | null
): Promise<any[] | null> {
  if (!user?.token) return null;
  const res = await safeFetch(`${getApiUrl(user)}/api/contacts`, {
    method: "GET",
    headers: getHeaders(user.token),
  });
  if (!res || !res.ok) return null;
  return res.json();
}

export async function postContact(
  user: { apiUrl?: string; token?: string } | null,
  body: { name: string; phone: string; relationship?: string; priority?: number }
): Promise<any | null> {
  if (!user?.token) return null;
  const res = await safeFetch(`${getApiUrl(user)}/api/contacts`, {
    method: "POST",
    headers: getHeaders(user.token),
    body: JSON.stringify(body),
  });
  if (!res || !res.ok) return null;
  return res.json();
}

export async function deleteContact(
  user: { apiUrl?: string; token?: string } | null,
  id: number | string
): Promise<boolean> {
  if (!user?.token) return false;
  const res = await safeFetch(`${getApiUrl(user)}/api/contacts/${id}`, {
    method: "DELETE",
    headers: getHeaders(user.token),
  });
  return !!res && res.ok;
}

// ─── Health Entries ───────────────────────────────────────────

export async function fetchHealth(
  user: { apiUrl?: string; token?: string } | null,
  limit?: number
): Promise<any[] | null> {
  if (!user?.token) return null;
  const qs = limit ? `?limit=${limit}` : "";
  const res = await safeFetch(`${getApiUrl(user)}/api/health${qs}`, {
    method: "GET",
    headers: getHeaders(user.token),
  });
  if (!res || !res.ok) return null;
  return res.json();
}

export async function postHealth(
  user: { apiUrl?: string; token?: string } | null,
  body: { type: string; value: number; unit: string; time?: string; date?: string; notes?: string }
): Promise<any | null> {
  if (!user?.token) return null;
  const res = await safeFetch(`${getApiUrl(user)}/api/health`, {
    method: "POST",
    headers: getHeaders(user.token),
    body: JSON.stringify(body),
  });
  if (!res || !res.ok) return null;
  return res.json();
}

// ─── Fall Detection ──────────────────────────────────────────

export async function postFallDetected(
  user: { apiUrl?: string; token?: string } | null,
  body: { user_id: number; timestamp: string; heart_rate?: number; location?: { lat: number; lng: number } }
): Promise<any | null> {
  if (!user?.token) return null;
  const res = await safeFetch(`${getApiUrl(user)}/api/fall-detected`, {
    method: "POST",
    headers: getHeaders(user.token),
    body: JSON.stringify(body),
  });
  if (!res || !res.ok) return null;
  return res.json();
}

export async function postFallCancelled(
  user: { apiUrl?: string; token?: string } | null,
  body: { user_id: number }
): Promise<any | null> {
  if (!user?.token) return null;
  const res = await safeFetch(`${getApiUrl(user)}/api/fall-cancelled`, {
    method: "POST",
    headers: getHeaders(user.token),
    body: JSON.stringify(body),
  });
  if (!res || !res.ok) return null;
  return res.json();
}

// ─── Family Elder Status ──────────────────────────────────────

export async function postFamilyCheckinOverride(
  user: { apiUrl?: string; token?: string } | null,
  body: { time: string; date: string; notes?: string }
): Promise<{ ok: boolean; checkin: any; duplicate?: boolean } | null> {
  if (!user?.token) return null;
  const res = await safeFetch(`${getApiUrl(user)}/api/family/checkin-override`, {
    method: "POST",
    headers: getHeaders(user.token),
    body: JSON.stringify(body),
  });
  if (!res || !res.ok) return null;
  return res.json();
}

export async function fetchElderStatus(
  user: { apiUrl?: string; token?: string } | null
): Promise<any | null> {
  if (!user?.token) return null;
  const res = await safeFetch(`${getApiUrl(user)}/api/family/elder-status`, {
    method: "GET",
    headers: getHeaders(user.token),
  });
  if (!res || !res.ok) return null;
  return res.json();
}

// ─── LGPD Consent ─────────────────────────────────────────────

export async function postConsent(
  user: { apiUrl?: string; token?: string } | null,
  body: { type: string; accepted: boolean }
): Promise<any | null> {
  if (!user?.token) return null;
  const res = await safeFetch(`${getApiUrl(user)}/api/consent`, {
    method: "POST",
    headers: getHeaders(user.token),
    body: JSON.stringify(body),
  });
  if (!res || !res.ok) return null;
  return res.json();
}

// ─── User Profile ─────────────────────────────────────────────

export async function fetchProfile(
  user: { apiUrl?: string; token?: string } | null
): Promise<any | null> {
  if (!user?.token) return null;
  const res = await safeFetch(`${getApiUrl(user)}/api/profile`, {
    method: "GET",
    headers: getHeaders(user.token),
  });
  if (!res || !res.ok) return null;
  return res.json();
}

// ─── Settings ─────────────────────────────────────────────────

export async function fetchSettings(
  user: { apiUrl?: string; token?: string } | null
): Promise<any | null> {
  if (!user?.token) return null;
  const res = await safeFetch(`${getApiUrl(user)}/api/settings`, {
    method: "GET",
    headers: getHeaders(user.token),
  });
  if (!res || !res.ok) return null;
  return res.json();
}

export async function fetchGamification(
  user: { apiUrl?: string; token?: string } | null
): Promise<any | null> {
  if (!user?.token) return null;
  const res = await safeFetch(`${getApiUrl(user)}/api/gamification`, {
    method: "GET",
    headers: getHeaders(user.token),
  });
  if (!res || !res.ok) return null;
  return res.json();
}

export async function postCheckinReward(
  user: { apiUrl?: string; token?: string } | null
): Promise<any | null> {
  if (!user?.token) return null;
  const res = await safeFetch(`${getApiUrl(user)}/api/gamification/checkin-reward`, {
    method: "POST",
    headers: getHeaders(user.token),
    body: JSON.stringify({}),
  });
  if (!res || !res.ok) return null;
  return res.json();
}

export async function postActivityUpdate(
  user: { apiUrl?: string; token?: string } | null,
  body: { user_id: number; movement_detected?: boolean; heart_rate?: number; steps?: number; spo2?: number; sleep_hours?: number; active_calories?: number }
): Promise<any | null> {
  if (!user?.token) return null;
  const res = await safeFetch(`${getApiUrl(user)}/api/activity-update`, {
    method: "POST",
    headers: getHeaders(user.token),
    body: JSON.stringify(body),
  });
  if (!res || !res.ok) return null;
  return res.json();
}

export async function testPushNotification(
  user: { apiUrl?: string; token?: string } | null
): Promise<{ ok: boolean; tokenCount?: number; tokens?: string[]; error?: string } | null> {
  if (!user?.token) return null;
  const res = await safeFetch(`${getApiUrl(user)}/api/push-test`, {
    method: "POST",
    headers: getHeaders(user.token),
    body: JSON.stringify({}),
  });
  if (!res) return { ok: false, error: "No response from server" };
  return res.json();
}

export async function fetchNapStatus(
  user: { apiUrl?: string; token?: string } | null
): Promise<any | null> {
  if (!user?.token) return null;
  const res = await safeFetch(`${getApiUrl(user)}/api/nap`, {
    method: "GET",
    headers: getHeaders(user.token),
  });
  if (!res || !res.ok) return null;
  return res.json();
}

// ─── Location & Geofencing ────────────────────────────────

export async function postLocation(
  user: { apiUrl?: string; token?: string } | null,
  latitude: number,
  longitude: number,
  accuracy?: number
): Promise<any | null> {
  if (!user?.token) return null;
  const res = await safeFetch(`${getApiUrl(user)}/api/location`, {
    method: "POST",
    headers: getHeaders(user.token),
    body: JSON.stringify({ latitude, longitude, accuracy }),
  });
  if (!res || !res.ok) return null;
  return res.json();
}

export async function getElderLatestLocation(
  user: { apiUrl?: string; token?: string } | null
): Promise<{ location: any | null; geofences: any[] } | null> {
  if (!user?.token) return null;
  const res = await safeFetch(`${getApiUrl(user)}/api/location/latest`, {
    method: "GET",
    headers: getHeaders(user.token),
  });
  if (!res || !res.ok) return null;
  return res.json();
}

export async function getGeofences(
  user: { apiUrl?: string; token?: string } | null
): Promise<any[] | null> {
  if (!user?.token) return null;
  const res = await safeFetch(`${getApiUrl(user)}/api/geofences`, {
    method: "GET",
    headers: getHeaders(user.token),
  });
  if (!res || !res.ok) return null;
  return res.json();
}

export async function createGeofence(
  user: { apiUrl?: string; token?: string } | null,
  body: { name: string; latitude: number; longitude: number; radius_meters?: number }
): Promise<any | null> {
  if (!user?.token) return null;
  const res = await safeFetch(`${getApiUrl(user)}/api/geofences`, {
    method: "POST",
    headers: getHeaders(user.token),
    body: JSON.stringify(body),
  });
  if (!res || !res.ok) return null;
  return res.json();
}

export async function updateGeofence(
  user: { apiUrl?: string; token?: string } | null,
  id: number | string,
  body: { name?: string; latitude?: number; longitude?: number; radius_meters?: number; is_active?: boolean }
): Promise<any | null> {
  if (!user?.token) return null;
  const res = await safeFetch(`${getApiUrl(user)}/api/geofences/${id}`, {
    method: "PUT",
    headers: getHeaders(user.token),
    body: JSON.stringify(body),
  });
  if (!res || !res.ok) return null;
  return res.json();
}

export async function deleteGeofence(
  user: { apiUrl?: string; token?: string } | null,
  id: number | string
): Promise<boolean> {
  if (!user?.token) return false;
  const res = await safeFetch(`${getApiUrl(user)}/api/geofences/${id}`, {
    method: "DELETE",
    headers: getHeaders(user.token),
  });
  return !!res && res.ok;
}

export async function putSettings(
  user: { apiUrl?: string; token?: string } | null,
  body: {
    checkin_times?: string[];
    checkin_mode?: string;
    checkin_interval_hours?: number;
    checkin_window_start?: string;
    checkin_window_end?: string;
    escalation_minutes?: number;
    samu_auto_call?: boolean;
    language?: string;
  }
): Promise<boolean> {
  if (!user?.token) return false;
  const res = await safeFetch(`${getApiUrl(user)}/api/settings`, {
    method: "PUT",
    headers: getHeaders(user.token),
    body: JSON.stringify(body),
  });
  return !!res && res.ok;
}

// ─── Health Readings (Watch-posted data) ─────────────────────
/**
 * Fetch recent health readings for a user from the server.
 * The Watch app posts readings here via /api/watch/health.
 * Used by FamilyDashboard to show "Minha Saúde" from Watch data,
 * bypassing the expo-healthkit native module entirely.
 */
export async function fetchUserHealthReadings(
  user: { apiUrl?: string; token?: string } | null,
  userId: number | string
): Promise<any[] | null> {
  if (!user?.token) return null;
  const url = `${getApiUrl(user)}/api/health-readings/${userId}?limit=30`;
  const res = await safeFetch(url, { method: "GET", headers: getHeaders(user.token) });
  if (!res?.ok) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}
