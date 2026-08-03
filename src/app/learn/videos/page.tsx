import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppNav } from "@/components/AppNav";
import { VideoCourse } from "./VideoCourse";

export const metadata: Metadata = {
  title: "Tutorial videos",
  robots: { index: false, follow: false },
};

/**
 * The video course, deliberately its own page beside the written guides
 * rather than folded into them: some people want to watch and some want to
 * read, and each should be able to get the whole product their own way.
 *
 * AppNav directly rather than AppShell, the same way the match page does it.
 * AppShell brings a max-width column, its own top padding and the
 * `.page-enter` animation, and on a phone this page is not a column of
 * content — it is a player that covers the lot. Desktop still wants the nav
 * and a normal page, so the nav stays and only the mobile layer goes over it.
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
    <>
      <AppNav avatarUrl={avatarUrl} />
      <main className="bg-arena flex-1">
        {/* Desktop only: the mobile layer carries its own floating back
            control, since there is no page around it to put one in. */}
        <div className="mx-auto hidden w-full max-w-6xl px-6 pt-6 lg:block">
          <div className="mb-4 flex items-center gap-3">
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
        </div>
        <VideoCourse />
      </main>
    </>
  );
}
