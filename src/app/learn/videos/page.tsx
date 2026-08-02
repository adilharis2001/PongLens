import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { VideoCourse } from "./VideoCourse";
import { CHAPTERS, totalLabel } from "./chapters";

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
      <Link
        href="/learn"
        className="inline-flex items-center gap-1.5 text-sm text-zinc-400 transition-colors hover:text-white"
      >
        <span aria-hidden>←</span> How-to guides
      </Link>
      <h1 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">
        Tutorial videos
      </h1>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-zinc-400">
        The whole app in {CHAPTERS.length} short chapters, {totalLabel()} end to
        end. Watch them in order, or jump to the one you need.
      </p>
      <VideoCourse />
    </AppShell>
  );
}
