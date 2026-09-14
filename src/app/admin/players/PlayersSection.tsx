"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatCost } from "@/lib/costs/calculations";
import { signupSourceLabel } from "@/lib/auth/signupSource";
import {
  agoLabel,
  countLabel,
  filterPlayers,
  gbLabel,
  isNew,
  PLAYER_SORTS,
  sortPlayers,
  type PlayerKind,
  type PlayerOverviewRow,
  type PlayerSort,
  whenExactLabel,
} from "./playersView";

/**
 * Every account (admin_player_overview, 068), and — since 176 — only the
 * ones worth looking at.
 *
 * It used to be one tall list of forty-seven rows ordered by match count,
 * which put Adil's own test accounts at the top and left a real person who
 * signed up this morning wherever their upload count happened to land.
 * About ten of the forty-seven are genuine users. So: a kind filter that
 * opens on Real, an order that opens on recent activity, and the dates
 * that make "somebody new turned up" visible at a glance.
 *
 * The kind is editable here because it has to be. New throwaways get made
 * every week, they default to Real so a genuine signup is never hidden,
 * and the fix has to be one click from the row that is wrong.
 */

const KINDS: { key: PlayerKind | "all"; label: string }[] = [
  { key: "real", label: "Real" },
  { key: "team", label: "Team" },
  { key: "test", label: "Test" },
  { key: "all", label: "All" },
];

/** What one account said when onboarding asked how it found us. Its own
 *  table and its own read: the answer belongs to the owner and the admin,
 *  and it is not on the player's profile row that their coach can see. */
interface SignupSourceRow {
  user_id: string;
  source: string;
  detail: string | null;
}

export function PlayersSection() {
  const router = useRouter();
  const [rows, setRows] = useState<PlayerOverviewRow[] | null>(null);
  const [sources, setSources] = useState<Map<string, SignupSourceRow>>(
    new Map(),
  );
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<PlayerKind | "all">("real");
  const [sort, setSort] = useState<PlayerSort>("active");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    void supabase.rpc("admin_player_overview").then(({ data, error }) => {
      if (error) setError(error.message);
      else setRows((data as PlayerOverviewRow[]) ?? []);
    });
    // Its own read rather than a column on the overview, so that adding a
    // question to onboarding never means rewriting the function the outreach
    // page also calls. A failure here leaves the column blank; it must not
    // take the players list down with it.
    void supabase
      .from("signup_sources")
      .select("user_id,source,detail")
      .then(({ data }) => {
        setSources(
          new Map(
            ((data as SignupSourceRow[]) ?? []).map((r) => [r.user_id, r]),
          ),
        );
      });
  }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = { real: 0, team: 0, test: 0, all: 0 };
    for (const r of rows ?? []) {
      c[r.kind] = (c[r.kind] ?? 0) + 1;
      c.all += 1;
    }
    return c;
  }, [rows]);

  const shown = useMemo(
    () => sortPlayers(filterPlayers(rows ?? [], kind, query), sort),
    [rows, kind, query, sort],
  );

  /** Where the accounts in view came from, commonest first. Counted over
   *  what the filters are showing, so reading it on Real answers the
   *  question worth asking and the test accounts stay out of it. */
  const tally = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of shown) {
      const answer = sources.get(row.user_id)?.source;
      if (answer) counts.set(answer, (counts.get(answer) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [shown, sources]);

  /** Change what an account is. Optimistic: the row stays put until the
   *  filter is re-read, so the list does not jump under the cursor while
   *  the click is still landing. */
  const setRowKind = async (row: PlayerOverviewRow, next: PlayerKind) => {
    setBusy(row.user_id);
    const supabase = createClient();
    const { error } = await supabase.rpc("admin_player_kind_set", {
      p_user_id: row.user_id,
      p_kind: next,
    });
    setBusy(null);
    if (error) {
      setError(error.message);
      return;
    }
    setRows((prev) =>
      (prev ?? []).map((r) =>
        r.user_id === row.user_id ? { ...r, kind: next } : r,
      ),
    );
  };

  if (error) {
    return <p className="text-sm text-red-400">{error}</p>;
  }
  if (rows === null) {
    return (
      <div className="h-40 animate-pulse rounded-2xl border border-edge bg-surface" />
    );
  }

  return (
    <>
      {/* Controls. One row on a wide screen, stacked on a phone; both are
          the same three controls rather than two designs. */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 overflow-x-auto">
          {KINDS.map((k) => (
            <button
              key={k.key}
              type="button"
              onClick={() => setKind(k.key)}
              aria-pressed={kind === k.key}
              className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
                kind === k.key
                  ? "bg-surface-2 text-white"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {k.label}
              <span className="ml-1.5 tabular-nums text-zinc-600">
                {counts[k.key] ?? 0}
              </span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or email"
            aria-label="Search players"
            className="min-w-0 flex-1 rounded-full border border-edge bg-surface px-3.5 py-1.5 text-[13px] text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-glow/60 focus:outline-none sm:w-52 sm:flex-none"
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as PlayerSort)}
            aria-label="Sort players"
            className="shrink-0 rounded-full border border-edge bg-surface px-3 py-1.5 text-[13px] text-zinc-200 focus:border-cyan-glow/60 focus:outline-none"
          >
            {PLAYER_SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Where the accounts in view say they came from. Only the ones that
          answered are counted, and only accounts created since the question
          shipped were ever asked, so this is a share of answers rather than
          a share of signups. */}
      {tally.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-2xl border border-edge bg-surface px-4 py-3 text-[13px]">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Heard about us from
          </span>
          {tally.map(([answer, count]) => (
            <span key={answer} className="text-zinc-300">
              {signupSourceLabel(answer)}
              <span className="ml-1.5 tabular-nums text-zinc-600">{count}</span>
            </span>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <p className="text-sm text-zinc-500">
          {query
            ? "Nobody matches that."
            : `No ${kind === "all" ? "" : kind} players.`}
        </p>
      ) : (
        <>
          {/* Wide: one table row per player */}
          <div className="hidden overflow-hidden rounded-2xl border border-edge bg-surface md:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="text-xs text-zinc-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">Player</th>
                    <th className="px-3 py-3 font-medium">From</th>
                    <th className="px-3 py-3 font-medium">Joined</th>
                    <th className="px-3 py-3 font-medium">Last seen</th>
                    <th className="px-3 py-3 font-medium">Last upload</th>
                    <th className="px-3 py-3 font-medium">Matches</th>
                    <th className="px-3 py-3 font-medium">Points</th>
                    <th className="px-3 py-3 font-medium">Notes</th>
                    <th className="px-3 py-3 font-medium">Storage</th>
                    <th className="px-3 py-3 text-right font-medium">
                      Est. cost
                    </th>
                    <th className="px-5 py-3 font-medium">Kind</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-edge/60">
                  {shown.map((row) => (
                    <tr
                      key={row.user_id}
                      onClick={() =>
                        router.push(`/admin/players/${row.user_id}`)
                      }
                      className="group cursor-pointer transition-colors hover:bg-surface-2/40"
                    >
                      <td className="px-5 py-3">
                        <span className="flex items-center gap-2">
                          <Link
                            href={`/admin/players/${row.user_id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="font-medium text-zinc-200 group-hover:text-cyan-glow"
                          >
                            {row.name || row.email}
                          </Link>
                          {isNew(row) && (
                            <span className="rounded-full bg-cyan-glow/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-glow">
                              New
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 block text-xs text-zinc-600">
                          {row.email}
                        </span>
                      </td>
                      {/* The name under the answer is the point of asking:
                          "a coach" says the channel works, "Anton Berman"
                          says which coach to thank. */}
                      <td className="px-3 py-3 text-zinc-300">
                        {signupSourceLabel(sources.get(row.user_id)?.source) ?? (
                          <span className="text-zinc-700">&mdash;</span>
                        )}
                        {sources.get(row.user_id)?.detail && (
                          <span className="mt-0.5 block text-xs text-zinc-500">
                            {sources.get(row.user_id)?.detail}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 tabular-nums text-zinc-300">
                        {agoLabel(row.created_at)}
                      </td>
                      <td
                        className="px-3 py-3 tabular-nums text-zinc-300"
                        title={whenExactLabel(row.last_seen_at) ?? undefined}
                      >
                        {agoLabel(row.last_seen_at ?? null) ?? "—"}
                      </td>
                      <td className="px-3 py-3 tabular-nums text-zinc-300">
                        {agoLabel(row.last_upload_at)}
                      </td>
                      <td className="px-3 py-3 tabular-nums text-zinc-200">
                        {row.matches}
                        {row.matches_scored > 0 && (
                          <span className="mt-0.5 block text-xs font-normal text-zinc-600">
                            {row.matches_scored} scored
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 tabular-nums text-zinc-300">
                        {row.points}
                      </td>
                      <td className="px-3 py-3 tabular-nums text-zinc-300">
                        {row.notes}
                      </td>
                      <td className="px-3 py-3 tabular-nums text-zinc-300">
                        {gbLabel(row.used_bytes)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-zinc-200">
                        {formatCost(row.est_cost_usd)}
                      </td>
                      <td className="px-5 py-3" onClick={(e) => e.stopPropagation()}>
                        <select
                          value={row.kind}
                          disabled={busy === row.user_id}
                          onChange={(e) =>
                            void setRowKind(row, e.target.value as PlayerKind)
                          }
                          aria-label={`What ${row.name || row.email} is`}
                          className="rounded-full border border-edge bg-surface-2 px-2.5 py-1 text-xs text-zinc-300 focus:border-cyan-glow/60 focus:outline-none disabled:opacity-60"
                        >
                          <option value="real">Real</option>
                          <option value="team">Team</option>
                          <option value="test">Test</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Narrow: one card per player */}
          <ul className="divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface md:hidden">
            {shown.map((row) => (
              <li key={row.user_id} className="px-4 py-3">
                <Link
                  href={`/admin/players/${row.user_id}`}
                  className="block transition-colors hover:opacity-80"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="flex min-w-0 items-center gap-2 truncate text-sm font-medium text-zinc-200">
                      <span className="truncate">{row.name || row.email}</span>
                      {isNew(row) && (
                        <span className="shrink-0 rounded-full bg-cyan-glow/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-glow">
                          New
                        </span>
                      )}
                    </p>
                    <p className="shrink-0 text-sm tabular-nums text-zinc-300">
                      {formatCost(row.est_cost_usd)}
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    Seen {agoLabel(row.last_seen_at ?? null) ?? "never"} ·
                    Joined {agoLabel(row.created_at)} · Uploaded{" "}
                    {agoLabel(row.last_upload_at)}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-600">
                    {countLabel(row.matches, "match", "matches")} ·{" "}
                    {countLabel(row.points, "point")} ·{" "}
                    {gbLabel(row.used_bytes)}
                  </p>
                  {sources.get(row.user_id) && (
                    <p className="mt-0.5 text-xs text-zinc-500">
                      From {signupSourceLabel(sources.get(row.user_id)?.source)}
                      {sources.get(row.user_id)?.detail
                        ? ` · ${sources.get(row.user_id)?.detail}`
                        : ""}
                    </p>
                  )}
                </Link>
                <select
                  value={row.kind}
                  disabled={busy === row.user_id}
                  onChange={(e) =>
                    void setRowKind(row, e.target.value as PlayerKind)
                  }
                  aria-label={`What ${row.name || row.email} is`}
                  className="mt-2 rounded-full border border-edge bg-surface-2 px-2.5 py-1 text-xs text-zinc-300 focus:border-cyan-glow/60 focus:outline-none disabled:opacity-60"
                >
                  <option value="real">Real</option>
                  <option value="team">Team</option>
                  <option value="test">Test</option>
                </select>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="mt-3 text-xs text-zinc-600">
        Kind is yours to set. A new account counts as Real until you say
        otherwise, so a genuine signup is never hidden. Cost is an estimated
        split of platform spend by each player&apos;s storage and activity.
        From is what the account answered when onboarding asked how it found
        us. It is blank for anyone who signed up before the question existed,
        for anyone who skipped it, and for a coach who came in through a
        player&apos;s invite, who is never asked.
      </p>
    </>
  );
}
