import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getSupportEmail } from "@/lib/config";
import { Logo } from "@/components/Logo";
import { computeMatchScore } from "@/app/match/[id]/gameScore";
import type { Point } from "@/lib/types";
import { ShareView, type SharePointRow } from "./ShareView";
import {
  playersLine,
  pointContextLine,
  type ResolvedShareLink,
  type ResolvedSharePoint,
} from "./shareData";

/**
 * Public share page — the ONLY logged-out surface that shows match media.
 * No AppNav/AppShell chrome, noindex, and strictly the public subset:
 * video, point numbers, durations, game score. Never notes, scorecard
 * suggestions, or placement maps. Resolution goes through the SECURITY
 * DEFINER resolve_share_link(); unknown and revoked tokens both land on
 * the same minimal "turned off" page.
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
  const title =
    link.kind === "point"
      ? pointContextLine(link)
      : names
        ? `Match · ${names}`
        : "Match";
  const description =
    link.kind === "point"
      ? "Watch this table tennis point on PongLens."
      : "Watch this table tennis match, point by point, on PongLens.";
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

  // Match links: the visible point list, already in timeline order. Game
  // dividers come from the same confirmed-score heuristic the match page
  // uses (nothing shows unless the owner confirmed points).
  let rows: SharePointRow[] | undefined;
  if (!isPoint) {
    const supabase = await createClient();
    const { data } = await supabase.rpc("resolve_share_points", {
      p_token: token,
    });
    const pts = (data ?? []) as ResolvedSharePoint[];
    const score = computeMatchScore(pts as unknown as Point[]);
    rows = pts.map((p, i) => ({
      id: p.id,
      number: i + 1,
      duration:
        p.t0 !== null && p.t1 !== null
          ? Math.max(0, Number(p.t1) - Number(p.t0))
          : null,
      boundary: score.boundaryAfter.get(p.id) ?? null,
    }));
  }

  return (
    <main className="bg-arena flex min-h-screen flex-col">
      <div className="mx-auto w-full max-w-md flex-1 px-4 py-8 sm:max-w-lg sm:py-12">
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
          {isPoint ? pointContextLine(link) : (names ?? "Match")}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          {isPoint && names ? `${names} · ` : ""}
          {formatDate(link.played_at)}
        </p>

        <div className="mt-4">
          <ShareView
            token={token}
            points={rows}
            initialPointId={rows?.[0]?.id}
          />
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
