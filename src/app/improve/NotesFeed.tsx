"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type {
  Note,
  NoteFeedRow,
  TagStat,
  TaggedPointRow,
} from "@/lib/types";
import { deriveMatchTitleParts, shortDate } from "@/lib/matchTitle";
import { NoteItem } from "@/app/match/[id]/Notes";
import { TagGlyph } from "@/app/match/[id]/Tags";

type KindFilter = "all" | "mine" | "coach" | "voice" | "text";

/**
 * The consolidated notes workspace: every note across the matches this
 * user can access (own + coach-shared), newest first, each keeping enough
 * match/point context to jump back to where it was written. Note bodies,
 * attribution colours, and voice playback reuse the match page's NoteItem,
 * so a note reads identically here and in the match thread.
 *
 * Tags (035) sit above the feed as a rail with cross-match counts.
 * Selecting one swaps the list to that tag's POINTS — tags attach to
 * points, not notes, so a tagged point with no note still shows — each
 * with its match context, any notes it does carry, and a deep link.
 */
export function NotesFeed({
  userId,
  accountName,
}: {
  userId: string;
  /** Viewer's account first name — feeds neutral-match title detection. */
  accountName: string | null;
}) {
  const [rows, setRows] = useState<NoteFeedRow[] | null>(null);
  const [kind, setKind] = useState<KindFilter>("all");
  const [matchFilter, setMatchFilter] = useState<string>("all");
  const [tagStats, setTagStats] = useState<TagStat[]>([]);
  const [activeTag, setActiveTag] = useState<TagStat | null>(null);
  // point rows for the active tag; null while loading
  const [taggedRows, setTaggedRows] = useState<TaggedPointRow[] | null>(null);

  useEffect(() => {
    const supabase = createClient();
    void supabase
      .rpc("note_feed", { p_limit: 500 })
      .then(({ data }) => setRows((data as NoteFeedRow[]) ?? []));
    void supabase.rpc("tag_stats").then(({ data }) => {
      const stats = (data as TagStat[]) ?? [];
      setTagStats(stats.filter((s) => Number(s.point_count) > 0));
    });
  }, []);

  useEffect(() => {
    if (!activeTag) {
      setTaggedRows(null);
      return;
    }
    let cancelled = false;
    setTaggedRows(null);
    const supabase = createClient();
    void supabase
      .rpc("tagged_points", { p_tag: activeTag.tag_id })
      .then(({ data }) => {
        if (!cancelled) setTaggedRows((data as TaggedPointRow[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTag]);

  const titleFor = useCallback(
    (n: {
      match_owner_id: string;
      user_side: "near" | "far" | null;
      player_near_name: string | null;
      player_far_name: string | null;
      opponent_name: string | null;
      venue: string | null;
      played_at: string;
    }) => {
      const own = n.match_owner_id === userId;
      const ownSide = (
        (n.user_side === "far" ? n.player_far_name : n.player_near_name) ?? ""
      ).trim();
      const acct = (accountName ?? "").trim().toLowerCase();
      const neutral =
        own && ownSide !== "" && (acct === "" || ownSide.toLowerCase() !== acct);
      return deriveMatchTitleParts({
        opponentName: n.opponent_name,
        venue: n.venue,
        playedAt: n.played_at,
        neutral,
        nameA: ownSide,
        nameB: (n.opponent_name ?? "").trim(),
      }).primary;
    },
    [userId, accountName]
  );

  // Match filter options: every match present in the feed, newest first
  // (feed order), labelled with the same derived title the cards use.
  const matchOptions = useMemo(() => {
    if (!rows) return [];
    const seen = new Map<string, string>();
    for (const n of rows) {
      if (!seen.has(n.match_id)) {
        seen.set(n.match_id, `${titleFor(n)} · ${shortDate(n.played_at)}`);
      }
    }
    return [...seen.entries()];
  }, [rows, titleFor]);

  // Notes keyed by point, so a tagged point can show its thread inline.
  const notesByPoint = useMemo(() => {
    const map = new Map<string, NoteFeedRow[]>();
    for (const n of rows ?? []) {
      if (!n.point_id) continue;
      const list = map.get(n.point_id) ?? [];
      list.push(n);
      map.set(n.point_id, list);
    }
    return map;
  }, [rows]);

  const filtered = (rows ?? []).filter((n) => {
    if (matchFilter !== "all" && n.match_id !== matchFilter) return false;
    switch (kind) {
      case "mine":
        return n.author_id === userId;
      case "coach":
        return n.author_id !== n.match_owner_id;
      case "voice":
        return n.audio_path !== null;
      case "text":
        return n.audio_path === null;
      default:
        return true;
    }
  });

  const chip = (value: KindFilter, label: string) => (
    <button
      key={value}
      type="button"
      onClick={() => setKind(value)}
      aria-pressed={kind === value}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        kind === value
          ? "border-cyan-glow/60 bg-cyan-glow/10 text-cyan-glow"
          : "border-edge text-zinc-400 hover:text-zinc-200"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div>
      {/* Tag rail: the owner's vocabulary with cross-match reach. A tag
          selects POINTS; everything below swaps accordingly. */}
      {tagStats.length > 0 && (
        <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
          {tagStats.map((s) => {
            const on = activeTag?.tag_id === s.tag_id;
            return (
              <button
                key={s.tag_id}
                type="button"
                onClick={() => setActiveTag(on ? null : s)}
                aria-pressed={on}
                title={`${s.point_count} point${
                  Number(s.point_count) === 1 ? "" : "s"
                } across ${s.match_count} match${
                  Number(s.match_count) === 1 ? "" : "es"
                }`}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  on
                    ? "border-cyan-glow/60 bg-cyan-glow/10 text-cyan-glow"
                    : "border-edge text-zinc-300 hover:border-cyan-glow/40 hover:text-white"
                }`}
              >
                <TagGlyph className="h-3 w-3" />
                {s.label}
                <span
                  className={`tabular-nums ${
                    on ? "text-cyan-glow/80" : "text-zinc-500"
                  }`}
                >
                  {s.point_count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {!activeTag && rows !== null && rows.length > 0 && (
        <div className="space-y-2.5">
          <div className="flex flex-wrap gap-1.5">
            {chip("all", "All")}
            {chip("mine", "Mine")}
            {chip("coach", "Coach")}
            {chip("voice", "Voice")}
            {chip("text", "Text")}
          </div>
          {matchOptions.length > 1 && (
            <select
              value={matchFilter}
              onChange={(e) => setMatchFilter(e.target.value)}
              aria-label="Filter by match"
              className="w-full rounded-xl border border-edge bg-surface-2/40 px-3.5 py-2.5 text-sm text-zinc-100 focus:border-cyan-glow/60 focus:outline-none"
            >
              <option value="all">All matches</option>
              {matchOptions.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {activeTag ? (
        taggedRows === null ? (
          <div className="mt-4 space-y-3">
            {[0, 1].map((i) => (
              <div
                key={i}
                className="h-20 animate-pulse rounded-2xl border border-edge bg-surface"
              />
            ))}
          </div>
        ) : (
          <>
            <p className="text-sm text-zinc-500">
              {activeTag.point_count} point
              {Number(activeTag.point_count) === 1 ? "" : "s"} across{" "}
              {activeTag.match_count} match
              {Number(activeTag.match_count) === 1 ? "" : "es"} tagged
              &ldquo;{activeTag.label}&rdquo;.
            </p>
            <ul className="mt-3 space-y-3">
              {taggedRows.map((tp) => {
                const pointNotes = notesByPoint.get(tp.point_id) ?? [];
                return (
                  <li
                    key={tp.point_id}
                    className="rounded-2xl border border-edge bg-surface p-4"
                  >
                    <Link
                      href={`/match/${tp.match_id}?p=${tp.point_id}`}
                      className="group flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-zinc-200 transition-colors group-hover:text-white">
                          Point {tp.point_no} · {titleFor(tp)}
                        </p>
                        <p className="mt-0.5 text-xs text-zinc-500">
                          {shortDate(tp.played_at)}
                        </p>
                      </div>
                      <svg
                        viewBox="0 0 24 24"
                        className="h-4 w-4 shrink-0 text-zinc-600 transition-colors group-hover:text-cyan-glow"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="m9 6 6 6-6 6"
                        />
                      </svg>
                    </Link>
                    {pointNotes.length > 0 && (
                      <ul className="mt-2.5 space-y-2">
                        {pointNotes.map((n) => (
                          <NoteItem
                            key={n.id}
                            note={{
                              id: n.id,
                              match_id: n.match_id,
                              point_id: n.point_id,
                              author_id: n.author_id,
                              body: n.body,
                              audio_path: n.audio_path,
                              created_at: n.created_at,
                            }}
                            matchId={n.match_id}
                            ownerId={n.match_owner_id}
                            viewerId={userId}
                            authorName={n.author_name}
                            clamp
                          />
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )
      ) : rows === null ? (
        <div className="mt-4 space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-2xl border border-edge bg-surface"
            />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-edge bg-surface p-10 text-center">
          <p className="text-3xl">📝</p>
          <p className="mt-3 font-medium text-zinc-200">No notes yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-zinc-500">
            Add notes while reviewing a match: on the whole match or a
            single point, typed or spoken. They all collect here.
          </p>
          <Link
            href="/matches"
            className="glow-cta mt-5 inline-block rounded-full bg-cyan-glow px-6 py-2.5 text-sm font-semibold text-ink"
          >
            Open a match
          </Link>
        </div>
      ) : filtered.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">
          No notes match these filters.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {filtered.map((n) => {
            const note: Note = {
              id: n.id,
              match_id: n.match_id,
              point_id: n.point_id,
              author_id: n.author_id,
              body: n.body,
              audio_path: n.audio_path,
              created_at: n.created_at,
            };
            return (
              <li
                key={n.id}
                className="rounded-2xl border border-edge bg-surface p-4"
              >
                <Link
                  href={`/match/${n.match_id}${
                    n.point_id ? `?p=${n.point_id}` : ""
                  }`}
                  className="group flex items-center justify-between gap-3 pb-2.5"
                >
                  <p className="truncate text-xs font-medium text-zinc-400 transition-colors group-hover:text-zinc-200">
                    {titleFor(n)}
                    <span className="text-zinc-600">
                      {" "}
                      · {n.point_id ? "Point note" : "Match note"}
                    </span>
                  </p>
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4 shrink-0 text-zinc-600 transition-colors group-hover:text-cyan-glow"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m9 6 6 6-6 6"
                    />
                  </svg>
                </Link>
                <ul>
                  <NoteItem
                    note={note}
                    matchId={n.match_id}
                    ownerId={n.match_owner_id}
                    viewerId={userId}
                    authorName={n.author_name}
                  />
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
