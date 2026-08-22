"use client";

import { useEffect, useMemo, useState } from "react";
import { computeMatchScore, sortPoints } from "@/app/match/[id]/gameScore";
import { createClient } from "@/lib/supabase/client";
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
  // A raw library video (096): uploaded, watchable, not yet processed.
  uploaded: {
    label: "Not processed",
    chip: "border-zinc-500/40 bg-zinc-500/10 text-zinc-300",
    dot: "bg-zinc-400",
  },
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

/** The subset of a job row this file needs to judge "is it working". */
type JobLike = {
  id: string;
  kind: string;
  status: string;
  progress: number;
  options?: { match_id?: string | null } | null;
};

/**
 * Is this match being worked on, and what should its chip say?
 *
 * Commerce mode (096) writes the match row FIRST — register_upload creates
 * it with a null job_id — and the worker only links the two when it picks
 * the job up. So for the whole of the wait, matches.status still reads
 * 'uploaded' while a job is queued or running against it, and anything
 * reading the status column alone says "Not processed" about a video that
 * is visibly processing.
 *
 * That went wrong in three places before this existed: the library card,
 * Home's active-work counter, and Home's recent list, which sat under a
 * banner saying "Your match is processing" and contradicted it. One
 * derivation, one import, no fourth copy.
 */
export function liveJobFor(
  matchId: string,
  jobId: string | null | undefined,
  jobs: JobLike[] | null | undefined,
): JobLike | null {
  const list = jobs ?? [];
  const working = (j: JobLike) =>
    j.status === "queued" || j.status === "processing";
  const linked = jobId ? list.find((j) => j.id === jobId) : undefined;
  if (linked && working(linked)) return linked;
  return (
    list.find(
      (j) =>
        j.kind === "deadspace_cut" &&
        working(j) &&
        String(j.options?.match_id ?? "") === matchId,
    ) ?? null
  );
}

/** The chip a match should wear, accounting for a job the row hasn't linked yet. */
export function chipForMatch(status: MatchStatus, live: JobLike | null) {
  if (live) return live.status === "queued" ? queuedChip : matchChips.processing;
  return matchChips[status] ?? matchChips.processing;
}

/**
 * Does this card open? Mirrors the routing in match/[id]/page.tsx, which is
 * the only thing that can actually answer it: 'ready' gets the match
 * experience, and anything with a source file gets the raw view.
 *
 * 'processing' used to be excluded here and on Home, so for the several
 * minutes a video spends in the pipeline its card was a plain div — no
 * link, no menu, nothing. It looked identical to a live one, and on a
 * touch device even the hover border that hints "this opens" does not
 * exist, so the only way to find out was to tap and get nothing. That
 * reads as an app that randomly ignores you, and it was reported as
 * exactly that. The page behind it was never the problem: it renders a
 * progress bar and says the email is coming.
 *
 * A failure with no cut opens too, even with no source left. The content
 * check deletes the raw when it turns a video down, and the card that
 * results is the only place the uploader learns why — a chip reading
 * "Processing failed" that cannot be tapped is barely better than the row
 * disappearing, which is what it used to do. The raw view handles the
 * missing file and says what happened.
 *
 * Legacy rows that DID process (a cut_path, however broken) stay on the
 * match experience, which is the routing this mirrors.
 */
export function canOpenMatch(m: {
  status: MatchStatus;
  raw_path?: string | null;
  cut_path?: string | null;
}) {
  if (m.status === "ready" || m.status === "uploaded") return true;
  if (m.status === "failed" && m.cut_path == null) return true;
  return (
    m.raw_path != null &&
    (m.status === "processing" || m.status === "failed")
  );
}

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
 * Games score per match (the cards' score chip), computed with the same
 * gameScore walk the match page uses. Any scoring at all shows the running
 * games result — a half-scored match saying "Add score" reads as lost work.
 * `complete` (every point decided, at least one game concluded; a skipped
 * point counts as handled) still marks the truly finished scorecards for
 * the scored/unscored filter and search tokens.
 */
export interface ScoreChip {
  you: number;
  them: number;
  complete: boolean;
}

/** PostgREST answers with at most 1000 rows, silently. */
const PAGE = 1000;
/** Backstop against a query that never returns a short page. Hitting it is
 *  a bug, not a limit to design around, so it says so out loud rather than
 *  truncating quietly — which is the whole failure this helper exists to
 *  fix. */
const MAX_PAGES = 50;

/**
 * Read a whole table selection, a page at a time.
 *
 * PostgREST caps a response at 1000 rows and reports nothing: no error, no
 * flag, just a short array. Every caller here feeds something that can't
 * tell "short answer" from "short data" — the score walk read a truncated
 * match as a finished one and quietly dropped games; note counts would
 * read low; job rows would vanish. `build` must impose a stable order, or
 * pages can overlap and skip.
 */
export async function fetchPaged<T>(
  build: (
    from: number,
    to: number
  ) => PromiseLike<{ data: unknown[] | null; error: unknown }>,
  label = "rows"
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await build(page * PAGE, page * PAGE + PAGE - 1);
    if (error || !data) break;
    out.push(...(data as T[]));
    if (data.length < PAGE) return out;
  }
  console.warn(
    `fetchPaged: stopped at ${MAX_PAGES} pages of ${label}; result is truncated`
  );
  return out;
}

/**
 * Every visible point row for the given matches (all of them when
 * `matchIds` is null). Ids are chunked as well as paged: PostgREST carries
 * `in.()` in the query string, so a deep library page would otherwise
 * outgrow the URL limit.
 */
export async function fetchPointsPaged<T>(
  columns: string,
  matchIds: string[] | null
): Promise<T[]> {
  const supabase = createClient();
  const chunks: (string[] | null)[] = [];
  if (matchIds === null) chunks.push(null);
  else {
    for (let i = 0; i < matchIds.length; i += 100) {
      chunks.push(matchIds.slice(i, i + 100));
    }
  }
  const out: T[] = [];
  for (const ids of chunks) {
    const rows = await fetchPaged<T>((from, to) => {
      let q = supabase
        .from("points")
        .select(columns)
        .eq("deleted", false)
        .order("id")
        .range(from, to);
      if (ids) q = q.in("match_id", ids);
      return q;
    }, "points");
    out.push(...rows);
  }
  return out;
}

export function useScoreChips(pointsLite: PointLite[]) {
  return useMemo(() => {
    const byMatch = new Map<string, PointLite[]>();
    for (const p of pointsLite) {
      const list = byMatch.get(p.match_id) ?? [];
      list.push(p);
      byMatch.set(p.match_id, list);
    }
    const chips = new Map<string, ScoreChip>();
    for (const [matchId, pts] of byMatch) {
      const ordered = sortPoints(pts as Point[]);
      const anyScored = ordered.some((p) => p.confirmed_winner !== null);
      if (!anyScored) continue;
      const score = computeMatchScore(ordered);
      const hasUnscored = ordered.some(
        (p) => p.confirmed_winner === null && !p.is_let
      );
      chips.set(matchId, {
        you: score.gamesYou,
        them: score.gamesThem,
        complete: !hasUnscored && score.games.length > 0,
      });
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
      decoding="async"
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
