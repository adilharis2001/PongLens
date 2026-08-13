import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { FeedbackForm } from "./FeedbackForm";

export const metadata: Metadata = {
  title: "Feedback",
  robots: { index: false, follow: false },
};

export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ matchId?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { matchId } = await searchParams;
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

  return (
    <AppShell avatarUrl={avatarUrl}>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
        Feedback
      </h1>
      <p className="mt-2 text-zinc-400">
        {isQa === true
          ? "Bugs, ideas, anything off. Your reports stay off the board and come straight to us."
          : "Bugs, ideas, anything off. It lands on the board so others can vote."}
      </p>

      <div className="mt-8 max-w-xl">
        <FeedbackForm
          userId={user.id}
          isAdmin={isAdmin === true}
          isQa={isQa === true}
          initialMatchId={matchId ?? null}
        />
      </div>
    </AppShell>
  );
}
