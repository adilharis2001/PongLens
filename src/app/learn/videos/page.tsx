import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { VideoCourse } from "./VideoCourse";

export const metadata: Metadata = {
  title: "Tutorial videos",
  robots: { index: false, follow: false },
};

/**
 * The video course, deliberately its own page beside the written guides
 * rather than folded into them: some people want to watch and some want to
 * read, and each should be able to get the whole product their own way.
 * The two link across to each other per chapter without merging.
 */
export default async function TutorialVideosPage() {
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
      {/* Same round chevron the match view uses to get back to Matches, so
          "up one level" looks the same wherever you meet it. On one row with
          the title because every pixel above the deck is height the video
          does not get. */}
      <div className="flex items-center gap-3">
        <Link
          href="/learn"
          aria-label="Back to how-to guides"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-zinc-300 transition-colors hover:text-cyan-glow"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m15 6-6 6 6 6" />
          </svg>
        </Link>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
          Tutorial videos
        </h1>
      </div>
      <VideoCourse />
    </AppShell>
  );
}
