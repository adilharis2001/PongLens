"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Point } from "@/lib/types";
import type { MatchScore } from "./gameScore";
import { armedPointId, cutEnd, playingPointId } from "./playhead";
import type { MatchServer, ServeInfo } from "./serving";

/**
 * The Player: ONE takeover playback surface that owns the ONLY
 * match-footage <video> on the page.
 *
 * Closed, it renders as a poster-style preview inside the full-video card
 * (paused first frame + play affordance — it never plays inline). Open,
 * it becomes a 100dvh takeover in one of two modes:
 *   - WATCH: video + chrome (point chips, scrub bar, speed, play/pause).
 *   - SCORE: the Keep-score pad (ticker, You/Them buttons, undo/let/star,
 *     game overlays, summary + skipped review) below the same video.
 *
 * The video element is never remounted between states — only classes
 * change — so entry taps can call video.play() synchronously (iOS
 * autoplay requires the user-gesture call stack) and currentTime survives
 * exits/re-entries. Winner taps resolve their target AT TAP TIME from
 * video.currentTime via the playhead resolvers, so scoring works while
 * paused, right after re-entry with zero timeupdate events, and after any
 * seek. No fullscreen APIs, ever: the takeover at 100dvh IS fullscreen
 * (iPhone's native fullscreen player would take over otherwise).
 */

const SPEEDS = [1, 1.5, 2] as const;

/** Single-tap vs double-tap vs press-and-hold disambiguation windows. */
const HOLD_MS = 250;
const DOUBLE_TAP_MS = 250;

type Mode = "watch" | "score";
type Phase = "play" | "summary" | "review";

interface UndoEntry {
  pointId: string;
  prevWinner: "user" | "opponent" | null;
  prevLet: boolean;
}

function isUnscored(p: Point) {
  return !p.is_let && p.confirmed_winner === null && p.cut_t0 !== null;
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return "0:00";
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export interface PlayerHandle {
  /** Open the takeover in watch mode; optionally seek first (cut-video s). */
  openWatch: (seekT?: number) => void;
  /** Open the takeover in score mode (resumes at the first unscored point). */
  openScore: () => void;
}

export const Player = forwardRef<
  PlayerHandle,
  {
    matchId: string;
    /** Visible timeline points, in display order. */
    points: Point[];
    /** Owner with cut offsets: may enter score mode. Coaches: watch only. */
    canScore: boolean;
    opponentName: string;
    firstServer: MatchServer | null;
    serveGuess: MatchServer | null;
    serving: Map<string, ServeInfo>;
    score: MatchScore;
    onSaveFirstServer: (v: MatchServer) => void;
    onSetWinner: (point: Point, value: "user" | "opponent" | null) => void;
    onSetLet: (point: Point, value: boolean) => void;
    onSetServer: (point: Point, value: "user" | "opponent") => void;
    onToggleStar: (point: Point) => void;
    /** Open a point's detail view (the transient chip pill uses it). */
    onOpenPoint: (pointId: string) => void;
    /** Mirrors open/closed so the page can hide its floating score pill. */
    onOpenChange: (open: boolean) => void;
  }
>(function Player(
  {
    matchId,
    points,
    canScore,
    opponentName,
    firstServer,
    serveGuess,
    serving,
    score,
    onSaveFirstServer,
    onSetWinner,
    onSetLet,
    onSetServer,
    onToggleStar,
    onOpenPoint,
    onOpenChange,
  },
  ref
) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const open = mode !== null;

  // Playhead mirror for DISPLAY (chips, armed chip, pre-lit buttons).
  // Updated by media events and optimistically by every programmatic seek,
  // so the UI is right even before any timeupdate fires. Tap TARGETING
  // reads video.currentTime directly (see resolveTargetPoint).
  const [playheadT, setPlayheadT] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState<{ s: number; e: number }[]>([]);
  const [paused, setPaused] = useState(true);
  const [speedIdx, setSpeedIdx] = useState(0);

  // Chrome visibility: single tap toggles, auto-hides while playing.
  const [controlsVisible, setControlsVisible] = useState(true);
  const [controlsNonce, setControlsNonce] = useState(0);
  const showControls = useCallback(() => {
    setControlsVisible(true);
    setControlsNonce((n) => n + 1);
  }, []);

  // Score-mode session state.
  const [phase, setPhase] = useState<Phase>("play");
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [serveSheet, setServeSheet] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const [boundary, setBoundary] = useState<{
    game: number;
    you: number;
    them: number;
  } | null>(null);
  const [reviewIds, setReviewIds] = useState<string[]>([]);
  const [reviewIdx, setReviewIdx] = useState(0);

  // Gesture feedback.
  const [flash, setFlash] = useState<{ label: string; key: number } | null>(
    null
  );
  const flashTimer = useRef<number | null>(null);
  const [holding2x, setHolding2x] = useState(false);

  // Transient "Open point N →" pill after a chip tap (3s auto-dismiss).
  const [pill, setPill] = useState<{
    id: string;
    n: number;
    shownAt: number;
  } | null>(null);
  const pillTimer = useRef<number | null>(null);

  const themLabel = opponentName.trim() || "Them";
  const hasChips = points.some((p) => p.cut_t0 !== null);

  // Latest points for stable callbacks/effects that shouldn't re-run on
  // every optimistic points update.
  const pointsRef = useRef(points);
  pointsRef.current = points;

  const indexById = useMemo(() => {
    const m = new Map<string, number>();
    points.forEach((p, i) => m.set(p.id, i));
    return m;
  }, [points]);

  // ---------------------------------------------------------------- media

  // Presigned preview URL of the cut video (the poster needs it too).
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
        // Poster stays on its loading state.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [matchId]);

  // Seeks requested before metadata is in are applied on loadedmetadata.
  const pendingSeek = useRef<number | null>(null);

  const seekTo = useCallback((t: number) => {
    const clamped = Math.max(0, t);
    setPlayheadT(clamped);
    const v = videoRef.current;
    if (v && v.readyState >= 1) v.currentTime = clamped;
    else pendingSeek.current = clamped;
  }, []);

  const playNow = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = SPEEDS[speedIdx];
    void v.play().catch(() => undefined);
  }, [speedIdx]);

  const onLoadedMetadata = useCallback((v: HTMLVideoElement) => {
    setDuration(v.duration || 0);
    if (pendingSeek.current !== null) {
      v.currentTime = pendingSeek.current;
      pendingSeek.current = null;
    } else if (v.currentTime === 0) {
      // Nudge iOS to paint the first frame as the poster.
      v.currentTime = 0.001;
    }
  }, []);

  const reviewPoint =
    phase === "review"
      ? (points.find((p) => p.id === reviewIds[reviewIdx]) ?? null)
      : null;

  const onTime = useCallback(
    (v: HTMLVideoElement) => {
      setPlayheadT(v.currentTime);
      // Review clips stop at the reviewed point's end.
      if (phase === "review" && reviewPoint) {
        const end = cutEnd(reviewPoint);
        if (end !== null && v.currentTime >= end) v.pause();
      }
    },
    [phase, reviewPoint]
  );

  const onProgress = useCallback((v: HTMLVideoElement) => {
    const b = v.buffered;
    const ranges: { s: number; e: number }[] = [];
    for (let i = 0; i < b.length; i++) ranges.push({ s: b.start(i), e: b.end(i) });
    setBuffered(ranges);
  }, []);

  // ------------------------------------------------------- playhead points

  const playingId = useMemo(
    () => playingPointId(points, playheadT),
    [points, playheadT]
  );
  const armedId = useMemo(
    () => armedPointId(points, playheadT),
    [points, playheadT]
  );
  const armedPoint = armedId
    ? (points.find((p) => p.id === armedId) ?? null)
    : null;
  const playingPoint = playingId
    ? (points.find((p) => p.id === playingId) ?? null)
    : null;

  // Display target: what the pad's chip + buttons reflect. Same precedence
  // as tap-time resolution so what you see is what a tap scores.
  const displayTarget =
    phase === "review" ? reviewPoint : (armedPoint ?? playingPoint);

  /**
   * BULLETPROOF tap targeting: compute the scored point AT TAP TIME from
   * video.currentTime — armed (rally end crossed, incl. past the last
   * point) ?? playing (mid-rally) ?? null. Works paused, works on
   * re-entry with zero media events, works right after any seek.
   */
  const resolveTargetPoint = useCallback((): Point | null => {
    if (phase === "review") {
      const ps = pointsRef.current;
      return ps.find((p) => p.id === reviewIds[reviewIdx]) ?? null;
    }
    const ps = pointsRef.current;
    const v = videoRef.current;
    const t = v && v.readyState >= 1 ? v.currentTime : playheadT;
    const id = armedPointId(ps, t) ?? playingPointId(ps, t);
    return id ? (ps.find((p) => p.id === id) ?? null) : null;
  }, [phase, reviewIds, reviewIdx, playheadT]);

  // Serve ball: the server of the rally currently on screen.
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

  // ------------------------------------------------------------ open/close

  const openChangeRef = useRef(onOpenChange);
  openChangeRef.current = onOpenChange;
  const modeRef = useRef<Mode | null>(null);
  modeRef.current = mode;

  const openTakeover = useCallback((m: Mode) => {
    if (modeRef.current === null) {
      window.history.pushState({ player: true }, "");
      openChangeRef.current(true);
    }
    modeRef.current = m;
    setMode(m);
    setControlsVisible(true);
  }, []);

  // popstate (browser/OS Back or our own history.back) closes the takeover.
  useEffect(() => {
    if (!open) return;
    const onPop = () => {
      videoRef.current?.pause();
      setMode(null);
      setServeSheet(false);
      setPhase("play");
      setPill(null);
      openChangeRef.current(false);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [open]);

  const exit = useCallback(() => {
    window.history.back();
  }, []);

  // Lock page scroll while the takeover is up.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const showToast = useCallback((text: string, ms = 1500) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = window.setTimeout(() => setToast(null), ms);
  }, []);

  const openWatch = useCallback(
    (seekT?: number) => {
      if (typeof seekT === "number") seekTo(seekT);
      openTakeover("watch");
      // Synchronous in the entry tap's call stack — iOS autoplay allows it.
      playNow();
    },
    [seekTo, openTakeover, playNow]
  );

  // Resume toast is deferred while the serve sheet is up.
  const resumeToastRef = useRef<string | null>(null);

  const gamesCount = score.games.length;
  const prevGamesRef = useRef(gamesCount);

  const openScore = useCallback(() => {
    // Fresh scoring session (the component itself never unmounts).
    setUndoStack([]);
    setPhase("play");
    setReviewIds([]);
    setReviewIdx(0);
    prevGamesRef.current = gamesCount;
    // Resume where scoring stopped: the first unscored point.
    const ps = pointsRef.current;
    const first = ps.find(isUnscored);
    const i = first ? ps.indexOf(first) : -1;
    resumeToastRef.current = null;
    if (first && i > 0 && first.cut_t0 !== null) {
      seekTo(Number(first.cut_t0));
      resumeToastRef.current = `Resuming from point ${i + 1}`;
    }
    openTakeover("score");
    if (firstServer === null) {
      setServeSheet(true);
      return; // playback starts from the serve-sheet answer tap
    }
    if (resumeToastRef.current) showToast(resumeToastRef.current);
    playNow();
  }, [gamesCount, seekTo, openTakeover, firstServer, showToast, playNow]);

  useImperativeHandle(ref, () => ({ openWatch, openScore }), [
    openWatch,
    openScore,
  ]);

  const answerServeSheet = useCallback(
    (v: MatchServer | null) => {
      if (v) onSaveFirstServer(v);
      setServeSheet(false);
      if (resumeToastRef.current) showToast(resumeToastRef.current);
      playNow(); // the answer tap is the user gesture
    },
    [onSaveFirstServer, showToast, playNow]
  );

  // ------------------------------------------------------------- controls

  const togglePause = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) playNow();
    else v.pause();
  }, [playNow]);

  const cycleSpeed = useCallback(() => {
    setSpeedIdx((i) => {
      const next = (i + 1) % SPEEDS.length;
      const v = videoRef.current;
      if (v) v.playbackRate = SPEEDS[next];
      return next;
    });
    showControls();
  }, [showControls]);

  // Auto-hide the chrome ~2.5s into uninterrupted playback.
  useEffect(() => {
    if (!open || !controlsVisible || paused) return;
    const id = window.setTimeout(() => setControlsVisible(false), 2500);
    return () => window.clearTimeout(id);
  }, [open, controlsVisible, paused, controlsNonce]);

  const dismissPill = useCallback(() => {
    if (pillTimer.current) window.clearTimeout(pillTimer.current);
    pillTimer.current = null;
    setPill(null);
  }, []);

  const showPill = useCallback((id: string, n: number) => {
    if (pillTimer.current) window.clearTimeout(pillTimer.current);
    setPill({ id, n, shownAt: Date.now() });
    pillTimer.current = window.setTimeout(() => {
      pillTimer.current = null;
      setPill(null);
    }, 3000);
  }, []);

  const tapChip = useCallback(
    (p: Point, n: number) => {
      if (p.cut_t0 === null) return;
      seekTo(Number(p.cut_t0));
      playNow();
      showPill(p.id, n);
      showControls();
    },
    [seekTo, playNow, showPill, showControls]
  );

  // ------------------------------------------------------------- gestures

  const gesture = useRef<{
    holdTimer: number | null;
    holding: boolean;
    priorRate: number;
    singleTimer: number | null;
    lastTapAt: number;
    downX: number;
    width: number;
  }>({
    holdTimer: null,
    holding: false,
    priorRate: 1,
    singleTimer: null,
    lastTapAt: 0,
    downX: 0,
    width: 1,
  });

  const showFlash = useCallback((label: string) => {
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    setFlash({ label, key: Date.now() });
    flashTimer.current = window.setTimeout(() => setFlash(null), 700);
  }, []);

  /** Double-tap: right half → next point's cut_t0, left half → previous. */
  const doubleTapSeek = useCallback(
    (forward: boolean) => {
      const ps = pointsRef.current;
      const cutPoints = ps.filter((p) => p.cut_t0 !== null);
      if (cutPoints.length === 0) return;
      const v = videoRef.current;
      const t = v && v.readyState >= 1 ? v.currentTime : playheadT;
      const curId = playingPointId(ps, t);
      const curIdx = curId
        ? cutPoints.findIndex((p) => p.id === curId)
        : -1;
      const target = forward
        ? (cutPoints[curIdx + 1] ?? null)
        : curIdx > 0
          ? cutPoints[curIdx - 1]
          : cutPoints[0];
      if (!target) return;
      seekTo(Number(target.cut_t0));
      showFlash(`Point ${(indexById.get(target.id) ?? 0) + 1}`);
    },
    [playheadT, seekTo, showFlash, indexById]
  );

  const endHold = useCallback(() => {
    const g = gesture.current;
    if (g.holdTimer) {
      window.clearTimeout(g.holdTimer);
      g.holdTimer = null;
    }
    if (g.holding) {
      g.holding = false;
      const v = videoRef.current;
      if (v) v.playbackRate = g.priorRate;
      setHolding2x(false);
      return true;
    }
    return false;
  }, []);

  const onVideoPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const g = gesture.current;
      const rect = e.currentTarget.getBoundingClientRect();
      g.downX = e.clientX - rect.left;
      g.width = rect.width;
      if (g.holdTimer) window.clearTimeout(g.holdTimer);
      // Press-and-hold ~250ms → 2x while held.
      g.holdTimer = window.setTimeout(() => {
        g.holdTimer = null;
        g.holding = true;
        const v = videoRef.current;
        g.priorRate = v ? v.playbackRate : SPEEDS[speedIdx];
        if (v) v.playbackRate = 2;
        setHolding2x(true);
      }, HOLD_MS);
    },
    [speedIdx]
  );

  const onVideoPointerUp = useCallback(() => {
    const g = gesture.current;
    if (endHold()) return; // hold released: no tap
    const now = Date.now();
    if (now - g.lastTapAt < DOUBLE_TAP_MS + 50) {
      // Double tap.
      if (g.singleTimer) {
        window.clearTimeout(g.singleTimer);
        g.singleTimer = null;
      }
      g.lastTapAt = 0;
      doubleTapSeek(g.downX > g.width / 2);
      return;
    }
    g.lastTapAt = now;
    if (g.singleTimer) window.clearTimeout(g.singleTimer);
    // Single tap (after the double-tap window): toggle the chrome.
    g.singleTimer = window.setTimeout(() => {
      g.singleTimer = null;
      setControlsVisible((vis) => !vis);
      setControlsNonce((n) => n + 1);
    }, DOUBLE_TAP_MS);
  }, [endHold, doubleTapSeek]);

  const onVideoPointerCancel = useCallback(() => {
    endHold();
  }, [endHold]);

  // ------------------------------------------------------------ scrub bar

  const scrubRef = useRef<HTMLDivElement | null>(null);
  const scrubbing = useRef(false);

  const scrubToClientX = useCallback(
    (clientX: number) => {
      const el = scrubRef.current;
      if (!el || duration <= 0) return;
      const rect = el.getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      seekTo(frac * duration);
    },
    [duration, seekTo]
  );

  const onScrubDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Capture is best-effort; tap-to-seek still works without it.
      }
      scrubbing.current = true;
      scrubToClientX(e.clientX);
      showControls();
    },
    [scrubToClientX, showControls]
  );
  const onScrubMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!scrubbing.current) return;
      scrubToClientX(e.clientX);
    },
    [scrubToClientX]
  );
  const onScrubUp = useCallback(() => {
    scrubbing.current = false;
  }, []);

  // --------------------------------------------------------- score-mode ops

  const nextReview = useCallback(() => {
    if (reviewIdx + 1 >= reviewIds.length) setPhase("summary");
    else setReviewIdx(reviewIdx + 1);
  }, [reviewIdx, reviewIds.length]);
  const nextReviewRef = useRef(nextReview);
  nextReviewRef.current = nextReview;

  const tapSide = useCallback(
    (side: "user" | "opponent") => {
      const p = resolveTargetPoint();
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
    [resolveTargetPoint, onSetWinner, phase]
  );

  const tapLet = useCallback(() => {
    const p = resolveTargetPoint();
    if (!p || p.is_let) return;
    setUndoStack((s) => [
      ...s,
      { pointId: p.id, prevWinner: p.confirmed_winner, prevLet: p.is_let },
    ]);
    onSetLet(p, true);
    showFlash("Let · not scored");
    if (phase === "review") {
      window.setTimeout(() => nextReviewRef.current(), 400);
      return;
    }
    // A let doesn't count — jump straight to the next rally.
    const ps = pointsRef.current;
    const next = ps.find(
      (pt) =>
        pt.cut_t0 !== null &&
        p.cut_t0 !== null &&
        Number(pt.cut_t0) > Number(p.cut_t0)
    );
    if (next?.cut_t0 != null) {
      seekTo(Number(next.cut_t0));
      playNow();
    }
  }, [resolveTargetPoint, onSetLet, phase, showFlash, seekTo, playNow]);

  // Serve ball tap: flip who served the rally on screen. The override
  // re-anchors the ITTF rotation, so every later point recomputes too.
  const flipServer = useCallback(() => {
    if (!currentRallyId || !server) return;
    const p = pointsRef.current.find((pt) => pt.id === currentRallyId);
    if (!p) return;
    const next = server === "user" ? "opponent" : "user";
    onSetServer(p, next);
    showFlash(next === "user" ? "You serve" : `${themLabel} serves`);
  }, [currentRallyId, server, onSetServer, showFlash, themLabel]);

  const undo = useCallback(() => {
    const e = undoStack[undoStack.length - 1];
    if (!e) return;
    setUndoStack((s) => s.slice(0, -1));
    const p = pointsRef.current.find((pt) => pt.id === e.pointId);
    if (!p) return;
    if (p.confirmed_winner !== e.prevWinner) onSetWinner(p, e.prevWinner);
    if (p.is_let !== e.prevLet) onSetLet(p, e.prevLet);
    // Seek back to the undone point so it plays out and re-arms.
    if (p.cut_t0 !== null && phase !== "review") {
      seekTo(Number(p.cut_t0));
      playNow();
    }
  }, [undoStack, onSetWinner, onSetLet, phase, seekTo, playNow]);

  const starTarget = displayTarget;
  const tapStar = useCallback(() => {
    const p = phase === "review" ? reviewPoint : resolveTargetPoint();
    if (p) onToggleStar(p);
  }, [phase, reviewPoint, resolveTargetPoint, onToggleStar]);

  const startReview = useCallback(() => {
    const ids = skipped.map((p) => p.id);
    if (ids.length === 0) return;
    setReviewIds(ids);
    setReviewIdx(0);
    setPhase("review");
  }, [skipped]);

  // Seek to the reviewed point whenever review advances. Reads points via
  // ref so a score tap (points identity change) never re-seeks/loops the
  // clip — only phase/index changes move the playhead.
  useEffect(() => {
    if (phase !== "review") return;
    const p = pointsRef.current.find((pt) => pt.id === reviewIds[reviewIdx]);
    if (!p || p.cut_t0 === null) return;
    seekTo(Number(p.cut_t0));
    playNow();
  }, [phase, reviewIdx, reviewIds, seekTo, playNow]);

  // Game boundary: a tap just completed a game → 1.2s overlay. Guarded by
  // a scalar previous-count so unrelated score recomputes never replay it.
  useEffect(() => {
    const prev = prevGamesRef.current;
    prevGamesRef.current = gamesCount;
    if (gamesCount <= prev || mode !== "score") return;
    const g = score.games[gamesCount - 1];
    setBoundary({ game: gamesCount, you: g.you, them: g.them });
    const id = window.setTimeout(() => setBoundary(null), 1200);
    return () => window.clearTimeout(id);
  }, [gamesCount, mode, score.games]);

  // Desktop keys. Space works in both modes; scoring keys in score mode.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (serveSheet || e.repeat) return;
      const t = e.target;
      if (t instanceof HTMLElement && t.closest("input, textarea, select"))
        return;
      if (e.key === " ") {
        e.preventDefault();
        togglePause();
        return;
      }
      if (mode !== "score") return;
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
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, mode, serveSheet, tapSide, undo, tapLet, tapStar, togglePause]);

  // Final line: games won, then each game's score (current game if live).
  const finalLine = useMemo(() => {
    const parts = score.games.map((g) => `${g.you}-${g.them}`);
    if (score.current.you + score.current.them > 0) {
      parts.push(`${score.current.you}-${score.current.them}`);
    }
    if (parts.length === 0) return null;
    return `${score.gamesYou}-${score.gamesThem} · ${parts.join(" ")}`;
  }, [score]);

  const target = displayTarget;
  const targetIdx = target ? (indexById.get(target.id) ?? -1) : -1;
  const litYou =
    !!target && !target.is_let && target.confirmed_winner === "user";
  const litThem =
    !!target && !target.is_let && target.confirmed_winner === "opponent";
  const canTap = !!target;

  const progressPct = duration > 0 ? (playheadT / duration) * 100 : 0;

  // ------------------------------------------------------------------ UI

  const videoAreaClass =
    mode === null
      ? "relative aspect-video w-full bg-black"
      : mode === "watch"
        ? "relative min-h-0 w-full flex-1 bg-black"
        : "relative mx-auto aspect-video max-h-[45dvh] w-full max-w-3xl shrink-0 bg-black";

  return (
    <div
      className={
        open ? "fixed inset-0 z-[80] flex flex-col bg-ink" : "relative"
      }
      style={
        open ? { paddingBottom: "env(safe-area-inset-bottom)" } : undefined
      }
    >
      {/* --------------------------------------------------- video area */}
      <div className={videoAreaClass}>
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            playsInline
            preload="metadata"
            onLoadedMetadata={(e) => onLoadedMetadata(e.currentTarget)}
            onTimeUpdate={(e) => onTime(e.currentTarget)}
            onProgress={(e) => onProgress(e.currentTarget)}
            onSeeked={(e) => setPlayheadT(e.currentTarget.currentTime)}
            onPlay={(e) => {
              setPaused(false);
              e.currentTarget.playbackRate = gesture.current.holding
                ? 2
                : SPEEDS[speedIdx];
              // Playback resuming clearly after the pill appeared dismisses
              // it (the chip tap that showed it also starts playback).
              setPill((cur) =>
                cur && Date.now() - cur.shownAt > 600 ? null : cur
              );
            }}
            onPause={() => {
              setPaused(true);
              setControlsVisible(true);
            }}
            onEnded={() => {
              if (mode === "score" && phase === "play") setPhase("summary");
            }}
            className="h-full w-full bg-black object-contain"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <p className="text-xs text-zinc-600">Loading preview…</p>
          </div>
        )}

        {/* poster affordance: the video NEVER plays inline on the page */}
        {!open && videoUrl && (
          <button
            type="button"
            onClick={() => openWatch()}
            aria-label="Play the full video"
            className="group absolute inset-0 flex items-center justify-center"
          >
            <span className="rounded-full border border-white/15 bg-ink/60 p-4 backdrop-blur-sm transition-all group-hover:bg-ink/80 group-active:scale-95">
              <svg
                viewBox="0 0 24 24"
                className="h-8 w-8 text-white"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M8 5.5v13l11-6.5-11-6.5Z" />
              </svg>
            </span>
          </button>
        )}

        {open && (
          <>
            {/* gesture surface: tap / double-tap / press-and-hold */}
            <div
              className="absolute inset-0 select-none"
              style={{ touchAction: "manipulation" }}
              onPointerDown={onVideoPointerDown}
              onPointerUp={onVideoPointerUp}
              onPointerCancel={onVideoPointerCancel}
              onPointerLeave={onVideoPointerCancel}
              onContextMenu={(e) => e.preventDefault()}
            />

            {/* paused glyph */}
            {paused && !serveSheet && phase !== "summary" && (
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

            {/* double-tap point flash */}
            {flash && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <span
                  key={flash.key}
                  className="ks-fade rounded-full border border-cyan-glow/60 bg-cyan-glow/15 px-4 py-2 text-sm font-semibold tabular-nums text-cyan-glow backdrop-blur-sm"
                >
                  {flash.label}
                </span>
              </div>
            )}

            {/* press-and-hold 2x indicator */}
            {holding2x && (
              <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
                <span className="ks-fade rounded-full border border-edge bg-ink/85 px-3 py-1 text-xs font-semibold tabular-nums text-zinc-200 backdrop-blur">
                  2x ▶
                </span>
              </div>
            )}

            {/* game boundary: 1.2s, then gone */}
            {boundary && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <p className="ks-fade rounded-2xl border border-edge bg-ink/85 px-6 py-4 text-xl font-bold tabular-nums backdrop-blur-md">
                  Game {boundary.game} ·{" "}
                  <span className="text-cyan-glow">{boundary.you}</span>
                  <span className="text-zinc-600">-</span>
                  <span className="text-magenta-soft">{boundary.them}</span>
                </p>
              </div>
            )}

            {/* resume / info toast */}
            {toast && (
              <div className="pointer-events-none absolute inset-x-0 bottom-24 flex justify-center">
                <p className="ks-fade rounded-full border border-edge bg-ink/85 px-4 py-1.5 text-xs text-zinc-300 backdrop-blur">
                  {toast}
                </p>
              </div>
            )}

            {/* transient "Open point N →" pill (chip-row companion) */}
            {pill && (
              <div className="absolute inset-x-0 bottom-24 z-10 flex justify-center">
                <button
                  type="button"
                  onClick={() => {
                    const id = pill.id;
                    dismissPill();
                    // Open the point only once Back has landed on the match
                    // page's history entry, so the ?p= sync sticks to it.
                    const openIt = onOpenPoint;
                    window.addEventListener(
                      "popstate",
                      () => window.setTimeout(() => openIt(id), 0),
                      { once: true }
                    );
                    exit();
                  }}
                  className="ks-fade whitespace-nowrap rounded-full border border-cyan-glow/50 bg-ink/90 px-4 py-2 text-xs font-semibold text-cyan-glow shadow-lg shadow-black/50 backdrop-blur-md"
                >
                  Open point {pill.n} →
                </button>
              </div>
            )}

            {/* ------------------------------------------------ chrome */}
            <div
              className={`absolute inset-x-0 top-0 flex items-center justify-between p-2 transition-opacity duration-200 ${
                controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"
              }`}
              style={{
                background:
                  "linear-gradient(to bottom, rgba(10,10,15,.7), transparent)",
              }}
            >
              <button
                type="button"
                onClick={exit}
                aria-label="Close player"
                className="rounded-full border border-edge bg-ink/70 p-2 text-zinc-300 backdrop-blur transition-colors hover:text-white"
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
              {mode === "watch" && canScore && (
                <button
                  type="button"
                  onClick={openScore}
                  className="rounded-full border border-cyan-glow/50 bg-ink/70 px-3.5 py-1.5 text-xs font-semibold text-cyan-glow backdrop-blur transition-colors hover:bg-cyan-glow/10"
                >
                  Keep score
                </button>
              )}
            </div>

            <div
              className={`absolute inset-x-0 bottom-0 transition-opacity duration-200 ${
                controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"
              }`}
              style={{
                background:
                  "linear-gradient(to top, rgba(10,10,15,.85), transparent)",
              }}
            >
              {/* Go to point chips */}
              {hasChips && (
                <div className="flex gap-1.5 overflow-x-auto px-3 pb-1 pt-3">
                  {points.map((p, i) =>
                    p.cut_t0 === null ? null : (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => tapChip(p, i + 1)}
                        aria-label={`Go to point ${i + 1}`}
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums transition-colors ${
                          playingId === p.id
                            ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                            : "border-edge bg-ink/40 text-zinc-400 hover:border-cyan-glow/40"
                        }`}
                      >
                        {i + 1}
                      </button>
                    )
                  )}
                </div>
              )}

              {/* transport row: play/pause · time · scrub · time · speed */}
              <div className="flex items-center gap-2 px-3 pb-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    togglePause();
                    showControls();
                  }}
                  aria-label={paused ? "Play" : "Pause"}
                  className="shrink-0 rounded-full p-1.5 text-white"
                >
                  {paused ? (
                    <svg
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path d="M8 5.5v13l11-6.5-11-6.5Z" />
                    </svg>
                  ) : (
                    <svg
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />
                    </svg>
                  )}
                </button>
                <span className="shrink-0 text-[10px] tabular-nums text-zinc-400">
                  {formatTime(playheadT)}
                </span>
                <div
                  ref={scrubRef}
                  role="slider"
                  aria-label="Seek"
                  aria-valuemin={0}
                  aria-valuemax={Math.round(duration)}
                  aria-valuenow={Math.round(playheadT)}
                  className="relative flex h-8 min-w-0 flex-1 cursor-pointer items-center"
                  style={{ touchAction: "none" }}
                  onPointerDown={onScrubDown}
                  onPointerMove={onScrubMove}
                  onPointerUp={onScrubUp}
                  onPointerCancel={onScrubUp}
                >
                  <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/15">
                    {duration > 0 &&
                      buffered.map((b, i) => (
                        <span
                          key={i}
                          className="absolute inset-y-0 bg-white/20"
                          style={{
                            left: `${(b.s / duration) * 100}%`,
                            width: `${((b.e - b.s) / duration) * 100}%`,
                          }}
                        />
                      ))}
                    <span
                      className="absolute inset-y-0 left-0 bg-cyan-glow"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                  <span
                    className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 rounded-full bg-cyan-glow shadow-[0_0_8px_rgba(34,211,238,0.7)]"
                    style={{ left: `${progressPct}%` }}
                  />
                </div>
                <span className="shrink-0 text-[10px] tabular-nums text-zinc-400">
                  {formatTime(duration)}
                </span>
                <button
                  type="button"
                  onClick={cycleSpeed}
                  aria-label="Playback speed"
                  className="shrink-0 rounded-full border border-edge bg-ink/60 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-zinc-200"
                >
                  {SPEEDS[speedIdx]}x
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ------------------------------------------------- score mode */}
      {open && mode === "score" && (
        <>
          {/* ticker: serve ball · armed chip · score · games pill */}
          <div className="mx-auto flex w-full max-w-3xl shrink-0 items-center border-b border-edge/60 px-3 py-2">
            <span className="flex w-7 justify-start">
              {server === "user" && (
                <button
                  type="button"
                  onClick={flipServer}
                  aria-label="You serve — tap to switch server"
                  className="-m-2 p-2"
                >
                  <span className="serve-ball block h-3.5 w-3.5 rounded-full" />
                </button>
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
            <span className="flex w-7 justify-end">
              {server === "opponent" && (
                <button
                  type="button"
                  onClick={flipServer}
                  aria-label={`${themLabel} serves — tap to switch server`}
                  className="-m-2 p-2"
                >
                  <span className="serve-ball block h-3.5 w-3.5 rounded-full" />
                </button>
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
                {/* mode toggle: X on the pad ↔ the watch-mode pill */}
                <button
                  type="button"
                  onClick={() => setMode("watch")}
                  aria-label="Close the scoring pad"
                  className="rounded-full border border-edge bg-surface p-2.5 text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white"
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
        </>
      )}

      {/* step 0: only when the match has no first server yet */}
      {open && serveSheet && (
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

      {/* end of video (score mode) */}
      {open && phase === "summary" && (
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
              onClick={exit}
              className="glow-cta mt-6 w-full rounded-full bg-cyan-glow px-4 py-2.5 text-sm font-semibold text-ink"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
});
