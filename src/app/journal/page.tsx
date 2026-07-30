import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { NotesFeed } from "./NotesFeed";

export const metadata: Metadata = {
  title: "Journal",
  robots: { index: false, follow: false },
};

/**
 * Improve v1 opens straight into the consolidated Notes workspace. Future
 * improvement features get their own internal structure when they exist —
 * nothing here reserves space for them.
 *
 * ?match=<id> opens the journal pre-filtered to that match's notes — the
 * deep link the match cards' note badge uses.
 */
export default async function ImprovePage({
  searchParams,
}: {
  searchParams: Promise<{ match?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { match } = await searchParams;
  const { data: recollectPreference } = await supabase
    .from("recollect_preferences")
    .select("enabled")
    .eq("user_id", user.id)
    .maybeSingle();

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

  return (
    <AppShell avatarUrl={avatarUrl}>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Journal</h1>
      <div className="mt-6">
        <NotesFeed
          userId={user.id}
          accountName={accountName}
          initialMatch={match ?? null}
          initialRecollectEnabled={recollectPreference?.enabled !== false}
        />
      </div>
    </AppShell>
  );
}
