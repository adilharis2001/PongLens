import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { BillingMode } from "./gateway";

/**
 * The caller's billing mode, asked of the database because the database
 * is where the answer lives: current_billing_mode() (092) pins QA
 * accounts to 'test' and reads the admin's app_config toggle. Anything
 * unexpected — error, no session, odd value — resolves to 'live', the
 * mode in which no fake route opens and no real charge is skipped.
 */
export async function callerBillingMode(
  supabase: SupabaseClient,
): Promise<BillingMode> {
  const { data, error } = await supabase.rpc("current_billing_mode");
  if (error || data !== "test") return "live";
  return "test";
}
