"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Job, SharedPlayer } from "@/lib/types";
import { deriveMatchTitle, deriveMatchTitleParts } from "@/lib/matchTitle";
import { ShareSheet } from "@/components/ShareSheet";
import {
  Chip,
  Thumb,
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

function NoteBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-400">
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
      {count}
    </span>
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
  const [pointsLite, setPointsLite] = useState<PointLite[]>([]);
  const [noteCounts, setNoteCounts] = useState<Map<string, number>>(new Map());
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [scoreFilter, setScoreFilter] = useState<ScoreFilter>("all");
  const [sort, setSort] = useState<SortKey>("uploaded");
  const [cap, setCap] = useState(RENDER_CAP);
  const [shareFor, setShareFor] = useState<MatchRow | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [confirmMatch, setConfirmMatch] = useState<MatchRow | null>(null);
  const [confirmBytes, setConfirmBytes] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    const supabase = createClient();
    // RLS returns own matches plus matches shared by players who accepted
    // this user as a coach; coach_players() supplies their display names.
    // Notes come back id-less (match_id only) purely for the per-card count.
    const [matchRes, jobRes, playersRes, pointRes, noteRes] =
      await Promise.all([
        supabase
          .from("matches")
          .select("*, points(count)")
          .order("created_at", { ascending: false }),
        supabase
          .from("jobs")
          .select("*")
          .order("created_at", { ascending: false }),
        supabase.rpc("coach_players"),
        supabase
          .from("points")
          .select(
            "id, match_id, idx, t0, is_let, confirmed_winner, game_end_override"
          )
          .eq("deleted", false),
        supabase.from("notes").select("match_id"),
      ]);
    if (matchRes.data) setMatches(matchRes.data as MatchRow[]);
    if (jobRes.data) setJobs(jobRes.data as Job[]);
    if (playersRes.data) setSharedPlayers(playersRes.data as SharedPlayer[]);
    if (pointRes.data) setPointsLite(pointRes.data as PointLite[]);
    if (noteRes.data) {
      const counts = new Map<string, number>();
      for (const n of noteRes.data as { match_id: string }[]) {
        counts.set(n.match_id, (counts.get(n.match_id) ?? 0) + 1);
      }
      setNoteCounts(counts);
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
    const id = setInterval(
      () => void fetchAll(),
      hasActiveWork ? POLL_MS : POLL_MS * 3
    );
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
        scoreChipByMatch.has(m.id) ? "scored" : "unscored",
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

  const applyFilters = useCallback(
    (list: MatchRow[]) =>
      list
        .filter(
          (m) =>
            matchesQuery(m) &&
            (statusFilter === "all" || m.status === statusFilter) &&
            (typeFilter === "all" || m.match_type === typeFilter) &&
            (scoreFilter === "all" ||
              (scoreFilter === "scored"
                ? scoreChipByMatch.has(m.id)
                : m.status === "ready" && !scoreChipByMatch.has(m.id)))
        )
        .sort((a, b) =>
          sort === "played"
            ? b.played_at.localeCompare(a.played_at)
            : b.created_at.localeCompare(a.created_at)
        ),
    [matchesQuery, statusFilter, typeFilter, scoreFilter, sort, scoreChipByMatch]
  );

  const filteredOwnAll = applyFilters(ownMatches);
  const filteredOwn = filteredOwnAll.slice(0, cap);
  const hiddenCount = filteredOwnAll.length - filteredOwn.length;
  const filteredShared = new Map(
    [...sharedByPlayer.entries()]
      .map(([pid, list]) => [pid, applyFilters(list)] as const)
      .filter(([, list]) => list.length > 0)
  );
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
            <div className="absolute right-0 top-10 z-20 overflow-hidden rounded-xl border border-edge bg-surface shadow-lg">
              {m.status === "ready" && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    setMenuFor(null);
                    setShareFor(m);
                  }}
                  className="block w-full px-4 py-2.5 text-left text-sm font-medium text-zinc-200 transition-colors hover:bg-cyan-glow/10"
                >
                  Share
                </button>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  void openDeleteConfirm(m);
                }}
                className="block w-full px-4 py-2.5 text-left text-sm font-medium text-red-400 transition-colors hover:bg-red-500/10"
              >
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
          <div className="mt-2 flex h-6 items-center gap-2.5">
            {m.status === "ready" && chip ? (
              <span className="rounded-full border border-cyan-glow/30 bg-cyan-glow/5 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-cyan-glow/90">
                {chip}
              </span>
            ) : m.status === "ready" &&
              !shared &&
              !UNSCORED_OK.has(m.match_type ?? "") ? (
              <span className="rounded-full border border-dashed border-edge px-2 py-0.5 text-[11px] font-medium text-zinc-500">
                Add score
              </span>
            ) : null}
            <NoteBadge count={notes} />
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
          <div className="mt-3 space-y-2.5 rounded-2xl border border-edge/70 bg-surface/50 p-4">
            {segment<StatusFilter>(statusFilter, setStatusFilter, [
              { value: "all", label: "All" },
              { value: "ready", label: "Ready" },
              { value: "processing", label: "Processing" },
              { value: "failed", label: "Failed" },
            ])}
            {segment<TypeFilter>(typeFilter, setTypeFilter, [
              { value: "all", label: "Any type" },
              { value: "drills", label: "Drills" },
              { value: "practice", label: "Practice" },
              { value: "match", label: "Match" },
              { value: "league", label: "League" },
              { value: "tournament", label: "Tournament" },
            ])}
            {segment<ScoreFilter>(scoreFilter, setScoreFilter, [
              { value: "all", label: "Any score" },
              { value: "scored", label: "Scored" },
              { value: "unscored", label: "Unscored" },
            ])}
            {segment<SortKey>(sort, setSort, [
              { value: "uploaded", label: "Recently uploaded" },
              { value: "played", label: "Match date" },
            ])}
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
            {(showPendingJobs.length > 0 || filteredOwn.length > 0) && (
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
                {filteredOwn.map((m) => matchCard(m, false))}
              </ul>
            )}
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
