import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/AppShell";
import { sponsoredLeftFor } from "@/lib/reviews/sponsoredLeft";
import type { CoachProfileRow, CoachQueueItem } from "@/lib/reviews/types";
import { createClient } from "@/lib/supabase/server";
import { OrdersHub } from "./OrdersHub";

export const metadata: Metadata = {
  title: "Orders",
  robots: { index: false, follow: false },
};

/**
 * The marketplace tab of the coaching workspace: every order the coach
 * has taken, the page players buy from, availability and payouts. A
 * coach without a page gets the offer to make one.
 */
export default async function CoachOrdersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/coaching/orders");

  const avatarUrl =
    (user.user_metadata?.avatar_url as string | undefined) ??
    (user.user_metadata?.picture as string | undefined) ??
    null;
  const defaultName =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    "";

  const { data: profile } = await supabase
    .from("coach_profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  const [queueRes, statsRes, offeringsRes, opensRes, sponsoredLeft] =
    await Promise.all([
      profile ? supabase.rpc("coach_queue") : Promise.resolve({ data: [] }),
      profile
        ? supabase.rpc("coach_review_stats")
        : Promise.resolve({ data: null }),
      profile
        ? supabase
            .from("offerings")
            .select("id", { count: "exact", head: true })
            .eq("coach_id", user.id)
        : Promise.resolve({ count: 0 }),
      // Storefront opens this week (RLS scopes to own rows).
      profile
        ? supabase
            .from("coach_page_views")
            .select("id", { count: "exact", head: true })
            .gte(
              "viewed_at",
              new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(),
            )
        : Promise.resolve({ count: 0 }),
      profile ? sponsoredLeftFor(supabase) : Promise.resolve(null),
    ]);

  return (
    <AppShell avatarUrl={avatarUrl}>
      <OrdersHub
        profile={(profile as CoachProfileRow | null) ?? null}
        queue={(queueRes.data ?? []) as CoachQueueItem[]}
        stats={
          statsRes.data ?? {
            active_count: 0,
            completed_count: 0,
            earned_cents: 0,
          }
        }
        offeringCount={(offeringsRes as { count: number | null }).count ?? 0}
        pageOpens7d={(opensRes as { count: number | null }).count ?? 0}
        sponsoredLeft={sponsoredLeft}
        defaultName={defaultName}
      />
    </AppShell>
  );
}
