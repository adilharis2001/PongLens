"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Point } from "@/lib/types";
import type { MatchScore } from "./gameScore";
import { armedPointId, cutEnd, playingPointId } from "./playhead";
import type { MatchServer, ServeInfo } from "./serving";

/**
 * Keep-score mode: full-screen takeover over the cut video. The video
 * plays; when a point's rally ends it becomes the ARMED point (same
 * playhead resolver family as the Go-to-point chips); one tap on the big
 * You/opponent buttons scores it. Score, serve dot and game boundaries
 * all derive live from the same confirmed-winner data as the match page.
 */

const SPEEDS = [1, 1.5, 2] as const;

interface UndoEntry {
  pointId: string;
  prevWinner: "user" | "opponent" | null;
  prevLet: boolean;
}

function isUnscored(p: Point) {
  return !p.is_let && p.confirmed_winner === null && p.cut_t0 !== null;
}

export function KeepScore({
  matchId,
  points,
  opponentName,
  firstServer,
  serveGuess,
  serving,
  score,
  onSaveFirstServer,
  onSetWinner,
  onSetLet,
  onToggleStar,
  onExit,
}: {
  matchId: string;
  /** Visible timeline points, in display order. */
  points: Point[];
  opponentName: string;
  firstServer: MatchServer | null;
  serveGuess: MatchServer | null;
  serving: Map<string, ServeInfo>;
  score: MatchScore;
  onSaveFirstServer: (v: MatchServer) => void;
  onSetWinner: (point: Point, value: "user" | "opponent" | null) => void;
  onSetLet: (point: Point, value: boolean) => void;
  onToggleStar: (point: Point) => void;
  onExit: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [phase, setPhase] = useState<"play" | "summary" | "review">("play");
  const [armedId, setArmedId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [speedIdx, setSpeedIdx] = useState(0);
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [serveSheet, setServeSheet] = useState(firstServer === null);
  const [toast, setToast] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<{
    game: number;
    you: number;
    them: number;
  } | null>(null);
  const [paused, setPaused] = useState(true);
  const [reviewIds, setReviewIds] = useState<string[]>([]);
  const [reviewIdx, setReviewIdx] = useState(0);

  const themLabel = opponentName.trim() || "Them";

  // Resume: start where scoring stopped — the first unscored point.
  // Computed once on mount so taps don't re-anchor it.
  const resume = useRef<{ t: number; n: number } | null>(null);
  if (resume.current === null) {
    const first = points.find(isUnscored);
    const i = first ? points.indexOf(first) : -1;
    resume.current =
      first && i > 0 ? { t: Number(first.cut_t0), n: i + 1 } : { t: 0, n: 0 };
  }

  const indexById = useMemo(() => {
    const m = new Map<string, number>();
    points.forEach((p, i) => m.set(p.id, i));
    return m;
  }, [points]);

  const armedPoint = useMemo(
    () => (armedId ? (points.find((p) => p.id === armedId) ?? null) : null),
    [armedId, points]
  );
  const reviewPoint =
    phase === "review"
      ? (points.find((p) => p.id === reviewIds[reviewIdx]) ?? null)
      : null;
  // Taps score the armed point; in review they score the reviewed point.
  const target = phase === "review" ? reviewPoint : armedPoint;
  // The star curates the point on screen: the one that just resolved, or
  // the one still playing before anything has armed.
  const playingPoint = useMemo(
    () => (playingId ? (points.find((p) => p.id === playingId) ?? null) : null),
    [playingId, points]
  );
  const starTarget = phase === "review" ? reviewPoint : (armedPoint ?? playingPoint);

  // Serve dot: the server of the rally currently on screen.
  const currentRallyId =
    playingId ?? points.find((p) => p.cut_t0 !== null)?.id ?? null;
  const server = currentRallyId
    ? (serving.get(currentRallyId)?.server ?? null)
    : null;

  const skipped = useMemo(() => points.filter(isUnscored), [points]);
  const starredCount = useMemo(
    () => points.filter((p) => p.starred).length,
    [points]
  );

  // Lock page scroll while the takeover is up.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Presigned preview URL of the cut video (same source as the match card).
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
        if (data?.url && !cancelled) setVideoUrl(data.url);
      } catch {
        // Stays on the loading state; Back exits.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [matchId]);

  const play = useCallback(() => {
    void videoRef.current?.play().catch(() => undefined);
  }, []);

  // Start playback once metadata is in and the serve sheet is answered.
  const started = useRef(false);
  const beginPlayback = useCallback(() => {
    const v = videoRef.current;
    if (!v || started.current || serveSheet) return;
    if (v.readyState < 1) return;
    started.current = true;
    const r = resume.current;
    if (r && r.n > 0) {
      v.currentTime = r.t;
      setToast(`Resuming from point ${r.n}`);
      window.setTimeout(() => setToast(null), 1500);
    }
    play();
  }, [serveSheet, play]);

  useEffect(() => {
    beginPlayback();
  }, [beginPlayback]);

  const onTime = useCallback(
    (v: HTMLVideoElement) => {
      const t = v.currentTime;
      setPlayingId(playingPointId(points, t));
      setArmedId(armedPointId(points, t));
      // Review clips stop at the reviewed point's end.
      if (phase === "review" && reviewPoint) {
        const end = cutEnd(reviewPoint);
        if (end !== null && t >= end) v.pause();
      }
    },
    [points, phase, reviewPoint]
  );

  // Game boundary: a tap just completed a game -> 1.2s overlay, no more.
  const prevGames = useRef(score.games.length);
  useEffect(() => {
    const n = score.games.length;
    if (n > prevGames.current) {
      const g = score.games[n - 1];
      setOverlay({ game: n, you: g.you, them: g.them });
      const id = window.setTimeout(() => setOverlay(null), 1200);
      prevGames.current = n;
      return () => window.clearTimeout(id);
    }
    prevGames.current = n;
  }, [score.games]);

  const nextReview = useCallback(() => {
    if (reviewIdx + 1 >= reviewIds.length) setPhase("summary");
    else setReviewIdx(reviewIdx + 1);
  }, [reviewIdx, reviewIds.length]);
  const nextReviewRef = useRef(nextReview);
  nextReviewRef.current = nextReview;

  const tapSide = useCallback(
    (side: "user" | "opponent") => {
      const p = phase === "review" ? reviewPoint : armedPoint;
      if (!p) return;
      setUndoStack((s) => [
        ...s,
        { pointId: p.id, prevWinner: p.confirmed_winner, prevLet: p.is_let },
      ]);
      onSetWinner(p, p.confirmed_winner === side ? null : side);
      if (phase === "review") {
        window.setTimeout(() => nextReviewRef.current(), 400);
      }
    },
    [phase, reviewPoint, armedPoint, onSetWinner]
  );

  const tapLet = useCallback(() => {
    const p = phase === "review" ? reviewPoint : armedPoint;
    if (!p || p.is_let) return;
    setUndoStack((s) => [
      ...s,
      { pointId: p.id, prevWinner: p.confirmed_winner, prevLet: p.is_let },
    ]);
    onSetLet(p, true);
    if (phase === "review") {
      window.setTimeout(() => nextReviewRef.current(), 400);
    }
  }, [phase, reviewPoint, armedPoint, onSetLet]);

  const undo = useCallback(() => {
    const e = undoStack[undoStack.length - 1];
    if (!e) return;
    setUndoStack((s) => s.slice(0, -1));
    const p = points.find((pt) => pt.id === e.pointId);
    if (!p) return;
    if (p.confirmed_winner !== e.prevWinner) onSetWinner(p, e.prevWinner);
    if (p.is_let !== e.prevLet) onSetLet(p, e.prevLet);
    // Seek back to the undone point so it plays out and re-arms.
    const v = videoRef.current;
    if (v && p.cut_t0 !== null && phase !== "review") {
      v.currentTime = Number(p.cut_t0);
      void v.play().catch(() => undefined);
    }
  }, [undoStack, points, onSetWinner, onSetLet, phase]);

  const tapStar = useCallback(() => {
    if (starTarget) onToggleStar(starTarget);
  }, [starTarget, onToggleStar]);

  const cycleSpeed = useCallback(() => {
    setSpeedIdx((i) => {
      const next = (i + 1) % SPEEDS.length;
      const v = videoRef.current;
      if (v) v.playbackRate = SPEEDS[next];
      return next;
    });
  }, []);

  const startReview = useCallback(() => {
    const ids = skipped.map((p) => p.id);
    if (ids.length === 0) return;
    setReviewIds(ids);
    setReviewIdx(0);
    setPhase("review");
  }, [skipped]);

  // Seek to the reviewed point whenever review advances.
  useEffect(() => {
    if (phase !== "review") return;
    const p = points.find((pt) => pt.id === reviewIds[reviewIdx]);
    const v = videoRef.current;
    if (!p || !v || p.cut_t0 === null) return;
    v.currentTime = Number(p.cut_t0);
    void v.play().catch(() => undefined);
    // points intentionally omitted: re-seeking on every tap would loop
    // the clip; only phase/index changes should move the playhead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, reviewIdx, reviewIds]);

  const togglePause = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  }, []);

  // Desktop keys: Left=You Right=Them U=undo L=let Space=pause.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (serveSheet || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select")) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        tapSide("user");
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        tapSide("opponent");
      } else if (e.key === "u" || e.key === "U") {
        undo();
      } else if (e.key === "l" || e.key === "L") {
        tapLet();
      } else if (e.key === "s" || e.key === "S") {
        tapStar();
      } else if (e.key === " ") {
        e.preventDefault();
        togglePause();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [serveSheet, tapSide, undo, tapLet, tapStar, togglePause]);

  const answerServeSheet = useCallback(
    (v: MatchServer | null) => {
      if (v) onSaveFirstServer(v);
      setServeSheet(false);
    },
    [onSaveFirstServer]
  );

  // Final line: games won, then each game's score (current game if live).
  const finalLine = useMemo(() => {
    const parts = score.games.map((g) => `${g.you}-${g.them}`);
    if (score.current.you + score.current.them > 0) {
      parts.push(`${score.current.you}-${score.current.them}`);
    }
    if (parts.length === 0) return null;
    return `${score.gamesYou}-${score.gamesThem} · ${parts.join(" ")}`;
  }, [score]);

  const targetIdx = target ? (indexById.get(target.id) ?? -1) : -1;
  const litYou = !!target && !target.is_let && target.confirmed_winner === "user";
  const litThem =
    !!target && !target.is_let && target.confirmed_winner === "opponent";
  const canTap = !!target;

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-ink">
      {/* video */}
      <div className="relative mx-auto w-full max-w-3xl shrink-0">
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            playsInline
            preload="auto"
            onLoadedMetadata={beginPlayback}
            onTimeUpdate={(e) => onTime(e.currentTarget)}
            onPlay={(e) => {
              setPaused(false);
              e.currentTarget.playbackRate = SPEEDS[speedIdx];
            }}
            onPause={() => setPaused(true)}
            onEnded={() => {
              if (phase === "play") setPhase("summary");
            }}
            onClick={togglePause}
            className="aspect-video w-full bg-black"
          />
        ) : (
          <div className="flex aspect-video items-center justify-center bg-black">
            <p className="text-xs text-zinc-600">Loading video…</p>
          </div>
        )}
        <button
          type="button"
          onClick={onExit}
          aria-label="Exit keep score"
          className="absolute left-2 top-2 rounded-full border border-edge bg-ink/70 p-2 text-zinc-300 backdrop-blur transition-colors hover:text-white"
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
        {paused && videoUrl && !serveSheet && phase === "play" && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="rounded-full bg-ink/60 p-4 backdrop-blur-sm">
              <svg
                viewBox="0 0 24 24"
                className="h-8 w-8 text-white"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M8 5.5v13l11-6.5-11-6.5Z" />
              </svg>
            </span>
          </div>
        )}
        {/* game boundary: 1.2s, then gone */}
        {overlay && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="ks-fade rounded-2xl border border-edge bg-ink/85 px-6 py-4 text-xl font-bold tabular-nums backdrop-blur-md">
              Game {overlay.game} ·{" "}
              <span className="text-cyan-glow">{overlay.you}</span>
              <span className="text-zinc-600">-</span>
              <span className="text-magenta-soft">{overlay.them}</span>
            </p>
          </div>
        )}
        {toast && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <p className="ks-fade rounded-full border border-edge bg-ink/85 px-4 py-1.5 text-xs text-zinc-300 backdrop-blur">
              {toast}
            </p>
          </div>
        )}
      </div>

      {/* ticker: armed chip · score · games · serve dot on server's side */}
      <div className="mx-auto flex w-full max-w-3xl shrink-0 items-center border-b border-edge/60 px-3 py-2">
        <span className="flex w-6 justify-start">
          {server === "user" && (
            <span className="h-2.5 w-2.5 rounded-full bg-cyan-glow glow-ring" />
          )}
        </span>
        <span className="flex h-8 w-8 items-center justify-center">
          {target && targetIdx >= 0 && (
            <span
              key={target.id}
              className="ks-arm flex h-8 w-8 items-center justify-center rounded-full border border-cyan-glow/60 bg-cyan-glow/15 text-xs font-semibold tabular-nums text-cyan-glow"
            >
              {targetIdx + 1}
            </span>
          )}
        </span>
        <span className="flex flex-1 items-baseline justify-center gap-2">
          <span
            key={`${score.current.you}-${score.current.them}`}
            className="ks-pop text-2xl font-bold tabular-nums tracking-tight"
          >
            <span className="text-cyan-glow">{score.current.you}</span>
            <span className="mx-1 text-zinc-600">-</span>
            <span className="text-magenta-soft">{score.current.them}</span>
          </span>
          {score.games.length > 0 && (
            <span className="rounded-full border border-edge bg-surface px-2 py-0.5 text-[11px] font-semibold tabular-nums text-zinc-300">
              {score.gamesYou}-{score.gamesThem}
            </span>
          )}
        </span>
        <span className="w-8" />
        <span className="flex w-6 justify-end">
          {server === "opponent" && (
            <span className="h-2.5 w-2.5 rounded-full bg-magenta-glow" />
          )}
        </span>
      </div>

      {/* pad */}
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-3 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={undo}
              disabled={undoStack.length === 0}
              aria-label="Undo last tap"
              className="rounded-full border border-edge bg-surface p-2.5 text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white disabled:opacity-40"
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
                  d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11"
                />
              </svg>
            </button>
            <button
              type="button"
              onClick={cycleSpeed}
              aria-label="Playback speed"
              className="rounded-full border border-edge bg-surface px-3 py-2 text-xs font-semibold tabular-nums text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white"
            >
              {SPEEDS[speedIdx]}x
            </button>
          </div>
          <div className="flex items-center gap-2">
            {phase === "review" && (
              <button
                type="button"
                onClick={nextReview}
                className="rounded-full border border-cyan-glow/50 bg-cyan-glow/10 px-4 py-2 text-xs font-semibold text-cyan-glow"
              >
                Next
              </button>
            )}
            <button
              type="button"
              onClick={tapStar}
              disabled={!starTarget}
              aria-label={
                starTarget?.starred ? "Remove star" : "Star this point"
              }
              aria-pressed={!!starTarget?.starred}
              className={`rounded-full border p-2.5 transition-colors disabled:opacity-40 ${
                starTarget?.starred
                  ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                  : "border-edge bg-surface text-zinc-300 hover:border-cyan-glow/50 hover:text-white"
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill={starTarget?.starred ? "currentColor" : "none"}
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
              onClick={tapLet}
              disabled={!canTap}
              className="rounded-full border border-edge bg-surface px-4 py-2 text-xs font-semibold text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white disabled:opacity-40"
            >
              Let
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 gap-3">
          <button
            type="button"
            onClick={() => tapSide("user")}
            disabled={!canTap}
            aria-pressed={litYou}
            className={`flex-1 rounded-2xl border text-2xl font-bold transition-all active:scale-[0.98] disabled:opacity-40 ${
              litYou
                ? "glow-ring border-cyan-glow bg-cyan-glow/25 text-cyan-glow"
                : "border-cyan-glow/30 bg-cyan-glow/5 text-cyan-glow"
            }`}
          >
            You
          </button>
          <button
            type="button"
            onClick={() => tapSide("opponent")}
            disabled={!canTap}
            aria-pressed={litThem}
            className={`min-w-0 flex-1 rounded-2xl border px-2 text-2xl font-bold transition-all active:scale-[0.98] disabled:opacity-40 ${
              litThem
                ? "border-magenta-glow bg-magenta-glow/25 text-magenta-soft shadow-[0_0_18px_rgba(232,121,249,0.4)]"
                : "border-magenta-glow/30 bg-magenta-glow/5 text-magenta-soft"
            }`}
          >
            <span className="block truncate">{themLabel}</span>
          </button>
        </div>

        <p className="hidden text-center text-[11px] text-zinc-600 lg:block">
          ← You · → {themLabel} · U undo · L let · S star · Space pause
        </p>
      </div>

      {/* step 0: only when the match has no first server yet */}
      {serveSheet && (
        <div className="absolute inset-0 z-10 flex items-end justify-center bg-ink/70 backdrop-blur-sm sm:items-center">
          <div className="ks-fade w-full rounded-t-2xl border border-edge bg-surface p-5 pb-8 sm:max-w-sm sm:rounded-2xl sm:pb-5">
            <h2 className="text-base font-semibold">Who served first?</h2>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {(
                [
                  { value: "user", label: "You" },
                  { value: "opponent", label: themLabel },
                ] as const
              ).map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => answerServeSheet(o.value)}
                  className={`truncate rounded-lg border px-4 py-3 text-sm font-semibold transition-colors ${
                    serveGuess === o.value
                      ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                      : "border-edge bg-ink/40 text-zinc-300 hover:border-cyan-glow/40"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => answerServeSheet(null)}
              className="mt-3 text-xs text-zinc-500 hover:text-zinc-300"
            >
              Skip
            </button>
          </div>
        </div>
      )}

      {/* end of video */}
      {phase === "summary" && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-ink/70 p-4 backdrop-blur-sm">
          <div className="ks-fade w-full max-w-sm rounded-2xl border border-edge bg-surface p-6 text-center">
            {finalLine ? (
              <p className="text-2xl font-bold tabular-nums tracking-tight">
                {finalLine}
              </p>
            ) : (
              <p className="text-sm text-zinc-400">No points scored</p>
            )}
            {skipped.length > 0 && (
              <div className="mt-4 flex items-center justify-center gap-3">
                <span className="text-sm text-zinc-400">
                  {skipped.length} skipped
                </span>
                <button
                  type="button"
                  onClick={startReview}
                  className="rounded-full border border-edge px-4 py-1.5 text-sm font-medium text-zinc-200 transition-colors hover:border-cyan-glow/50"
                >
                  Review
                </button>
              </div>
            )}
            {starredCount > 0 && (
              <p className="mt-2 text-sm text-zinc-400">
                {starredCount} starred
              </p>
            )}
            <button
              type="button"
              onClick={onExit}
              className="glow-cta mt-6 w-full rounded-full bg-cyan-glow px-4 py-2.5 text-sm font-semibold text-ink"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
