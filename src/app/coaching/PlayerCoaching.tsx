"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { FabButton } from "@/components/Fab";
import { LessonCard } from "@/app/journal/LessonCard";
import { JournalEditor } from "@/app/journal/JournalEditor";
import { NoteEditor } from "@/app/journal/NoteEditor";
import { SharedEntryCard, type SharedEntry } from "@/app/journal/CoachShared";
import { useFocusPoints } from "@/app/journal/useFocusPoints";
import { journalTagsForOwner } from "@/lib/journal/tags";
import { NewLessonSheet } from "./NewLessonSheet";
import { sortCoaches, type PlayerCoach,
  coachStanding,
} from "@/lib/coaches/playerCoaches";
import { formatUsd } from "@/lib/reviews/money";
import { orderStatusLabel, type StudentOrderItem } from "@/lib/reviews/types";
import { deriveMatchTitleParts, shortDate } from "@/lib/matchTitle";
import type { EntryTag, Lesson, NoteFeedRow, Tag } from "@/lib/types";

/** One accepted or waiting grant, from player_coach_links(). */
interface CoachLinkRow {
  id: string;
  coach_id: string | null;
  scope_match_id: string | null;
  all_matches: boolean;
  status: string;
  created_at: string;
}

/** A lesson video the player owns, from GET /api/lesson-video. */
interface RecapRow {
  id: string;
  coach_ref_id: string | null;
  student_id: string | null;
  status: string;
  edit: { title?: string } | null;
  created_at: string;
  updated_at: string;
}

/** Everything in the feed, whichever direction it travelled. */
type Item =
  | { kind: "shared"; at: string; coachRef: string | null; entry: SharedEntry }
  | { kind: "note"; at: string; coachRef: string | null; note: NoteFeedRow }
  | { kind: "lesson"; at: string; coachRef: string | null; lesson: Lesson }
  | { kind: "recap"; at: string; coachRef: string | null; recap: RecapRow }
  | {
      kind: "match";
      at: string;
      coachRef: string | null;
      matchId: string;
      title: string;
      coachName: string;
    }
  | { kind: "order"; at: string; coachRef: null; order: StudentOrderItem };

/** The chip a row answers to. NO_COACH is its own bucket, not "everyone". */
const NO_COACH = "__none__";

const FEED_CAP = 30;

/**
 * The player's coaching workspace: everything between you and the people
 * who coach you, newest first, in one feed you can narrow to one of them.
 *
 * A feed rather than a list of coaches, because what a player comes here
 * for is "what happened", and only afterwards "who with" (Adil,
 * 2026-09-06). The chips are how you narrow it; the card that appears
 * when you do is the door to everything about that coach — what they can
 * see, what you have shared, and how to leave.
 *
 * The Journal keeps every one of these entries too. That is deliberate:
 * the Journal is the place you ask questions of, and it can only answer
 * "what did Jonathan tell me to work on" if the lesson is in it. This tab
 * is the same content read by coach instead of by date.
 */
export function PlayerCoaching({
  userId,
  coachNotes,
  studentOrders,
}: {
  userId: string;
  /** Notes a coach left on YOUR matches, from note_feed, filtered server
   *  side to your own matches written by somebody else. */
  coachNotes: NoteFeedRow[];
  studentOrders: StudentOrderItem[];
}) {
  const [coaches, setCoaches] = useState<PlayerCoach[]>([]);
  const [links, setLinks] = useState<CoachLinkRow[]>([]);
  const [shared, setShared] = useState<SharedEntry[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [recaps, setRecaps] = useState<RecapRow[]>([]);
  const [matchNames, setMatchNames] = useState<Map<string, string>>(new Map());
  const [vocab, setVocab] = useState<Tag[]>([]);
  const [entryTags, setEntryTags] = useState<EntryTag[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);
  const [chooserOpen, setChooserOpen] = useState(false);
  /* The bell's deep link scrolls to its entry ONCE. A ref callback runs
     again whenever the element is remounted, and re-scrolling under a
     reader who has started scrolling away is worse than not scrolling at
     all. */
  const scrolledToEntry = useRef(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [editing, setEditing] = useState<Lesson | null>(null);
  const [cap, setCap] = useState(FEED_CAP);

  const { addCue } = useFocusPoints(userId);

  /* The bell's "your coach shared a lesson note" lands here carrying the
     entry it was about. Without this it would land on a feed with the
     entry somewhere in it, which is making the reader find it twice. */
  const openEntryId = useSearchParams().get("entry");

  /** Find-or-create one of the player's own coaches by name (164). The
   *  same rule the Journal's composer uses: a name that already exists
   *  resolves to that row rather than starting a second one. */
  const createCoach = useCallback(
    async (name: string): Promise<PlayerCoach | null> => {
      const clean = name.trim().replace(/\s+/gu, " ").slice(0, 80);
      if (!clean) return null;
      const existing = coaches.find(
        (c) => c.display_name.trim().toLowerCase() === clean.toLowerCase()
      );
      if (existing) return existing;
      const supabase = createClient();
      const { data } = await supabase
        .from("player_coaches")
        .insert({ player_id: userId, display_name: clean })
        .select("id")
        .maybeSingle();
      const id = (data as { id: string } | null)?.id;
      if (!id) return null;
      const row: PlayerCoach = {
        id,
        coach_id: null,
        display_name: clean,
        coach_email: null,
        invite_id: null,
        status: "offline",
        entry_count: 0,
        shared_count: 0,
      };
      setCoaches((cs) => [row, ...cs]);
      return row;
    },
    [coaches, userId]
  );

  const loadCoaches = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.rpc("player_coaches_list");
    setCoaches((data as PlayerCoach[]) ?? []);
  }, []);

  useEffect(() => {
    void loadCoaches();
  }, [loadCoaches, composeOpen, editing]);

  useEffect(() => {
    let alive = true;
    const supabase = createClient();
    void (async () => {
      const [sharedRes, lessonRes, linkRes, tagRes, entryTagRes] =
        await Promise.all([
          supabase.rpc("coach_shared_entries"),
          supabase
            .from("lessons")
            .select("*")
            .eq("kind", "lesson")
            .order("created_at", { ascending: false }),
          supabase.rpc("player_coach_links"),
          supabase.from("tags").select("*").eq("owner_id", userId),
          supabase.from("entry_tags").select("*"),
        ]);
      if (!alive) return;
      setShared((sharedRes.data as SharedEntry[]) ?? []);
      setLessons((lessonRes.data as Lesson[]) ?? []);
      setLinks((linkRes.data as CoachLinkRow[]) ?? []);
      setVocab(journalTagsForOwner((tagRes.data as Tag[]) ?? [], userId));
      setEntryTags((entryTagRes.data as EntryTag[]) ?? []);
      setLoaded(true);

      // Match names for the "you shared this match" rows. Only the ones
      // actually named by a scoped grant, so this stays one small query.
      const scoped = ((linkRes.data as CoachLinkRow[]) ?? [])
        .map((l) => l.scope_match_id)
        .filter((id): id is string => !!id);
      if (scoped.length > 0) {
        const { data: ms } = await supabase
          .from("matches")
          .select(
            "id, user_id, opponent_name, venue, played_at, user_side, player_near_name, player_far_name"
          )
          .in("id", [...new Set(scoped)]);
        if (!alive) return;
        const names = new Map<string, string>();
        for (const m of (ms ?? []) as MatchTitleRow[]) {
          names.set(m.id, matchTitle(m));
        }
        setMatchNames(names);
      }
    })();
    return () => {
      alive = false;
    };
  }, [userId]);

  // Recaps come from the API, not from the table: the row a player may
  // read is scrubbed there, and the list already answers whether each one
  // is shared.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/lesson-video", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { videos?: RecapRow[] };
        if (alive) setRecaps(data.videos ?? []);
      } catch {
        // A recap missing from the feed is a smaller failure than a
        // coaching tab that will not render.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const byCoachId = useMemo(() => {
    const m = new Map<string, PlayerCoach>();
    for (const c of coaches) if (c.coach_id) m.set(c.coach_id, c);
    return m;
  }, [coaches]);

  const tagsByLesson = useMemo(() => {
    const byId = new Map(vocab.map((t) => [t.id, t]));
    const m = new Map<string, Tag[]>();
    for (const et of entryTags) {
      const tag = byId.get(et.tag_id);
      if (!tag) continue;
      const list = m.get(et.lesson_id) ?? [];
      list.push(tag);
      m.set(et.lesson_id, list);
    }
    return m;
  }, [entryTags, vocab]);

  const items: Item[] = useMemo(() => {
    const out: Item[] = [];
    for (const e of shared) {
      out.push({
        kind: "shared",
        at: e.shared_at,
        coachRef: byCoachId.get(e.coach_id)?.id ?? null,
        entry: e,
      });
    }
    for (const n of coachNotes) {
      out.push({
        kind: "note",
        at: n.created_at,
        coachRef: byCoachId.get(n.author_id)?.id ?? null,
        note: n,
      });
    }
    for (const l of lessons) {
      out.push({
        kind: "lesson",
        at: l.created_at,
        coachRef: l.coach_ref_id ?? NO_COACH,
        lesson: l,
      });
    }
    for (const r of recaps) {
      // A coach's own import belongs to their student's page, not here.
      if (r.student_id) continue;
      // The recap's own journal entry is already in `lessons`; showing
      // both would be the same lesson twice under two headings.
      if (lessons.some((l) => l.lesson_video_id === r.id)) continue;
      out.push({
        kind: "recap",
        // When the lesson happened, not when the recap was last touched.
        // Editing a recap should not move it to the top of a feed that
        // reads as a history. iOS sorts on the same field.
        at: r.created_at,
        coachRef: r.coach_ref_id ?? NO_COACH,
        recap: r,
      });
    }
    for (const l of links) {
      if (l.status !== "accepted" || !l.scope_match_id || !l.coach_id) continue;
      const coach = byCoachId.get(l.coach_id);
      out.push({
        kind: "match",
        at: l.created_at,
        coachRef: coach?.id ?? null,
        matchId: l.scope_match_id,
        title: matchNames.get(l.scope_match_id) ?? "A match",
        coachName: coach?.display_name ?? "your coach",
      });
    }
    for (const o of studentOrders) {
      out.push({ kind: "order", at: o.created_at, coachRef: null, order: o });
    }
    return out.sort((a, b) => b.at.localeCompare(a.at));
  }, [
    shared,
    coachNotes,
    lessons,
    recaps,
    links,
    studentOrders,
    byCoachId,
    matchNames,
  ]);

  const anyWithoutCoach = items.some((i) => i.coachRef === NO_COACH);
  const shown = filter ? items.filter((i) => i.coachRef === filter) : items;
  const selected = coaches.find((c) => c.id === filter) ?? null;

  const accessLine = useCallback(
    (coach: PlayerCoach): string => {
      if (!coach.coach_id) return "Not connected";
      const mine = links.filter(
        (l) => l.coach_id === coach.coach_id && l.status === "accepted"
      );
      if (mine.some((l) => l.all_matches && !l.scope_match_id)) {
        return "All matches";
      }
      const n = new Set(
        mine.map((l) => l.scope_match_id).filter(Boolean)
      ).size;
      if (n === 0) return "No matches shared";
      return `${n} ${n === 1 ? "match" : "matches"} shared`;
    },
    [links]
  );

  const chip = (value: string | null, label: string) => (
    <button
      key={value ?? "all"}
      type="button"
      onClick={() => {
        setFilter(value);
        setCap(FEED_CAP);
      }}
      aria-pressed={filter === value}
      className={`shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
        filter === value
          ? "border-cyan-glow/60 bg-cyan-glow/10 text-cyan-glow"
          : "border-edge text-zinc-400 hover:text-zinc-200"
      }`}
    >
      {label}
    </button>
  );

  const noCoaches = coaches.length === 0;

  return (
    <>
      {/* The chips sit directly under the title so both they and the coach
          card they reveal are above the fold on a 393px phone. */}
      {!noCoaches && (
        <div className="mt-5 flex gap-1.5 overflow-x-auto pb-1">
          {chip(null, "All")}
          {sortCoaches(coaches).map((c) => chip(c.id, c.display_name))}
          {anyWithoutCoach && chip(NO_COACH, "No coach")}
        </div>
      )}

      {selected && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-edge bg-surface p-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-zinc-100">
              {selected.display_name}
            </p>
            <p className="mt-0.5 text-xs text-zinc-500">
              {coachStanding(selected)}
              {/* Only a connected coach has match access to describe.
                  "Not on PongLens · Not connected" was one fact said
                  twice, and the second half read as a second problem. */}
              {selected.coach_id && (
                <span className="text-zinc-600"> · {accessLine(selected)}</span>
              )}
            </p>
          </div>
          <Link
            href={`/coaching/coach/${selected.id}`}
            className="shrink-0 rounded-full border border-edge px-3.5 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white"
          >
            Manage
          </Link>
        </div>
      )}

      {noCoaches && loaded && (
        <div className="mt-6 rounded-2xl border border-edge bg-surface p-6">
          <p className="text-sm text-zinc-300">No coaches yet.</p>
          <Link
            href="/coaching/coach"
            className="mt-4 inline-block rounded-full bg-cyan-glow px-4 py-2 text-sm font-semibold text-ink"
          >
            Add a coach
          </Link>
        </div>
      )}

      {!loaded ? (
        <div className="mt-6 space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-2xl border border-edge bg-surface"
            />
          ))}
        </div>
      ) : shown.length === 0 ? (
        // The "No coaches yet" card above already speaks for a player with
        // nothing at all; a second empty line under it says it twice. And
        // a chip nobody has pressed cannot be "this coach".
        noCoaches ? null : (
          <p className="mt-6 text-sm text-zinc-500">
            {filter === null
              ? "Nothing here yet."
              : "Nothing with this coach yet."}
          </p>
        )
      ) : (
        <>
          <ul className="mt-6 space-y-3">
            {shown.slice(0, cap).map((item) => (
              <FeedRow
                key={rowKey(item)}
                item={item}
                openEntryId={openEntryId}
                scrolledRef={scrolledToEntry}
                tagsByLesson={tagsByLesson}
                vocab={vocab}
                addCue={addCue}
                onLessonUpdated={(u) =>
                  setLessons((ls) => ls.map((x) => (x.id === u.id ? u : x)))
                }
                onLessonDeleted={(id) =>
                  setLessons((ls) => ls.filter((x) => x.id !== id))
                }
                onEdit={setEditing}
              />
            ))}
          </ul>
          {shown.length > cap && (
            <button
              type="button"
              onClick={() => setCap((c) => c + FEED_CAP)}
              className="mt-4 w-full rounded-xl border border-edge bg-surface/50 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:border-cyan-glow/40 hover:text-white"
            >
              Show {Math.min(shown.length - cap, FEED_CAP)} more
            </button>
          )}
        </>
      )}

      <FabButton label="New lesson" onClick={() => setChooserOpen(true)} />

      <NewLessonSheet
        open={chooserOpen}
        onClose={() => setChooserOpen(false)}
        onWrite={() => setComposeOpen(true)}
      />

      <JournalEditor
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        userId={userId}
        vocab={vocab}
        coaches={coaches}
        mode="lesson"
        createCoach={createCoach}
        createTag={async (label) => {
          const clean = label.trim().slice(0, 40);
          if (!clean) return null;
          const supabase = createClient();
          const { data } = await supabase
            .from("tags")
            .insert({ owner_id: userId, label: clean })
            .select("*")
            .maybeSingle();
          const tag = (data as Tag | null) ?? null;
          if (tag) setVocab((v) => [tag, ...v]);
          return tag;
        }}
        onSaved={(lesson, tags) => {
          setLessons((ls) => [lesson, ...ls]);
          if (tags.length > 0) {
            setEntryTags((ts) => [
              ...ts,
              ...tags.map((t) => ({
                lesson_id: lesson.id,
                tag_id: t.id,
                created_by: userId,
              })) as EntryTag[],
            ]);
          }
        }}
      />

      <NoteEditor
        lesson={editing}
        coaches={coaches}
        createCoach={createCoach}
        onClose={() => setEditing(null)}
        onSaved={(u) => {
          setLessons((ls) => ls.map((x) => (x.id === u.id ? u : x)));
          setEditing(null);
        }}
      />
    </>
  );
}


function rowKey(item: Item): string {
  switch (item.kind) {
    case "shared":
      return `shared-${item.entry.entry_id}`;
    case "note":
      return `note-${item.note.id}`;
    case "lesson":
      return `lesson-${item.lesson.id}`;
    case "recap":
      return `recap-${item.recap.id}`;
    case "match":
      // One match shared with two coaches is two rows, and React needs
      // them told apart or it renders one and drops the other.
      return `match-${item.matchId}-${item.coachRef ?? "none"}`;
    default:
      return `order-${item.order.id}`;
  }
}

function FeedRow({
  item,
  openEntryId,
  scrolledRef,
  tagsByLesson,
  vocab,
  addCue,
  onLessonUpdated,
  onLessonDeleted,
  onEdit,
}: {
  item: Item;
  /** The coach_entries row the bell was tapped on, if any. */
  openEntryId: string | null;
  /** Whether that entry has already been scrolled to, once, this visit. */
  scrolledRef: React.MutableRefObject<boolean>;
  tagsByLesson: Map<string, Tag[]>;
  vocab: Tag[];
  addCue: ReturnType<typeof useFocusPoints>["addCue"];
  onLessonUpdated: (lesson: Lesson) => void;
  onLessonDeleted: (id: string) => void;
  onEdit: (lesson: Lesson) => void;
}) {
  if (item.kind === "shared") {
    const asked = openEntryId === item.entry.entry_id;
    return (
      <li
        id={`coaching-entry-${item.entry.entry_id}`}
        ref={
          asked
            ? (el) => {
                if (!el || scrolledRef.current) return;
                scrolledRef.current = true;
                el.scrollIntoView({ behavior: "smooth", block: "center" });
              }
            : undefined
        }
        className="scroll-mt-24"
      >
        <SharedEntryCard entry={item.entry} defaultOpen={asked} />
      </li>
    );
  }

  if (item.kind === "lesson") {
    return (
      <LessonCard
        lesson={item.lesson}
        tags={tagsByLesson.get(item.lesson.id) ?? []}
        vocab={vocab}
        onToggleTag={() => {}}
        onCreateTag={() => {}}
        onAddCue={addCue}
        onUpdated={onLessonUpdated}
        onDeleted={onLessonDeleted}
        onEdit={onEdit}
      />
    );
  }

  if (item.kind === "note") {
    const n = item.note;
    return (
      <li className="rounded-2xl border border-edge bg-surface p-4">
        {/* A coach's remark and the rally it is about stay one tap apart:
            a point note opens that point, a match note opens the match. */}
        <Link
          href={`/match/${n.match_id}${n.point_id ? `?p=${n.point_id}` : ""}`}
          className="group block"
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-400">
            From {n.author_name ?? "your coach"}
          </p>
          <p className="mt-1 line-clamp-3 text-sm leading-relaxed text-zinc-200">
            {n.body}
          </p>
          <p className="mt-2 truncate text-xs text-zinc-500 transition-colors group-hover:text-zinc-300">
            {noteWhere(n)}
          </p>
        </Link>
      </li>
    );
  }

  if (item.kind === "recap") {
    return (
      <li className="rounded-2xl border border-edge bg-surface p-4">
        <Link href={`/lesson-video/${item.recap.id}`} className="group block">
          <p className="text-xs font-semibold uppercase tracking-wider text-cyan-glow">
            Lesson recap
          </p>
          <p className="mt-1 truncate text-sm font-medium text-zinc-100">
            {item.recap.edit?.title || "Your lesson"}
          </p>
          <p className="mt-1 text-xs text-zinc-500 transition-colors group-hover:text-zinc-300">
            {recapStanding(item.recap.status)}
          </p>
        </Link>
      </li>
    );
  }

  if (item.kind === "match") {
    return (
      <li className="rounded-2xl border border-edge bg-surface p-4">
        <Link href={`/match/${item.matchId}`} className="group block">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Shared with {item.coachName}
          </p>
          <p className="mt-1 truncate text-sm font-medium text-zinc-100 transition-colors group-hover:text-white">
            {item.title}
          </p>
        </Link>
      </li>
    );
  }

  const o = item.order;
  return (
    <li className="rounded-2xl border border-edge bg-surface p-4">
      <Link
        href={`/orders/${o.id}`}
        className="group flex items-center justify-between gap-3"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-zinc-200">
            {o.offering_title}
            <span className="text-zinc-500"> · {o.coach_name}</span>
          </span>
          <span className="mt-0.5 block text-xs text-zinc-500">
            {orderStatusLabel(o.status, "student")}
          </span>
        </span>
        <span className="shrink-0 text-sm tabular-nums text-zinc-400">
          {formatUsd(o.price_cents)}
        </span>
      </Link>
    </li>
  );
}

/** The shape both a note row and a match row can answer a title from. */
interface MatchTitleRow {
  id: string;
  opponent_name: string | null;
  venue: string | null;
  played_at: string;
  user_side: "near" | "far" | null;
  player_near_name: string | null;
  player_far_name: string | null;
}

/** The match's own name, the way the Journal derives it. */
function matchTitle(m: Omit<MatchTitleRow, "id">): string {
  const ownSide = (
    (m.user_side === "far" ? m.player_far_name : m.player_near_name) ?? ""
  ).trim();
  return deriveMatchTitleParts({
    opponentName: m.opponent_name,
    venue: m.venue,
    playedAt: m.played_at,
    neutral: ownSide !== "",
    nameA: ownSide,
    nameB: (m.opponent_name ?? "").trim(),
  }).primary;
}

function noteWhere(n: NoteFeedRow): string {
  return `${matchTitle(n)} · ${
    n.point_id ? "Point note" : "Match note"
  } · ${shortDate(n.played_at)}`;
}

function recapStanding(status: string): string {
  switch (status) {
    case "review":
      return "Ready to review";
    case "ready":
      return "Ready";
    case "failed":
      return "Needs attention";
    case "uploading":
      return "Uploading";
    default:
      return "Making the recap";
  }
}
