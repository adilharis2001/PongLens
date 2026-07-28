"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type {
  Lesson,
  Note,
  NoteFeedRow,
  TagStat,
  TaggedPointRow,
} from "@/lib/types";
import { LessonCard } from "./LessonCard";
import { WorkingOn } from "./WorkingOn";
import { deriveMatchTitleParts, shortDate } from "@/lib/matchTitle";
import { NoteItem } from "@/app/match/[id]/Notes";
import { TagGlyph } from "@/app/match/[id]/Tags";
import { FabButton } from "@/components/Fab";
import { JournalEditor } from "./JournalEditor";

type Section = "all" | "matches" | "lessons" | "practice";

/**
 * The Journal: one book, four sections. Match notes (born in matches),
 * lessons (coaching content, distilled), practice entries (the player's
 * own journal) — recent first, searched by one field that covers note
 * text, lesson content, tag labels, and match names. The tag rail is a
 * browse shortcut into the same tagged-points view as ever; "Working on"
 * pins the cues currently being fixed.
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
  const [section, setSection] = useState<Section>("all");
  const [query, setQuery] = useState("");
  const [tagStats, setTagStats] = useState<TagStat[]>([]);
  const [activeTag, setActiveTag] = useState<TagStat | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [lessons, setLessons] = useState<Lesson[]>([]);
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
    void supabase
      .from("lessons")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data }) => setLessons((data as Lesson[]) ?? []));
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

  // One search over everything: note bodies and authors, lesson text and
  // takeaways, match titles. Token-AND like the match library's search.
  const q = query.trim().toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);
  const hits = useCallback(
    (hay: string) => tokens.every((t) => hay.includes(t)),
    [tokens]
  );

  const noteMatches = useCallback(
    (n: NoteFeedRow) =>
      tokens.length === 0 ||
      hits(
        [n.body, n.author_name, titleFor(n), shortDate(n.played_at)]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
      ),
    [tokens.length, hits, titleFor]
  );
  const lessonMatches = useCallback(
    (l: Lesson) =>
      tokens.length === 0 ||
      hits(
        [
          l.transcript,
          l.takeaways?.title,
          ...(l.takeaways?.themes.flatMap((t) => [t.name, ...t.points]) ?? []),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
      ),
    [tokens.length, hits]
  );

  const filteredNotes = (rows ?? []).filter(noteMatches);
  const filteredLessons = lessons.filter(lessonMatches);
  const visibleTags = q
    ? tagStats.filter((s) => hits(s.label.toLowerCase()))
    : tagStats;

  // Section contents, recent first everywhere.
  const feedItems: (
    | { type: "note"; note: NoteFeedRow }
    | { type: "lesson"; lesson: Lesson }
  )[] = [
    ...(section === "all" || section === "matches"
      ? filteredNotes.map((n) => ({ type: "note" as const, note: n }))
      : []),
    ...(section === "all"
      ? filteredLessons.map((l) => ({ type: "lesson" as const, lesson: l }))
      : section === "lessons"
        ? filteredLessons
            .filter((l) => l.kind !== "practice")
            .map((l) => ({ type: "lesson" as const, lesson: l }))
        : section === "practice"
          ? filteredLessons
              .filter((l) => l.kind === "practice")
              .map((l) => ({ type: "lesson" as const, lesson: l }))
          : []),
  ].sort((a, b) => {
    const ca = a.type === "note" ? a.note.created_at : a.lesson.created_at;
    const cb = b.type === "note" ? b.note.created_at : b.lesson.created_at;
    return cb.localeCompare(ca);
  });

  // Matches section: the same notes grouped by match, groups ordered by
  // their latest note.
  const matchGroups = useMemo(() => {
    if (section !== "matches") return [];
    const byMatch = new Map<string, NoteFeedRow[]>();
    for (const n of filteredNotes) {
      const list = byMatch.get(n.match_id) ?? [];
      list.push(n);
      byMatch.set(n.match_id, list);
    }
    return [...byMatch.values()].sort((a, b) =>
      b[0].created_at.localeCompare(a[0].created_at)
    );
    // filteredNotes derives from rows + query — both stable per render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, rows, query]);

  const sectionTab = (value: Section, label: string) => (
    <button
      key={value}
      type="button"
      onClick={() => setSection(value)}
      aria-pressed={section === value}
      className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
        section === value
          ? "bg-surface-2 text-white"
          : "text-zinc-500 hover:text-zinc-300"
      }`}
    >
      {label}
    </button>
  );

  const noteCard = (n: NoteFeedRow, inGroup: boolean) => {
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
      <li key={n.id} className="rounded-2xl border border-edge bg-surface p-4">
        <Link
          href={`/match/${n.match_id}${n.point_id ? `?p=${n.point_id}` : ""}`}
          className="group flex items-center justify-between gap-3 pb-2.5"
        >
          <p className="truncate text-xs font-medium text-zinc-400 transition-colors group-hover:text-zinc-200">
            {inGroup ? (
              n.point_id ? "Point note" : "Match note"
            ) : (
              <>
                {titleFor(n)}
                <span className="text-zinc-600">
                  {" "}
                  · {n.point_id ? "Point note" : "Match note"}
                </span>
              </>
            )}
          </p>
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4 shrink-0 text-zinc-600 transition-colors group-hover:text-cyan-glow"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
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
  };

  const lessonItem = (l: Lesson) => (
    <LessonCard
      key={l.id}
      lesson={l}
      onUpdated={(u) =>
        setLessons((ls) => ls.map((x) => (x.id === u.id ? u : x)))
      }
      onDeleted={(id) => setLessons((ls) => ls.filter((x) => x.id !== id))}
    />
  );

  const empty = (rows?.length ?? 0) === 0 && lessons.length === 0;

  return (
    <div>
      <FabButton label="New" onClick={() => setComposeOpen(true)} />
      <JournalEditor
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        userId={userId}
        onSaved={(lesson) => setLessons((ls) => [lesson, ...ls])}
      />

      {/* One search across everything the journal holds. */}
      {!empty && rows !== null && (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search notes, lessons, tags"
          aria-label="Search the journal"
          autoComplete="off"
          className="mb-3 w-full rounded-xl border border-edge bg-surface-2/40 px-4 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-cyan-glow/60 focus:outline-none"
        />
      )}

      {/* Tag rail: browse shortcuts into the tagged-points view. */}
      {visibleTags.length > 0 && (
        <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
          {visibleTags.map((s) => {
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

      {!activeTag && <WorkingOn userId={userId} />}

      {!activeTag && !empty && rows !== null && (
        <div className="flex gap-1 border-b border-edge/60 pb-2">
          {sectionTab("all", "All")}
          {sectionTab("matches", "Matches")}
          {sectionTab("lessons", "Lessons")}
          {sectionTab("practice", "Practice")}
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
      ) : empty ? (
        <div className="rounded-2xl border border-edge bg-surface p-10 text-center">
          <p className="text-3xl">📓</p>
          <p className="mt-3 font-medium text-zinc-200">
            Your journal starts here
          </p>
          <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-zinc-500">
            Notes from your matches collect here on their own. Add a lesson
            or a practice entry with New — typed, spoken, or pasted.
          </p>
        </div>
      ) : section === "matches" ? (
        matchGroups.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">Nothing found.</p>
        ) : (
          <div className="mt-4 space-y-6">
            {matchGroups.map((group) => (
              <div key={group[0].match_id}>
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                  {titleFor(group[0])} · {shortDate(group[0].played_at)}
                </h3>
                <ul className="mt-2 space-y-2.5">
                  {group.map((n) => noteCard(n, true))}
                </ul>
              </div>
            ))}
          </div>
        )
      ) : feedItems.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">
          {section === "practice"
            ? "No practice entries yet. New starts one."
            : section === "lessons"
              ? "No lessons yet. New saves your first."
              : "Nothing found."}
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {feedItems.map((item) =>
            item.type === "lesson"
              ? lessonItem(item.lesson)
              : noteCard(item.note, false)
          )}
        </ul>
      )}
    </div>
  );
}
