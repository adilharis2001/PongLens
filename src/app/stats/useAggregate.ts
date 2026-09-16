"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Point } from "@/lib/types";
import { scoreChipsForPoints } from "@/app/dashboard/shared";
import { loadCanonicalScoreSummaryDiagnostic } from "@/lib/scoring/reader";
import {
  readCached,
  splitByFreshness,
  writeCached,
} from "@/lib/stats/pointCache";
import {
  aggregateStats,
  isNeutral,
  type AggregateStats,
  type MatchLite,
} from "./aggregate";

/** Point columns the aggregation walks actually read. */
const POINT_COLS =
  "id, match_id, idx, t0, is_let, confirmed_winner, confirmed_how, " +
  "direction, serve_spin, serve_sidespin, serve_length, loss_reasons, " +
  "game_end_override, game_winner_override, server_override, server";

/**
 * There is no summary row anywhere: every one of these numbers is folded
 * out of every live point of every match, through the exact pure walks the
 * match page uses, so they can never drift from what a match page shows.
 * Three surfaces want the same answer — Home's "Your game" card, /stats,
 * and the Journal's Stats tab.
 *
 * Two things stop that costing what it used to.
 *
 * Within a page session the walk is SHARED: the first caller does it, the
 * rest are handed the finished result, and a caller arriving mid-walk
 * waits on the same promise rather than starting a second one. That is
 * why the Journal's Stats tab paints filled the second time it is opened.
 *
 * Between sessions the POINTS are cached, per match, under a fingerprint
 * of every column the walk reads (`my_match_point_fingerprints`, 41 ms and
 * 7 KB). A match whose fingerprint is unchanged is not fetched again, so
 * an ordinary visit downloads nothing at all instead of 2.5 MB. This is
 * deliberately not a stored ANSWER: a stored answer is faster still, but a
 * write that is ever missed leaves a confident wrong number on screen with
 * nothing to show it is wrong, and a fingerprint cannot be wrong because
 * it IS the question. Adil's call, 2026-09-07.
 *
 * The match rows themselves are always read fresh — 115 rows, and a change
 * to `first_server` or `user_side` moves the numbers — so nothing about
 * them is ever cached.
 */
const FRESH_MS = 60_000;

interface Walk {
  key: string;
  stats: AggregateStats;
  at: number;
}

let done: Walk | null = null;
let inFlight: { key: string; promise: Promise<AggregateStats | null> } | null =
  null;

async function walk(
  userId: string,
  accountName: string | null
): Promise<AggregateStats | null> {
  const supabase = createClient();
  const { data: ms } = await supabase
    .from("matches")
    .select(
      "id, opponent_name, match_type, played_at, first_server, first_server_source, user_side, player_near_name, player_far_name, score_revision"
    )
    .eq("user_id", userId);
  const list = (ms as MatchLite[]) ?? [];
  const ids = list.map((m) => m.id);
  if (ids.length === 0) return aggregateStats(list, new Map(), accountName);

  // "Has anything changed?", asked in one cheap query. A digest per match
  // of every column the walk reads: 107 rows and about 7 KB against the
  // 2.5 MB of points it decides whether we need. A match with no live
  // points is absent from the answer, which is itself a fingerprint —
  // the empty string below.
  const { data: fp } = await supabase.rpc("my_match_point_fingerprints");
  const fingerprints = new Map<string, string>(
    ((fp as { match_id: string; fingerprint: string }[] | null) ?? []).map(
      (r) => [r.match_id, r.fingerprint]
    )
  );
  const fingerprintOf = (id: string) => fingerprints.get(id) ?? "";

  const cached = await readCached(userId, ids);
  const { fresh, stale } = splitByFreshness(ids, fingerprints, cached);
  const byMatch = new Map<string, Point[]>(fresh);
  let pointFetchComplete = true;

  // Only the matches that actually moved. On an ordinary visit this is
  // empty and nothing is downloaded at all. Points arrive in match-id
  // chunks (URL length) and 1000-row pages (PostgREST cap); the chunks are
  // independent queries and run together, because walking them one after
  // another was most of the wait.
  if (stale.length > 0) {
    const chunks: string[][] = [];
    for (let i = 0; i < stale.length; i += 50) chunks.push(stale.slice(i, i + 50));
    const perChunk = await Promise.all(
      chunks.map(async (chunk) => {
        const rows: Point[] = [];
        let complete = true;
        for (let from = 0; ; from += 1000) {
          const { data: ps, error } = await supabase
            .from("points")
            .select(POINT_COLS)
            .in("match_id", chunk)
            .eq("deleted", false)
            .range(from, from + 999);
          if (error || !ps) {
            complete = false;
            break;
          }
          const page = (ps as unknown as Point[]) ?? [];
          rows.push(...page);
          if (page.length < 1000) break;
        }
        return { rows, complete };
      })
    );
    for (const id of stale) byMatch.set(id, []);
    for (const result of perChunk) {
      pointFetchComplete = pointFetchComplete && result.complete;
      const { rows } = result;
      for (const p of rows) {
        byMatch.get(p.match_id)?.push(p);
      }
    }
    // A partial cross-match walk is a convincing but wrong answer. Preserve
    // the last completed in-session result (when there is one) and retry on
    // the next visit; never cache incomplete rows under a current fingerprint.
    if (!pointFetchComplete) return null;
    void writeCached(
      userId,
      stale.map((id) => ({
        matchId: id,
        fingerprint: fingerprintOf(id),
        points: byMatch.get(id) ?? [],
      })),
      ids
    );
  }

  const stats = aggregateStats(list, byMatch, accountName);
  const scoredMatchIds = list
    .filter((match) => !isNeutral(match, accountName))
    .map((match) => match.id);
  const included = new Set(scoredMatchIds);
  const revisions = new Map<string, number>();
  for (const match of list) {
    if (
      included.has(match.id) &&
      typeof match.score_revision === "number"
    ) {
      revisions.set(match.id, match.score_revision);
    }
  }
  const diagnostic = await loadCanonicalScoreSummaryDiagnostic({
    matchIds: scoredMatchIds,
    expectedRevisions: revisions,
    legacyByMatch: scoreChipsForPoints(
      [...byMatch.entries()]
        .filter(([matchId]) => included.has(matchId))
        .flatMap(([, points]) => points),
    ),
    rpc: (name, args) => supabase.rpc(name, args),
  });
  if (diagnostic?.kind === "parity") {
    console.info("aggregate stats canonical score reader parity", diagnostic);
  } else if (diagnostic) {
    console.warn("aggregate stats canonical score reader fallback", {
      reason: diagnostic.reason,
    });
  }

  return stats;
}

function share(key: string, userId: string, accountName: string | null) {
  if (inFlight?.key === key) return inFlight.promise;
  const promise = walk(userId, accountName)
    .then((stats) => {
      if (stats) done = { key, stats, at: Date.now() };
      return stats;
    })
    .finally(() => {
      if (inFlight?.key === key) inFlight = null;
    });
  inFlight = { key, promise };
  return promise;
}

/**
 * One fetch, one aggregation — shared by /stats, Home's "Your game" card
 * and the Journal's Stats tab so the three can never disagree and never
 * walk the same points three times. Returns null only when there is no
 * answer yet; a session that has already counted returns immediately.
 */
export function useAggregateStats(
  userId: string,
  accountName: string | null
): AggregateStats | null {
  const key = useMemo(
    () => `${userId}|${accountName ?? ""}`,
    [userId, accountName]
  );
  const [stats, setStats] = useState<AggregateStats | null>(() =>
    done?.key === key ? done.stats : null
  );

  useEffect(() => {
    let cancelled = false;
    const cached = done?.key === key ? done : null;
    if (cached) {
      setStats(cached.stats);
      if (Date.now() - cached.at < FRESH_MS) return;
    }
    void share(key, userId, accountName).then((fresh) => {
      if (!cancelled && fresh) setStats(fresh);
    });
    return () => {
      cancelled = true;
    };
  }, [key, userId, accountName]);

  return stats;
}
