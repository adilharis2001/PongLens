import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { DashboardLists } from "./DashboardLists";

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

  return (
    <AppShell avatarUrl={avatarUrl}>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
        Hey {firstName} 👋
      </h1>
      <p className="mt-2 text-zinc-400">
        Your matches live here. Most videos finish processing in under 30
        minutes.
      </p>

      <div className="mt-10">
        <DashboardLists userId={user.id} accountName={accountName} />
      </div>
    </AppShell>
  );
}
