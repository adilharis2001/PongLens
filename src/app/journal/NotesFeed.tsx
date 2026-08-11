"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useFocusPoints } from "./useFocusPoints";
import {
  WorkingOn,
  type FocusPoint,
} from "./WorkingOn";
import { deriveMatchTitleParts, shortDate } from "@/lib/matchTitle";
import { NoteItem } from "@/app/match/[id]/Notes";
import { TagGlyph } from "@/app/match/[id]/Tags";
import { FabButton } from "@/components/Fab";
import { journalTagsForOwner } from "@/lib/journal/tags";
import { JournalEditor } from "./JournalEditor";
import { AskPanel, MAX_QUESTION_CHARS, askable } from "./AskPanel";
import { askExamples, topOpponentFromNotes } from "@/lib/ask/examples";
import { Recollect } from "./Recollect";
import type { RecollectSource } from "@/lib/recollect/types";

type Section = "all" | "matches" | "lessons" | "practice" | "recollect";

/**
 * Export a tag's points as ONE video across every match (042). Request →
 * the worker renders → Download. Re-opening the view re-checks: an
 * unchanged, already-rendered collection comes back 'ready' instantly.
 */
function TagReelExport({ tagId }: { tagId: string }) {
  const [state, setState] = useState<
    "idle" | "working" | "ready" | "failed"
  >("idle");
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    []
  );

  const request = useCallback(async () => {
    try {
      const res = await fetch("/api/tag-reel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagId }),
      });
      const data = res.ok ? await res.json() : null;
      if (!data?.status) throw new Error("no status");
      if (data.status === "ready") {
        setState("ready");
      } else {
        setState("working");
        timer.current = window.setTimeout(() => void request(), 6000);
      }
    } catch {
      setState("failed");
    }
  }, [tagId]);

  const download = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/media-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagReel: tagId }),
      });
      const data = res.ok ? await res.json() : null;
      if (!data?.url) throw new Error("no url");
      window.location.href = data.url;
    } catch {
      setState("failed");
    } finally {
      setBusy(false);
    }
  }, [tagId]);

  const cls =
    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors";
  if (state === "working") {
    return (
      <span className={`${cls} border-edge text-zinc-400`}>
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
        Rendering the video…
      </span>
    );
  }
  if (state === "ready") {
    return (
      <button
        type="button"
        onClick={() => void download()}
        disabled={busy}
        className={`${cls} border-cyan-glow/50 text-cyan-glow hover:bg-cyan-glow/10 disabled:opacity-60`}
      >
        <svg
          viewBox="0 0 24 24"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 4v11m0 0 4.5-4.5M12 15l-4.5-4.5M5 19h14"
          />
        </svg>
        {busy ? "Preparing…" : "Download video"}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        setState("working");
        void request();
      }}
      className={`${cls} border-edge text-zinc-400 hover:border-cyan-glow/40 hover:text-white`}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        aria-hidden="true"
      >
        <rect x="3" y="5" width="18" height="14" rx="2.5" />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="m10.2 9.4 4.6 2.6-4.6 2.6Z"
        />
      </svg>
      {state === "failed" ? "Failed — try again" : "Export as one video"}
    </button>
  );
}

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
  initialMatch = null,
  initialRecollectEnabled = true,
}: {
  userId: string;
  /** Viewer's account first name — feeds neutral-match title detection. */
  accountName: string | null;
  /** ?match= deep link: open pre-filtered to this match's notes. */
  initialMatch?: string | null;
  initialRecollectEnabled?: boolean;
}) {
  const [rows, setRows] = useState<NoteFeedRow[] | null>(null);
  const [section, setSection] = useState<Section>(
    initialMatch ? "matches" : "all"
  );
  const [matchFilter, setMatchFilter] = useState<string | null>(initialMatch);
  const [query, setQuery] = useState("");
  // The Ask panel hands its ask function up here so the search field's
  // Enter key and the Ask row both fire the same one. Stable identity, or
  // the registering effect re-runs on every keystroke.
  const askRef = useRef<(() => void) | null>(null);
  const registerAsk = useCallback((fn: () => void) => {
    askRef.current = fn;
  }, []);
  const [tagStats, setTagStats] = useState<TagStat[]>([]);
  const [activeTag, setActiveTag] = useState<RailTag | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  // The entry the capture sheet is editing; null means it composes new.
  const [editingLesson, setEditingLesson] = useState<Lesson | null>(null);
  const [cap, setCap] = useState(FEED_CAP);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  // point rows for the active tag; null while loading
  const [taggedRows, setTaggedRows] = useState<TaggedPointRow[] | null>(null);
  // Entry tagging: the owner's whole vocabulary plus entry_tags rows.
  // Same tags as points — the vocabulary is one list (RLS scopes both).
  const [vocab, setVocab] = useState<Tag[]>([]);
  const [entryTags, setEntryTags] = useState<EntryTag[]>([]);
  // Working on cues (active + retired). The hook owns loading and every
  // server-confirmed write; it lives here so lesson takeaways and
  // Recollect file cues into the same list the pinned card renders.
  const {
    cues,
    loaded: cuesLoaded,
    addCue,
    retireCue,
    restoreCue,
    mergeCue,
  } = useFocusPoints(userId);
  const [recollectEnabled] = useState(initialRecollectEnabled);

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
      .eq("owner_id", userId)
      .then(({ data }) =>
        setVocab(journalTagsForOwner((data as Tag[]) ?? [], userId))
      );
    void supabase
      .from("entry_tags")
      .select("*")
      .then(({ data }) => setEntryTags((data as EntryTag[]) ?? []));
  }, [userId]);

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
          l.coach_name,
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

  // Own matches only — note_feed also carries students' matches for a
  // coach, and a name from those would name someone Ask cannot see.
  const topOpponent = useMemo(
    () => topOpponentFromNotes(rows, userId),
    [rows, userId]
  );

  // Coaches already named in this journal, most recently taught first, so
  // the editor can offer them and the spelling stays one spelling.
  const coachNames = useMemo(() => {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const l of lessons) {
      const name = l.coach_name?.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      names.push(name);
    }
    return names;
  }, [lessons]);

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
      if (matchFilter && n.match_id !== matchFilter) continue;
      const list = byMatch.get(n.match_id) ?? [];
      list.push(n);
      byMatch.set(n.match_id, list);
    }
    return [...byMatch.values()].sort((a, b) =>
      b[0].created_at.localeCompare(a[0].created_at)
    );
    // filteredNotes derives from rows + query — both stable per render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, rows, query, matchFilter]);

  const clearMatchFilter = useCallback(() => {
    setMatchFilter(null);
    window.history.replaceState(null, "", "/journal");
  }, []);

  const matchFilterTitle = useMemo(() => {
    if (!matchFilter) return null;
    const n = (rows ?? []).find((r) => r.match_id === matchFilter);
    return n ? titleFor(n) : "This match";
  }, [matchFilter, rows, titleFor]);

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
      onClick={() => {
        setSection(value);
        if (matchFilter) clearMatchFilter();
      }}
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
      image_path: n.image_path,
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
      onAddCue={addCue}
      onUpdated={(u) =>
        setLessons((ls) => ls.map((x) => (x.id === u.id ? u : x)))
      }
      onDeleted={(id) => setLessons((ls) => ls.filter((x) => x.id !== id))}
      onEdit={(lesson) => {
        setEditingLesson(lesson);
        setComposeOpen(true);
      }}
    />
  );

  const openRecollectSource = useCallback((source: RecollectSource) => {
    setActiveTag(null);
    setQuery("");
    setMatchFilter(null);
    setSection(source.kind === "practice" ? "practice" : "lessons");
    window.history.replaceState(null, "", "/journal");
    window.setTimeout(() => {
      document
        .getElementById(`journal-entry-${source.lessonId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
  }, []);

  const acceptRecollectFocus = mergeCue;

  const empty = (rows?.length ?? 0) === 0 && lessons.length === 0;

  return (
    <div>
      {/* Every section of the journal is the same page with a different
          list in it, Recollect included, so the chrome around the list does
          not come and go with the tab. */}
      <FabButton label="New" onClick={() => setComposeOpen(true)} />
      <JournalEditor
        open={composeOpen}
        onClose={() => {
          setComposeOpen(false);
          // Cleared on close so the next New starts blank, not on the
          // last thing edited.
          setEditingLesson(null);
        }}
        userId={userId}
        vocab={sortedVocab}
        coachNames={coachNames}
        editing={editingLesson}
        createTag={createTag}
        onSaved={(lesson, tags) => {
          // One rule for both modes: a known id is replaced in place, a
          // new one joins at the top.
          setLessons((ls) =>
            ls.some((x) => x.id === lesson.id)
              ? ls.map((x) => (x.id === lesson.id ? lesson : x))
              : [lesson, ...ls]
          );
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

      {/* One search across everything the journal holds — and the same
          words, on request, as a question. Typing only ever filters; the
          Ask row below is the deliberate second step. */}
      {!empty && rows !== null && (
        <>
          {/* The sparkle is the whole signal that this box does more than
              filter. Without it the placeholder is doing all the work and
              reads as ordinary search, which is exactly how the feature
              went unnoticed. Inside the field, not beside it, so it reads
              as a property of the box rather than a button. */}
          <div className="relative mb-3">
            <span
              aria-hidden
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4 text-cyan-glow"
                fill="currentColor"
              >
                <path d="M12 2.5 13.7 9l6.3 1.7-6.3 1.7L12 19l-1.7-6.6L4 10.7 10.3 9 12 2.5Z" />
                <path
                  d="M18.5 3 19.2 5.3 21.5 6l-2.3.7-.7 2.3-.7-2.3L15.5 6l2.3-.7L18.5 3Z"
                  opacity="0.6"
                />
              </svg>
            </span>
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              // Search reads entries, which Recollect does not list. Rather
              // than sit there inert on that section, the first keystroke
              // moves to the one that can answer.
              if (e.target.value && section === "recollect") setSection("all");
            }}
            onKeyDown={(e) => {
              // Enter is the keyboard version of tapping the Ask row. The
              // row itself is still there; this just saves the reach.
              if (e.key === "Enter" && askable(query)) {
                e.preventDefault();
                askRef.current?.();
              }
            }}
            placeholder="Search or ask your journal"
            aria-label="Search or ask your journal"
            autoComplete="off"
            maxLength={MAX_QUESTION_CHARS}
            className="w-full rounded-xl border border-edge bg-surface-2/40 py-2.5 pl-10 pr-4 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-cyan-glow/60 focus:outline-none"
          />
          </div>
          <AskPanel
            query={query}
            examples={askExamples({
              coachName: coachNames[0] ?? null,
              opponentName: topOpponent,
            })}
            onReady={registerAsk}
          />
        </>
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
                aria-label={on ? `Clear the ${s.label} filter` : undefined}
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
                {/* Selected, the count moves into the sentence below, so the
                    chip shows the way back out instead. Tapping a lit chip
                    always cleared the filter; nothing said so. */}
                {on ? (
                  <svg
                    viewBox="0 0 24 24"
                    className="h-3.5 w-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
                  </svg>
                ) : (
                  <span className="tabular-nums text-zinc-500">
                    {s.point_count + s.entry_count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Working On stays put across every section, Recollect included:
          adding a revealed cue there is the one place the list changes
          without the player typing it, so it has to be on screen to see it
          land. The search, tag rail, and New button are still section-
          specific — they act on entries, which Recollect does not list. */}
      {!activeTag && (
        <WorkingOn
          cues={cues}
          loaded={cuesLoaded}
          onAdd={addCue}
          onRetire={retireCue}
          onRestore={restoreCue}
        />
      )}

      {!activeTag &&
        rows !== null &&
        (!empty || recollectEnabled) && (
        <div className="flex gap-1 overflow-x-auto border-b border-edge/60 pb-2">
          {sectionTab("all", "All")}
          {sectionTab("matches", "Matches")}
          {sectionTab("lessons", "Lessons")}
          {sectionTab("practice", "Practice")}
          {recollectEnabled && sectionTab("recollect", "Recollect")}
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
          {activeTag.point_count > 0 && (
            <div className="mt-2.5">
              <TagReelExport
                key={activeTag.tag_id}
                tagId={activeTag.tag_id}
              />
            </div>
          )}
          {taggedEntries.length > 0 && (
            <>
              {activeTag.point_count > 0 && (
                <h3 className="mt-4 text-xs font-semibold uppercase tracking-wider text-zinc-500">
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
                  <h3 className="mt-5 text-xs font-semibold uppercase tracking-wider text-zinc-500">
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
                              image_path: n.image_path,
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
      ) : section === "recollect" ? (
        <Recollect
          onOpenSource={openRecollectSource}
          onFocusPointAdded={acceptRecollectFocus}
        />
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
            or a practice entry with New. Type it, speak it, or paste it.
          </p>
        </div>
      ) : section === "matches" ? (
        <>
          {matchFilter && (
            <div className="mt-3">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-glow/40 bg-cyan-glow/10 py-1 pl-3 pr-1.5 text-xs font-medium text-cyan-glow">
                {matchFilterTitle}
                <button
                  type="button"
                  onClick={clearMatchFilter}
                  aria-label="Show every match"
                  className="rounded-full p-0.5 transition-colors hover:bg-cyan-glow/20"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-3.5 w-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </span>
            </div>
          )}
          {matchGroups.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-500">
              {matchFilter ? (
                <>
                  No notes on this match yet.{" "}
                  <Link
                    href={`/match/${matchFilter}`}
                    className="font-medium text-zinc-300 underline decoration-edge underline-offset-4 transition-colors hover:text-white"
                  >
                    Open the match
                  </Link>{" "}
                  to add one.
                </>
              ) : (
                "Nothing found."
              )}
            </p>
          ) : (
            <div className="mt-4 space-y-6">
              {matchGroups.map((group) => (
                <div key={group[0].match_id}>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    {titleFor(group[0])} · {shortDate(group[0].played_at)}
                  </h3>
                  <ul className="mt-2 space-y-2.5">
                    {group.map((n) => noteCard(n, true))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </>
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
