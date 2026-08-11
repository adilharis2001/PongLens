import type { Metadata } from "next";

import { AppShell } from "@/components/AppShell";
import { requireAdmin } from "../requireAdmin";
import { CommerceSection } from "./CommerceSection";

export const metadata: Metadata = {
  title: "Commerce",
  robots: { index: false, follow: false },
};

const KEYS = [
  "commerce_enabled",
  "free_processing_minutes",
  "review_included_minutes",
  "sponsored_free_credits",
  "default_storage_bytes",
  "minute_packs",
  "storage_packs",
  "sponsored_packs",
] as const;

/**
 * /admin/commerce — every knob of the usage-based model (096): the kill
 * switch, the free allowances, the packs, and the support grants. All of
 * it is app_config the admin may write directly under its RLS; grants go
 * through the admin_grant_* RPCs, which re-check is_admin() inside.
 */
export default async function AdminCommercePage() {
  const { supabase, avatarUrl } = await requireAdmin();

  const { data: config } = await supabase
    .from("app_config")
    .select("key, value")
    .in("key", [...KEYS]);
  const cfg = new Map(
    ((config ?? []) as { key: string; value: string }[]).map((r) => [
      r.key,
      r.value,
    ]),
  );

  return (
    <AppShell avatarUrl={avatarUrl}>
      <CommerceSection
        initial={{
          enabled: cfg.get("commerce_enabled") === "true",
          freeMinutes: Number(cfg.get("free_processing_minutes") ?? "250"),
          reviewMinutes: Number(cfg.get("review_included_minutes") ?? "45"),
          sponsoredFree: Number(cfg.get("sponsored_free_credits") ?? "3"),
          defaultGb: Math.round(
            Number(cfg.get("default_storage_bytes") ?? "10737418240") /
              1073741824,
          ),
          minutePacks: cfg.get("minute_packs") ?? "[]",
          storagePacks: cfg.get("storage_packs") ?? "[]",
          sponsoredPacks: cfg.get("sponsored_packs") ?? "[]",
        }}
      />
    </AppShell>
  );
}
