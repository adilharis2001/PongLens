import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The suppression list, read side (104).
 *
 * One rule governs this whole file: **it fails open.** If the lookup
 * errors, the service role key is missing, or Supabase is having a bad
 * minute, the answer is "not suppressed" and the mail goes out. A
 * suppression list exists to protect domain reputation, which is a slow
 * problem. Silently swallowing every receipt and review notification
 * because a query failed is a fast one. Getting that backwards would turn
 * a database hiccup into a total outage of the app's email.
 *
 * Addresses are lowercased on both sides. Resend reports whatever casing
 * the sender typed, and the send path has whatever the user signed up
 * with.
 */

export function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

export async function isSuppressed(address: string): Promise<boolean> {
  const key = normalizeAddress(address);
  if (!key) return false;
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("email_suppressions")
      .select("address")
      .eq("address", key)
      .maybeSingle();
    if (error) {
      console.error("suppression: lookup failed, sending anyway:", error.message);
      return false;
    }
    return data !== null;
  } catch (err) {
    console.error("suppression: lookup threw, sending anyway:", err);
    return false;
  }
}

/**
 * Wraps a send so the caller reads as one line. Returns true when the mail
 * was skipped, so the caller can log its own context and return early.
 */
export async function skipIfSuppressed(
  address: string,
  label: string,
): Promise<boolean> {
  if (await isSuppressed(address)) {
    console.log(`suppression: skipped ${label} to ${normalizeAddress(address)}`);
    return true;
  }
  return false;
}
