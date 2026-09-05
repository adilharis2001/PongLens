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
  storage: "Storage is full. Delete a video or manage your allowance in Account.",
  unavailable: "Could not check your storage allowance. Please try again.",
  queue: "Your queue is full. Wait for a match to finish.",
  daily: "Daily upload limit reached. Try again tomorrow.",
} as const;

// 1 processing + 3 queued: reject once 4 jobs are already in flight.
const MAX_ACTIVE_JOBS = 4;

export interface StorageState {
  // The EFFECTIVE limit: base allowance plus unexpired entitlements (096).
  storage_limit_bytes: number;
  daily_upload_limit: number;
  used_bytes: number;
  uploads_today: number;
  active_jobs: number;
  pending_request: boolean;
  // Commerce breakdown (096); absent until the migration applies.
  base_limit_bytes?: number;
  entitlement_bytes?: number;
  entitlement_expires_at?: string | null;
  held_bytes?: number;
}

/**
 * Returns a user-facing error message when the upload must be rejected,
 * or null when it may proceed. A failed lookup cannot authorize extra usage.
 */
export async function checkUploadAllowed(
  supabase: SupabaseClient,
  incomingBytes: number,
  opts?: {
    /**
     * Commerce mode (096): uploads no longer enqueue a job, so the queue
     * rule moves to claim_processing and stops gating uploads.
     */
    skipQueue?: boolean;
    /**
     * Commerce mode (096): retires the legacy daily count. See the rule
     * itself for why metering makes it redundant.
     */
    skipDaily?: boolean;
    /**
     * An upload for an active review order is held outside the player's
     * allowance until the order completes; the storage rule skips it.
     * The order itself is validated by register_upload at completion.
     */
    skipStorage?: boolean;
  }
): Promise<string | null> {
  const { data, error } = await supabase.rpc("my_storage_state").single();
  if (error || !data) {
    console.error("quota check failed:", error);
    return QUOTA_ERRORS.unavailable;
  }
  const s = data as StorageState;
  if (
    !opts?.skipStorage &&
    (s.used_bytes >= s.storage_limit_bytes ||
      s.used_bytes + Math.max(0, incomingBytes) > s.storage_limit_bytes)
  ) {
    return QUOTA_ERRORS.storage;
  }
  if (!opts?.skipQueue && s.active_jobs >= MAX_ACTIVE_JOBS) {
    return QUOTA_ERRORS.queue;
  }
  // The daily rule is legacy anti-spam from before anything was metered.
  // In commerce mode minutes and storage both bill per unit, so a count of
  // uploads per day protects nothing that is not already protected — it
  // only walls off the player who filmed a tournament and came home with
  // five matches, which is the best day this product gets. Same reasoning
  // that already retires the queue rule above. The column stays for abuse
  // response; it simply stops applying by default.
  //
  // An order-funded upload skips it too: a paid review must not bounce off
  // an anti-spam limit meant for personal uploads.
  if (
    !opts?.skipDaily &&
    !opts?.skipStorage &&
    s.uploads_today >= s.daily_upload_limit
  ) {
    return QUOTA_ERRORS.daily;
  }
  return null;
}
