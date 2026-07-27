"use client";

import { useEffect, useMemo, useState } from "react";
import { computeMatchScore, sortPoints } from "@/app/match/[id]/gameScore";
import type { Match, MatchStatus, Point } from "@/lib/types";

/**
 * Helpers shared by the Home overview (dashboard) and the Matches library.
 * Extracted from the pre-split DashboardLists so both surfaces render
 * matches identically.
 */

export type MatchRow = Match & { points: { count: number }[] };

/** match_reels via the owner-scoped RLS select (Exports section).
 *  scope 'starred' | 'full' — a match can hold one of each. */
export type ReelRow = {
  match_id: string;
  scope: string;
  status: string;
  duration_s: number | null;
  manifest: { you_name?: string; them_name?: string } | null;
  updated_at: string;
};

/** Just enough of a point to run computeMatchScore for the score chips
 *  (game_end_override included so overridden boundaries — and therefore
 *  the games chip — match the match page's walk). */
export type PointLite = Pick<
  Point,
  | "id"
  | "match_id"
  | "idx"
  | "t0"
  | "is_let"
  | "confirmed_winner"
  | "game_end_override"
>;

export const matchChips: Record<
  MatchStatus,
  { label: string; chip: string; dot: string }
> = {
  processing: {
    label: "Processing",
    chip: "border-amber-400/40 bg-amber-400/10 text-amber-300",
    dot: "bg-amber-400",
  },
  ready: {
    label: "Ready",
    chip: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
    dot: "bg-emerald-400",
  },
  failed: {
    label: "Failed",
    chip: "border-red-400/40 bg-red-400/10 text-red-300",
    dot: "bg-red-400",
  },
};

export const queuedChip = {
  label: "Queued",
  chip: "border-cyan-glow/40 bg-cyan-glow/10 text-cyan-glow",
  dot: "bg-cyan-glow pulse-cyan",
};

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function monthLabel(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

export function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function formatBytes(n: number) {
  const GB = 1024 ** 3;
  const MB = 1024 ** 2;
  if (n >= GB * 0.95) return `${(n / GB).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(n / MB))} MB`;
}

export function fmtDuration(d: number) {
  const s = Math.max(0, Math.round(d));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function Chip({
  s,
}: {
  s: { label: string; chip: string; dot: string };
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${s.chip}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

/**
 * Neutral / third-party match fields for a card title (see matchTitle.ts and
 * MatchView's `neutral`): the owner named their OWN side as someone who isn't
 * the account holder, so the title reads "A vs B" instead of opponent-led.
 * Only own matches can be judged — we only know the viewer's account name.
 */
export function neutralTitleFields(m: MatchRow, accountName: string | null) {
  const ownSide = (
    (m.user_side === "far" ? m.player_far_name : m.player_near_name) ?? ""
  ).trim();
  const acct = (accountName ?? "").trim().toLowerCase();
  const neutral =
    ownSide !== "" && (acct === "" || ownSide.toLowerCase() !== acct);
  return { neutral, nameA: ownSide, nameB: (m.opponent_name ?? "").trim() };
}

/**
 * Confirmed games score per match (the cards' score chip), computed with
 * the same gameScore walk the match page uses. Only a FULLY scored match
 * shows a final games result — a partial score is ambiguous next to a real
 * one. A skipped point counts as handled; only a real un-decided point
 * makes it partial.
 */
export function useScoreChips(pointsLite: PointLite[]) {
  return useMemo(() => {
    const byMatch = new Map<string, PointLite[]>();
    for (const p of pointsLite) {
      const list = byMatch.get(p.match_id) ?? [];
      list.push(p);
      byMatch.set(p.match_id, list);
    }
    const chips = new Map<string, string>();
    for (const [matchId, pts] of byMatch) {
      const ordered = sortPoints(pts as Point[]);
      const score = computeMatchScore(ordered);
      const hasUnscored = ordered.some(
        (p) => p.confirmed_winner === null && !p.is_let
      );
      if (hasUnscored || score.games.length === 0) continue;
      chips.set(matchId, `${score.gamesYou}-${score.gamesThem}`);
    }
    return chips;
  }, [pointsLite]);
}

/**
 * Batch-signed poster thumbnails (media-url { thumbs }). Only matches with
 * a thumb_path come back; the rest render the placeholder. URLs live 1h and
 * the id set rarely changes, so refetching on set-change alone is enough.
 */
export function useThumbs(ids: string[]) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = [...ids].sort().join(",");
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    (async () => {
      const all = key.split(",");
      const merged: Record<string, string> = {};
      // media-url caps a batch at 100 ids.
      for (let i = 0; i < all.length; i += 100) {
        try {
          const res = await fetch("/api/media-url", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ thumbs: all.slice(i, i + 100) }),
          });
          const data = res.ok ? await res.json() : null;
          Object.assign(merged, data?.urls ?? {});
        } catch {
          // cards fall back to the placeholder
        }
      }
      if (!cancelled) setUrls(merged);
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);
  return urls;
}

/** Poster thumbnail with the placeholder fallback (no thumb yet, or the
 *  match predates thumbs and its clips are gone). */
export function Thumb({
  url,
  className,
}: {
  url: string | undefined;
  className: string;
}) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      loading="lazy"
      className={`${className} object-cover`}
    />
  ) : (
    <div
      className={`${className} flex items-center justify-center bg-surface-2/60`}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-6 w-6 text-zinc-600"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        aria-hidden="true"
      >
        <rect x="3" y="5" width="18" height="14" rx="2.5" />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="m10.2 9.4 4.6 2.6-4.6 2.6Z"
        />
      </svg>
    </div>
  );
}
