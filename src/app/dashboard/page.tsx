import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCommerceEnabled } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { HomeOverview } from "./HomeOverview";
import { PlayerSetupCard } from "./PlayerSetupCard";

export const metadata: Metadata = {
  title: "Dashboard",
  robots: { index: false, follow: false },
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const name =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    user.email ??
    "player";
  const firstName = name.split(" ")[0];
  // The account first name WITHOUT the email fallback — the same derivation
  // the match page uses, so neutral-match detection (a card titled "A vs B"
  // when the owner named their own side as someone else) stays consistent.
  const accountName =
    (
      (user.user_metadata?.full_name as string | undefined) ??
      (user.user_metadata?.name as string | undefined) ??
      ""
    )
      .trim()
      .split(/\s+/)[0] || null;
  const avatarUrl =
    (user.user_metadata?.avatar_url as string | undefined) ??
    (user.user_metadata?.picture as string | undefined) ??
    null;
  // The playing questions never answered or skipped (159): the coach path
  // of onboarding leaves the row unstamped, and this is the day they
  // switched sides.
  const { data: profileRow } = await supabase
    .from("player_profiles")
    .select("setup_done_at")
    .eq("user_id", user.id)
    .maybeSingle();
  const playerSetupPending = Boolean(profileRow) && !profileRow?.setup_done_at;

  return (
    <AppShell avatarUrl={avatarUrl} hasFab>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
        Hey {firstName} 👋
      </h1>

      <div className="mt-8">
        {playerSetupPending && <PlayerSetupCard userId={user.id} />}
        <HomeOverview
          userId={user.id}
          accountName={accountName}
          firstStepsDismissed={Boolean(
            user.user_metadata?.first_steps_dismissed
          )}
          commerceEnabled={await getCommerceEnabled()}
        />
      </div>
    </AppShell>
  );
}
