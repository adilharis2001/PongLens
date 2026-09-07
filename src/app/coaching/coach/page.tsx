import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/AppShell";
import { SharingSection } from "@/components/SharingSection";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Your coaches",
  robots: { index: false, follow: false },
};

/**
 * Every coach in one list, and the one place a new one is added.
 *
 * The Coaching tab is a feed of what happened, narrowed by coach; this is
 * the roster behind it, which is why the tab's empty state sends people
 * here. SharingSection is unchanged from the section that used to sit on
 * the Account page — it already owns the invite and its three scopes.
 */
export default async function YourCoachesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/coaching/coach");

  const avatarUrl =
    (user.user_metadata?.avatar_url as string | undefined) ??
    (user.user_metadata?.picture as string | undefined) ??
    null;

  return (
    <AppShell avatarUrl={avatarUrl}>
      <Link
        href="/coaching"
        className="text-sm text-zinc-400 transition-colors hover:text-white"
      >
        ← Coaching
      </Link>

      <h1 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
        Your coaches
      </h1>
      <div className="mt-6">
        <SharingSection userId={user.id} />
      </div>
    </AppShell>
  );
}
