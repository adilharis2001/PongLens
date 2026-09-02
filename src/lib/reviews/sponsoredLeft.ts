import { getCommerceEnabled } from "@/lib/config";
import type { createClient } from "@/lib/supabase/server";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Sponsored reviews a coach can still cover (096). The free allowance
 * lands lazily on first use, so an untouched ledger means the allowance
 * is still waiting, not spent. null when commerce is off, and the row
 * that shows it hides.
 */
export async function sponsoredLeftFor(
  supabase: ServerClient,
): Promise<number | null> {
  if (!(await getCommerceEnabled())) return null;
  const [{ data: creditRows }, { data: freeRow }] = await Promise.all([
    supabase.from("sponsored_credit_ledger").select("credits, kind"),
    supabase
      .from("app_config")
      .select("value")
      .eq("key", "sponsored_free_credits")
      .maybeSingle(),
  ]);
  const rows = (creditRows ?? []) as { credits: number | null; kind: string }[];
  const sum = rows.reduce((s, r) => s + (r.credits ?? 0), 0);
  const hasGrant = rows.some((r) => r.kind === "grant");
  const free = Number(freeRow?.value ?? "3");
  return sum + (hasGrant ? 0 : Number.isFinite(free) && free > 0 ? free : 0);
}
