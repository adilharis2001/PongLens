import type { Metadata } from "next";

import { AppShell } from "@/components/AppShell";
import { requireAdmin } from "../requireAdmin";
import { ReviewsAdminSection } from "./ReviewsAdminSection";

export const metadata: Metadata = {
  title: "Paid reviews",
  robots: { index: false, follow: false },
};

/**
 * /admin/reviews — every order across the platform, the fee config, and
 * the purchase kill switch. Data comes from admin_review_orders()
 * (is_admin re-checked inside) and app_config, which the admin may write
 * directly under its RLS.
 */
export default async function AdminReviewsPage() {
  const { supabase, avatarUrl } = await requireAdmin();

  const [{ data: orders }, { data: config }] = await Promise.all([
    supabase.rpc("admin_review_orders"),
    supabase
      .from("app_config")
      .select("key, value")
      .in("key", [
        "coach_reviews_enabled",
        "review_fee_mode",
        "review_fee_percent",
        "review_fee_fixed_cents",
      ]),
  ]);

  const cfg = new Map(
    ((config ?? []) as { key: string; value: string }[]).map((r) => [
      r.key,
      r.value,
    ]),
  );

  return (
    <AppShell avatarUrl={avatarUrl}>
      <ReviewsAdminSection
        initialOrders={orders ?? []}
        initialConfig={{
          enabled: cfg.get("coach_reviews_enabled") === "true",
          mode: cfg.get("review_fee_mode") === "fixed" ? "fixed" : "percent",
          percent: Number(cfg.get("review_fee_percent") ?? "15"),
          fixedCents: Number(cfg.get("review_fee_fixed_cents") ?? "500"),
        }}
      />
    </AppShell>
  );
}
