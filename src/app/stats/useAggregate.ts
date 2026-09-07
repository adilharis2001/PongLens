"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Point } from "@/lib/types";
import {
  aggregateStats,
  type AggregateStats,
  type MatchLite,
} from "./aggregate";

/** Point columns the aggregation walks actually read. */
const POINT_COLS =
  "id, match_id, idx, t0, is_let, confirmed_winner, confirmed_how, " +
  "direction, serve_spin, serve_sidespin, serve_length, loss_reasons, " +
  "game_end_override, server_override, server";

/**
 * There is no summary row anywhere: every one of these numbers is folded
 * out of every live point of every match, in the browser, on each mount.
 * On a big account that is thousands of rows over several round trips,
 * and three surfaces want the same answer — Home's "Your game" card,
 * /stats, and the Journal's Stats tab.
 *
 * So the walk is shared. The first caller in a page session does it; the
 * rest are handed the finished result, which is why the Journal's Stats
 * tab can paint filled the second time it is opened. A caller arriving
 * while the walk is still running waits on the same promise rather than
 * starting a second one.
 *
 * `matches` has no `updated_at`, so there is nothing cheap to compare a
 * cached answer against. Instead the result is simply re-walked in the
 * background when it is more than a minute old, and the stale numbers
 * stay on screen until the new ones land. Making this a stored per-match
 * summary is its own piece of work; until then, this is the difference
 * between a tab that pauses and one that does not.
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
      "id, opponent_name, match_type, played_at, first_server, first_server_source, user_side, player_near_name, player_far_name"
    )
    .eq("user_id", userId);
  const list = (ms as MatchLite[]) ?? [];

  // Points arrive in match-id chunks (URL length) and 1000-row pages
  // (PostgREST cap). Order doesn't matter — sortPoints runs per match.
  const all: Point[] = [];
  const ids = list.map((m) => m.id);
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    for (let from = 0; ; from += 1000) {
      const { data: ps } = await supabase
        .from("points")
        .select(POINT_COLS)
        .in("match_id", chunk)
        .eq("deleted", false)
        .range(from, from + 999);
      const page = (ps as unknown as Point[]) ?? [];
      all.push(...page);
      if (page.length < 1000) break;
    }
  }

  const byMatch = new Map<string, Point[]>();
  for (const p of all) {
    const rows = byMatch.get(p.match_id) ?? [];
    rows.push(p);
    byMatch.set(p.match_id, rows);
  }
  return aggregateStats(list, byMatch, accountName);
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
