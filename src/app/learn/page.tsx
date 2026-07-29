import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { LearnIndex } from "./LearnIndex";

export const metadata: Metadata = {
  title: "Learn",
  robots: { index: false, follow: false },
};

export default async function LearnPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const avatarUrl =
    (user.user_metadata?.avatar_url as string | undefined) ??
    (user.user_metadata?.picture as string | undefined) ??
    null;

  return (
    <AppShell avatarUrl={avatarUrl}>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Learn</h1>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-zinc-400">
        Step-by-step help for recording, reviewing, scoring, and sharing your
        matches. Start with a guide below, or search for the feature you need.
      </p>
      <LearnIndex />
    </AppShell>
  );
}
