import { cache } from "react";

/**
 * Non-secret app settings from public.app_config (migration 014).
 * Server components only.
 *
 * Read via plain PostgREST fetch with the anon key (the table is
 * anon-readable by design) instead of the cookie-bound supabase server
 * client: cookies() would force every page that renders the footer —
 * including the static homepage and legal pages — into dynamic rendering.
 * `revalidate` keeps the value fresh within an hour of a config change;
 * cache() dedupes within a render pass; the fallback keeps pages rendering
 * even if the fetch fails.
 */

const FALLBACK_SUPPORT_EMAIL = "adilharis2001@gmail.com";

async function getConfigValue(key: string): Promise<string | null> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) return null;
    const res = await fetch(
      `${url}/rest/v1/app_config?key=eq.${encodeURIComponent(key)}&select=value`,
      {
        headers: { apikey: anon, Authorization: `Bearer ${anon}` },
        next: { revalidate: 3600 },
      }
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as { value?: string }[];
    return rows[0]?.value?.trim() || null;
  } catch {
    return null;
  }
}

export const getSupportEmail = cache(async (): Promise<string> => {
  return (await getConfigValue("support_email")) ?? FALLBACK_SUPPORT_EMAIL;
});

/** Runtime kill switch for paid review purchases (073). */
export const getCoachReviewsEnabled = cache(async (): Promise<boolean> => {
  return (await getConfigValue("coach_reviews_enabled")) === "true";
});

/**
 * Current platform-fee config, for showing a coach what they'd receive.
 * The truth at purchase time is review_fee_for() in the database; this is
 * display only and shares its defaults.
 */
export const getReviewFeeConfig = cache(
  async (): Promise<{
    mode: "percent" | "fixed";
    percent: number;
    fixedCents: number;
  }> => {
    const [mode, percent, fixed] = await Promise.all([
      getConfigValue("review_fee_mode"),
      getConfigValue("review_fee_percent"),
      getConfigValue("review_fee_fixed_cents"),
    ]);
    return {
      mode: mode === "fixed" ? "fixed" : "percent",
      percent: Number(percent) > 0 ? Number(percent) : 15,
      fixedCents: Number(fixed) >= 0 ? Number(fixed) : 500,
    };
  },
);
