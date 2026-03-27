/**
 * ProfileSyncService — periodically fetches the user profile from the server
 * and updates subscription state so admin changes reflect within ~1 minute.
 */

import { fetchProfile } from "./ApiService";

const SYNC_INTERVAL_MS = 60_000; // 60 seconds

type User = { apiUrl?: string; token?: string } | null;
type Dispatch = (action: any) => void;

let intervalId: ReturnType<typeof setInterval> | null = null;

async function syncProfile(user: User, dispatch: Dispatch): Promise<void> {
  try {
    const profile = await fetchProfile(user);
    if (!profile) return;

    // Update subscription from server (single source of truth)
    const serverSub = profile.subscription || "free";
    dispatch({
      type: "SET_SUBSCRIPTION",
      payload: {
        tier: serverSub === "pro" ? "pro" : "free",
        isActive: true,
      },
    });
  } catch (e) {
    console.warn("[ProfileSync] Failed to sync profile:", e);
  }
}

export function startProfileSync(user: User, dispatch: Dispatch): void {
  // Stop any existing sync first
  stopProfileSync();

  if (!user) return;

  // Run immediately on start
  syncProfile(user, dispatch);

  // Then every 60 seconds
  intervalId = setInterval(() => {
    syncProfile(user, dispatch);
  }, SYNC_INTERVAL_MS);

  console.log("[ProfileSync] Started (interval: 60s)");
}

export function stopProfileSync(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
    console.log("[ProfileSync] Stopped");
  }
}
