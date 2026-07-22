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

  // is_admin() is the single source of truth (SQL re-checks it on writes).
  const { data: isAdmin } = await supabase.rpc("is_admin");

  return (
    <AppShell avatarUrl={avatarUrl}>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
        Feedback
      </h1>
      <p className="mt-2 text-zinc-400">
        Bugs, ideas, anything off. It lands on the board so others can vote.
      </p>

      <div className="mt-8 max-w-xl">
        <FeedbackForm
          userId={user.id}
          isAdmin={isAdmin === true}
          initialMatchId={matchId ?? null}
        />
      </div>
    </AppShell>
  );
}
