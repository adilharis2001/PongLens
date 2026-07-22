import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side upload gate (SPEC follow-up: storage quotas + anti-spam).
 * Called by /api/upload-url (create) and /api/import-url before any work
 * starts. Reads the caller's quota state via the my_storage_state() RPC
 * (SECURITY DEFINER; creates the user_quotas row on first use).
 *
 * Rules, in order:
 *   a. storage:  used + estimated incoming > limit
 *   b. queue:    4+ jobs already queued/processing (reclips excluded)
 *   c. daily:    daily_upload_limit uploads already created today (UTC)
 */

export const QUOTA_ERRORS = {
  storage: "Storage is full. Delete a match or request more space.",
  queue: "Your queue is full. Wait for a match to finish.",
  daily: "Daily upload limit reached. Try again tomorrow.",
} as const;

// 1 processing + 3 queued: reject once 4 jobs are already in flight.
const MAX_ACTIVE_JOBS = 4;

export interface StorageState {
  storage_limit_bytes: number;
  daily_upload_limit: number;
  used_bytes: number;
  uploads_today: number;
  active_jobs: number;
  pending_request: boolean;
}

/**
 * Returns a user-facing error message when the upload must be rejected,
 * or null when it may proceed. Fails open on RPC errors (a broken quota
 * lookup must not take uploads down) — the error is logged by the caller.
 */
export async function checkUploadAllowed(
  supabase: SupabaseClient,
  incomingBytes: number
): Promise<string | null> {
  const { data, error } = await supabase.rpc("my_storage_state").single();
  if (error || !data) {
    console.error("quota check failed (allowing upload):", error);
    return null;
  }
  const s = data as StorageState;
  if (s.used_bytes + Math.max(0, incomingBytes) > s.storage_limit_bytes) {
    return QUOTA_ERRORS.storage;
  }
  if (s.active_jobs >= MAX_ACTIVE_JOBS) {
    return QUOTA_ERRORS.queue;
  }
  if (s.uploads_today >= s.daily_upload_limit) {
    return QUOTA_ERRORS.daily;
  }
  return null;
}
