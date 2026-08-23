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

const FALLBACK_SUPPORT_EMAIL = "support@ponglens.com";

/**
 * Who may reach the admin pages. Deliberately a constant rather than an
 * app_config row: is_admin() (migration 010) compares against this same
 * literal and is the real boundary, since every admin RPC re-checks it.
 * A runtime-editable copy could only drift from the SQL, and changing the
 * admin needs a migration either way.
 *
 * This used to read support_email, which quietly tied the admin's identity
 * to the address printed in the footer. Pointing support at a real mailbox
 * would then have locked the admin out of /admin and 403'd the players
 * portal's media links.
 */
export const ADMIN_EMAIL = "adilharis2001@gmail.com";

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

/** Runtime kill switch for the usage-based commercial model (096). */
export const getCommerceEnabled = cache(async (): Promise<boolean> => {
  return (await getConfigValue("commerce_enabled")) === "true";
});

/** Source-video minutes a paid or sponsored review covers (096). */
export const getReviewIncludedMinutes = cache(async (): Promise<number> => {
  const raw = Number(await getConfigValue("review_included_minutes"));
  return Number.isInteger(raw) && raw > 0 ? raw : 45;
});

async function getConfigJson(key: string): Promise<unknown> {
  const raw = await getConfigValue(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export const getMinutePacks = cache(async () => {
  const { parseMinutePacks, DEFAULT_MINUTE_PACKS } = await import(
    "@/lib/commerce/packs"
  );
  const parsed = parseMinutePacks(await getConfigJson("minute_packs"));
  return parsed.length > 0 ? parsed : DEFAULT_MINUTE_PACKS;
});

export const getStoragePacks = cache(async () => {
  const { parseStoragePacks, DEFAULT_STORAGE_PACKS } = await import(
    "@/lib/commerce/packs"
  );
  const parsed = parseStoragePacks(await getConfigJson("storage_packs"));
  return parsed.length > 0 ? parsed : DEFAULT_STORAGE_PACKS;
});

export const getSponsoredPacks = cache(async () => {
  const { parseSponsoredPacks, DEFAULT_SPONSORED_PACKS } = await import(
    "@/lib/commerce/packs"
  );
  const parsed = parseSponsoredPacks(await getConfigJson("sponsored_packs"));
  return parsed.length > 0 ? parsed : DEFAULT_SPONSORED_PACKS;
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

/**
 * Placement maps show serves only (2026-08-23).
 *
 * On, the maps are built by the serve rule in placementAggregate.ts and
 * the Serves/Rally control comes off both web surfaces. Off, everything
 * is exactly as it was: the rally trust rule, both toggles, the old
 * counts. That is what makes rollback one UPDATE rather than a deploy —
 * the rule is applied at read time, so every existing match.json works
 * under either setting and nothing is reprocessed.
 *
 * One key rather than two, deliberately. Narrowing the UI while the old
 * rule still decides which landings survive would title the section
 * "Serve placement" over the twelve points the rally rule allows, which
 * is worse than either end state.
 */
export const getPlacementServesOnly = cache(async (): Promise<boolean> => {
  return (await getConfigValue("placement_serves_only")) === "true";
});
