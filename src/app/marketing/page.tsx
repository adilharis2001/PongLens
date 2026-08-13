import type { Metadata } from "next";
import { MarketingDashboard } from "./MarketingDashboard";
import type { MarketingAccount } from "./MarketingAccessSection";
import { requireMarketing } from "./requireMarketing";
import { MARKETING_SPACES } from "./marketingDashboardModel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Marketing",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * /marketing — the private marketing hub, reached by knowing the URL. The
 * gate is the same one /research uses and lives in requireMarketing():
 * the middleware requires a session, and the page admits the admin or an
 * account carrying the marketing role (100). Everyone else gets the app's
 * 404, so the page never confirms it exists.
 */
export default async function MarketingPage() {
  const { supabase, isAdmin } = await requireMarketing("/marketing");

  // Only the owner grants access, so only the owner pays for the lookup.
  const accounts = isAdmin
    ? (((await supabase.rpc("admin_list_marketing"))
        .data as MarketingAccount[] | null) ?? [])
    : null;

  return <MarketingDashboard spaces={MARKETING_SPACES} accounts={accounts} />;
}
