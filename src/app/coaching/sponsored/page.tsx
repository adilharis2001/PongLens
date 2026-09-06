import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/AppShell";
import {
  getCommerceEnabled,
  getSponsoredEnabled,
  getSponsoredPacks,
} from "@/lib/config";
import type { OfferingRow } from "@/lib/reviews/types";
import { createClient } from "@/lib/supabase/server";
import { SponsoredManager } from "./SponsoredManager";

export const metadata: Metadata = {
  title: "Sponsored reviews",
  robots: { index: false, follow: false },
};

/**
 * /coaching/sponsored — where a coach covers reviews for their own
 * students (096). Create a single-use link from an offering, watch the
 * unused links, and top the balance up when the free allowance runs out.
 */
export default async function SponsoredPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/coaching/sponsored");
  if (!(await getCommerceEnabled())) redirect("/coaching");
  // The row is gone, so the page must be too: a hidden entrance and a
  // live page is the state where a bookmark still works (170).
  if (!(await getSponsoredEnabled())) redirect("/coaching");

  const { data: profile } = await supabase
    .from("coach_profiles")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile) redirect("/coaching");

  const [{ data: offerings }, packs] = await Promise.all([
    supabase
      .from("offerings")
      .select("id, title, active")
      .eq("coach_id", user.id)
      .order("sort")
      .order("created_at"),
    getSponsoredPacks(),
  ]);

  const avatarUrl =
    (user.user_metadata?.avatar_url as string | undefined) ??
    (user.user_metadata?.picture as string | undefined) ??
    null;

  return (
    <AppShell avatarUrl={avatarUrl}>
      <SponsoredManager
        offerings={((offerings ?? []) as Pick<
          OfferingRow,
          "id" | "title" | "active"
        >[]).map((o) => ({ id: o.id, title: o.title, active: o.active }))}
        packs={packs}
      />
    </AppShell>
  );
}
