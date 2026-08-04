"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Job, SharedPlayer } from "@/lib/types";
import { deriveMatchTitle, deriveMatchTitleParts } from "@/lib/matchTitle";
import { ShareSheet } from "@/components/ShareSheet";
import { CoachCta } from "@/components/reviews/CoachCta";
import { chipTargetIds } from "./chipTargets";
import {
  Chip,
  Thumb,
  fetchPaged,
  fetchPointsPaged,
  formatBytes,
  formatDate,
  matchChips,
  monthLabel,
  neutralTitleFields,
  queuedChip,
  timeAgo,
  useScoreChips,
  useThumbs,
  type MatchRow,
  type PointLite,
} from "@/app/dashboard/shared";

// Same cadence as Home. Upgrade path: Supabase Realtime.
const POLL_MS = 10_000;

type StatusFilter = "all" | "ready" | "processing" | "failed";
type TypeFilter =
  | "all"
  | "drills"
  | "practice"
  | "match"
  | "league"
  | "tournament";
type ScoreFilter = "all" | "scored" | "unscored";
type SortKey = "uploaded" | "played";

/** Cards rendered before "Show more" — keeps hundreds of uploads light
 *  on old devices (thumbs are only signed for rendered cards). */
const RENDER_CAP = 24;

/** Footage types that never nag for a score. */
const UNSCORED_OK = new Set(["drills", "practice"]);

function NoteBadge({
  count,
  coach,
  onOpen,
}: {
  count: number;
  /** Someone other than the owner (a coach) wrote at least one note. */
  coach?: boolean;
  /** Opens the Journal pre-filtered to this match. */
  onOpen?: () => void;
}) {
  if (count === 0) return null;
  const cls = `inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-medium ${
    coach ? "text-amber-300/90" : "text-zinc-400"
  }`;
  if (onOpen) {
    return (
      <button
        type="button"
        title={`${coach ? "Coach notes — " : ""}open in Journal`}
        aria-label="Open this match's notes in the Journal"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onOpen();
        }}
        className={`${cls} transition-colors hover:text-white`}
      >
        <NoteGlyph />
        {count}
        {coach && <span className="hidden font-semibold sm:inline">coach</span>}
      </button>
    );
  }
  return (
    <span className={cls}>
      <NoteGlyph />
      {count}
      {coach && <span className="hidden font-semibold sm:inline">coach</span>}
    </span>
  );
}

function NoteGlyph() {
  return (
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
        d="M21 12a8.96 8.96 0 0 1-9 9 9.36 9.36 0 0 1-4.2-1L3 21l1-4.8A8.96 8.96 0 0 1 3 12a9 9 0 1 1 18 0Z"
      />
    </svg>
  );
}

/**
 * The match library: every match as a thumbnail card, searchable and
 * filterable. Own matches first, then matches players shared via accepted
 * coach links ("Shared with me"). Management (download / delete) lives
 * here on each card's overflow menu; Home only previews this list.
 */
export function MatchLibrary({
  userId,
  accountName,
}: {
  userId: string;
  /** Viewer's account first name — feeds neutral-match title detection. */
  accountName: string | null;
}) {
  const [matches, setMatches] = useState<MatchRow[] | null>(null);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [sharedPlayers, setSharedPlayers] = useState<SharedPlayer[]>([]);
  // Points are fetched per visible card (see chipTargets), so they're held
  // by match id: "Show more" merges the new page in rather than replacing
  // the set, which would blank the chips already on screen mid-flight.
  const [pointsByMatch, setPointsByMatch] = useState<Map<string, PointLite[]>>(
    new Map()
  );
  /** Bumped by the poll so the scoped point fetch refreshes with everything
   *  else, without coupling it to fetchAll's identity. */
  const [tick, setTick] = useState(0);
  const [noteCounts, setNoteCounts] = useState<Map<string, number>>(new Map());
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [scoreFilter, setScoreFilter] = useState<ScoreFilter>("all");
  const [sort, setSort] = useState<SortKey>("uploaded");
  const [cap, setCap] = useState(RENDER_CAP);
  const router = useRouter();
  const [shareFor, setShareFor] = useState<MatchRow | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [coachNoted, setCoachNoted] = useState<Set<string>>(new Set());
  const [exportReady, setExportReady] = useState<Set<string>>(new Set());
  const [confirmMatch, setConfirmMatch] = useState<MatchRow | null>(null);
  const [confirmBytes, setConfirmBytes] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    const supabase = createClient();
    // RLS returns own matches plus matches shared by players who accepted
    // this user as a coach; coach_players() supplies their display names.
    // Notes come back id-less (match_id only) purely for the per-card count.
    // Point rows are NOT here: they're the one payload that grows with the
    // library, so they load per visible card in their own effect below.
    const [matchRes, jobRes, playersRes, noteRows, reelRes] =
      await Promise.all([
        supabase
          .from("matches")
          .select("*, points(count)")
          .order("created_at", { ascending: false }),
        // Active jobs only. Everything this page does with a job — the
        // progress % on a processing card, the queued cards, the poll
        // cadence — reads queued/processing and nothing else, so fetching
        // the account's whole job history was both wasted and, past 1000
        // rows, silently truncated.
        supabase
          .from("jobs")
          .select("*")
          .in("status", ["queued", "processing"])
          .order("created_at", { ascending: false }),
        supabase.rpc("coach_players"),
        // Paged: one row per note across the whole account, so a busy
        // journal would otherwise start under-counting the card badges.
        fetchPaged<{ match_id: string; author_id: string }>(
          (from, to) =>
            supabase
              .from("notes")
              .select("match_id, author_id")
              .order("id")
              .range(from, to),
          "notes"
        ),
        supabase.from("match_reels").select("match_id, status"),
      ]);
    if (matchRes.data) setMatches(matchRes.data as MatchRow[]);
    if (jobRes.data) setJobs(jobRes.data as Job[]);
    if (playersRes.data) setSharedPlayers(playersRes.data as SharedPlayer[]);
    {
      const counts = new Map<string, number>();
      const owners = new Map(
        ((matchRes.data ?? []) as MatchRow[]).map((m) => [m.id, m.user_id])
      );
      const coach = new Set<string>();
      for (const n of noteRows) {
        counts.set(n.match_id, (counts.get(n.match_id) ?? 0) + 1);
        // A note by someone who isn't the match owner is a coach's.
        if (n.author_id !== owners.get(n.match_id)) coach.add(n.match_id);
      }
      setNoteCounts(counts);
      setCoachNoted(coach);
    }
    if (reelRes.data) {
      setExportReady(
        new Set(
          (reelRes.data as { match_id: string; status: string }[])
            .filter((r) => r.status === "ready")
            .map((r) => r.match_id)
        )
      );
    }
  }, []);

  const hasActiveWork =
    (matches ?? []).some((m) => m.status === "processing") ||
    (jobs ?? []).some(
      (j) => j.status === "queued" || j.status === "processing"
    );

  useEffect(() => {
    void fetchAll();
    // Fast poll only while something is processing; old devices shouldn't
    // re-render a big library every 10s for nothing.
    const id = setInterval(() => {
      void fetchAll();
      setTick((t) => t + 1);
    }, hasActiveWork ? POLL_MS : POLL_MS * 3);
    return () => clearInterval(id);
  }, [fetchAll, hasActiveWork]);

  const loading = matches === null || jobs === null;
  const ownMatches = (matches ?? []).filter((m) => m.user_id === userId);
  const sharedMatches = (matches ?? []).filter((m) => m.user_id !== userId);
  const playerName = new Map(
    sharedPlayers.map((p) => [p.player_id, p.player_name])
  );
  const sharedByPlayer = new Map<string, MatchRow[]>();
  for (const m of sharedMatches) {
    const list = sharedByPlayer.get(m.user_id) ?? [];
    list.push(m);
    sharedByPlayer.set(m.user_id, list);
  }
  const jobById = new Map((jobs ?? []).map((j) => [j.id, j]));
  const pointsLite = useMemo(
    () => [...pointsByMatch.values()].flat(),
    [pointsByMatch]
  );
  const scoreChipByMatch = useScoreChips(pointsLite);


  // Jobs that asked for points but whose match row doesn't exist yet show
  // as processing cards at the top of the library.
  const matchJobIds = new Set(ownMatches.map((m) => m.job_id));
  const pendingPointJobs = (jobs ?? []).filter(
    (j) =>
      j.options?.points === true &&
      !matchJobIds.has(j.id) &&
      (j.status === "queued" || j.status === "processing")
  );

  // Token-AND search over everything visible on a card — names, venue,
  // type, and the formatted date — so "Westchester", "league", and
  // "Vaibhav July" each narrow.
  const q = query.trim().toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);
  const matchesQuery = useCallback(
    (m: MatchRow) => {
      if (tokens.length === 0) return true;
      const hay = [
        m.opponent_name,
        m.player_near_name,
        m.player_far_name,
        m.venue,
        m.match_type,
        m.status,
        scoreChipByMatch.get(m.id)?.complete ? "scored" : "unscored",
        deriveMatchTitle({
          opponentName: m.opponent_name,
          venue: m.venue,
          playedAt: m.played_at,
        }),
        monthLabel(m.played_at),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return tokens.every((t) => hay.includes(t));
    },
     
    [tokens, scoreChipByMatch]
  );

  // Everything EXCEPT the score filter. Split out because the scoped point
  // fetch below needs a target set that doesn't depend on the chips that
  // fetch produces — see chipTargets.ts for why that would deadlock.
  const applyBaseFilters = useCallback(
    (list: MatchRow[]) =>
      list
        .filter(
          (m) =>
            matchesQuery(m) &&
            (statusFilter === "all" || m.status === statusFilter) &&
            (typeFilter === "all" || m.match_type === typeFilter)
        )
        .sort((a, b) =>
          sort === "played"
            ? b.played_at.localeCompare(a.played_at)
            : b.created_at.localeCompare(a.created_at)
        ),
    [matchesQuery, statusFilter, typeFilter, sort]
  );

  const applyScoreFilter = useCallback(
    (list: MatchRow[]) =>
      scoreFilter === "all"
        ? list
        : list.filter((m) =>
            scoreFilter === "scored"
              ? scoreChipByMatch.get(m.id)?.complete === true
              : m.status === "ready" &&
                scoreChipByMatch.get(m.id)?.complete !== true
          ),
    [scoreFilter, scoreChipByMatch]
  );

  const baseOwn = applyBaseFilters(ownMatches);
  const filteredOwnAll = applyScoreFilter(baseOwn);
  const filteredOwn = filteredOwnAll.slice(0, cap);
  const hiddenCount = filteredOwnAll.length - filteredOwn.length;

  // Month timeline: with a real library (a season's worth), the grid gains
  // month headers plus a jump rail — nobody scrolls 100 uploads blind.
  // Months follow the active sort's date (uploaded vs played).
  const monthed = filteredOwnAll.length >= 13;
  const dateOf = (m: MatchRow) =>
    sort === "played" ? m.played_at : m.created_at;
  const monthSections: { month: string; items: MatchRow[] }[] = [];
  if (monthed) {
    for (const m of filteredOwn) {
      const month = monthLabel(dateOf(m));
      const last = monthSections[monthSections.length - 1];
      if (last && last.month === month) last.items.push(m);
      else monthSections.push({ month, items: [m] });
    }
  }
  const monthRail: { month: string; short: string; count: number; end: number }[] =
    [];
  if (monthed) {
    for (let i = 0; i < filteredOwnAll.length; i++) {
      const iso = dateOf(filteredOwnAll[i]);
      const month = monthLabel(iso);
      const last = monthRail[monthRail.length - 1];
      if (last && last.month === month) {
        last.count += 1;
        last.end = i;
      } else {
        monthRail.push({
          month,
          short: new Date(iso).toLocaleDateString("en-US", {
            month: "short",
            year: "2-digit",
          }),
          count: 1,
          end: i,
        });
      }
    }
  }
  const monthAnchor = (month: string) => `month-${month.replace(/\s+/g, "-")}`;
  const jumpToMonth = (month: string, end: number) => {
    // Everything through this month's last card must be rendered before
    // the header can be scrolled to.
    setCap((c) => Math.max(c, end + 1));
    setTimeout(() => {
      document
        .getElementById(monthAnchor(month))
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  };
  const baseShared = [...sharedByPlayer.entries()].map(
    ([pid, list]) => [pid, applyBaseFilters(list)] as const
  );
  const filteredShared = new Map(
    baseShared
      .map(([pid, list]) => [pid, applyScoreFilter(list)] as const)
      .filter(([, list]) => list.length > 0)
  );
  // Score chips: fetch point rows for the cards on screen, not the whole
  // account. `cap` is part of the key, so "Show more" pulls the newly
  // revealed cards' points. `null` means the score-aware fallback — load
  // everything, exactly as this page did before.
  const chipIds = chipTargetIds({
    baseFilteredOwn: baseOwn,
    baseFilteredShared: baseShared.flatMap(([, list]) => list),
    cap,
    scoreFilter,
    tokens,
  });
  const chipKey = chipIds === null ? "*" : chipIds.join(",");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ids = chipKey === "*" ? null : chipKey ? chipKey.split(",") : [];
      if (ids !== null && ids.length === 0) return;
      const rows = await fetchPointsPaged<PointLite>(
        "id, match_id, idx, t0, is_let, confirmed_winner, game_end_override",
        ids
      );
      const fetched = new Map<string, PointLite[]>();
      for (const p of rows) {
        const list = fetched.get(p.match_id) ?? [];
        list.push(p);
        fetched.set(p.match_id, list);
      }
      // A match that came back with nothing must still land as an empty
      // list, or the merge below would keep serving its old chip.
      if (ids) for (const id of ids) if (!fetched.has(id)) fetched.set(id, []);
      if (cancelled) return;
      setPointsByMatch((prev) =>
        ids === null ? fetched : new Map([...prev, ...fetched])
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [chipKey, tick]);

  const filtersActive =
    statusFilter !== "all" ||
    typeFilter !== "all" ||
    scoreFilter !== "all" ||
    sort !== "uploaded";
  const showPendingJobs =
    !q && (statusFilter === "all" || statusFilter === "processing")
      ? pendingPointJobs
      : [];
  const anythingVisible =
    filteredOwn.length > 0 ||
    filteredShared.size > 0 ||
    showPendingJobs.length > 0;
  const hasAnything =
    ownMatches.length > 0 ||
    sharedMatches.length > 0 ||
    pendingPointJobs.length > 0;

  // Sign thumbnails only for cards actually rendered.
  const thumbs = useThumbs(
    useMemo(
      () =>
        [
          ...filteredOwn,
          ...[...filteredShared.values()].flat(),
        ]
          .filter((m) => m.thumb_path)
          .map((m) => m.id),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [matches, query, statusFilter, typeFilter, scoreFilter, sort, cap]
    )
  );

  async function openDeleteConfirm(m: MatchRow) {
    setMenuFor(null);
    setConfirmMatch(m);
    setConfirmBytes(null);
    setDeleteError(null);
    try {
      const res = await fetch("/api/delete-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", matchId: m.id }),
      });
      const data = res.ok ? await res.json() : null;
      setConfirmBytes(typeof data?.bytes === "number" ? data.bytes : 0);
    } catch {
      setConfirmBytes(0);
    }
  }

  async function deleteMatch(m: MatchRow) {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch("/api/delete-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", matchId: m.id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error ?? "delete failed");
      }
      setConfirmMatch(null);
      await fetchAll();
    } catch (e) {
      setDeleteError(
        e instanceof Error && e.message !== "delete failed"
          ? e.message
          : "Could not delete the match. Try again."
      );
    } finally {
      setDeleting(false);
    }
  }

  // Card actions (share + overflow), own matches only, floating on the
  // thumbnail as one glass cluster.
  const cardMenu = (m: MatchRow) => {
    if (m.status === "processing" || m.user_id !== userId) return null;
    return (
      <span className="absolute right-1.5 top-1.5 z-10 flex gap-1.5">
        <button
          type="button"
          aria-label="Match options"
          onClick={(e) => {
            e.preventDefault();
            setMenuFor(menuFor === m.id ? null : m.id);
          }}
          className="rounded-full bg-ink/70 p-2 text-zinc-300 backdrop-blur-md transition-colors hover:bg-ink/90 hover:text-white"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="currentColor"
            aria-hidden="true"
          >
            <circle cx="12" cy="5" r="1.6" />
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="12" cy="19" r="1.6" />
          </svg>
        </button>
        {menuFor === m.id && (
          <>
            <button
              type="button"
              aria-label="Close menu"
              onClick={(e) => {
                e.preventDefault();
                setMenuFor(null);
              }}
              className="fixed inset-0 z-10 cursor-default"
            />
            <div className="absolute right-0 top-10 z-20 w-44 overflow-hidden rounded-2xl border border-edge/80 bg-ink/95 py-1.5 shadow-xl shadow-black/50 backdrop-blur-xl">
              {m.status === "ready" && (
                <>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      setMenuFor(null);
                      setShareFor(m);
                    }}
                    className="flex w-full items-center gap-2.5 whitespace-nowrap px-3.5 py-2 text-left text-[13px] font-medium text-zinc-200 transition-colors hover:bg-white/5 hover:text-white"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-4 w-4 shrink-0 text-zinc-400"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 15V4m0 0L8 8m4-4 4 4M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"
                      />
                    </svg>
                    Share
                  </button>
                  <div className="mx-3 my-1 border-t border-edge/60" />
                </>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  void openDeleteConfirm(m);
                }}
                className="flex w-full items-center gap-2.5 whitespace-nowrap px-3.5 py-2 text-left text-[13px] font-medium text-red-400 transition-colors hover:bg-red-500/10"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m3 0-.7 12.1a2 2 0 0 1-2 1.9H8.7a2 2 0 0 1-2-1.9L6 7m4 4v6m4-6v6"
                  />
                </svg>
                Delete match
              </button>
            </div>
          </>
        )}
      </span>
    );
  };

  const matchCard = (m: MatchRow, shared: boolean) => {
    const s = matchChips[m.status] ?? matchChips.processing;
    const count = m.points?.[0]?.count ?? 0;
    const job = m.job_id ? jobById.get(m.job_id) : undefined;
    const chip = scoreChipByMatch.get(m.id);
    const notes = noteCounts.get(m.id) ?? 0;
    const parts = deriveMatchTitleParts({
      opponentName: m.opponent_name,
      venue: m.venue,
      playedAt: m.played_at,
      matchType: m.match_type,
      ...(shared
        ? { neutral: false, nameA: "", nameB: (m.opponent_name ?? "").trim() }
        : neutralTitleFields(m, accountName)),
    });
    const bits: string[] = [parts.secondary];
    if (m.status === "ready") bits.push(`${count} point${count === 1 ? "" : "s"}`);
    if (
      m.status === "processing" &&
      job &&
      job.progress > 0 &&
      job.status !== "done"
    )
      bits.push(`${job.progress}%`);

    const body = (
      <>
        <div className="relative">
          <Thumb
            url={thumbs[m.id]}
            className="aspect-video w-full rounded-t-2xl"
          />
          {m.status !== "ready" && (
            <span className="absolute left-2 top-2">
              <Chip s={s} />
            </span>
          )}
        </div>
        <div className="p-3.5">
          <p className="truncate text-sm font-medium text-zinc-200">
            {parts.primary}
          </p>
          <p className="mt-0.5 truncate text-xs text-zinc-500">
            {bits.filter(Boolean).join(" · ")}
          </p>
          {/* fixed-height footer keeps every card the same size */}
          <div className="mt-2 flex h-6 items-center gap-2">
            {m.status === "ready" && chip ? (
              <span
                title={chip.complete ? "Final games score" : "Scoring in progress"}
                className="whitespace-nowrap rounded-full border border-edge bg-ink/50 px-2 py-0.5 text-[11px] font-semibold tabular-nums"
              >
                <span className="text-cyan-glow">{chip.you}</span>
                <span className="px-0.5 text-zinc-600">-</span>
                <span className="text-magenta-glow">{chip.them}</span>
              </span>
            ) : m.status === "ready" &&
              !shared &&
              !UNSCORED_OK.has(m.match_type ?? "") ? (
              <span className="whitespace-nowrap rounded-full border border-dashed border-edge px-2 py-0.5 text-[11px] font-medium text-zinc-500">
                Add score
              </span>
            ) : null}
            <NoteBadge
              count={notes}
              coach={!shared && coachNoted.has(m.id)}
              onOpen={() => router.push(`/journal?match=${m.id}`)}
            />
            {exportReady.has(m.id) && (
              <span
                title="Export rendered and ready"
                className="ml-auto inline-flex shrink-0 items-center text-zinc-500"
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
                  <path strokeLinecap="round" d="M7 5v14M17 5v14M3 12h18" />
                </svg>
              </span>
            )}
          </div>
        </div>
      </>
    );
    const frame = `block overflow-hidden rounded-2xl border border-edge bg-surface transition-colors ${
      shared ? "hover:border-amber-400/40" : "hover:border-cyan-glow/40"
    }`;
    return (
      <li key={m.id} className="relative">
        {m.status === "ready" ? (
          <Link href={`/match/${m.id}`} className={frame}>
            {body}
          </Link>
        ) : (
          <div className={frame.replace("transition-colors", "")}>{body}</div>
        )}
        {!shared && cardMenu(m)}
      </li>
    );
  };

  const segment = <T extends string>(
    value: T,
    setValue: (v: T) => void,
    options: { value: T; label: string }[]
  ) => (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => setValue(o.value)}
          aria-pressed={value === o.value}
          className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
            value === o.value
              ? "border-cyan-glow/60 bg-cyan-glow/10 text-cyan-glow"
              : "border-edge text-zinc-400 hover:text-zinc-200"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-12">
      <section>
        {/* search + filter toggle */}
        {!loading && hasAnything && (
          <div className="flex items-center gap-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search matches"
              aria-label="Search matches"
              autoComplete="off"
              className="w-full rounded-xl border border-edge bg-surface-2/40 px-4 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-cyan-glow/60 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setFiltersOpen((o) => !o)}
              aria-expanded={filtersOpen}
              aria-label="Filters"
              className={`shrink-0 rounded-xl border p-2.5 transition-colors ${
                filtersActive || filtersOpen
                  ? "border-cyan-glow/60 text-cyan-glow"
                  : "border-edge text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  d="M4 6h16M7 12h10m-7 6h4"
                />
              </svg>
            </button>
          </div>
        )}

        {filtersOpen && (
          <div className="mt-3 space-y-3 rounded-2xl border border-edge/70 bg-surface/50 p-4">
            {(
              [
                {
                  label: "Status",
                  row: segment<StatusFilter>(statusFilter, setStatusFilter, [
                    { value: "all", label: "All" },
                    { value: "ready", label: "Ready" },
                    { value: "processing", label: "Processing" },
                    { value: "failed", label: "Failed" },
                  ]),
                },
                {
                  label: "Type",
                  row: segment<TypeFilter>(typeFilter, setTypeFilter, [
                    { value: "all", label: "Any type" },
                    { value: "drills", label: "Drills" },
                    { value: "practice", label: "Practice" },
                    { value: "match", label: "Match" },
                    { value: "league", label: "League" },
                    { value: "tournament", label: "Tournament" },
                  ]),
                },
                {
                  label: "Score",
                  row: segment<ScoreFilter>(scoreFilter, setScoreFilter, [
                    { value: "all", label: "Any score" },
                    { value: "scored", label: "Scored" },
                    { value: "unscored", label: "Unscored" },
                  ]),
                },
                {
                  label: "Sort",
                  row: segment<SortKey>(sort, setSort, [
                    { value: "uploaded", label: "Recently uploaded" },
                    { value: "played", label: "Match date" },
                  ]),
                },
              ] as { label: string; row: React.ReactNode }[]
            ).map(({ label, row }) => (
              <div key={label} className="flex items-start gap-3">
                <span className="w-12 shrink-0 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                  {label}
                </span>
                <div className="min-w-0 flex-1">{row}</div>
              </div>
            ))}
          </div>
        )}

        {loading ? (
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <li
                key={i}
                className="aspect-[4/4.4] animate-pulse rounded-2xl border border-edge bg-surface"
              />
            ))}
          </ul>
        ) : !hasAnything ? (
          <div className="mt-4 rounded-2xl border border-edge bg-surface p-10 text-center">
            <p className="text-3xl">🏓</p>
            <p className="mt-3 font-medium text-zinc-200">No matches yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-zinc-500">
              Upload your first match. When processing finishes it will appear
              here, broken into points and ready to review.
            </p>
            <Link
              href="/upload"
              className="glow-cta mt-5 inline-block rounded-full bg-cyan-glow px-6 py-2.5 text-sm font-semibold text-ink"
            >
              Upload a match
            </Link>
          </div>
        ) : !anythingVisible ? (
          <p className="mt-4 text-sm text-zinc-500">
            No matches{q ? ` for “${query.trim()}”` : ""}
            {filtersActive ? " with these filters" : ""}.
          </p>
        ) : (
          <>
            {monthed && monthRail.length > 1 && (
              <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
                {monthRail.map((r) => (
                  <button
                    key={r.month}
                    type="button"
                    onClick={() => jumpToMonth(r.month, r.end)}
                    title={`${r.month} · ${r.count} match${
                      r.count === 1 ? "" : "es"
                    }`}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-edge px-3 py-1 text-xs font-medium text-zinc-400 transition-colors hover:border-cyan-glow/40 hover:text-white"
                  >
                    {r.short}
                    <span className="tabular-nums text-zinc-600">
                      {r.count}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {(showPendingJobs.length > 0 ||
              (!monthed && filteredOwn.length > 0)) && (
              <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {showPendingJobs.map((job) => (
                  <li
                    key={job.id}
                    className="overflow-hidden rounded-2xl border border-edge bg-surface"
                  >
                    <div className="flex aspect-video w-full items-center justify-center bg-surface-2/60">
                      <Chip
                        s={
                          job.status === "queued" ? queuedChip : matchChips.processing
                        }
                      />
                    </div>
                    <div className="p-3.5">
                      <p className="truncate text-sm font-medium text-zinc-200">
                        {job.original_name ?? "Match"}
                      </p>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        {formatDate(job.created_at)}
                        {job.status === "processing" && job.progress > 0
                          ? ` · ${job.progress}%`
                          : ""}
                        {" · "}
                        {timeAgo(job.created_at)}
                      </p>
                    </div>
                  </li>
                ))}
                {!monthed && filteredOwn.map((m) => matchCard(m, false))}
              </ul>
            )}
            {monthed &&
              monthSections.map((s) => (
                <div key={s.month}>
                  <h3
                    id={monthAnchor(s.month)}
                    className="mt-5 scroll-mt-20 text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
                  >
                    {s.month}
                    <span className="ml-1.5 font-normal normal-case tracking-normal text-zinc-600">
                      ·{" "}
                      {monthRail.find((r) => r.month === s.month)?.count ??
                        s.items.length}
                    </span>
                  </h3>
                  <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {s.items.map((m) => matchCard(m, false))}
                  </ul>
                </div>
              ))}
            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setCap((c) => c + RENDER_CAP)}
                className="mt-4 w-full rounded-xl border border-edge bg-surface/50 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:border-cyan-glow/40 hover:text-white"
              >
                Show {Math.min(hiddenCount, RENDER_CAP)} more
              </button>
            )}
          </>
        )}
      </section>

      {/* coach view: matches other players shared via accepted coach links */}
      {!loading && filteredShared.size > 0 && (
        <section>
          <h2 className="text-lg font-semibold">Shared with me</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Matches players shared with you. Open one to watch and leave
            coach notes.
          </p>
          <CoachCta />
          <div className="mt-4 space-y-6">
            {[...filteredShared.entries()].map(([playerId, list]) => (
              <div key={playerId}>
                <h3 className="text-sm font-semibold text-zinc-300">
                  {playerName.get(playerId) ?? "Player"}
                </h3>
                <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {list.map((m) => matchCard(m, true))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Per-card share: the same sheet the match page uses. */}
      {shareFor && (
        <ShareSheet
          open
          onClose={() => setShareFor(null)}
          matchId={shareFor.id}
          userId={userId}
          names={
            deriveMatchTitleParts({
              opponentName: shareFor.opponent_name,
              playedAt: shareFor.played_at,
              venue: null,
              ...neutralTitleFields(shareFor, accountName),
            }).primary
          }
        />
      )}

      {/* Delete match confirmation */}
      {confirmMatch && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div className="w-full max-w-sm rounded-2xl border border-edge bg-surface p-6">
            <h3 className="text-lg font-semibold text-zinc-100">
              Delete this match?
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-zinc-400">
              {confirmBytes === null
                ? "Checking how much space this frees…"
                : `This frees ${formatBytes(confirmBytes)}. `}
              {confirmBytes !== null &&
                "Clips, video, notes, and the scorecard are deleted. This cannot be undone."}
            </p>
            {deleteError && (
              <p className="mt-3 text-sm text-red-400">{deleteError}</p>
            )}
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setConfirmMatch(null);
                  setDeleteError(null);
                }}
                disabled={deleting}
                className="flex-1 rounded-full border border-edge px-4 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:text-white disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void deleteMatch(confirmMatch)}
                disabled={deleting || confirmBytes === null}
                className="flex-1 rounded-full bg-red-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-400 disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Delete match"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
