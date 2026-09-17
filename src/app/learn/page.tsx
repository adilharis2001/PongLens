import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import Link from "next/link";
import { LearnIndex } from "./LearnIndex";
import { PublicShell } from "./PublicShell";
import { loadLearnServerContext } from "./serverContext";

export const metadata: Metadata = {
  title: "Learn",
  description:
    "Guides to every part of PongLens: recording and uploading a match, scoring it, reading the analysis, sharing with a coach, and the coaching workspace.",
  alternates: { canonical: "/learn" },
  robots: { index: true, follow: true },
};

/**
 * The Learn hub. Public: a visitor gets the guides in the marketing
 * chrome, a signed-in person gets them inside the app. The written guides
 * are the only long-form writing about the product, and a page behind
 * sign-in is a page search has never read.
 */
export default async function LearnPage({
  searchParams,
}: {
  searchParams: Promise<{ audience?: string }>;
}) {
  const { audience: requested } = await searchParams;
  const context = await loadLearnServerContext(requested);
  const audienceQuery =
    context.audience === context.activeWorkspace
      ? ""
      : `?audience=${context.audience}`;

  const body = (
    <>
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Learn</h1>

      {/* Directly under the search box, so someone who would rather watch
          than read meets the video before the list of articles. A visitor
          gets the public videos; the tutorial course needs an account. */}
      <LearnIndex
        audience={context.audience}
        platform="web"
        activeWorkspace={context.activeWorkspace}
        canSwitch={context.canSwitch}
        afterSearch={
          <Link
            href={context.user ? `/learn/videos${audienceQuery}` : "/videos"}
            className="mt-3 flex items-center gap-3 rounded-2xl border border-edge bg-surface px-4 py-3 transition-colors hover:border-cyan-glow/50"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan-glow/15 text-cyan-glow">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
                <path d="M8 5.5v13l11-6.5-11-6.5Z" />
              </svg>
            </span>
            <span className="flex-1 text-sm font-semibold text-zinc-100">
              {context.user ? "Tutorial videos" : "Videos"}
            </span>
            <span aria-hidden className="shrink-0 text-zinc-500">
              ›
            </span>
          </Link>
        }
      />
    </>
  );

  if (!context.user) {
    return <PublicShell audience={context.audience}>{body}</PublicShell>;
  }
  return <AppShell avatarUrl={context.avatarUrl}>{body}</AppShell>;
}
