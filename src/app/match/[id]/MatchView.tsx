"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Match, Note, Point } from "@/lib/types";
import { ShareWithCoach } from "@/components/ShareWithCoach";
import { computeMatchScore, sortPoints } from "./gameScore";
import { NoteComposer, NoteItem } from "./Notes";
import { PointDetail } from "./PointDetail";
import { PointSheet } from "./PointSheet";
import { PlayerTagging } from "./PlayerTagging";
import { ServerChipMenu } from "./ServerChipMenu";
import {
  computeServing,
  firstServerGuess,
  type MatchServer,
} from "./serving";
import type { Side } from "./sides";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Source-video timestamp as m:ss. */
function formatClock(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function TrashIcon({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m3 0-.9 13a1 1 0 0 1-1 .9H7.9a1 1 0 0 1-1-.9L6 7m4 4v6m4-6v6"
      />
    </svg>
  );
}

const SWIPE_OPEN_PX = -88;

/**
 * Swipe-left on touch devices reveals a red Remove action behind the card.
 * Vertical scrolling is untouched (we only claim clearly horizontal drags);
 * while the action is open, the first tap on the card just closes it.
 */
function SwipeRemoveRow({
  enabled,
  onRemove,
  children,
}: {
  enabled: boolean;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{
    x: number;
    y: number;
    dx: number;
    horizontal: boolean | null;
  } | null>(null);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const t = e.touches[0];
      start.current = { x: t.clientX, y: t.clientY, dx, horizontal: null };
    },
    [dx]
  );

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    const s = start.current;
    if (!s) return;
    const t = e.touches[0];
    const moveX = t.clientX - s.x;
    const moveY = t.clientY - s.y;
    if (s.horizontal === null) {
      if (Math.abs(moveX) < 8 && Math.abs(moveY) < 8) return;
      s.horizontal = Math.abs(moveX) > Math.abs(moveY);
    }
    if (!s.horizontal) return;
    setDragging(true);
    setDx(Math.min(0, Math.max(SWIPE_OPEN_PX * 1.25, s.dx + moveX)));
  }, []);

  const onTouchEnd = useCallback(() => {
    const s = start.current;
    start.current = null;
    setDragging(false);
    if (!s || s.horizontal !== true) return;
    setDx((v) => (v < SWIPE_OPEN_PX / 2 ? SWIPE_OPEN_PX : 0));
  }, []);

  if (!enabled) return <>{children}</>;

  return (
    <div className="relative">
      <div
        className={`absolute inset-y-0 right-0 w-24 ${
          dx < 0 ? "" : "pointer-events-none opacity-0"
        }`}
      >
        <button
          type="button"
          onClick={() => {
            setDx(0);
            onRemove();
          }}
          className="flex h-full w-full items-center justify-center rounded-2xl border border-red-400/40 bg-red-500/15 pl-2 text-sm font-semibold text-red-300"
        >
          Remove
        </button>
      </div>
      <div
        style={{
          // Only transform while swiped/dragging: a permanent transform
          // would give every card its own stacking context, and the server
          // chip menu (z-40) would paint under the next card.
          transform: dx !== 0 ? `translateX(${dx}px)` : undefined,
          transition: dragging ? "none" : "transform 0.2s ease",
          touchAction: "pan-y",
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClickCapture={(e) => {
          if (dx !== 0) {
            e.preventDefault();
            e.stopPropagation();
            setDx(0);
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** lg breakpoint: the split view replaces the sheet from here up. */
function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isDesktop;
}

/** Download card: inline preview of the cut plus the download button. */
function DownloadCard({ matchId }: { matchId: string }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/media-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ matchId, preview: true }),
        });
        const data = res.ok ? await res.json() : null;
        if (data?.url && !cancelled) setPreviewUrl(data.url);
      } catch {
        // Preview is optional; the download button still works.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [matchId]);

  const download = useCallback(async () => {
    setDownloading(true);
    setError(null);
    try {
      const res = await fetch("/api/media-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId }),
      });
      const data = res.ok ? await res.json() : null;
      if (!data?.url) throw new Error("no url");
      window.location.href = data.url;
    } catch {
      setError("Couldn't create a download link. Try again shortly.");
    } finally {
      setDownloading(false);
    }
  }, [matchId]);

  return (
    <div className="w-full overflow-hidden rounded-2xl border border-edge bg-surface sm:max-w-sm">
      {previewUrl ? (
        <video
          src={previewUrl}
          controls
          playsInline
          preload="metadata"
          className="aspect-video w-full bg-black"
        />
      ) : (
        <div className="flex aspect-video items-center justify-center bg-ink">
          <p className="text-xs text-zinc-600">Loading preview…</p>
        </div>
      )}
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div>
          <p className="text-sm font-semibold">Full video</p>
          <p className="text-xs text-zinc-500">Dead time removed</p>
        </div>
        <button
          type="button"
          onClick={() => void download()}
          disabled={downloading}
          className="glow-cta shrink-0 rounded-full bg-cyan-glow px-4 py-2 text-sm font-semibold text-ink disabled:opacity-60"
        >
          {downloading ? "Preparing…" : "Download"}
        </button>
      </div>
      {error && <p className="px-4 pb-3 text-sm text-red-400">{error}</p>}
    </div>
  );
}

export function MatchView({
  match,
  initialPoints,
  initialNotes,
  userId,
  strictness,
}: {
  match: Match;
  initialPoints: Point[];
  initialNotes: Note[];
  userId: string;
  strictness: string;
}) {
  const [points, setPoints] = useState<Point[]>(initialPoints);
  const [notes, setNotes] = useState<Note[]>(initialNotes);
  const [opponentName, setOpponentName] = useState(match.opponent_name ?? "");
  const [userSide, setUserSide] = useState<Side | null>(match.user_side);
  const [nearName, setNearName] = useState(match.player_near_name ?? "");
  const [farName, setFarName] = useState(match.player_far_name ?? "");
  const [firstServer, setFirstServer] = useState<MatchServer | null>(
    match.first_server
  );
  const [activePointId, setActivePointId] = useState<string | null>(null);

  // Undo snackbar for "Not a point" soft deletes.
  const [snackbar, setSnackbar] = useState<{
    text: string;
    pointId: string;
  } | null>(null);
  const snackbarTimer = useRef<number | null>(null);
  // Debounce: many quick edits -> ONE reclip job per match.
  const reclipTimer = useRef<number | null>(null);

  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackBody, setFeedbackBody] = useState("");
  const [feedbackState, setFeedbackState] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");

  const isOwner = match.user_id === userId;
  const isDesktop = useIsDesktop();

  // Opponent name: save on blur / Enter, only when it changed.
  const saveOpponentName = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (trimmed === (match.opponent_name ?? "").trim()) return;
      const supabase = createClient();
      await supabase
        .from("matches")
        .update({ opponent_name: trimmed || null })
        .eq("id", match.id);
      match.opponent_name = trimmed || null;
    },
    [match]
  );

  const toggleStar = useCallback(async (point: Point) => {
    const next = !point.starred;
    setPoints((ps) =>
      ps.map((p) => (p.id === point.id ? { ...p, starred: next } : p))
    );
    const supabase = createClient();
    const { error } = await supabase
      .from("points")
      .update({ starred: next })
      .eq("id", point.id);
    if (error) {
      setPoints((ps) =>
        ps.map((p) => (p.id === point.id ? { ...p, starred: !next } : p))
      );
    }
  }, []);

  const sendFeedback = useCallback(async () => {
    const body = feedbackBody.trim();
    if (!body) return;
    setFeedbackState("sending");
    const supabase = createClient();
    const { error } = await supabase.from("feedback").insert({
      user_id: userId,
      match_id: match.id,
      body,
    });
    if (error) {
      setFeedbackState("error");
      return;
    }
    setFeedbackBody("");
    setFeedbackState("sent");
  }, [feedbackBody, userId, match.id]);

  const noteCountByPoint = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of notes) {
      if (n.point_id) map.set(n.point_id, (map.get(n.point_id) ?? 0) + 1);
    }
    return map;
  }, [notes]);

  const matchNotes = notes.filter((n) => n.point_id === null);

  // Timeline = non-deleted, non-warmup points in source-video order;
  // display numbers are positions in this list (soft deletes and warmup
  // renumber automatically). Warmup collapses at the top, removed at the
  // bottom — both recoverable.
  const orderedPoints = useMemo(() => sortPoints(points), [points]);
  const visiblePoints = useMemo(
    () => orderedPoints.filter((p) => !p.deleted && !p.warmup),
    [orderedPoints]
  );
  const warmupPoints = useMemo(
    () => orderedPoints.filter((p) => p.warmup && !p.deleted),
    [orderedPoints]
  );
  const removedPoints = useMemo(
    () => orderedPoints.filter((p) => p.deleted),
    [orderedPoints]
  );
  const [warmupOpen, setWarmupOpen] = useState(false);
  const [removedOpen, setRemovedOpen] = useState(false);
  const score = useMemo(
    () => computeMatchScore(visiblePoints),
    [visiblePoints]
  );

  // ITTF rotation from first_server (overrides re-anchor downstream);
  // recomputes instantly on any first_server / override / let change.
  const serving = useMemo(
    () => computeServing(visiblePoints, firstServer),
    [visiblePoints, firstServer]
  );
  const serveGuess = useMemo(
    () => firstServerGuess(visiblePoints, userSide),
    [visiblePoints, userSide]
  );

  const saveFirstServer = useCallback(
    async (value: MatchServer) => {
      const prev = firstServer;
      setFirstServer(value);
      const supabase = createClient();
      const { error } = await supabase
        .from("matches")
        .update({ first_server: value })
        .eq("id", match.id);
      if (error) setFirstServer(prev);
      else match.first_server = value;
    },
    [firstServer, match]
  );

  // Desktop always shows a point in the pane (default: the first).
  // Mobile opens the sheet only after a tap.
  const selectedPoint =
    visiblePoints.find((p) => p.id === activePointId) ?? null;
  const panePoint = selectedPoint ?? visiblePoints[0] ?? null;
  const paneIndex = panePoint
    ? visiblePoints.findIndex((p) => p.id === panePoint.id)
    : -1;

  const goToIndex = useCallback(
    (i: number) => {
      if (i < 0 || i >= visiblePoints.length) return;
      const id = visiblePoints[i].id;
      setActivePointId(id);
      document
        .getElementById(`point-card-${id}`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    },
    [visiblePoints]
  );

  // Desktop arrow-key navigation between points.
  useEffect(() => {
    if (!isDesktop || visiblePoints.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      const next = e.key === "ArrowDown" || e.key === "ArrowRight";
      const prev = e.key === "ArrowUp" || e.key === "ArrowLeft";
      if (!next && !prev) return;
      const t = e.target as HTMLElement | null;
      if (
        t?.closest(
          'input, textarea, select, video, audio, [contenteditable="true"]'
        )
      )
        return;
      e.preventDefault();
      goToIndex(paneIndex + (next ? 1 : -1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isDesktop, visiblePoints.length, paneIndex, goToIndex]);

  const updatePoint = useCallback((pointId: string, patch: Partial<Point>) => {
    setPoints((ps) =>
      ps.map((p) => (p.id === pointId ? { ...p, ...patch } : p))
    );
  }, []);

  // Inline winner tap on a card: one tap confirms, tapping the same side
  // again clears it. confirmed_how stays untouched (set in the point view).
  const tapWinner = useCallback(
    async (point: Point, side: "user" | "opponent") => {
      const prev = point.confirmed_winner;
      const next = prev === side ? null : side;
      updatePoint(point.id, { confirmed_winner: next });
      const supabase = createClient();
      const { error } = await supabase
        .from("points")
        .update({ confirmed_winner: next })
        .eq("id", point.id);
      if (error) updatePoint(point.id, { confirmed_winner: prev });
    },
    [updatePoint]
  );

  const dismissSnackbar = useCallback(() => {
    if (snackbarTimer.current) window.clearTimeout(snackbarTimer.current);
    snackbarTimer.current = null;
    setSnackbar(null);
  }, []);

  // Soft delete: hide from the timeline immediately, undoable for a bit.
  const deletePoint = useCallback(
    async (point: Point) => {
      updatePoint(point.id, { deleted: true });
      setActivePointId(null);
      if (snackbarTimer.current) window.clearTimeout(snackbarTimer.current);
      setSnackbar({ text: "Point removed", pointId: point.id });
      snackbarTimer.current = window.setTimeout(() => setSnackbar(null), 6000);
      const supabase = createClient();
      const { error } = await supabase
        .from("points")
        .update({ deleted: true })
        .eq("id", point.id);
      if (error) {
        updatePoint(point.id, { deleted: false });
        dismissSnackbar();
      }
    },
    [updatePoint, dismissSnackbar]
  );

  const undoDelete = useCallback(
    async (pointId: string) => {
      dismissSnackbar();
      updatePoint(pointId, { deleted: false });
      const supabase = createClient();
      const { error } = await supabase
        .from("points")
        .update({ deleted: false })
        .eq("id", pointId);
      if (error) updatePoint(pointId, { deleted: true });
    },
    [updatePoint, dismissSnackbar]
  );

  // "This is a point": rescue a warmup-flagged play into the timeline.
  const markRealPoint = useCallback(
    async (point: Point) => {
      updatePoint(point.id, { warmup: false });
      const supabase = createClient();
      const { error } = await supabase
        .from("points")
        .update({ warmup: false })
        .eq("id", point.id);
      if (error) updatePoint(point.id, { warmup: true });
    },
    [updatePoint]
  );

  // One debounced 'reclip' job per match: skip when one is already queued
  // (a job that is mid-processing may have read the points before the
  // latest edit, so only 'queued' suppresses a new enqueue).
  const enqueueReclip = useCallback(async () => {
    const supabase = createClient();
    const { data: queued } = await supabase
      .from("jobs")
      .select("id")
      .eq("kind", "reclip")
      .eq("status", "queued")
      .contains("options", { match_id: match.id })
      .limit(1);
    if (queued && queued.length > 0) return;
    await supabase
      .from("jobs")
      .insert({ user_id: userId, kind: "reclip", options: { match_id: match.id } });
  }, [match.id, userId]);

  const scheduleReclip = useCallback(() => {
    if (reclipTimer.current) window.clearTimeout(reclipTimer.current);
    reclipTimer.current = window.setTimeout(() => {
      reclipTimer.current = null;
      void enqueueReclip();
    }, 4000);
  }, [enqueueReclip]);

  const addSplitPoint = useCallback((newPoint: Point) => {
    setPoints((ps) =>
      ps.some((p) => p.id === newPoint.id) ? ps : [...ps, newPoint]
    );
  }, []);

  // While clips are regenerating, poll so 'Updating clip' resolves into the
  // fresh clip without a manual refresh. t0/t1 truth lives in Postgres; the
  // video is the only thing arriving late.
  const hasPendingClips = points.some((p) => p.edited && !p.deleted);
  useEffect(() => {
    if (!hasPendingClips) return;
    const supabase = createClient();
    const iv = window.setInterval(() => {
      void (async () => {
        const { data } = await supabase
          .from("points")
          .select("id, t0, t1, clip_path, edited, deleted")
          .eq("match_id", match.id);
        if (!data) return;
        setPoints((ps) =>
          ps.map((p) => {
            const fresh = data.find((d) => d.id === p.id);
            return fresh ? { ...p, ...fresh } : p;
          })
        );
      })();
    }, 8000);
    return () => window.clearInterval(iv);
  }, [hasPendingClips, match.id]);

  const onTaggingChange = useCallback(
    (patch: {
      userSide?: Side;
      nearName?: string;
      farName?: string;
      opponentName?: string;
    }) => {
      if (patch.userSide !== undefined) setUserSide(patch.userSide);
      if (patch.nearName !== undefined) setNearName(patch.nearName);
      if (patch.farName !== undefined) setFarName(patch.farName);
      if (patch.opponentName !== undefined) {
        setOpponentName(patch.opponentName);
        match.opponent_name = patch.opponentName;
      }
    },
    [match]
  );

  const winnerText = (p: Point) =>
    p.confirmed_winner === "user"
      ? isOwner
        ? "You won"
        : "Player won"
      : isOwner
        ? "They won"
        : "Opponent won";

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12 lg:max-w-6xl">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-zinc-400 transition-colors hover:text-white"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m15 6-6 6 6 6" />
        </svg>
        Dashboard
      </Link>

      {/* header */}
      <div className="mt-4">
        {isOwner ? (
          <input
            value={opponentName}
            onChange={(e) => setOpponentName(e.target.value)}
            onBlur={(e) => void saveOpponentName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            placeholder="vs. who?"
            aria-label="Opponent name"
            className="w-full border-b border-transparent bg-transparent text-2xl font-bold tracking-tight outline-none transition-colors placeholder:text-zinc-600 hover:border-edge focus:border-cyan-glow/60 sm:text-3xl"
          />
        ) : (
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {opponentName || "Match"}
          </h1>
        )}
        <p className="mt-1 text-sm text-zinc-400">
          {formatDate(match.played_at)}
        </p>

        <div className="mt-4 flex flex-wrap items-start gap-3">
          <DownloadCard matchId={match.id} />
          {isOwner && <ShareWithCoach userId={userId} matchId={match.id} />}
        </div>
      </div>

      {/* player tagging: who is who? */}
      {isOwner && points.length > 0 && (
        <PlayerTagging
          matchId={match.id}
          firstPointId={points[0]?.id ?? null}
          userSide={userSide}
          nearName={nearName}
          farName={farName}
          onChange={onTaggingChange}
        />
      )}

      {/* first server: anchors the ITTF serve rotation for every point */}
      {isOwner && firstServer === null && visiblePoints.length > 0 && (
        <div className="mt-6 rounded-2xl border border-cyan-glow/30 bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Who served first?</h2>
              <p className="mt-0.5 text-sm text-zinc-400">
                Sets the serve rotation for the whole match.
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              {(
                [
                  { value: "user", label: "You" },
                  { value: "opponent", label: "Them" },
                ] as const
              ).map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => void saveFirstServer(o.value)}
                  className={`rounded-lg border px-5 py-2.5 text-sm font-semibold transition-colors ${
                    serveGuess === o.value
                      ? "border-cyan-glow/50 bg-cyan-glow/10 text-cyan-glow"
                      : "border-edge bg-ink/40 text-zinc-300 hover:border-cyan-glow/40"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          {serveGuess !== null && (
            <p className="mt-2 text-[11px] text-zinc-500">
              Auto-detect thinks {serveGuess === "user" ? "you" : "they"}{" "}
              served first.
            </p>
          )}
        </div>
      )}

      {/* split view on lg+: point list left, sticky detail pane right */}
      <div className="lg:grid lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)] lg:items-start lg:gap-8">
        {/* point timeline */}
        <section className="mt-8">
          {/* sticky score strip: stays put while the timeline scrolls.
              Mobile: below the top bar. Desktop: atop the left column.
              Confirmed points only; live-updates on winner taps. */}
          {score.confirmedCount > 0 && (
            <div className="sticky top-[4.25rem] z-30 mx-1 mb-3 md:top-[4.75rem]">
              <div className="flex items-center justify-between gap-3 rounded-full border border-edge bg-ink/90 px-5 py-2.5 shadow-lg shadow-black/50 backdrop-blur-md">
                <div className="flex items-baseline gap-2">
                  <p className="text-xl font-bold tabular-nums tracking-tight">
                    <span className="text-cyan-glow">{score.current.you}</span>
                    <span className="mx-1 text-zinc-600">-</span>
                    <span className="text-magenta-soft">
                      {score.current.them}
                    </span>
                  </p>
                  <span className="text-[11px] text-zinc-500">
                    Game {score.games.length + 1}
                  </span>
                </div>
                <div className="text-right">
                  <p className="text-xs font-semibold tabular-nums text-zinc-200">
                    Games {score.gamesYou}-{score.gamesThem} · now{" "}
                    {score.current.you}-{score.current.them}
                  </p>
                  <p className="mt-0.5 text-[10px] tabular-nums text-zinc-500">
                    {score.games.length > 0
                      ? score.games
                          .map((g) => `${g.you}-${g.them}`)
                          .join(", ")
                      : `${score.confirmedCount} confirmed point${
                          score.confirmedCount === 1 ? "" : "s"
                        }`}
                  </p>
                </div>
              </div>
            </div>
          )}

          <h2 className="text-lg font-semibold">Points</h2>

          {/* warmup: collapsed at the top, rescuable */}
          {warmupPoints.length > 0 && (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setWarmupOpen((o) => !o)}
                aria-expanded={warmupOpen}
                className="flex w-full items-center justify-between rounded-2xl border border-edge/70 bg-surface/50 px-4 py-3 text-left transition-colors hover:border-cyan-glow/30"
              >
                <span className="text-sm font-medium text-zinc-300">
                  Warmup ({warmupPoints.length})
                </span>
                <span className="flex items-center gap-1.5 text-xs text-zinc-500">
                  {warmupOpen ? "Hide" : "Show"}
                  <svg
                    viewBox="0 0 24 24"
                    className={`h-3.5 w-3.5 transition-transform ${
                      warmupOpen ? "rotate-180" : ""
                    }`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m6 9 6 6 6-6"
                    />
                  </svg>
                </span>
              </button>
              <p className="mt-1.5 text-[11px] text-zinc-500">
                Casual play before the match. Not counted in the score.
              </p>
              {warmupOpen && (
                <ul className="mt-2 space-y-2">
                  {warmupPoints.map((p) => {
                    const dur =
                      p.t0 !== null && p.t1 !== null
                        ? Math.max(0, Number(p.t1) - Number(p.t0))
                        : null;
                    return (
                      <li
                        key={p.id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-edge/60 bg-surface/40 px-4 py-3"
                      >
                        <span className="text-xs text-zinc-400">
                          {p.t0 !== null
                            ? `At ${formatClock(Number(p.t0))}`
                            : "Warmup play"}
                          {dur !== null && ` · ${dur.toFixed(1)}s`}
                        </span>
                        {isOwner && (
                          <button
                            type="button"
                            onClick={() => void markRealPoint(p)}
                            className="shrink-0 rounded-full border border-edge px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white"
                          >
                            This is a point
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
          {points.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">
              No point breakdown for this match.
            </p>
          ) : visiblePoints.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">
              No points in the timeline.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {visiblePoints.map((point, i) => {
                const duration =
                  point.t0 !== null && point.t1 !== null
                    ? Math.max(0, Number(point.t1) - Number(point.t0))
                    : null;
                const noteCount = noteCountByPoint.get(point.id) ?? 0;
                const isActive = isDesktop && panePoint?.id === point.id;
                const nextGame = score.boundaryAfter.get(point.id);
                return (
                  <li key={point.id} id={`point-card-${point.id}`}>
                    <SwipeRemoveRow
                      enabled={isOwner}
                      onRemove={() => void deletePoint(point)}
                    >
                    <div
                      className={`flex items-center gap-3 rounded-2xl border bg-surface p-4 transition-colors ${
                        isActive
                          ? "border-cyan-glow/60"
                          : "border-edge hover:border-cyan-glow/40"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setActivePointId(point.id)}
                        aria-current={isActive || undefined}
                        aria-label={`Open point ${i + 1}`}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-edge bg-ink/60 text-sm font-bold text-zinc-300"
                      >
                        {i + 1}
                      </button>
                      <div className="min-w-0 flex-1">
                        {/* the chip is its own tap target (server menu),
                            so it lives outside the open-point button */}
                        <div className="flex flex-wrap items-center gap-2">
                          <ServerChipMenu
                            point={point}
                            serve={serving.get(point.id)}
                            userSide={userSide}
                            isOwner={isOwner}
                            onPointUpdate={updatePoint}
                          />
                          {point.confirmed_winner && !point.is_let && (
                            <span
                              className={`text-[11px] font-medium ${
                                point.confirmed_winner === "user"
                                  ? "text-emerald-400"
                                  : "text-zinc-400"
                              }`}
                            >
                              {winnerText(point)}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => setActivePointId(point.id)}
                          className="mt-1 flex w-full items-center gap-3 text-left text-xs text-zinc-500"
                        >
                          {duration !== null ? (
                            <span>{duration.toFixed(1)}s</span>
                          ) : (
                            <span>View point</span>
                          )}
                          {noteCount > 0 && (
                            <span>
                              {noteCount} note{noteCount === 1 ? "" : "s"}
                            </span>
                          )}
                          {point.edited && (
                            <span className="animate-pulse text-cyan-glow/80">
                              Updating clip
                            </span>
                          )}
                        </button>
                      </div>
                      {/* one-tap winner: builds the score without opening
                          the point; tap the same side again to clear */}
                      {isOwner && (
                        <span className="flex shrink-0 flex-col gap-1">
                          <button
                            type="button"
                            onClick={() => void tapWinner(point, "user")}
                            aria-pressed={point.confirmed_winner === "user"}
                            aria-label={`Point ${i + 1}: you won`}
                            className={`rounded-md border px-2 py-1 text-[11px] font-semibold leading-none transition-colors ${
                              point.confirmed_winner === "user"
                                ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                                : "border-edge bg-ink/40 text-zinc-400 hover:border-cyan-glow/40"
                            }`}
                          >
                            You
                          </button>
                          <button
                            type="button"
                            onClick={() => void tapWinner(point, "opponent")}
                            aria-pressed={point.confirmed_winner === "opponent"}
                            aria-label={`Point ${i + 1}: they won`}
                            className={`rounded-md border px-2 py-1 text-[11px] font-semibold leading-none transition-colors ${
                              point.confirmed_winner === "opponent"
                                ? "border-magenta-glow/60 bg-magenta-glow/15 text-magenta-soft"
                                : "border-edge bg-ink/40 text-zinc-400 hover:border-magenta-glow/40"
                            }`}
                          >
                            Them
                          </button>
                        </span>
                      )}
                      {!isOwner && point.starred && (
                        <span className="shrink-0 p-2 text-amber-300">
                          <svg
                            viewBox="0 0 24 24"
                            className="h-5 w-5"
                            fill="currentColor"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            aria-hidden="true"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z"
                            />
                          </svg>
                        </span>
                      )}
                      {isOwner && (
                        <span className="flex shrink-0 flex-col items-center">
                          <button
                            type="button"
                            onClick={() => void toggleStar(point)}
                            aria-pressed={point.starred}
                            aria-label={
                              point.starred ? "Remove star" : "Star this point"
                            }
                            className={`rounded-full p-1.5 transition-colors ${
                              point.starred
                                ? "text-amber-300"
                                : "text-zinc-600 hover:text-zinc-400"
                            }`}
                          >
                            <svg
                              viewBox="0 0 24 24"
                              className="h-5 w-5"
                              fill={point.starred ? "currentColor" : "none"}
                              stroke="currentColor"
                              strokeWidth="1.8"
                              aria-hidden="true"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z"
                              />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => void deletePoint(point)}
                            aria-label={`Remove point ${i + 1}`}
                            className="rounded-full p-1.5 text-zinc-600 transition-colors hover:text-red-300"
                          >
                            <TrashIcon className="h-5 w-5" />
                          </button>
                        </span>
                      )}
                    </div>
                    </SwipeRemoveRow>
                    {/* game boundary from the confirmed sequence */}
                    {nextGame !== undefined && (
                      <div
                        className="mt-3 flex items-center gap-3"
                        aria-hidden="true"
                      >
                        <span className="h-px flex-1 bg-edge" />
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                          Game {nextGame.game} · {nextGame.you}-{nextGame.them}
                        </span>
                        <span className="h-px flex-1 bg-edge" />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {/* removed points: persistent undo at the bottom */}
          {isOwner && removedPoints.length > 0 && (
            <div className="mt-6">
              <button
                type="button"
                onClick={() => setRemovedOpen((o) => !o)}
                aria-expanded={removedOpen}
                className="flex w-full items-center justify-between rounded-2xl border border-edge/70 bg-surface/50 px-4 py-3 text-left transition-colors hover:border-cyan-glow/30"
              >
                <span className="text-sm font-medium text-zinc-300">
                  Removed ({removedPoints.length})
                </span>
                <span className="flex items-center gap-1.5 text-xs text-zinc-500">
                  {removedOpen ? "Hide" : "Show"}
                  <svg
                    viewBox="0 0 24 24"
                    className={`h-3.5 w-3.5 transition-transform ${
                      removedOpen ? "rotate-180" : ""
                    }`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m6 9 6 6 6-6"
                    />
                  </svg>
                </span>
              </button>
              {removedOpen && (
                <ul className="mt-2 space-y-2">
                  {removedPoints.map((p) => {
                    const dur =
                      p.t0 !== null && p.t1 !== null
                        ? Math.max(0, Number(p.t1) - Number(p.t0))
                        : null;
                    return (
                      <li
                        key={p.id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-edge/60 bg-surface/40 px-4 py-3"
                      >
                        <span className="text-xs text-zinc-400">
                          {p.t0 !== null
                            ? `At ${formatClock(Number(p.t0))}`
                            : "Removed point"}
                          {dur !== null && ` · ${dur.toFixed(1)}s`}
                        </span>
                        <button
                          type="button"
                          onClick={() => void undoDelete(p.id)}
                          className="shrink-0 rounded-full border border-edge px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white"
                        >
                          Restore
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </section>

        {/* desktop detail pane */}
        {isDesktop && panePoint && (
          <aside className="sticky top-20 mt-8 hidden max-h-[calc(100vh-6rem)] overflow-y-auto rounded-2xl border border-edge bg-surface p-5 lg:block">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-semibold">
                Point {paneIndex + 1}
                <span className="ml-2 text-xs font-normal text-zinc-500">
                  {paneIndex + 1} of {visiblePoints.length}
                </span>
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => goToIndex(paneIndex - 1)}
                  disabled={paneIndex <= 0}
                  aria-label="Previous point"
                  title="Previous point (arrow keys work too)"
                  className="rounded-full border border-edge p-1.5 text-zinc-400 transition-colors hover:border-cyan-glow/50 hover:text-white disabled:opacity-40"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m15 6-6 6 6 6"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => goToIndex(paneIndex + 1)}
                  disabled={paneIndex >= visiblePoints.length - 1}
                  aria-label="Next point"
                  title="Next point (arrow keys work too)"
                  className="rounded-full border border-edge p-1.5 text-zinc-400 transition-colors hover:border-cyan-glow/50 hover:text-white disabled:opacity-40"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
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
                </button>
              </div>
            </div>
            <PointDetail
              key={panePoint.id}
              matchId={match.id}
              ownerId={match.user_id}
              point={panePoint}
              serve={serving.get(panePoint.id)}
              notes={notes.filter((n) => n.point_id === panePoint.id)}
              userId={userId}
              userSide={userSide}
              strictness={strictness}
              onPointUpdate={(patch) => updatePoint(panePoint.id, patch)}
              onNoteAdded={(note) => setNotes((ns) => [...ns, note])}
              onDelete={(p) => void deletePoint(p)}
              onSplit={addSplitPoint}
              onClipEdited={scheduleReclip}
            />
          </aside>
        )}
      </div>

      {/* match-level notes (point_id null): overall takeaways + coach review */}
      <section className="mt-10 lg:max-w-2xl">
        <h2 className="text-lg font-semibold">Overall notes</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Notes about the whole match. Type or record a voice note.
        </p>
        {matchNotes.length > 0 && (
          <ul className="mt-4 space-y-3">
            {matchNotes.map((n) => (
              <NoteItem
                key={n.id}
                note={n}
                matchId={match.id}
                ownerId={match.user_id}
                viewerId={userId}
              />
            ))}
          </ul>
        )}
        <div className="mt-4">
          <NoteComposer
            matchId={match.id}
            pointId={null}
            userId={userId}
            placeholder="How did the match go?"
            onNoteAdded={(note) => setNotes((ns) => [...ns, note])}
          />
        </div>
      </section>

      {/* feedback: owner only (coaches report through their own matches) */}
      {isOwner && (
        <div className="mt-12 border-t border-edge/60 pt-6">
          {feedbackState === "sent" ? (
            <p className="text-sm text-emerald-400">
              Thanks. We read every report.
            </p>
          ) : feedbackOpen ? (
            <div>
              <p className="text-sm font-medium text-zinc-300">
                Something wrong with this match?
              </p>
              <p className="mt-0.5 text-xs text-zinc-500">
                Wrong server, missed points, bad cuts. Tell us and we fix the
                pipeline.
              </p>
              <textarea
                value={feedbackBody}
                onChange={(e) => setFeedbackBody(e.target.value)}
                rows={3}
                placeholder="What looks off?"
                className="mt-3 w-full resize-y rounded-lg border border-edge bg-ink/60 px-3 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-600"
              />
              <div className="mt-2 flex items-center gap-3">
                <button
                  type="button"
                  disabled={
                    feedbackState === "sending" ||
                    feedbackBody.trim().length === 0
                  }
                  onClick={() => void sendFeedback()}
                  className="rounded-full bg-cyan-glow px-4 py-1.5 text-sm font-semibold text-ink disabled:opacity-50"
                >
                  {feedbackState === "sending" ? "Sending…" : "Send"}
                </button>
                <button
                  type="button"
                  onClick={() => setFeedbackOpen(false)}
                  className="text-sm text-zinc-500 hover:text-zinc-300"
                >
                  Cancel
                </button>
                {feedbackState === "error" && (
                  <p className="text-xs text-red-400">
                    Couldn&apos;t send. Try again.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setFeedbackOpen(true)}
              className="text-sm text-zinc-500 underline underline-offset-2 transition-colors hover:text-zinc-300"
            >
              Something wrong with this match?
            </button>
          )}
        </div>
      )}

      {/* mobile point sheet */}
      {!isDesktop && selectedPoint && (
        <PointSheet
          matchId={match.id}
          ownerId={match.user_id}
          point={selectedPoint}
          serve={serving.get(selectedPoint.id)}
          notes={notes.filter((n) => n.point_id === selectedPoint.id)}
          userId={userId}
          userSide={userSide}
          strictness={strictness}
          index={visiblePoints.findIndex((p) => p.id === selectedPoint.id)}
          total={visiblePoints.length}
          onClose={() => setActivePointId(null)}
          onPrev={() =>
            goToIndex(
              visiblePoints.findIndex((p) => p.id === selectedPoint.id) - 1
            )
          }
          onNext={() =>
            goToIndex(
              visiblePoints.findIndex((p) => p.id === selectedPoint.id) + 1
            )
          }
          onPointUpdate={(patch) => updatePoint(selectedPoint.id, patch)}
          onNoteAdded={(note) => setNotes((ns) => [...ns, note])}
          onDelete={(p) => void deletePoint(p)}
          onSplit={addSplitPoint}
          onClipEdited={scheduleReclip}
        />
      )}

      {/* undo snackbar for "Not a point" */}
      {snackbar && (
        <div className="fixed inset-x-0 bottom-24 z-[70] flex justify-center px-4 md:bottom-6">
          <div className="flex items-center gap-4 rounded-full border border-edge bg-surface px-5 py-3 shadow-2xl">
            <span className="text-sm text-zinc-200">{snackbar.text}</span>
            <button
              type="button"
              onClick={() => void undoDelete(snackbar.pointId)}
              className="text-sm font-semibold text-cyan-glow hover:underline"
            >
              Undo
            </button>
            <button
              type="button"
              onClick={dismissSnackbar}
              aria-label="Dismiss"
              className="text-zinc-500 transition-colors hover:text-zinc-300"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
