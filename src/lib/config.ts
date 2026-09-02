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

/**
 * Everyone the admin surfaces open for. Anton was added 2026-09-02 so he
 * can read the behind-the-scenes of uploads; is_admin() (migration 161)
 * carries the same two literals, and the two lists must move together —
 * a name in one and not the other gets pages that render but RPCs that
 * refuse, which reads as a broken portal rather than a permissions gap.
 *
 * ADMIN_EMAIL above stays singular on purpose: the worker uses it as the
 * operational identity — failure mail, export receipts, the digest — and
 * none of that should follow a second reader of the dashboard.
 */
export const ADMIN_EMAILS: readonly string[] = [
  ADMIN_EMAIL,
  "aber97@gmail.com",
];

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && ADMIN_EMAILS.includes(email);
}

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

/**
 * Scored points end at the winner tap plus half a second (2026-08-25).
 *
 * On, every playback and render surface clamps a tapped point's end to
 * scored_at_cut_s + 0.5 (playhead.effectiveEnd) and watch mode jumps the
 * dead footage between a tap and the next rally. Off — or on any fetch
 * failure — everything is exactly the padded-end behavior this replaced.
 * Applied at read time, so it covers every match ever processed and
 * rollback is one UPDATE. Measured: ~25% of a scored match's cut is
 * after the taps (docs/research/2026-08-25-tap-end-shave.md).
 */
export const getTapEndPlayback = cache(async (): Promise<boolean> => {
  return (await getConfigValue("tap_end_playback")) === "on";
});

/**
 * The game-end indicator (2026-08-26, 140).
 *
 * On, a marker is drawn between two rallies where the video shows the
 * players swapping ends — in Keep score's strip and in the point list.
 * Off, or on any fetch failure, there is no marker anywhere and every
 * match scores exactly as it did. Applied at read time, so it covers
 * matches processed before the flag existed and rollback is one UPDATE.
 *
 * The marker never changes a score by itself. Tapping it can, because
 * that writes the same game_end_override the owner could pin by hand.
 */
export const getGameEndDetection = cache(async (): Promise<boolean> => {
  return (await getConfigValue("game_end_detection")) === "on";
});

/**
 * UNSCORED points end when the rally was last observed (2026-08-27).
 *
 * The sibling of the rule above, for the matches nobody scores. The worker
 * records points.rally_end_cut_s — the last bounce on the user's own table
 * — and t1 pads it by 2.6s so a winner tap would land inside. No tap is
 * coming on an unscored match, so that padding is ball retrieval. The tap
 * still wins wherever one exists; this only fills the gap where none does.
 *
 * Off — or on any fetch failure — playback is exactly the padded-end
 * behaviour this replaced. Read time again, so it covers every match with
 * the column backfilled and rollback is one UPDATE.
 * docs/superpowers/specs/2026-08-27-unscored-rally-end.md
 */
export const getUnscoredRallyEnd = cache(async (): Promise<boolean> => {
  return (await getConfigValue("unscored_rally_end")) === "on";
});

/**
 * Seconds kept after the observed rally end before playback stops.
 *
 * A config row rather than a constant because it is not calibrated yet:
 * 0.5 is deliberately aggressive so the trims can be judged by eye, and
 * widening it must not need a deploy. A missing or unparseable value reads
 * as the default rather than as zero — zero would be the most dangerous
 * setting, and a failed fetch must never select it.
 */
export const getUnscoredRallyEndBufferS = cache(async (): Promise<number> => {
  const raw = await getConfigValue("unscored_rally_end_buffer_s");
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0.5;
});
