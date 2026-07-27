import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { MatchLibrary } from "./MatchLibrary";

export const metadata: Metadata = {
  title: "Matches",
  robots: { index: false, follow: false },
};

export default async function MatchesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // The account first name WITHOUT the email fallback — the same derivation
  // the match page uses, so neutral-match detection stays consistent.
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
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Matches</h1>
      <div className="mt-6">
        <MatchLibrary userId={user.id} accountName={accountName} />
      </div>
    </AppShell>
  );
}
