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
 * One fetch, one aggregation — shared by /stats and Home's "Your game"
 * card so the two can never disagree. Fetches once per mount (no
 * polling: cross-match stats move at match cadence, not job cadence).
 * Returns null while loading.
 */
export function useAggregateStats(
  userId: string,
  accountName: string | null
): AggregateStats | null {
  const [matches, setMatches] = useState<MatchLite[] | null>(null);
  const [points, setPoints] = useState<Point[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    (async () => {
      const { data: ms } = await supabase
        .from("matches")
        .select(
          "id, opponent_name, match_type, played_at, first_server, first_server_source, user_side, player_near_name, player_far_name"
        )
        .eq("user_id", userId);
      if (cancelled) return;
      const list = (ms as MatchLite[]) ?? [];
      setMatches(list);

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
      if (!cancelled) setPoints(all);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return useMemo(() => {
    if (!matches || !points) return null;
    const byMatch = new Map<string, Point[]>();
    for (const p of points) {
      const list = byMatch.get(p.match_id) ?? [];
      list.push(p);
      byMatch.set(p.match_id, list);
    }
    return aggregateStats(matches, byMatch, accountName);
  }, [matches, points, accountName]);
}
