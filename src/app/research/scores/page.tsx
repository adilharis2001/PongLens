import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  pointsShort,
  scoreMatch,
  type MatchScoring,
  type ScoredGame,
  type ScoringPoint,
} from "@/lib/research/scoreGaps";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Games that could not have ended that way",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Every match anyone has scored, and whether each of its games could have
 * ended the way it is recorded.
 *
 * A game ends at 11, or past 10-all at the first two-point lead. A game
 * recorded as 9-5 therefore did not end: the person scoring reached the end
 * of the footage before the game reached its eleventh point, which means
 * rallies that were played are not in the cut.
 *
 * That makes the scoring a detector for dropped play, and the only one on
 * these research pages that costs nothing and needs nobody to mark anything
 * by hand. Its ground truth is the rules of the game. It also keeps
 * producing evidence on its own: every match scored from here on adds to it.
 *
 * The rule itself lives in `scoreGaps.ts`, which folds points through the
 * match page's own boundary walk, so a game here is the same game the owner
 * sees on their match.
 */

const PAGE = 1000;
const BLUE = "#5a8cff";
const AMBER = "#f59e0b";

function mmss(t: number): string {
  return `${Math.floor(t / 60)}:${Math.floor(t % 60)
    .toString()
    .padStart(2, "0")}`;
}

interface Row {
  id: string;
  mine: boolean;
  opponent: string | null;
  venue: string | null;
  created: string;
  scoring: MatchScoring;
}

/**
 * PostgREST answers at most 1000 rows per request whatever the query says,
 * and there are about five thousand points across the scored matches. A
 * page that silently rendered the first thousand would report a lot of
 * missing rallies that are simply not in the response.
 */
async function allVisiblePoints(
  admin: ReturnType<typeof createAdminClient>,
): Promise<(ScoringPoint & { match_id: string })[]> {
  const out: (ScoringPoint & { match_id: string })[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("points")
      .select(
        "id,match_id,idx,t0,t1,is_let,confirmed_winner,game_end_override,game_winner_override",
      )
      .eq("deleted", false)
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

/** Why a score does not add up, in the order that matters. */
function gameNote(g: ScoredGame): string {
  if (g.legal) return "";
  if (g.overrun) return "ran past 11 without the game ending";
  if (g.unscored > 0)
    return `${g.unscored} point${g.unscored === 1 ? "" : "s"} not scored yet`;
  if (g.final) return "last game, recording stopped";
  const n = pointsShort(g.you, g.them);
  return `${n} rall${n === 1 ? "y" : "ies"} short of a game`;
}

function Sequence({ game }: { game: ScoredGame }) {
  const gapAt = new Map(game.gaps.map((g) => [g.t, g.seconds]));
  return (
    <span className="inline-flex flex-wrap items-center gap-y-1">
      {game.points.map((p) => (
        <span key={p.id} className="inline-flex items-center">
          <span
            title={`${mmss(p.t0)} · ${
              p.winner === "user"
                ? "uploader"
                : p.winner === "opponent"
                  ? "opponent"
                  : p.skipped
                    ? "skipped"
                    : "not scored"
            }${p.winner ? ` · ${p.you}-${p.them}` : ""}`}
            style={{
              background:
                p.winner === "user"
                  ? BLUE
                  : p.winner === "opponent"
                    ? AMBER
                    : "#3f3f46",
            }}
            className="mr-[3px] inline-block h-4 w-[7px] rounded-[2px] align-middle"
          />
          {gapAt.has(p.t1) ? (
            <span className="mr-[5px] inline-block rounded border border-red-700 px-1 text-[10px] leading-4 tabular-nums text-red-300 align-middle">
              {Math.round(gapAt.get(p.t1) ?? 0)}s
            </span>
          ) : null}
        </span>
      ))}
    </span>
  );
}

export default async function ScoresPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/research/scores");
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) notFound();

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return (
      <main className="mx-auto max-w-5xl px-5 py-8">
        <h1 className="text-xl font-semibold text-zinc-100">
          Games that could not have ended that way
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          This page reads other people&apos;s matches, so it needs the service
          key. There is none in this environment.
        </p>
      </main>
    );
  }

  const points = await allVisiblePoints(admin);
  const byMatch = new Map<string, ScoringPoint[]>();
  for (const p of points) {
    const list = byMatch.get(p.match_id) ?? [];
    list.push(p);
    byMatch.set(p.match_id, list);
  }

  const scoring = new Map<string, MatchScoring>();
  for (const [id, list] of byMatch) {
    const s = scoreMatch(list);
    if (s.scored > 0) scoring.set(id, s);
  }

  const { data: matches } = await admin
    .from("matches")
    .select("id,user_id,opponent_name,venue,created_at")
    .in("id", [...scoring.keys()]);

  const rows: Row[] = (matches ?? [])
    .map((m) => ({
      id: m.id,
      mine: m.user_id === user.id,
      opponent: m.opponent_name,
      venue: m.venue,
      created: m.created_at
        ? new Date(m.created_at).toISOString().slice(0, 10)
        : "",
      scoring: scoring.get(m.id)!,
    }))
    .sort(
      (a, b) =>
        b.scoring.suspect - a.scoring.suspect ||
        b.scoring.missing - a.scoring.missing ||
        b.scoring.overrun - a.scoring.overrun ||
        b.created.localeCompare(a.created),
    );

  const games = rows.reduce((n, r) => n + r.scoring.games.length, 0);
  const suspect = rows.reduce((n, r) => n + r.scoring.suspect, 0);
  const missing = rows.reduce((n, r) => n + r.scoring.missing, 0);
  const trailing = rows.reduce(
    (n, r) => n + r.scoring.games.filter((g) => g.final && !g.legal).length,
    0,
  );
  const overrun = rows.reduce((n, r) => n + r.scoring.overrun, 0);

  const stat = (n: number, label: string, bad = false) => (
    <div key={label}>
      <b
        className={`block text-2xl font-semibold tabular-nums ${
          bad ? "text-red-400" : "text-zinc-100"
        }`}
      >
        {n}
      </b>
      <span className="text-xs uppercase tracking-wide text-zinc-500">
        {label}
      </span>
    </div>
  );

  return (
    <main className="mx-auto max-w-5xl px-5 py-8">
      <h1 className="text-xl font-semibold text-zinc-100">
        Games that could not have ended that way
      </h1>
      <p className="mt-2 max-w-prose text-sm text-zinc-400">
        A game ends at 11, or past 10-all at the first two-point lead. Any
        other final score means the scoring ran out of footage before the game
        ran out of points, so rallies that were played are missing from the
        cut. Three kinds of short game are excused, because each has an
        ordinary explanation: the last game of a match, which is short because
        the recording stopped; a game with points still unscored, where the
        scoring is simply unfinished; and a game whose score ran past 11,
        which is a boundary in the wrong place rather than a missing rally.
        What is red is a game whose every rally was watched and called, which
        still did not reach 11, and which had play carry on after it.
      </p>
      <p className="mt-2 max-w-prose text-sm text-zinc-400">
        Blue is a point to the uploader, amber to the opponent, grey a point
        nobody has scored. A red chip is a gap far longer than that
        game&apos;s own rhythm, which is the likeliest place a rally was
        dropped. The twelve matches with video and detector lanes are on{" "}
        <Link
          className="text-cyan-400 underline underline-offset-2"
          href="/research/endon"
        >
          the end-on page
        </Link>
        .
      </p>

      <div className="mt-6 flex flex-wrap gap-x-10 gap-y-4">
        {stat(suspect, "games short mid-match", suspect > 0)}
        {stat(missing, "points missing, at minimum", missing > 0)}
        {stat(overrun, "games that ran past 11")}
        {stat(trailing, "last games cut off")}
        {stat(games, "games scored")}
        {stat(rows.length, "matches")}
      </div>

      <div className="mt-8 space-y-0">
        {rows.map((r) => (
          <section key={r.id} className="border-t border-zinc-800 py-4">
            <h2 className="text-sm font-semibold text-zinc-100">
              {r.opponent ? `vs ${r.opponent}` : "no opponent set"}
              {r.venue ? (
                <span className="font-normal text-zinc-400"> · {r.venue}</span>
              ) : null}
              <span className="font-normal text-zinc-500">
                {" "}
                · {r.created} ·{" "}
                {r.mine ? (
                  <Link
                    className="text-cyan-400 underline underline-offset-2"
                    href={`/match/${r.id}`}
                  >
                    {r.id.slice(0, 8)}
                  </Link>
                ) : (
                  r.id.slice(0, 8)
                )}
              </span>
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              {r.scoring.scored} of {r.scoring.visible} points scored ·{" "}
              {r.scoring.games.length} game
              {r.scoring.games.length === 1 ? "" : "s"} ·{" "}
              <span
                className={r.scoring.suspect ? "text-red-400" : "text-emerald-400"}
              >
                {r.scoring.suspect} incomplete
              </span>
              {r.scoring.missing > 0
                ? ` · at least ${r.scoring.missing} points missing`
                : ""}
            </p>
            <table className="mt-2 w-full">
              <tbody>
                {r.scoring.games.map((g) => (
                  <tr key={g.game} className="border-b border-zinc-800/70">
                    <td className="w-16 py-1.5 pr-2 align-middle text-xs text-zinc-500">
                      game {g.game}
                    </td>
                    <td
                      className={`w-20 py-1.5 pr-2 align-middle text-sm font-semibold tabular-nums ${
                        g.suspect
                          ? "text-red-400"
                          : g.legal
                            ? "text-zinc-200"
                            : "text-zinc-500"
                      }`}
                    >
                      {g.you} – {g.them}
                    </td>
                    <td className="w-52 py-1.5 pr-3 align-middle text-xs text-zinc-500">
                      {gameNote(g)}
                    </td>
                    <td className="py-1.5 align-middle">
                      <Sequence game={g} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </main>
  );
}
