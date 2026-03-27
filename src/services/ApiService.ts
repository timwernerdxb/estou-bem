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
    const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(10000) });
    return res;
  } catch (err) {
    console.warn("[ApiService] Network error:", (err as Error).message);
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
  body: { stock: number }
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
  body: { user_id: number; movement_detected?: boolean; heart_rate?: number; spo2?: number; sleep_hours?: number }
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
