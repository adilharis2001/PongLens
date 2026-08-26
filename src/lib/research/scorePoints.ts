import "server-only";
import type { createAdminClient } from "../supabase/admin.ts";
import type { ScoringPoint } from "./scoreGaps.ts";

/**
 * Every visible point, for scoring a match against the rules of the game.
 *
 * Read with the service key rather than a signed-in session, because the row
 * policy on `points` has no admin branch: it grants a match's owner, their
 * accepted coach, and a coach holding a live review order. The research
 * pages that call this are looking at other people's matches on every
 * count, and they are already behind `is_admin()`.
 *
 * PostgREST answers at most 1000 rows whatever the query asks for, so this
 * pages. That is not a precaution: the twelve matches on /research/endon
 * already carry 963 points between them, and a thirteenth would have pushed
 * it over — silently, with a wrong game showing rather than an error.
 */
const PAGE = 1000;

export async function fetchVisiblePoints(
  admin: ReturnType<typeof createAdminClient>,
  matchIds?: readonly string[],
): Promise<(ScoringPoint & { match_id: string })[]> {
  if (matchIds && matchIds.length === 0) return [];
  const out: (ScoringPoint & { match_id: string })[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = admin
      .from("points")
      .select(
        "id,match_id,idx,t0,t1,is_let,confirmed_winner,game_end_override,game_winner_override",
      )
      .eq("deleted", false);
    if (matchIds) q = q.in("match_id", matchIds);
    // A stable order is what makes the paging meaningful: without it two
    // requests can return overlapping windows of the same table.
    const { data, error } = await q
      .order("match_id")
      .order("idx")
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    for (const r of data) {
      out.push({
        id: r.id,
        match_id: r.match_id,
        idx: r.idx,
        t0: r.t0 === null ? null : Number(r.t0),
        t1: r.t1 === null ? null : Number(r.t1),
        is_let: Boolean(r.is_let),
        confirmed_winner: r.confirmed_winner,
        game_end_override: r.game_end_override,
        game_winner_override: r.game_winner_override,
      });
    }
    if (data.length < PAGE) break;
  }
  return out;
}
