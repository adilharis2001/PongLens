"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type {
  EntryTag,
  Lesson,
  Note,
  NoteFeedRow,
  Tag,
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

/** One chip on the tag rail: point reach (tag_stats) + entry reach. */
interface RailTag {
  tag_id: string;
  label: string;
  point_count: number;
  match_count: number;
  entry_count: number;
}

/** Feed items rendered before "Show more" — hundreds of notes stay light
 *  on old devices. */
const FEED_CAP = 30;

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
  const [activeTag, setActiveTag] = useState<RailTag | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [cap, setCap] = useState(FEED_CAP);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  // point rows for the active tag; null while loading
  const [taggedRows, setTaggedRows] = useState<TaggedPointRow[] | null>(null);
  // Entry tagging: the owner's whole vocabulary plus entry_tags rows.
  // Same tags as points — the vocabulary is one list (RLS scopes both).
  const [vocab, setVocab] = useState<Tag[]>([]);
  const [entryTags, setEntryTags] = useState<EntryTag[]>([]);

  useEffect(() => {
    const supabase = createClient();
    void supabase
      .rpc("note_feed", { p_limit: 500 })
      .then(({ data }) => setRows((data as NoteFeedRow[]) ?? []));
    void supabase.rpc("tag_stats").then(({ data }) => {
      setTagStats((data as TagStat[]) ?? []);
    });
    void supabase
      .from("lessons")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data }) => setLessons((data as Lesson[]) ?? []));
    void supabase
      .from("tags")
      .select("*")
      .then(({ data }) => setVocab((data as Tag[]) ?? []));
    void supabase
      .from("entry_tags")
      .select("*")
      .then(({ data }) => setEntryTags((data as EntryTag[]) ?? []));
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

  /* ---------------------------------------------------- entry tagging */

  const tagById = useMemo(() => new Map(vocab.map((t) => [t.id, t])), [vocab]);

  const tagsByLesson = useMemo(() => {
    const map = new Map<string, Tag[]>();
    for (const et of entryTags) {
      const tag = tagById.get(et.tag_id);
      if (!tag) continue;
      const list = map.get(et.lesson_id) ?? [];
      list.push(tag);
      map.set(et.lesson_id, list);
    }
    return map;
  }, [entryTags, tagById]);

  const entryCountByTag = useMemo(() => {
    const map = new Map<string, number>();
    for (const et of entryTags) {
      map.set(et.tag_id, (map.get(et.tag_id) ?? 0) + 1);
    }
    return map;
  }, [entryTags]);

  // Recently-used-first, like the match page picker; recency here means
  // "last put on an entry".
  const sortedVocab = useMemo(() => {
    const lastUsed = new Map<string, string>();
    for (const et of entryTags) {
      const cur = lastUsed.get(et.tag_id);
      if (!cur || et.created_at > cur) lastUsed.set(et.tag_id, et.created_at);
    }
    return [...vocab].sort((a, b) => {
      const ua = lastUsed.get(a.id) ?? "";
      const ub = lastUsed.get(b.id) ?? "";
      if (ua !== ub) return ub.localeCompare(ua);
      return b.created_at.localeCompare(a.created_at);
    });
  }, [vocab, entryTags]);

  const toggleEntryTag = useCallback(
    async (lessonId: string, tag: Tag) => {
      const has = entryTags.some(
        (et) => et.lesson_id === lessonId && et.tag_id === tag.id
      );
      const supabase = createClient();
      if (has) {
        setEntryTags((ets) =>
          ets.filter(
            (et) => !(et.lesson_id === lessonId && et.tag_id === tag.id)
          )
        );
        const { error } = await supabase
          .from("entry_tags")
          .delete()
          .eq("lesson_id", lessonId)
          .eq("tag_id", tag.id);
        if (error) {
          setEntryTags((ets) => [
            ...ets,
            {
              lesson_id: lessonId,
              tag_id: tag.id,
              created_by: userId,
              created_at: new Date().toISOString(),
            },
          ]);
        }
      } else {
        setEntryTags((ets) => [
          ...ets,
          {
            lesson_id: lessonId,
            tag_id: tag.id,
            created_by: userId,
            created_at: new Date().toISOString(),
          },
        ]);
        const { error } = await supabase
          .from("entry_tags")
          .insert({ lesson_id: lessonId, tag_id: tag.id, created_by: userId });
        if (error) {
          setEntryTags((ets) =>
            ets.filter(
              (et) => !(et.lesson_id === lessonId && et.tag_id === tag.id)
            )
          );
        }
      }
    },
    [entryTags, userId]
  );

  // Find-or-create in the shared vocabulary (same 23505 recovery as the
  // match page: a concurrent create resolves to the existing row).
  const createTag = useCallback(
    async (label: string): Promise<Tag | null> => {
      const clean = label.trim().slice(0, 40);
      if (!clean) return null;
      const existing = vocab.find(
        (t) => t.label.toLowerCase() === clean.toLowerCase()
      );
      if (existing) return existing;
      const supabase = createClient();
      const { data } = await supabase
        .from("tags")
        .insert({ owner_id: userId, label: clean })
        .select()
        .maybeSingle();
      let tag = data as Tag | null;
      if (!tag) {
        const { data: again } = await supabase
          .from("tags")
          .select("*")
          .eq("owner_id", userId)
          .ilike("label", clean.replace(/[%_\\]/g, (m) => `\\${m}`))
          .maybeSingle();
        tag = again as Tag | null;
      }
      if (tag) {
        const t = tag;
        setVocab((v) => (v.some((x) => x.id === t.id) ? v : [t, ...v]));
      }
      return tag;
    },
    [vocab, userId]
  );

  const createEntryTag = useCallback(
    async (lessonId: string, label: string) => {
      const tag = await createTag(label);
      if (tag) void toggleEntryTag(lessonId, tag);
    },
    [createTag, toggleEntryTag]
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
          ...(tagsByLesson.get(l.id)?.map((t) => t.label) ?? []),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
      ),
    [tokens.length, hits, tagsByLesson]
  );

  const filteredNotes = (rows ?? []).filter(noteMatches);
  const filteredLessons = lessons.filter(lessonMatches);

  // The rail: every tag with any reach — points (tag_stats) or entries.
  const railTags = useMemo(() => {
    const statByTag = new Map(tagStats.map((s) => [s.tag_id, s]));
    return vocab
      .map((t) => {
        const s = statByTag.get(t.id);
        return {
          tag_id: t.id,
          label: t.label,
          point_count: Number(s?.point_count ?? 0),
          match_count: Number(s?.match_count ?? 0),
          entry_count: entryCountByTag.get(t.id) ?? 0,
        };
      })
      .filter((t) => t.point_count > 0 || t.entry_count > 0)
      .sort(
        (a, b) =>
          b.point_count + b.entry_count - (a.point_count + a.entry_count)
      );
  }, [vocab, tagStats, entryCountByTag]);
  const visibleTags = q
    ? railTags.filter((s) => hits(s.label.toLowerCase()))
    : railTags;

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

  // Written entries carrying the active tag — shown next to its points.
  const taggedEntries = useMemo(
    () =>
      activeTag
        ? lessons.filter((l) =>
            (tagsByLesson.get(l.id) ?? []).some(
              (t) => t.id === activeTag.tag_id
            )
          )
        : [],
    [activeTag, lessons, tagsByLesson]
  );

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
      tags={tagsByLesson.get(l.id) ?? []}
      vocab={sortedVocab}
      onToggleTag={(t) => void toggleEntryTag(l.id, t)}
      onCreateTag={(label) => void createEntryTag(l.id, label)}
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
        vocab={sortedVocab}
        createTag={createTag}
        onSaved={(lesson, tags) => {
          setLessons((ls) => [lesson, ...ls]);
          if (tags.length > 0) {
            const now = new Date().toISOString();
            setEntryTags((ets) => [
              ...ets,
              ...tags.map((t) => ({
                lesson_id: lesson.id,
                tag_id: t.id,
                created_by: userId,
                created_at: now,
              })),
            ]);
          }
        }}
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
                title={[
                  s.point_count > 0
                    ? `${s.point_count} point${
                        s.point_count === 1 ? "" : "s"
                      } across ${s.match_count} match${
                        s.match_count === 1 ? "" : "es"
                      }`
                    : null,
                  s.entry_count > 0
                    ? `${s.entry_count} ${
                        s.entry_count === 1 ? "entry" : "entries"
                      }`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
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
                  {s.point_count + s.entry_count}
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
        <>
          <p className="text-sm text-zinc-500">
            {[
              activeTag.point_count > 0
                ? `${activeTag.point_count} point${
                    activeTag.point_count === 1 ? "" : "s"
                  } across ${activeTag.match_count} match${
                    activeTag.match_count === 1 ? "" : "es"
                  }`
                : null,
              activeTag.entry_count > 0
                ? `${activeTag.entry_count} ${
                    activeTag.entry_count === 1 ? "entry" : "entries"
                  }`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}{" "}
            tagged &ldquo;{activeTag.label}&rdquo;.
          </p>
          {taggedEntries.length > 0 && (
            <>
              {activeTag.point_count > 0 && (
                <h3 className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                  Entries
                </h3>
              )}
              <ul className="mt-3 space-y-3">
                {taggedEntries.map((l) => lessonItem(l))}
              </ul>
            </>
          )}
          {activeTag.point_count > 0 &&
            (taggedRows === null ? (
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
                {taggedEntries.length > 0 && (
                  <h3 className="mt-5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    Points
                  </h3>
                )}
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
            ))}
        </>
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
        <>
          <ul className="mt-4 space-y-3">
            {feedItems.slice(0, cap).map((item) =>
              item.type === "lesson"
                ? lessonItem(item.lesson)
                : noteCard(item.note, false)
            )}
          </ul>
          {feedItems.length > cap && (
            <button
              type="button"
              onClick={() => setCap((c) => c + FEED_CAP)}
              className="mt-4 w-full rounded-xl border border-edge bg-surface/50 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:border-cyan-glow/40 hover:text-white"
            >
              Show {Math.min(feedItems.length - cap, FEED_CAP)} more
            </button>
          )}
        </>
      )}
    </div>
  );
}
