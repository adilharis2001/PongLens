/**
 * Pack definitions live in app_config as JSON (minute_packs, storage_packs,
 * sponsored_packs) so the admin can tune them without a deploy. The
 * database snapshots the chosen pack onto platform_purchases at creation
 * (create_platform_purchase, 096) — these parsers exist for display and
 * share the RPC's validation bounds, so a pack the UI shows is always one
 * the purchase RPC will accept.
 */

export interface MinutePack {
  key: string;
  minutes: number;
  priceCents: number;
}

export interface StoragePack {
  key: string;
  gb: number;
  months: number;
  priceCents: number;
}

export interface SponsoredPack {
  key: string;
  credits: number;
  priceCents: number;
}

/** Launch defaults, matching the 096 seeds. Display fallback only. */
export const DEFAULT_MINUTE_PACKS: MinutePack[] = [
  { key: "m60", minutes: 60, priceCents: 500 },
  { key: "m180", minutes: 180, priceCents: 1200 },
  { key: "m600", minutes: 600, priceCents: 3500 },
];

export const DEFAULT_STORAGE_PACKS: StoragePack[] = [
  { key: "s100", gb: 100, months: 12, priceCents: 2500 },
  { key: "s500", gb: 500, months: 12, priceCents: 10000 },
];

export const DEFAULT_SPONSORED_PACKS: SponsoredPack[] = [
  { key: "sp5", credits: 5, priceCents: 2000 },
  { key: "sp15", credits: 15, priceCents: 5000 },
];

/** Same bounds create_platform_purchase enforces. */
function priceOk(cents: unknown): cents is number {
  return typeof cents === "number" && cents >= 50 && cents <= 100000;
}

function keyOk(key: unknown): key is string {
  return typeof key === "string" && /^[a-z0-9-]{1,24}$/.test(key);
}

function positiveInt(n: unknown, max: number): n is number {
  return typeof n === "number" && Number.isInteger(n) && n > 0 && n <= max;
}

function rows(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (r): r is Record<string, unknown> => typeof r === "object" && r !== null,
  );
}

export function parseMinutePacks(raw: unknown): MinutePack[] {
  const out: MinutePack[] = [];
  for (const r of rows(raw)) {
    if (keyOk(r.key) && positiveInt(r.minutes, 100000) &&
        priceOk(r.price_cents)) {
      out.push({ key: r.key, minutes: r.minutes, priceCents: r.price_cents });
    }
  }
  return out;
}

export function parseStoragePacks(raw: unknown): StoragePack[] {
  const out: StoragePack[] = [];
  for (const r of rows(raw)) {
    if (keyOk(r.key) && positiveInt(r.gb, 10240) && priceOk(r.price_cents)) {
      out.push({
        key: r.key,
        gb: r.gb,
        months: positiveInt(r.months, 120) ? r.months : 12,
        priceCents: r.price_cents,
      });
    }
  }
  return out;
}

export function parseSponsoredPacks(raw: unknown): SponsoredPack[] {
  const out: SponsoredPack[] = [];
  for (const r of rows(raw)) {
    if (keyOk(r.key) && positiveInt(r.credits, 1000) &&
        priceOk(r.price_cents)) {
      out.push({ key: r.key, credits: r.credits, priceCents: r.price_cents });
    }
  }
  return out;
}
