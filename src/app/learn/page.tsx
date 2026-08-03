import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import Link from "next/link";
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

      {/* Directly under the search box, so someone who would rather watch
          than read meets the video before the list of articles. */}
      <LearnIndex
        afterSearch={
          <Link
            href="/learn/videos"
            className="mt-3 flex items-center gap-3 rounded-2xl border border-edge bg-surface px-4 py-3 transition-colors hover:border-cyan-glow/50"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan-glow/15 text-cyan-glow">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
                <path d="M8 5.5v13l11-6.5-11-6.5Z" />
              </svg>
            </span>
            <span className="flex-1 text-sm font-semibold text-zinc-100">
              Tutorial videos
            </span>
            <span aria-hidden className="shrink-0 text-zinc-500">
              ›
            </span>
          </Link>
        }
      />
    </AppShell>
  );
}
