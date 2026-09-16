import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { FeedbackPanels } from "./FeedbackPanels";

export const metadata: Metadata = {
  title: "Feedback and discussion",
  robots: { index: false, follow: false },
};

export default async function FeedbackPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const avatarUrl =
    (user.user_metadata?.avatar_url as string | undefined) ??
    (user.user_metadata?.picture as string | undefined) ??
    null;

  // is_admin() / is_qa() are the single source of truth (SQL re-checks
  // both on writes; these only shape the UI).
  const [{ data: isAdmin }, { data: isQa }] = await Promise.all([
    supabase.rpc("is_admin"),
    supabase.rpc("is_qa"),
  ]);

  // `wide` because the page lays out side by side on a laptop: the
  // composer keeps a fixed column and the board takes the rest. `hasFab`
  // because on a phone the composer is a corner button over the list.
  return (
    <AppShell avatarUrl={avatarUrl} wide hasFab>
      {/* "Feedback and discussion", not "Feedback board": the reader is
          looking at the board, so the name says what it is for
          (Adil, 2026-09-16). */}
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
        Feedback and discussion
      </h1>
      {/* The one line under the title. Adil asked for it here (2026-09-16):
          the page grew threads, and a first-time reader should know the
          board is for talking as well as voting. */}
      <p className="mt-2 text-zinc-400">
        {isQa === true
          ? "Bugs, ideas, anything off. Your reports stay off the board and come straight to us."
          : "Ideas and bugs from players. Vote on what matters, join a thread, and see what's being built."}
      </p>

      <Suspense fallback={null}>
        <FeedbackPanels
          userId={user.id}
          isAdmin={isAdmin === true}
          isQa={isQa === true}
        />
      </Suspense>
    </AppShell>
  );
}
