import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getSupportEmail } from "@/lib/config";
import { Logo } from "@/components/Logo";
import { ShareView } from "./ShareView";
import { StarredView, type StarredClip } from "./StarredView";
import {
  playersLine,
  pointContextLine,
  starredContextLine,
  type ResolvedShareLink,
  type ResolvedStarredPoint,
} from "./shareData";

/**
 * Public share page — the ONLY logged-out surface that shows match media.
 * No AppNav/AppShell chrome, noindex, and strictly the public subset:
 *
 *   point   — that point's clip
 *   match   — the cut video, nothing else (no point-by-point rows)
 *   starred — the CURRENTLY starred clips, played sequentially. Resolved
 *             at view time: starring/unstarring changes what viewers see.
 *
 * Never notes, scorecard suggestions, or placement maps. Resolution goes
 * through the SECURITY DEFINER resolve functions; unknown and revoked
 * tokens both land on the same minimal "turned off" page.
 */

const resolve = cache(
  async (token: string): Promise<ResolvedShareLink | null> => {
    if (!token || token.length < 32 || token.length > 128) return null;
    const supabase = await createClient();
    const { data } = await supabase.rpc("resolve_share_link", {
      p_token: token,
    });
    return (data?.[0] as ResolvedShareLink | undefined) ?? null;
  }
);

const resolveStarred = cache(
  async (token: string): Promise<ResolvedStarredPoint[]> => {
    const supabase = await createClient();
    const { data } = await supabase.rpc("resolve_share_starred", {
      p_token: token,
    });
    return (data ?? []) as ResolvedStarredPoint[];
  }
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const link = await resolve(token);
  const robots = { index: false, follow: false };
  if (!link) return { title: "PongLens", robots };
  const names = playersLine(link);
  let title: string;
  let description: string;
  if (link.kind === "point") {
    title = pointContextLine(link);
    description = "Watch this table tennis point on PongLens.";
  } else if (link.kind === "starred") {
    const starred = await resolveStarred(token);
    title = starredContextLine(starred.length, names);
    description = "Watch these table tennis points on PongLens.";
  } else {
    title = names ? `Match · ${names}` : "Match";
    description = "Watch this table tennis match on PongLens.";
  }
  return {
    title,
    description,
    robots,
    openGraph: { title: `${title} · PongLens`, description },
    twitter: { card: "summary_large_image", title: `${title} · PongLens`, description },
  };
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function LinkOff() {
  return (
    <main className="bg-arena flex min-h-screen flex-col items-center justify-center gap-6 px-4">
      <Logo />
      <p className="text-sm text-zinc-400">This link was turned off.</p>
    </main>
  );
}

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const link = await resolve(token);
  if (!link) return <LinkOff />;
  const supportEmail = await getSupportEmail();

  const names = playersLine(link);
  const isPoint = link.kind === "point";
  const isStarred = link.kind === "starred";

  // Starred links: the currently-starred clip list, resolved right now.
  let clips: StarredClip[] = [];
  if (isStarred) {
    const starred = await resolveStarred(token);
    clips = starred.map((p) => ({
      id: p.id,
      number: p.number,
      duration:
        p.t0 !== null && p.t1 !== null
          ? Math.max(0, Number(p.t1) - Number(p.t0))
          : null,
    }));
  }

  const heading = isPoint
    ? pointContextLine(link)
    : isStarred
      ? starredContextLine(clips.length, names)
      : (names ?? "Match");

  return (
    <main className="bg-arena flex min-h-screen flex-col">
      <div className="mx-auto w-full max-w-md flex-1 px-4 py-8 sm:max-w-lg sm:py-12">
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
          {heading}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          {isPoint && names ? `${names} · ` : ""}
          {formatDate(link.played_at)}
        </p>

        <div className="mt-4">
          {isStarred ? (
            clips.length > 0 ? (
              <StarredView token={token} clips={clips} />
            ) : (
              <div className="flex aspect-video items-center justify-center rounded-2xl border border-edge bg-ink">
                <p className="text-sm text-zinc-500">
                  Nothing here right now.
                </p>
              </div>
            )
          ) : (
            <ShareView token={token} />
          )}
        </div>

        <Link
          href="/"
          className="glow-cta mt-6 block w-full rounded-full bg-cyan-glow px-5 py-3 text-center text-sm font-semibold text-ink"
        >
          Analyze your own match — free
        </Link>
      </div>

      <footer className="mt-8 border-t border-edge/60 px-4 py-6">
        <div className="mx-auto flex w-full max-w-md flex-col items-center gap-3 sm:max-w-lg">
          <Logo />
          <a
            href={`mailto:${supportEmail}?subject=Report%20a%20shared%20video`}
            className="text-xs text-zinc-600 transition-colors hover:text-zinc-400"
          >
            Report this video
          </a>
        </div>
      </footer>
    </main>
  );
}
