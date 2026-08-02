import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import Link from "next/link";
import { LearnIndex } from "./LearnIndex";
import { CHAPTERS, totalLabel } from "./videos/chapters";

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
      {/* Above the written guides rather than among them: someone who
          would rather watch should not have to find video hiding in a list
          of articles. */}
      <Link
        href="/learn/videos"
        className="mt-6 flex items-center gap-4 rounded-2xl border border-cyan-glow/30 bg-cyan-glow/[0.06] p-4 transition-colors hover:border-cyan-glow/60"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-cyan-glow/15 text-cyan-glow">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
            <path d="M8 5.5v13l11-6.5-11-6.5Z" />
          </svg>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-zinc-100">
            Tutorial videos
          </span>
          <span className="block text-[13px] leading-relaxed text-zinc-400">
            The whole app in {CHAPTERS.length} short chapters, {totalLabel()} end to end.
          </span>
        </span>
        <span aria-hidden className="shrink-0 text-zinc-500">›</span>
      </Link>

      <LearnIndex />
    </AppShell>
  );
}
