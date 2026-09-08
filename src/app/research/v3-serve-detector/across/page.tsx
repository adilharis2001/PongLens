import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@/lib/supabase/server";
import { CSS } from "../styles";
import { callKey, excusedCounts, rowKey, type RowVerdict } from "../rowCalls";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "V3 across matches",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * The V3 card assembler on every exported match at once, read the way Adil
 * asked for it on 2026-09-06: not "how many cards are right" but what a
 * player would have to do afterwards. Adding a missing point is hard.
 * Splitting a card that holds two points, joining two halves and deleting a
 * junk card are easy. A run with more deletes and fewer missing points is
 * the better run.
 *
 * Everything here comes from the files export_prod.py writes beside the
 * per-match page: index.json for the list, each match's compare.json for
 * the numbers and the cards that still need an edit.
 */

interface Meta {
  match: string;
  matchId: string;
  title: string;
  venue: string | null;
}

interface Summary {
  cards: number;
  points: number;
  ok: number;
  missed: number;
  fused: number;
  extra: number;
  on_deleted: number;
  nowhere: number;
  short: number;
  srv_agree: number;
  srv_disagree: number;
}

interface Card {
  t0: number;
  t1: number;
}

interface Row {
  kind: string;
  app_no: number | null;
  prod_t0: number | null;
  prod_t1: number | null;
  tap?: number | null;
  holds_press?: boolean | null;
  verdict: string;
  mine?: Card[];
}

interface MatchData {
  meta: Meta;
  summary: Summary;
  rows: Row[];
}

const ROOT = "public/research/v3-serve-detector";

function mmss(t: number | null | undefined): string {
  if (typeof t !== "number" || !Number.isFinite(t)) return "-";
  const m = Math.floor(t / 60);
  const s = (t - m * 60).toFixed(1).padStart(4, "0");
  return `${m}:${s}`;
}

async function load(): Promise<MatchData[]> {
  let metas: Meta[] = [];
  try {
    const raw = await readFile(path.join(process.cwd(), ROOT, "index.json"), "utf8");
    metas = JSON.parse(raw) as Meta[];
  } catch {
    return [];
  }
  const out: MatchData[] = [];
  for (const meta of metas) {
    try {
      const raw = await readFile(
        path.join(process.cwd(), ROOT, meta.matchId, "compare.json"),
        "utf8",
      );
      const parsed = JSON.parse(raw) as { summary: Summary; rows: Row[] };
      out.push({ meta, summary: parsed.summary, rows: parsed.rows });
    } catch {
      /* a match without a payload is left off the table rather than shown as zeros */
    }
  }
  return out;
}

const EXTRA_CSS = `
.v3 .across { padding: 16px; max-width: 1120px; }
.v3 table.agg { border-collapse: collapse; width: 100%; margin: 12px 0 22px; font-size: 13.5px; }
.v3 table.agg th, .v3 table.agg td { padding: 7px 10px; border-bottom: 1px solid #222831;
  text-align: right; white-space: nowrap; vertical-align: bottom; }
.v3 table.agg th { color: #8b97a7; font-weight: 500; }
.v3 table.agg th:first-child, .v3 table.agg td:first-child { text-align: left; }
.v3 table.agg tr.total td { font-weight: 650; border-top: 1px solid #3a424e; }
.v3 table.agg td.hard { color: #ff9a9a; }
.v3 table.agg td.easy { color: #c0c8d4; }
.v3 table.agg td.good { color: #7fd4a0; }
.v3 .across h2 { font-size: 15px; font-weight: 600; margin: 20px 0 6px; }
.v3 .across h2 a { color: #7fd4ff; font-weight: 500; font-size: 13px; margin-left: 10px; text-decoration: none; }
.v3 .across h2 a:hover { text-decoration: underline; }
.v3 ul.left { margin: 0; padding-left: 18px; color: #c7d2e0; }
.v3 ul.left li { margin: 3px 0; }
.v3 .across .muted { color: #8b97a7; }
.v3 .across p { margin: 6px 0; color: #c7d2e0; }
`;

function describe(r: Row): string | null {
  const span = `${mmss(r.prod_t0)} to ${mmss(r.prod_t1)}`;
  const point = r.app_no != null ? `Point ${r.app_no}` : "Point";
  switch (r.verdict) {
    case "missed":
      return `${point}, ${span}: no card at all. Needs adding.`;
    case "fused":
      return `${point}, ${span}: swallowed by the card next door. Needs splitting out.`;
    case "extra": {
      const cards = (r.mine ?? []).map((c) => `${mmss(c.t0)} to ${mmss(c.t1)}`).join(" and ");
      return `${point}, ${span}: two cards (${cards}). If one is a knock beside a complete card, delete it; if the point was cut in two, join them.`;
    }
    case "junk_unknown": {
      const c = r.mine?.[0];
      return `Card at ${c ? `${mmss(c.t0)} to ${mmss(c.t1)}` : "?"}: where you carded nothing. Delete.`;
    }
    default:
      return null;
  }
}

export default async function V3AcrossMatchesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/research/v3-serve-detector/across");
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (!isAdmin) notFound();

  const data = await load();

  // Adil's row calls on this page: a flagged row he called "fine" is the
  // reference's fault, and is shown beside the number rather than in it.
  const { data: rowVerdicts } = await supabase
    .from("research_row_verdicts")
    .select("match_id,row_s,verdict")
    .eq("page", "v3-serve-detector");
  const calls = new Map<string, string>();
  for (const v of (rowVerdicts ?? []) as RowVerdict[]) calls.set(callKey(v.match_id, Number(v.row_s)), v.verdict);
  const excusedOf = (matchId: string, rows: Row[]) =>
    excusedCounts(rows, (r) => {
      const k = rowKey(r);
      return k == null ? null : calls.get(callKey(matchId, k));
    });
  const excused = new Map(data.map((d) => [d.meta.matchId, excusedOf(d.meta.matchId, d.rows)]));
  const exTotal = { missed: 0, fused: 0, extra: 0, short: 0, junk: 0 };
  for (const e of excused.values()) {
    exTotal.missed += e.missed; exTotal.fused += e.fused; exTotal.extra += e.extra; exTotal.short += e.short; exTotal.junk += e.junk;
  }
  const fine = (n: number) => (n > 0 ? <span className="muted"> ({n} you called fine)</span> : null);
  const total = data.reduce(
    (a, d) => ({
      points: a.points + d.summary.points,
      ok: a.ok + d.summary.ok,
      missed: a.missed + d.summary.missed,
      fused: a.fused + d.summary.fused,
      extra: a.extra + d.summary.extra,
      del: a.del + d.summary.on_deleted + d.summary.nowhere,
      onDeleted: a.onDeleted + d.summary.on_deleted,
      short: a.short + d.summary.short,
      srvA: a.srvA + d.summary.srv_agree,
      srvN: a.srvN + d.summary.srv_agree + d.summary.srv_disagree,
    }),
    { points: 0, ok: 0, missed: 0, fused: 0, extra: 0, del: 0, onDeleted: 0, short: 0, srvA: 0, srvN: 0 },
  );

  return (
    <div className="v3 novideo">
      <style dangerouslySetInnerHTML={{ __html: CSS + EXTRA_CSS }} />
      <div id="matchbar">
        <span className="lab">Match</span>
        <Link href="/research/v3-serve-detector/across" className="pill" aria-current="page">
          All matches
        </Link>
        {data.map(({ meta }) => (
          <Link
            key={meta.matchId}
            href={`/research/v3-serve-detector?m=${meta.matchId}`}
            className="pill"
          >
            {meta.title}
            {meta.venue ? ` · ${meta.venue}` : ""}
          </Link>
        ))}
      </div>
      <header>
        <h1>All matches</h1>
      </header>
      <div className="across">
        {data.length === 0 ? (
          <p>No match has been exported yet.</p>
        ) : (
          <>
            <table className="agg">
              <thead>
                <tr>
                  <th>Match</th>
                  <th>Points you scored</th>
                  <th>Got one correct card</th>
                  <th>Add a missing point</th>
                  <th>Split a card holding two points</th>
                  <th>Two cards on one point</th>
                  <th>Delete a junk card</th>
                  <th>Ends before your winner press</th>
                  <th>Server right</th>
                </tr>
              </thead>
              <tbody>
                {data.map(({ meta, summary: s }) => (
                  <tr key={meta.matchId}>
                    <td>
                      <Link href={`/research/v3-serve-detector?m=${meta.matchId}`}>{meta.title}</Link>
                      {meta.venue ? <span className="muted"> {meta.venue}</span> : null}
                    </td>
                    <td>{s.points}</td>
                    <td className="good">{s.ok}</td>
                    <td className="hard">{s.missed}{fine(excused.get(meta.matchId)?.missed ?? 0)}</td>
                    <td className="hard">{s.fused}{fine(excused.get(meta.matchId)?.fused ?? 0)}</td>
                    <td className="easy">{s.extra}{fine(excused.get(meta.matchId)?.extra ?? 0)}</td>
                    <td className="easy">
                      {s.on_deleted + s.nowhere}
                      <span className="muted"> ({s.on_deleted} on cards you had deleted)</span>
                      {fine(excused.get(meta.matchId)?.junk ?? 0)}
                    </td>
                    <td>{s.short}{fine(excused.get(meta.matchId)?.short ?? 0)}</td>
                    <td>
                      {s.srv_agree}/{s.srv_agree + s.srv_disagree}
                    </td>
                  </tr>
                ))}
                <tr className="total">
                  <td>All {data.length} matches</td>
                  <td>{total.points}</td>
                  <td className="good">{total.ok}</td>
                  <td className="hard">{total.missed}{fine(exTotal.missed)}</td>
                  <td className="hard">{total.fused}{fine(exTotal.fused)}</td>
                  <td className="easy">{total.extra}{fine(exTotal.extra)}</td>
                  <td className="easy">
                    {total.del}
                    <span className="muted"> ({total.onDeleted} on cards you had deleted)</span>
                    {fine(exTotal.junk)}
                  </td>
                  <td>{total.short}{fine(exTotal.short)}</td>
                  <td>
                    {total.srvA}/{total.srvN}
                  </td>
                </tr>
              </tbody>
            </table>

            {data.map(({ meta, rows }) => {
              const items = rows
                .map((r) => describe(r))
                .filter((x): x is string => x !== null);
              const onDeleted = rows.filter((r) => r.verdict === "junk_deleted").length;
              return (
                <section key={meta.matchId}>
                  <h2>
                    {meta.title}
                    <Link href={`/research/v3-serve-detector?m=${meta.matchId}`}>Open the cards</Link>
                  </h2>
                  {items.length === 0 ? (
                    <p>Every point you scored got exactly one card.</p>
                  ) : (
                    <ul className="left">
                      {items.map((text, i) => (
                        <li key={i}>{text}</li>
                      ))}
                    </ul>
                  )}
                  {onDeleted > 0 ? (
                    <p className="muted">
                      Plus {onDeleted} {onDeleted === 1 ? "card" : "cards"} on stretches you had already
                      deleted in the app.
                    </p>
                  ) : null}
                </section>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
