import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/AppShell";
import { getReviewFeeConfig } from "@/lib/config";
import type { OfferingRow } from "@/lib/reviews/types";
import { createClient } from "@/lib/supabase/server";
import { OfferingsEditor } from "./OfferingsEditor";

export const metadata: Metadata = {
  title: "Offerings",
  robots: { index: false, follow: false },
};

export default async function OfferingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/coaching/offerings");

  const { data: profile } = await supabase
    .from("coach_profiles")
    .select("user_id, handle, display_name")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile) redirect("/coaching");

  const [{ data: offerings }, feeConfig] = await Promise.all([
    supabase
      .from("offerings")
      .select("*")
      .eq("coach_id", user.id)
      .order("sort")
      .order("created_at"),
    getReviewFeeConfig(),
  ]);

  const avatarUrl =
    (user.user_metadata?.avatar_url as string | undefined) ??
    (user.user_metadata?.picture as string | undefined) ??
    null;

  return (
    <AppShell avatarUrl={avatarUrl} wide>
      <OfferingsEditor
        initialOfferings={(offerings ?? []) as OfferingRow[]}
        feeConfig={feeConfig}
        coachName={profile.display_name || "the coach"}
      />
    </AppShell>
  );
}
