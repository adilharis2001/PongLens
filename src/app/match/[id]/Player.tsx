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
import { createClient } from "@/lib/supabase/client";
import type { Point } from "@/lib/types";
import { TIGHT_PAD, effectivePad } from "./clipEdit";
import {
  computeMatchScore,
  type GameEndOverride,
  type MatchScore,
} from "./gameScore";
import {
  armedPointId,
  cutToSource,
  paddedEnd,
  pauseEnd,
  playingPointId,
  type ClipPad,
} from "./playhead";
import type { MatchServer, ServeInfo } from "./serving";

/**
 * The Player: ONE takeover playback surface that owns the ONLY
 * match-footage <video> on the page.
 *
 * Closed, it renders as a poster-style preview inside the full-video card
 * (paused first frame + play affordance — it never plays inline). Open,
 * it becomes a 100dvh takeover in one of two modes:
 *   - WATCH: video + chrome (point chips, scrub bar, speed, play/pause).
 *   - SCORE: the Keep-score pad (ticker, You/Them buttons, undo/skip/star,
 *     game overlays, summary + unscored review) below the same video.
 *
 * The video element is never remounted between states — only classes
 * change — so entry taps can call video.play() synchronously (iOS
 * autoplay requires the user-gesture call stack) and currentTime survives
 * exits/re-entries. Winner taps resolve their target AT TAP TIME from
 * video.currentTime via the playhead resolvers, so scoring works while
 * paused, right after re-entry with zero timeupdate events, and after any
 * seek. No fullscreen APIs, ever: the takeover at 100dvh IS fullscreen
 * (iPhone's native fullscreen player would take over otherwise).
 *
 * PAUSE-AT-POINT-END (score mode, live phase): when playback crosses the
 * on-screen rally's pause boundary the video pauses — the pad's four
 * actions ARE the prompt, no extra copy. The boundary is pauseEnd():
 * cut_t0 + pad.pre + (t1 - t0) + min(pad.post, 0.6) — the rally's actual
 * end plus a beat of the post pad, so the deciding ball's landing is on
 * screen (cut_t0 is the PADDED clip start; see playhead.ts). The rules,
 * exactly:
 *   - Fires only while PLAYING in score/play, only for an UNSCORED rally
 *     (no winner, not skipped): if the user already scored it mid-rally,
 *     its end never interrupts — eager scorers flow straight through.
 *   - Fires only when the current playback run STARTED before the
 *     rally's end (runStartTRef): a rally's boundary overhangs the next
 *     rally's padded start on adjacent cuts, and a replay/resume that
 *     begins at that next start must never be hijacked by a boundary
 *     whose rally the user didn't just watch.
 *   - Once per entry into a rally's end (endPauseFiredRef), and NEVER
 *     twice at the same boundary without a real replay: the consumed
 *     boundary re-arms only when playback dips >= 1.5s BEFORE it (a
 *     deliberate scrub-back to replay the point) or when a DIFFERENT
 *     rally's boundary is crossed. A guard window also blocks any
 *     auto-pause within 0.5s of a play() start, so resuming exactly at a
 *     boundary can never wedge into pause-play-pause. Net effect:
 *     resuming from paused-at-end always plays on into the next rally.
 *   - Never in watch mode, review phase, or the same tick as a deleted-
 *     span auto-skip (that branch returns first).
 *   - The pause PINS the chip + tap targeting to the rally whose end
 *     fired (endPausedId): the corrected boundary lands ~pad.pre later
 *     than the old one, so with near-adjacent cuts the WYSIWYG resolver
 *     has flipped to the next rally BEFORE the boundary even more often —
 *     the answer must still score the rally that just ended. Resume or
 *     navigation (chevrons/double-tap/chips) releases the pin — and
 *     navigation ALWAYS auto-plays its destination in the same gesture
 *     (owner-specified): leaving a paused end via a chevron never strands
 *     a paused glyph or a wedged play button.
 *   - While paused-at-end a "Replay" pill (bottom-left over the video)
 *     seeks back to the pinned rally's cut_t0, explicitly re-arms its
 *     boundary, and plays — the replay pauses again at the same end.
 *   - ADVANCE ON ANY NEW ANSWER: an outcome entry (winner tap, Skip,
 *     Delete — taps or ArrowLeft/Right keys) on a rally that previously
 *     had NO outcome seeks to the next visible rally and plays in the
 *     same gesture, whether paused-at-end or mid-rally. CHANGING an
 *     existing outcome (toggle-off, switching winner, skipping an
 *     already-scored rally) never advances — corrections stay in place.
 *     Delete always advances (its footage is dead either way). Serve-ball
 *     and star taps are optional extras and do NOT advance. A plain tap
 *     on the video (at 1x — while zoomed, taps stay inspection-safe) or
 *     Space resumes WITHOUT scoring — the point stays unscored for the
 *     end-of-video review to catch.
 *
 * PINCH ZOOM (score mode): 1x–4x around the pinch midpoint, one-finger
 * pan while zoomed (clamped to the frame). The zoom PERSISTS across point
 * navigation, answer-advance and review steps — if the owner zoomed, the
 * camera was too far away, and with a static camera the same framing is
 * right for the whole video. The "1x" pill and pinching back out are the
 * ONLY resets (plus leaving score mode / closing the takeover — zoom is
 * a score-mode affordance). While zoomed: a single finger pans (so
 * hold-2x stays 1x-only — a hold that then moves must seamlessly become
 * a pan, and the speed control is one tap away on the pad), a double tap
 * keeps its normal meaning (prev/next point seek, zoom kept), and taps
 * resume/toggle chrome as usual. Implemented locally (ClipPlayer has its
 * own).
 *
 * SPLIT-WHILE-WATCHING (score mode, play phase): the auto-splitter
 * sometimes fuses two rallies into ONE point (the gap between them was too
 * short). The reviewer only notices mid-playback, when the SECOND serve
 * starts. The pad's Split control (scissors, in the control row) cuts the
 * CURRENT point in two AT THE PLAYHEAD, reusing the same machinery as the
 * point-detail "Split at this moment" (split_point RPC + child cut_t0,
 * migrations 020/023). The cut-time playhead maps to the split's SOURCE
 * at_t through cutToSource() (playhead.ts) — the exact inverse of the
 * cut_t0 anchoring the chip/seek already use:
 *
 *   at = max(0, A.t0 - A.effPre) + (T - A.cut_t0)      // cut time T → source
 *   child_cut_t0 = A.cut_t0 + (at - min(pad.pre, TIGHT_PAD))
 *                           - max(0, A.t0 - A.effPre)  // == T - min(pre, TIGHT_PAD)
 *
 * v1 BACKWARD-LEAD HEURISTIC: the reviewer taps a beat AFTER the new serve
 * begins, so the raw playhead is a touch late. We lead the cut back a
 * fixed SPLIT_LEAD_S (~0.6s), clamped to stay inside the point and >0.3s
 * off A.t0, landing nearer the true gap. After the split we pause at A's
 * (corrected) end, PIN targeting to A, and arm its boundary as consumed:
 * scoring A (Me/Them/Skip) advances into child B, which plays and pauses
 * at ITS end — the same pause-decide rhythm. Undo is a typed {type:'split'}
 * entry: it calls unsplit_point (migration 026), the atomic inverse —
 * hard-deletes B and restores A's t1/tight_end/edited — so the DB returns
 * byte-identical and the timeline shows one point again.
 *
 * DEFERRED refinements (documented follow-ups — NOT built here):
 *   (a) SNAP-TO-GAP: replace the fixed backward lead with a snap to the
 *       nearest low-activity gap around the tap. Needs a per-frame activity
 *       signal that isn't persisted for the cut video — a worker/API
 *       round-trip to compute and cache it. Design later; the fixed lead is
 *       the interim.
 *   (b) PASSIVE HINT: at an end-pause, surface a quiet "Looks like 2 points
 *       · Split" nudge when an internal gap is detected inside the point.
 *       Depends on the activity signal from (a).
 */

const SPEEDS = [1, 1.5, 2] as const;

/** Single-tap vs double-tap vs press-and-hold disambiguation windows. */
const HOLD_MS = 250;
const DOUBLE_TAP_MS = 250;

/** Score-mode pinch zoom ceiling (1x = no zoom). */
const ZOOM_MAX = 4;

/** A consumed pause boundary re-arms only when playback dips this many
 *  seconds before it — a deliberate scrub-back-to-replay, never the tail
 *  of a resume. */
const REARM_BACK_S = 1.5;
/** No auto-pause within this window of a play() start (wall clock):
 *  resuming exactly at a boundary must never immediately re-pause. */
const PLAY_GUARD_MS = 500;

/** Split-while-watching backward lead (v1 heuristic): the reviewer taps a
 *  beat after the new serve begins, so lead the cut back this many seconds
 *  to land nearer the true gap. Clamped to stay inside the point (see
 *  SPLIT_EDGE_S). Superseded later by snap-to-activity-gap (deferred). */
const SPLIT_LEAD_S = 0.6;
/** The split at_t must sit at least this far inside the point on both edges
 *  (matches PointDetail's guard and the RPC's window). */
const SPLIT_EDGE_S = 0.3;

type Mode = "watch" | "score";
type Phase = "play" | "summary" | "review";

type UndoEntry =
  | {
      type: "tap";
      pointId: string;
      prevWinner: "user" | "opponent" | null;
      prevSkipped: boolean;
    }
  | {
      /** Player-originated soft delete; undo restores deleted:false. */
      type: "delete";
      pointId: string;
      /** Where the deleted rally started, so undo can seek back to it. */
      cutT0: number | null;
    }
  | {
      /** Game-boundary override ("Didn't end?" / "Game ended here?" /
       *  "End game"); undo restores the prior override value. */
      type: "override";
      pointId: string;
      prevOverride: GameEndOverride;
    }
  | {
      /** Split-while-watching. Undo calls unsplit_point (the atomic
       *  inverse): hard-delete child B, restore parent A's pre-split
       *  t1/tight_end/edited. */
      type: "split";
      parentId: string;
      childId: string;
      prevT1: number;
      prevTightEnd: boolean;
      prevEdited: boolean;
      /** Parent's cut_t0, so undo can seek back to replay the rejoined
       *  point. */
      parentCutT0: number | null;
    };

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
    /**
     * The uploader-side label on the scoring pad: "Me" for a normal match,
     * or the bottom player's name in a neutral / third-party match (the
     * uploader isn't a player — see MatchView's `neutral`).
     */
    youLabel: string;
    firstServer: MatchServer | null;
    serveGuess: MatchServer | null;
    serving: Map<string, ServeInfo>;
    score: MatchScore;
    /**
     * Clip context padding of the match's cut (clipPad(strictness), from
     * the job). cut_t0 is the PADDED clip start, so every rally-end
     * computation — the pause boundary above all — needs it (playhead.ts).
     */
    pad: ClipPad;
    /**
     * Deleted points' footage spans inside the cut video ([start, end]
     * seconds, sorted, overlaps merged). Dead footage is dead everywhere:
     * playback silently jumps over these in BOTH modes, and opening/
     * resuming never lands inside one.
     */
    deletedSpans: { start: number; end: number }[];
    /**
     * Soft-delete a point from score mode ("dead space"). Player-
     * originated: MatchView must NOT show its undo snackbar (the takeover
     * covers it at z-[80]) — the pad's own Undo restores instead.
     */
    onDeletePoint: (point: Point) => void;
    /** Restore a Player-deleted point (the pad's Undo). */
    onUndoDelete: (pointId: string) => void;
    /**
     * Non-null when the reel-usable names are incomplete (either player
     * unnamed under the current side mapping): prefills for the score-mode
     * names sheet. null = both known, never prompt.
     */
    namesPrompt: { you: string; them: string } | null;
    /** Persist the names sheet's answers (MatchView owns the columns). */
    onSaveNames: (you: string, them: string) => void;
    onSaveFirstServer: (v: MatchServer) => void;
    onSetWinner: (point: Point, value: "user" | "opponent" | null) => void;
    /** Mark/unmark a point skipped (is_let column). */
    onSetSkipped: (point: Point, value: boolean) => void;
    onSetServer: (point: Point, value: "user" | "opponent") => void;
    /** Pin/clear a game boundary after a point (game_end_override). */
    onSetGameOverride: (point: Point, value: GameEndOverride) => void;
    onToggleStar: (point: Point) => void;
    /**
     * Split-while-watching: the Player has already run the split_point RPC
     * (child B inserted, parent A's t1 clamped in the DB). This applies the
     * optimistic local state: patch parent A, add child B, schedule a
     * reclip. Optional — the Split control is hidden until it's wired
     * (reuses MatchView.addSplitPoint / updatePoint / scheduleReclip).
     */
    onSplit?: (parent: Point, patch: Partial<Point>, child: Point) => void;
    /**
     * Undo of a split: the Player has already run unsplit_point (child B
     * deleted, parent A restored in the DB). This mirrors it locally —
     * remove B, restore A's pre-split fields. Optional, wired alongside
     * onSplit.
     */
    onUnsplit?: (
      parentId: string,
      patch: Partial<Point>,
      childId: string
    ) => void;
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
    youLabel,
    firstServer,
    serveGuess,
    serving,
    score,
    pad,
    deletedSpans,
    onDeletePoint,
    onUndoDelete,
    namesPrompt,
    onSaveNames,
    onSaveFirstServer,
    onSetWinner,
    onSetSkipped,
    onSetServer,
    onSetGameOverride,
    onToggleStar,
    onSplit,
    onUnsplit,
    onOpenPoint,
    onOpenChange,
  },
  ref
) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const open = mode !== null;

  // Playhead mirror for DISPLAY (chips, point chip, pre-lit buttons).
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
  // Split-while-watching in flight (the split_point RPC round-trip): guards
  // against a double-tap firing two splits.
  const [splitting, setSplitting] = useState(false);
  const [serveSheet, setServeSheet] = useState(false);
  // Names half of the setup sheet: asked at most once per takeover session
  // (skippable, never blocks scoring); re-asked on a fresh entry while the
  // names are still missing. Drafts are the sheet's two inputs.
  const [namesSheet, setNamesSheet] = useState(false);
  const [draftYou, setDraftYou] = useState("");
  const [draftThem, setDraftThem] = useState("");
  const namesPromptedRef = useRef(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const [boundary, setBoundary] = useState<{
    game: number;
    you: number;
    them: number;
    /** the point the game closed after (the "Didn't end?" target) */
    pointId: string | null;
  } | null>(null);
  // Transient "Game ended here?" pill: after an answered point while a
  // 'continue' override holds the game open past the auto condition —
  // one tap pins the boundary on that point. ~2.5s, non-blocking.
  const [endedPill, setEndedPill] = useState<{ pointId: string } | null>(
    null
  );
  const endedPillTimer = useRef<number | null>(null);
  const [reviewIds, setReviewIds] = useState<string[]>([]);
  const [reviewIdx, setReviewIdx] = useState(0);

  // Gesture feedback.
  const [flash, setFlash] = useState<{ label: string; key: number } | null>(
    null
  );
  const flashTimer = useRef<number | null>(null);
  const [holding2x, setHolding2x] = useState(false);

  // Pause-at-point-end bookkeeping (see the header comment for the rules).
  // endPausedId (+ ref twin for gesture/tap handlers): the rally the video
  // is auto-paused at — it PINS the chip and tap targeting to the rally
  // that just ended (with near-adjacent cuts the WYSIWYG resolver may have
  // already flipped to the next rally a beat before the boundary), gates
  // "answer → advance", and enables tap-to-resume-without-scoring.
  // endPauseFiredRef: the last rally whose end already paused once. The
  // consumed boundary re-arms ONLY when playback dips >= 1.5s before it
  // (REARM_BACK_S — a deliberate scrub-back to replay) or when a
  // different rally's boundary is crossed; a small dip can never re-pause
  // the same boundary, so resume never wedges. lastPlayAtRef: wall-clock
  // of the last play() start — no auto-pause fires within 0.5s of it
  // (PLAY_GUARD_MS), killing pause-play-pause loops at a boundary.
  // lastTickRef: previous continuous-playback timeupdate position for
  // edge-crossing detection (nulled on pause/seek so jumps never read as
  // crossings).
  // runStartTRef: media time where the current CONTINUOUS playback run
  // began (first tick after a play/seek). A rally's boundary only pauses
  // when the run started before that rally's END — you must have actually
  // watched the deciding shot. This keeps a previous rally's boundary
  // (which pokes past the next rally's padded start on adjacent cuts —
  // pauseEnd = rally end + up to 0.6s) from hijacking a replay or a
  // resume that starts AT the next rally's padded start.
  const [endPausedId, setEndPausedId] = useState<string | null>(null);
  const endPausedRef = useRef<string | null>(null);
  const endPauseFiredRef = useRef<string | null>(null);
  const lastTickRef = useRef<number | null>(null);
  const runStartTRef = useRef<number | null>(null);
  const lastPlayAtRef = useRef(0);
  const pinEndPause = useCallback((id: string | null) => {
    endPausedRef.current = id;
    setEndPausedId(id);
  }, []);

  // Score-mode pinch zoom: transform state (render) + ref (gesture math).
  // Origin top-left: frame point = {x,y} + s * content point.
  const [zoomT, setZoomT] = useState({ s: 1, x: 0, y: 0 });
  const zoomRef = useRef({ s: 1, x: 0, y: 0 });

  /** Clamp (1x–4x, panned within the frame) and commit a zoom transform. */
  const applyZoom = useCallback(
    (s: number, x: number, y: number, rect: { width: number; height: number }) => {
      const cs = Math.min(ZOOM_MAX, Math.max(1, s));
      if (cs <= 1.001) {
        zoomRef.current = { s: 1, x: 0, y: 0 };
        setZoomT(zoomRef.current);
        return;
      }
      // Origin top-left: the frame shows [−x, −x + W]/s of the content,
      // so translation lives in [W(1−s), 0] (same for y).
      const next = {
        s: cs,
        x: Math.min(0, Math.max(rect.width * (1 - cs), x)),
        y: Math.min(0, Math.max(rect.height * (1 - cs), y)),
      };
      zoomRef.current = next;
      setZoomT(next);
    },
    []
  );

  const resetZoom = useCallback(() => {
    zoomRef.current = { s: 1, x: 0, y: 0 };
    setZoomT(zoomRef.current);
  }, []);

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

  // Latest deleted spans, same reasoning (auto-skip runs per timeupdate).
  const deletedSpansRef = useRef(deletedSpans);
  deletedSpansRef.current = deletedSpans;

  // Clip pad, same reasoning (the pause boundary is computed per tick).
  const padRef = useRef(pad);
  padRef.current = pad;

  /** End of the deleted span the playhead is inside, or null. The small
   *  epsilon keeps a jump that landed exactly on an end from re-matching. */
  const deadSpanEnd = useCallback((t: number): number | null => {
    for (const s of deletedSpansRef.current) {
      if (t < s.start) break; // sorted: nothing later can contain t
      if (t < s.end - 0.05) return s.end;
    }
    return null;
  }, []);

  /**
   * Where a landing at t should actually put the playhead: pushed out of
   * any deleted span, and never in the dead lead before the first visible
   * point — always in score mode (buttons are dimmed there: the owner's
   * "grayed out, looks broken" bug), in watch mode only when deleted
   * footage sits in that lead (an untouched pre-match pad still plays).
   */
  const snapLanding = useCallback((t: number, alwaysToFirst: boolean) => {
    let out = t;
    const spans = deletedSpansRef.current;
    for (const s of spans) {
      if (out < s.start) break;
      if (out < s.end) out = s.end;
    }
    const firstP = pointsRef.current.find((p) => p.cut_t0 !== null);
    const firstT = firstP ? Number(firstP.cut_t0) : null;
    if (
      firstT !== null &&
      out < firstT &&
      (alwaysToFirst || spans.some((s) => s.end > out && s.start < firstT))
    ) {
      out = firstT;
    }
    return out;
  }, []);

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
    // Kill the crossing detector's previous tick SYNCHRONOUSLY: a
    // timeupdate can race in with the new position before the seeked
    // event clears it, and a jump must never read as a played-through
    // pause boundary.
    lastTickRef.current = null;
    const v = videoRef.current;
    if (v && v.readyState >= 1) v.currentTime = clamped;
    else pendingSeek.current = clamped;
  }, []);

  const playNow = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    lastPlayAtRef.current = Date.now(); // arms the no-auto-pause guard
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
      // Deleted-span auto-skip: dead footage is dead in BOTH modes.
      // During playback (never mid-scrub — respect the user's drag) the
      // playhead entering a deleted span silently jumps to its end.
      // Forward-only by construction (span end > any t inside the span),
      // and deadSpanEnd's epsilon stops the landing from re-matching, so
      // no seek loops.
      if (!scrubbing.current && !v.paused) {
        const end = deadSpanEnd(v.currentTime);
        if (end !== null && end > v.currentTime) {
          v.currentTime = end;
          setPlayheadT(end);
          return;
        }
      }
      setPlayheadT(v.currentTime);
      // Pause-at-point-end: an UNSCORED rally's pauseEnd (rally end + a
      // beat of post pad — cut_t0 is the PADDED start, see playhead.ts)
      // crossed during CONTINUOUS playback in score/play pauses once (a
      // mid-rally winner tap means its end flows straight through).
      // Crossing = the boundary lies inside this playback step ((prev,
      // t], ~250ms ticks) checked against every visible rally, not just
      // the WYSIWYG one — with near-adjacent cuts the chip flips to the
      // next rally BEFORE the finished rally's boundary, and the pause
      // must still prompt for the rally that just ended (endPausedId pins
      // targeting to it). Seeks and pauses null lastTickRef, so jumps and
      // scrubs never read as crossings. NEVER-FREEZE rules: a consumed
      // boundary re-arms only >= REARM_BACK_S before it (deliberate
      // replay) or when a different rally's boundary is crossed, and no
      // pause fires within PLAY_GUARD_MS of a play() start — so resuming
      // from paused-at-end always makes real progress.
      if (
        modeRef.current === "score" &&
        phase === "play" &&
        !scrubbing.current &&
        !v.paused
      ) {
        const ps = pointsRef.current;
        const cpad = padRef.current;
        const t = v.currentTime;
        const prev = lastTickRef.current;
        lastTickRef.current = t;
        if (prev === null) runStartTRef.current = t; // new playback run
        if (endPauseFiredRef.current !== null) {
          const fp = ps.find((pt) => pt.id === endPauseFiredRef.current);
          const fend = fp ? pauseEnd(fp, cpad) : null;
          // Playing well before the consumed boundary again = the user
          // scrubbed back to REPLAY the point: re-arm so it pauses at its
          // end again. (A small dip — resume jitter — never re-arms.)
          if (fend === null || t < fend - REARM_BACK_S) {
            endPauseFiredRef.current = null;
          }
        }
        if (prev !== null && t > prev && t - prev < 1) {
          const guarded =
            Date.now() - lastPlayAtRef.current < PLAY_GUARD_MS;
          const runStart = runStartTRef.current;
          // The rally this run STARTED in (WYSIWYG resolver at the run's
          // first tick). A run beginning at a rally's padded start —
          // chevron/double-tap/chip navigation, answer-advance — is
          // watching THAT rally's pre-serve context, even though on
          // adjacent cuts those same frames sit inside the PREVIOUS
          // rally's span (its cut_t0 + pre overlaps the earlier rally's
          // end when the gap between rallies is shorter than the pre
          // pad). Only the start rally itself or later ones may pause
          // this run: without the positional check below, a navigation
          // landing before the previous rally's actual end passed the
          // runStart-before-rEnd test and got hijacked — play() paused
          // again within a second at the stale boundary, reading as a
          // frozen play button.
          const startId =
            runStart !== null ? playingPointId(ps, runStart) : null;
          const startP = startId
            ? (ps.find((pt) => pt.id === startId) ?? null)
            : null;
          const startCut =
            startP?.cut_t0 == null ? null : Number(startP.cut_t0);
          for (const p of ps) {
            const end = pauseEnd(p, cpad);
            if (end === null || end <= prev || end > t) continue;
            if (p.id !== endPauseFiredRef.current) {
              // Crossing a DIFFERENT rally's boundary retires the
              // consumed one — its end can pause again on a later replay.
              endPauseFiredRef.current = null;
            }
            // Only prompt for a rally whose deciding shot this playback
            // run actually covered: the run must have started before the
            // rally's END (boundary minus the post-pad beat) AND not
            // inside a LATER rally's span (the positional start check —
            // see startCut above). A replay or resume that starts at the
            // next rally's padded start never gets hijacked by the
            // previous rally's overhanging boundary.
            const rEnd = end - Math.min(cpad.post, 0.6);
            const watched =
              runStart !== null &&
              runStart < rEnd - 0.05 &&
              (startCut === null ||
                p.cut_t0 === null ||
                startCut <= Number(p.cut_t0));
            if (
              isUnscored(p) &&
              endPauseFiredRef.current !== p.id &&
              watched &&
              !guarded
            ) {
              endPauseFiredRef.current = p.id;
              pinEndPause(p.id);
              v.pause(); // onPause shows the chrome → thin scrub bar for frame-hunting
              break;
            }
          }
        }
      } else {
        lastTickRef.current = null;
      }
      // Review clips stop at the reviewed point's padded end (the full
      // footage extent — same span the reel would cut).
      if (phase === "review" && reviewPoint) {
        const end = paddedEnd(reviewPoint, padRef.current);
        if (end !== null && v.currentTime >= end) v.pause();
      }
    },
    [phase, reviewPoint, deadSpanEnd, pinEndPause]
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
    () => armedPointId(points, playheadT, pad),
    [points, playheadT, pad]
  );
  const armedPoint = armedId
    ? (points.find((p) => p.id === armedId) ?? null)
    : null;
  const playingPoint = playingId
    ? (points.find((p) => p.id === playingId) ?? null)
    : null;

  // Display target: WYSIWYG — the chip shows the rally the playhead is
  // inside (playingPointId flips at the point's padded span start, i.e.
  // at/just before the serve), and winner/skip/star taps score EXACTLY
  // the chip's point. Same precedence as tap-time resolution below.
  //
  // Grace note (intended ergonomics): in the dead gap right after a rally
  // ends, the chip hasn't flipped yet — it only flips at the NEXT point's
  // padded start — so tapping "just too late" still scores the rally you
  // just watched.
  //
  // Before the first point's start both resolvers are null: chip hidden,
  // buttons dimmed. armedPoint is a defensive fallback only — anywhere it
  // matches, playingPoint matches too (a rally ends after it starts).
  //
  // Paused-at-end PIN: while auto-paused at a rally's end, the chip (and
  // tap targeting below) stays on THAT rally even if the WYSIWYG resolver
  // already flipped to a near-adjacent next rally — the pause is a prompt
  // for the rally that just ended. Cleared on any resume or navigation.
  const endPausedPoint =
    endPausedId !== null
      ? (points.find((p) => p.id === endPausedId) ?? null)
      : null;
  const displayTarget =
    phase === "review"
      ? reviewPoint
      : (endPausedPoint ?? playingPoint ?? armedPoint);

  // WYSIWYG ticker score: the score AS OF the rally on screen — completed
  // games + current game over the visible points up to and INCLUDING the
  // chip point (same semantics as MatchView's runningScore in the point
  // headers). Entering an unscored rally this equals the score going into
  // it (an unscored point contributes nothing), and the winner tap folds
  // it in immediately — the tap→score-pop is unchanged. Re-entering
  // already-scored footage shows THAT moment's score, not the match's
  // final aggregate. The `score` prop keeps the final totals for the end
  // summary.
  const runningScore = useMemo(() => {
    const idx = displayTarget ? (indexById.get(displayTarget.id) ?? -1) : -1;
    return computeMatchScore(points.slice(0, idx + 1));
  }, [points, displayTarget, indexById]);

  /**
   * BULLETPROOF tap targeting: compute the scored point AT TAP TIME from
   * video.currentTime — playing (the rally on screen / just finished)
   * ?? armed (defensive fallback) ?? null. Works paused, works on
   * re-entry with zero media events, works right after any seek.
   */
  const resolveTargetPoint = useCallback((): Point | null => {
    if (phase === "review") {
      const ps = pointsRef.current;
      return ps.find((p) => p.id === reviewIds[reviewIdx]) ?? null;
    }
    const ps = pointsRef.current;
    // Paused-at-end pin first: taps answer the rally the pause prompted
    // for (matches the pinned chip), not a near-adjacent next rally.
    if (endPausedRef.current !== null) {
      const pinned = ps.find((p) => p.id === endPausedRef.current);
      if (pinned) return pinned;
    }
    const v = videoRef.current;
    const t = v && v.readyState >= 1 ? v.currentTime : playheadT;
    const id = playingPointId(ps, t) ?? armedPointId(ps, t, padRef.current);
    return id ? (ps.find((p) => p.id === id) ?? null) : null;
  }, [phase, reviewIds, reviewIdx, playheadT]);

  // Serve ball: the server of the rally currently on screen (same
  // pinned-then-playing source as the chip and tap targeting).
  const currentRallyId =
    endPausedId ??
    playingId ??
    points.find((p) => p.cut_t0 !== null)?.id ??
    null;
  const server = currentRallyId
    ? (serving.get(currentRallyId)?.server ?? null)
    : null;

  // Flank chevron availability: hidden on the first-point side (nothing
  // before) and the last-point side (nothing after).
  const cutPoints = useMemo(
    () => points.filter((p) => p.cut_t0 !== null),
    [points]
  );
  const playingCutIdx = playingId
    ? cutPoints.findIndex((p) => p.id === playingId)
    : -1;
  const hasPrevPoint = playingCutIdx > 0;
  const hasNextPoint =
    cutPoints.length > 0 && playingCutIdx < cutPoints.length - 1;

  // Null-outcome points ("unscored") — distinct from the deliberate
  // Skipped outcome (is_let).
  const unscored = useMemo(() => points.filter(isUnscored), [points]);
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
      pinEndPause(null);
      endPauseFiredRef.current = null;
      zoomRef.current = { s: 1, x: 0, y: 0 };
      setZoomT({ s: 1, x: 0, y: 0 });
      setMode(null);
      setServeSheet(false);
      setNamesSheet(false);
      namesPromptedRef.current = false; // fresh entry re-asks if still missing
      setPhase("play");
      setPill(null);
      openChangeRef.current(false);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [open, pinEndPause]);

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
      if (typeof seekT === "number") {
        seekTo(seekT);
      } else {
        // Poster → open with no explicit target: never start inside dead
        // footage. With the leading points deleted (warm-up), t=0 opens
        // at the first visible point instead (owner-friendly).
        const v = videoRef.current;
        const cur = v && v.readyState >= 1 ? v.currentTime : playheadT;
        const snapped = snapLanding(cur, false);
        if (snapped !== cur) seekTo(snapped);
      }
      openTakeover("watch");
      // Synchronous in the entry tap's call stack — iOS autoplay allows it.
      playNow();
    },
    [seekTo, snapLanding, playheadT, openTakeover, playNow]
  );

  // Resume toast is deferred while the serve sheet is up.
  const resumeToastRef = useRef<string | null>(null);

  // Completed games AS OF the playhead (running score): the boundary
  // overlay walks this count. Seeks move it too, so the overlay effect
  // additionally requires a recent winner tap — navigation never fires it.
  const gamesCount = runningScore.games.length;
  const prevGamesRef = useRef(gamesCount);
  const lastScoreTapRef = useRef(0);

  const openScore = useCallback(() => {
    // Fresh scoring session (the component itself never unmounts).
    setUndoStack([]);
    setPhase("play");
    setReviewIds([]);
    setReviewIdx(0);
    pinEndPause(null);
    endPauseFiredRef.current = null;
    zoomRef.current = { s: 1, x: 0, y: 0 };
    setZoomT({ s: 1, x: 0, y: 0 });
    prevGamesRef.current = gamesCount;
    // Resume where scoring stopped: the first unscored point (from the
    // very first entry too — landing before it left the pad dimmed with
    // the chip hidden, which read as broken). No unscored points left:
    // keep the current position, snapped out of any dead footage.
    const ps = pointsRef.current;
    const first = ps.find(isUnscored);
    const i = first ? ps.indexOf(first) : -1;
    resumeToastRef.current = null;
    const v = videoRef.current;
    const cur = v && v.readyState >= 1 ? v.currentTime : playheadT;
    const base = first && first.cut_t0 !== null ? Number(first.cut_t0) : cur;
    const startT = snapLanding(base, true);
    if (startT !== cur) seekTo(startT);
    if (first && i > 0) resumeToastRef.current = `Resuming from point ${i + 1}`;
    openTakeover("score");
    // Setup sheet: names (when the reel-usable names are incomplete, at
    // most once per takeover session) and/or the first server. One combined
    // sheet when both are missing; playback starts from its answer tap.
    const askNames = namesPrompt !== null && !namesPromptedRef.current;
    if (askNames && namesPrompt) {
      setDraftYou(namesPrompt.you);
      setDraftThem(namesPrompt.them);
      setNamesSheet(true);
    }
    if (firstServer === null) {
      setServeSheet(true);
      return; // playback starts from the serve-sheet answer tap
    }
    if (askNames) return; // playback starts from the names Done/Skip tap
    if (resumeToastRef.current) showToast(resumeToastRef.current);
    playNow();
  }, [
    gamesCount,
    seekTo,
    snapLanding,
    playheadT,
    openTakeover,
    firstServer,
    namesPrompt,
    showToast,
    playNow,
    pinEndPause,
  ]);

  useImperativeHandle(ref, () => ({ openWatch, openScore }), [
    openWatch,
    openScore,
  ]);

  // Commit the names drafts (no-op unless the names sheet is up and
  // something was typed). Confirming closes the names half for good this
  // session; MatchView's optimistic state makes namesPrompt null on save.
  const commitNames = useCallback(() => {
    if (!namesSheet) return;
    namesPromptedRef.current = true;
    setNamesSheet(false);
    const you = draftYou.trim();
    const them = draftThem.trim();
    if (you || them) onSaveNames(you, them);
  }, [namesSheet, draftYou, draftThem, onSaveNames]);

  const answerServeSheet = useCallback(
    (v: MatchServer | null) => {
      commitNames(); // on the combined sheet the serve tap is the confirm
      if (v) onSaveFirstServer(v);
      setServeSheet(false);
      if (resumeToastRef.current) showToast(resumeToastRef.current);
      playNow(); // the answer tap is the user gesture
    },
    [commitNames, onSaveFirstServer, showToast, playNow]
  );

  // Done on the names-only variant of the setup sheet.
  const doneNamesSheet = useCallback(() => {
    commitNames();
    if (resumeToastRef.current) showToast(resumeToastRef.current);
    playNow(); // the Done tap is the user gesture
  }, [commitNames, showToast, playNow]);

  // Quiet Skip: dismiss whatever the setup sheet was asking (names and/or
  // first server) without saving. Never blocks scoring.
  const skipSetupSheet = useCallback(() => {
    namesPromptedRef.current = true;
    setNamesSheet(false);
    setServeSheet(false);
    if (resumeToastRef.current) showToast(resumeToastRef.current);
    playNow(); // the Skip tap is the user gesture
  }, [showToast, playNow]);

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
      pinEndPause(null); // navigation releases the paused-at-end pin
      endPauseFiredRef.current = null; // destination's boundary re-arms
      seekTo(Number(p.cut_t0)); // zoom persists across navigation
      playNow();
      showPill(p.id, n);
      showControls();
    },
    [pinEndPause, seekTo, playNow, showPill, showControls]
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

  /** Double-tap / flank chevrons: right → next point's cut_t0, left →
   *  previous. Navigation ALWAYS auto-plays the destination (owner-
   *  specified UX): seek and play() share the gesture call stack (iOS),
   *  so chevroning out of the paused-at-end state never leaves a dead
   *  paused glyph needing an extra tap. */
  const doubleTapSeek = useCallback(
    (forward: boolean) => {
      const ps = pointsRef.current;
      const cutPoints = ps.filter((p) => p.cut_t0 !== null);
      if (cutPoints.length === 0) return;
      const v = videoRef.current;
      const t = v && v.readyState >= 1 ? v.currentTime : playheadT;
      // While auto-paused at a rally's end, THAT pinned rally is the
      // current one. pauseEnd overhangs the next rally's padded start on
      // adjacent cuts, so the WYSIWYG resolver may already say "next" —
      // stepping from IT made the next chevron skip a point and the prev
      // chevron land back on the rally just watched, whose end then
      // re-paused: the frozen-feeling navigation loop.
      const curId = endPausedRef.current ?? playingPointId(ps, t);
      const curIdx = curId
        ? cutPoints.findIndex((p) => p.id === curId)
        : -1;
      const target = forward
        ? (cutPoints[curIdx + 1] ?? null)
        : curIdx > 0
          ? cutPoints[curIdx - 1]
          : cutPoints[0];
      if (!target) return;
      pinEndPause(null); // free navigation releases the paused-at-end pin
      endPauseFiredRef.current = null; // destination's boundary re-arms
      seekTo(Number(target.cut_t0)); // zoom persists across navigation
      playNow(); // auto-play the destination, in the gesture call stack
      showFlash(`Point ${(indexById.get(target.id) ?? 0) + 1}`);
    },
    [playheadT, pinEndPause, seekTo, playNow, showFlash, indexById]
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

  // Score-mode pinch/pan tracking (kept out of `gesture` so watch mode's
  // tap machinery is untouched). zoomGestured suppresses the tap that
  // would otherwise fire when a pinch/pan lifts.
  const activePtrs = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{
    dist: number;
    mid: { x: number; y: number };
    z: { s: number; x: number; y: number };
  } | null>(null);
  const panLast = useRef<{ x: number; y: number } | null>(null);
  const panMoved = useRef(0);
  const zoomGestured = useRef(false);

  const onVideoPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const g = gesture.current;
      const rect = e.currentTarget.getBoundingClientRect();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Best-effort; gestures still work for pointers that stay inside.
      }
      const ptrs = activePtrs.current;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (modeRef.current === "score" && ptrs.size === 2) {
        // Second finger: pinch begins — kill tap/double-tap/hold arming.
        if (g.holdTimer) {
          window.clearTimeout(g.holdTimer);
          g.holdTimer = null;
        }
        if (g.singleTimer) {
          window.clearTimeout(g.singleTimer);
          g.singleTimer = null;
        }
        g.lastTapAt = 0;
        endHold();
        const [a, b] = [...ptrs.values()];
        pinchStart.current = {
          dist: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
          mid: {
            x: (a.x + b.x) / 2 - rect.left,
            y: (a.y + b.y) / 2 - rect.top,
          },
          z: { ...zoomRef.current },
        };
        panLast.current = null;
        zoomGestured.current = true;
        return;
      }
      if (ptrs.size > 2) return; // ignore extra fingers
      zoomGestured.current = false;
      panMoved.current = 0;
      g.downX = e.clientX - rect.left;
      g.width = rect.width;
      if (modeRef.current === "score" && zoomRef.current.s > 1) {
        // Zoomed: a single finger PANS — hold-2x only exists at 1x
        // (double-tap = reset to 1x, handled on pointer-up).
        panLast.current = { x: e.clientX, y: e.clientY };
        return;
      }
      panLast.current = null;
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
    [speedIdx, endHold]
  );

  const onVideoPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const ptrs = activePtrs.current;
      if (!ptrs.has(e.pointerId)) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (modeRef.current !== "score") return;
      const rect = e.currentTarget.getBoundingClientRect();
      const st = pinchStart.current;
      if (st && ptrs.size >= 2) {
        // Pinch: scale around the midpoint (midpoint drift = 2-finger pan).
        const [a, b] = [...ptrs.values()];
        const dist = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
        const mid = {
          x: (a.x + b.x) / 2 - rect.left,
          y: (a.y + b.y) / 2 - rect.top,
        };
        const s = Math.min(ZOOM_MAX, Math.max(1, st.z.s * (dist / st.dist)));
        // Keep the content point under the start midpoint pinned to the
        // live midpoint: t' = mid − (s/s0)(mid0 − t0).
        const k = s / st.z.s;
        applyZoom(
          s,
          mid.x - k * (st.mid.x - st.z.x),
          mid.y - k * (st.mid.y - st.z.y),
          rect
        );
        return;
      }
      if (panLast.current && ptrs.size === 1 && zoomRef.current.s > 1) {
        const dx = e.clientX - panLast.current.x;
        const dy = e.clientY - panLast.current.y;
        panLast.current = { x: e.clientX, y: e.clientY };
        const z = zoomRef.current;
        applyZoom(z.s, z.x + dx, z.y + dy, rect);
        panMoved.current += Math.hypot(dx, dy);
        if (panMoved.current > 6) zoomGestured.current = true; // not a tap
      }
    },
    [applyZoom]
  );

  const onVideoPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const ptrs = activePtrs.current;
      ptrs.delete(e.pointerId);
      const g = gesture.current;
      if (pinchStart.current) {
        if (ptrs.size < 2) {
          pinchStart.current = null;
          // The remaining finger continues as a pan.
          panLast.current =
            ptrs.size === 1 && zoomRef.current.s > 1
              ? [...ptrs.values()][0]
              : null;
        }
        return; // pinch fingers never count as taps
      }
      if (ptrs.size > 0) return;
      if (zoomGestured.current) {
        // A pan just lifted: swallow the tap (no chrome toggle / resume).
        zoomGestured.current = false;
        panLast.current = null;
        g.lastTapAt = 0;
        return;
      }
      panLast.current = null;
      if (endHold()) return; // hold released: no tap
      const now = Date.now();
      if (now - g.lastTapAt < DOUBLE_TAP_MS + 50) {
        // Double tap.
        if (g.singleTimer) {
          window.clearTimeout(g.singleTimer);
          g.singleTimer = null;
        }
        g.lastTapAt = 0;
        // Double tap = prev/next point seek, zoomed or not — the zoom is
        // the owner's camera correction and carries over ("pinched in,
        // double-tap to force next point"). The 1x pill is the reset.
        doubleTapSeek(g.downX > g.width / 2);
        return;
      }
      g.lastTapAt = now;
      if (g.singleTimer) window.clearTimeout(g.singleTimer);
      // Paused-at-point-end: a plain tap resumes WITHOUT scoring — play()
      // fires right here in the gesture call stack (iOS requires it), not
      // after the double-tap window. A quick second tap still double-tap
      // seeks; playback simply continues at the target. Zoomed too: with
      // persistent zoom the zoomed state is normal viewing, not a frame
      // inspection — a pan-lift never reaches here (zoomGestured swallows
      // it above), so this only fires on a genuine tap.
      if (endPausedRef.current !== null && modeRef.current === "score") {
        playNow();
        return;
      }
      // Single tap (after the double-tap window): toggle the chrome.
      g.singleTimer = window.setTimeout(() => {
        g.singleTimer = null;
        setControlsVisible((vis) => !vis);
        setControlsNonce((n) => n + 1);
      }, DOUBLE_TAP_MS);
    },
    [endHold, doubleTapSeek, playNow]
  );

  const onVideoPointerCancel = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      activePtrs.current.delete(e.pointerId);
      if (activePtrs.current.size < 2) pinchStart.current = null;
      if (activePtrs.current.size === 0) panLast.current = null;
      endHold();
    },
    [endHold]
  );

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

  /**
   * Seamless advance after an outcome entry while paused-at-end: seek to
   * the next visible rally and play in the same gesture (same-file seek;
   * play() stays in the tap's call stack for iOS). Returns false when p
   * was the last rally — we stay paused there (exit/resume are manual).
   */
  const advanceFrom = useCallback(
    (p: Point) => {
      const ps = pointsRef.current;
      const t0 = p.cut_t0 === null ? null : Number(p.cut_t0);
      const next = ps.find(
        (pt) =>
          pt.id !== p.id &&
          pt.cut_t0 !== null &&
          t0 !== null &&
          Number(pt.cut_t0) > t0
      );
      if (next?.cut_t0 == null) return false;
      endPauseFiredRef.current = null; // destination's boundary re-arms
      seekTo(Number(next.cut_t0)); // zoom persists across the advance
      playNow();
      return true;
    },
    [seekTo, playNow]
  );

  /**
   * "Replay" pill (paused-at-end only): seek back to the pinned rally's
   * padded start (cut_t0) and play it again. Explicitly re-arms the
   * boundary — a short rally can be closer to its end than REARM_BACK_S,
   * and the replay MUST pause at the (corrected) end again.
   */
  const replayRally = useCallback(() => {
    const pinned = pointsRef.current.find(
      (p) => p.id === endPausedRef.current
    );
    if (!pinned || pinned.cut_t0 === null) return;
    endPauseFiredRef.current = null; // re-arm: pause at this end again
    seekTo(Number(pinned.cut_t0)); // zoom persists across the replay
    playNow();
  }, [seekTo, playNow]);

  /** Show the transient "Game ended here?" pill for a just-answered point
   *  (only offered while a 'continue' override holds the game open). */
  const showEndedPill = useCallback((pointId: string) => {
    if (endedPillTimer.current) window.clearTimeout(endedPillTimer.current);
    setEndedPill({ pointId });
    endedPillTimer.current = window.setTimeout(() => {
      endedPillTimer.current = null;
      setEndedPill(null);
    }, 2500);
  }, []);

  const tapSide = useCallback(
    (side: "user" | "opponent") => {
      const p = resolveTargetPoint();
      if (!p) return;
      lastScoreTapRef.current = Date.now();
      setUndoStack((s) => [
        ...s,
        {
          type: "tap",
          pointId: p.id,
          prevWinner: p.confirmed_winner,
          prevSkipped: p.is_let,
        },
      ]);
      const hadOutcome = p.confirmed_winner !== null || p.is_let;
      const next = p.confirmed_winner === side ? null : side;
      onSetWinner(p, next);
      if (phase === "review") {
        window.setTimeout(() => nextReviewRef.current(), 400);
        return;
      }
      // While a prior 'continue' holds the game open past the auto
      // condition, every answered point offers the one-tap boundary:
      // a transient "Game ended here?" pill (the walk stays open until
      // an explicit 'end'). Computed on the answer as just applied —
      // the optimistic points update hasn't landed yet.
      if (next !== null) {
        const ps = pointsRef.current;
        const i = ps.findIndex((pt) => pt.id === p.id);
        if (i >= 0) {
          const upto = ps
            .slice(0, i + 1)
            .map((pt) =>
              pt.id === p.id
                ? { ...pt, confirmed_winner: next, is_let: false }
                : pt
            );
          if (computeMatchScore(upto).open) showEndedPill(p.id);
        }
      }
      // ADVANCE ON ANY NEW ANSWER: a winner on a rally that had NO
      // outcome yet advances to the next rally and plays — one gesture,
      // whether paused-at-end or mid-rally. CHANGING an existing outcome
      // (toggle-off, switching winner) is a correction: it never
      // advances, the rally just keeps playing (or stays paused where
      // the user put it).
      if (!hadOutcome && next !== null) {
        pinEndPause(null);
        advanceFrom(p);
      } else if (endPausedRef.current === p.id) {
        // Corrections while paused-at-end release the pin so playback
        // controls behave normally, but stay in place.
        pinEndPause(null);
      }
    },
    [
      resolveTargetPoint,
      onSetWinner,
      phase,
      advanceFrom,
      pinEndPause,
      showEndedPill,
    ]
  );

  const tapSkip = useCallback(() => {
    const p = resolveTargetPoint();
    if (!p) return;
    if (p.is_let) {
      // Already skipped — the press means "move on". Never a silent no-op.
      const ps = pointsRef.current;
      const next = ps.find(
        (pt) =>
          pt.cut_t0 !== null &&
          p.cut_t0 !== null &&
          Number(pt.cut_t0) > Number(p.cut_t0)
      );
      if (next?.cut_t0 != null) {
        seekTo(Number(next.cut_t0)); // zoom persists
        playNow();
        showFlash(`Point ${(indexById.get(next.id) ?? 0) + 1}`);
      }
      return;
    }
    const hadOutcome = p.confirmed_winner !== null;
    setUndoStack((s) => [
      ...s,
      {
        type: "tap",
        pointId: p.id,
        prevWinner: p.confirmed_winner,
        prevSkipped: p.is_let,
      },
    ]);
    onSetSkipped(p, true);
    showFlash("Skipped");
    if (phase === "review") {
      window.setTimeout(() => nextReviewRef.current(), 400);
      return;
    }
    // NEW answer → advance: a skipped point doesn't count — jump straight
    // to the next rally (this is also the paused-at-end advance: Skip
    // answers the pause). Skipping a rally that already HAD a winner is a
    // correction and stays in place, like every other outcome change.
    if (hadOutcome) {
      if (endPausedRef.current === p.id) pinEndPause(null);
      return;
    }
    pinEndPause(null);
    const ps = pointsRef.current;
    const next = ps.find(
      (pt) =>
        pt.cut_t0 !== null &&
        p.cut_t0 !== null &&
        Number(pt.cut_t0) > Number(p.cut_t0)
    );
    if (next?.cut_t0 != null) {
      seekTo(Number(next.cut_t0)); // zoom persists
      playNow();
    }
  }, [
    resolveTargetPoint,
    onSetSkipped,
    phase,
    showFlash,
    seekTo,
    playNow,
    indexById,
    pinEndPause,
  ]);

  // Delete ("dead space"): soft-remove the rally on screen — a mis-cut,
  // warm-up, or between-points junk that isn't a real point. Its span
  // becomes dead footage (deletedSpans recomputes), targeting recomputes
  // off the shrunken visible list, and playback jumps to the next rally
  // (previous at the very end). Undo lives on the pad's own stack.
  const tapDelete = useCallback(() => {
    const p = resolveTargetPoint();
    if (!p) return;
    setUndoStack((s) => [
      ...s,
      {
        type: "delete",
        pointId: p.id,
        cutT0: p.cut_t0 === null ? null : Number(p.cut_t0),
      },
    ]);
    onDeletePoint(p);
    showFlash("Removed");
    if (phase === "review") {
      window.setTimeout(() => nextReviewRef.current(), 400);
      return;
    }
    // pointsRef may not have dropped p yet (state update is async) —
    // exclude it explicitly.
    const ps = pointsRef.current;
    const t0 = p.cut_t0 === null ? null : Number(p.cut_t0);
    const next = ps.find(
      (pt) =>
        pt.id !== p.id &&
        pt.cut_t0 !== null &&
        t0 !== null &&
        Number(pt.cut_t0) > t0
    );
    if (next?.cut_t0 != null) {
      seekTo(Number(next.cut_t0)); // zoom persists
      playNow();
      return;
    }
    const before = ps.filter(
      (pt) =>
        pt.id !== p.id &&
        pt.cut_t0 !== null &&
        t0 !== null &&
        Number(pt.cut_t0) < t0
    );
    const prev = before[before.length - 1];
    if (prev?.cut_t0 != null) {
      seekTo(Number(prev.cut_t0)); // zoom persists
      playNow();
    }
  }, [
    resolveTargetPoint,
    onDeletePoint,
    showFlash,
    phase,
    seekTo,
    playNow,
  ]);

  // Split-while-watching: cut the CURRENT point in two at the playhead — a
  // fused pair of rallies the auto-splitter merged (gap too short). Reuses
  // the point-view split path (split_point RPC + child cut_t0); the cut-time
  // playhead maps to the source at_t via cutToSource, then a fixed backward
  // lead nudges it toward the true gap. See the header comment for the full
  // mapping + heuristic.
  const splitHere = useCallback(async () => {
    if (splitting || phase !== "play" || !onSplit) return;
    const A = resolveTargetPoint();
    const v = videoRef.current;
    if (!A || !v || A.cut_t0 === null || A.t0 === null || A.t1 === null) return;
    const cpad = padRef.current;
    const T = v.readyState >= 1 ? v.currentTime : playheadT;
    const atRaw = cutToSource(A, T, cpad);
    if (atRaw === null) return;
    const t0 = Number(A.t0);
    const t1 = Number(A.t1);
    // Backward lead, clamped to a real interior split (matches the RPC's and
    // PointDetail's ±0.3s window). Too-short points can't be split.
    const lo = t0 + SPLIT_EDGE_S;
    const hi = t1 - SPLIT_EDGE_S;
    if (hi <= lo) return;
    const at =
      Math.round(Math.min(hi, Math.max(lo, atRaw - SPLIT_LEAD_S)) * 100) / 100;
    // Child's padded start in cut coords — identical formula to
    // PointDetail.splitHere / migration 023 (reduces to T - min(pre, TIGHT)).
    const eff = effectivePad(cpad, A.tight_start, A.tight_end);
    const childCutT0 =
      Math.round(
        (Number(A.cut_t0) +
          (at - Math.min(cpad.pre, TIGHT_PAD)) -
          Math.max(0, t0 - eff.pre)) *
          100
      ) / 100;

    setSplitting(true);
    v.pause();
    const supabase = createClient();
    const { data, error } = await supabase.rpc("split_point", {
      p_id: A.id,
      at_t: at,
      child_cut_t0: childCutT0,
    });
    setSplitting(false);
    if (error || !data) {
      showToast("Couldn't split. Try again.");
      return;
    }
    const child = data as Point;
    // Optimistic local state: parent A shrinks to [t0, at] with a tight end,
    // child B is [at, t1] (returned by the RPC). Reclip regenerates clips.
    onSplit(A, { t1: at, edited: true, tight_end: true }, child);
    setUndoStack((s) => [
      ...s,
      {
        type: "split",
        parentId: A.id,
        childId: child.id,
        prevT1: t1,
        prevTightEnd: A.tight_end,
        prevEdited: A.edited,
        parentCutT0: A.cut_t0 === null ? null : Number(A.cut_t0),
      },
    ]);
    // Pause-decide on A: pin targeting to the rally that just ended, arm its
    // boundary as consumed so it never re-fires, and seek to its corrected
    // end so the split moment is on screen. Scoring A advances into B.
    endPauseFiredRef.current = A.id;
    pinEndPause(A.id);
    const boundaryT = pauseEnd({ ...A, t1: at, tight_end: true }, cpad);
    if (boundaryT !== null) seekTo(boundaryT);
    showFlash("Split");
  }, [
    splitting,
    phase,
    onSplit,
    resolveTargetPoint,
    playheadT,
    pinEndPause,
    seekTo,
    showFlash,
    showToast,
  ]);

  // Serve ball tap: flip who served the rally on screen. The override
  // re-anchors the ITTF rotation, so every later point recomputes too.
  const flipServer = useCallback(() => {
    if (!currentRallyId || !server) return;
    const p = pointsRef.current.find((pt) => pt.id === currentRallyId);
    if (!p) return;
    const next = server === "user" ? "opponent" : "user";
    onSetServer(p, next);
    showFlash(
      next === "user"
        ? youLabel === "Me"
          ? "I serve"
          : `${youLabel} serves`
        : `${themLabel} serves`
    );
  }, [currentRallyId, server, onSetServer, showFlash, themLabel, youLabel]);

  // ------------------------------------------- game-boundary overrides

  /** Push an undo entry and write a boundary override on one point. */
  const applyGameOverride = useCallback(
    (p: Point, value: GameEndOverride) => {
      setUndoStack((s) => [
        ...s,
        {
          type: "override",
          pointId: p.id,
          prevOverride: p.game_end_override,
        },
      ]);
      onSetGameOverride(p, value);
    },
    [onSetGameOverride]
  );

  /** Boundary overlay's "Didn't end?": the auto boundary fired where the
   *  video says the game kept going — hold it open ('continue'), dismiss
   *  the overlay, keep counting in the same game. */
  const tapDidntEnd = useCallback(() => {
    if (!boundary?.pointId) return;
    const p = pointsRef.current.find((pt) => pt.id === boundary.pointId);
    if (!p) return;
    applyGameOverride(p, "continue");
    setBoundary(null);
  }, [boundary, applyGameOverride]);

  /** Transient pill's "Game ended here?": pin an explicit 'end' on the
   *  just-answered point (closing a game held open by 'continue'). */
  const tapEndedHere = useCallback(() => {
    if (!endedPill) return;
    const p = pointsRef.current.find((pt) => pt.id === endedPill.pointId);
    if (!p) return;
    lastScoreTapRef.current = Date.now(); // the boundary overlay confirms
    applyGameOverride(p, "end");
    setEndedPill(null);
  }, [endedPill, applyGameOverride]);

  // Paused-state "End game" target (the inverse fix: the game was
  // actually over BEFORE the auto rule fired — e.g. the real score was
  // miscounted upward, or the tail of the game was never scored at all).
  // The boundary is POSITIONAL: it pins 'end' on the rally the pause is
  // showing — the pinned rally when auto-paused at its end, else the
  // WYSIWYG one — scored, skipped, or unscored alike (the walk honors
  // overrides on every visible point). Pausing where the video shows the
  // side-switch and tapping the pill closes the game exactly there, even
  // with a run of unscored rallies behind it. Hidden only when the walk
  // already closes a game at that rally.
  const endGameTarget = useMemo(() => {
    if (phase !== "play") return null;
    const p = endPausedPoint ?? playingPoint ?? armedPoint;
    if (!p) return null;
    return score.boundaryAfter.has(p.id) ? null : p;
  }, [phase, endPausedPoint, playingPoint, armedPoint, score.boundaryAfter]);

  const tapEndGame = useCallback(() => {
    if (!endGameTarget) return;
    lastScoreTapRef.current = Date.now(); // the boundary overlay confirms
    applyGameOverride(endGameTarget, "end");
  }, [endGameTarget, applyGameOverride]);

  const undo = useCallback(() => {
    const e = undoStack[undoStack.length - 1];
    if (!e) return;
    setUndoStack((s) => s.slice(0, -1));
    if (e.type === "delete") {
      // Restore the deleted point and replay it (it isn't in the visible
      // points yet — the stored cutT0 is the seek target).
      onUndoDelete(e.pointId);
      if (e.cutT0 !== null && phase !== "review") {
        seekTo(e.cutT0); // zoom persists
        playNow();
      }
      return;
    }
    if (e.type === "override") {
      // Boundary override undo: restore the prior override value in
      // place — overrides never moved playback, so undo doesn't either.
      const p = pointsRef.current.find((pt) => pt.id === e.pointId);
      if (p) onSetGameOverride(p, e.prevOverride);
      return;
    }
    if (e.type === "split") {
      // Inverse of split_point: hard-delete child B and restore parent A's
      // pre-split t1/tight_end, atomically (unsplit_point, migration 026).
      // Growing t1 back to full re-fires the points_mark_edited trigger, so
      // A ends edited=true — correct: its clip is now stale and the reclip
      // (scheduled by onUnsplit) regenerates it to the restored extent.
      // Optimistic local mirror rejoins the timeline into one point;
      // seeking back replays it (unscored ⇒ its end re-arms and pauses).
      const patch: Partial<Point> = {
        t1: e.prevT1,
        tight_end: e.prevTightEnd,
        edited: true,
      };
      pinEndPause(null);
      endPauseFiredRef.current = null;
      (async () => {
        const supabase = createClient();
        const { error } = await supabase.rpc("unsplit_point", {
          p_parent: e.parentId,
          p_child: e.childId,
          parent_t1: e.prevT1,
          parent_tight_end: e.prevTightEnd,
          parent_edited: e.prevEdited,
        });
        if (error) {
          showToast("Couldn't undo the split. Try again.");
          return;
        }
        onUnsplit?.(e.parentId, patch, e.childId);
        if (e.parentCutT0 !== null && phase !== "review") {
          seekTo(e.parentCutT0); // zoom persists
          playNow();
        }
      })();
      return;
    }
    const p = pointsRef.current.find((pt) => pt.id === e.pointId);
    if (!p) return;
    if (p.confirmed_winner !== e.prevWinner) onSetWinner(p, e.prevWinner);
    if (p.is_let !== e.prevSkipped) onSetSkipped(p, e.prevSkipped);
    // Seek back to the undone point so it plays out and re-arms (undo
    // after a paused-at-end advance lands back on the undone rally, whose
    // end will pause again once it's unscored).
    if (p.cut_t0 !== null && phase !== "review") {
      seekTo(Number(p.cut_t0)); // zoom persists
      playNow();
    }
  }, [
    undoStack,
    onUndoDelete,
    onUnsplit,
    onSetWinner,
    onSetSkipped,
    onSetGameOverride,
    pinEndPause,
    showToast,
    phase,
    seekTo,
    playNow,
  ]);

  const starTarget = displayTarget;
  const tapStar = useCallback(() => {
    const p = phase === "review" ? reviewPoint : resolveTargetPoint();
    if (p) onToggleStar(p);
  }, [phase, reviewPoint, resolveTargetPoint, onToggleStar]);

  const startReview = useCallback(() => {
    const ids = unscored.map((p) => p.id);
    if (ids.length === 0) return;
    pinEndPause(null);
    endPauseFiredRef.current = null;
    setReviewIds(ids); // zoom persists into review
    setReviewIdx(0);
    setPhase("review");
  }, [unscored, pinEndPause]);

  // Seek to the reviewed point whenever review advances. Reads points via
  // ref so a score tap (points identity change) never re-seeks/loops the
  // clip — only phase/index changes move the playhead.
  useEffect(() => {
    if (phase !== "review") return;
    const p = pointsRef.current.find((pt) => pt.id === reviewIds[reviewIdx]);
    if (!p || p.cut_t0 === null) return;
    seekTo(Number(p.cut_t0)); // zoom persists between reviewed clips
    playNow();
  }, [phase, reviewIdx, reviewIds, seekTo, playNow]);

  // Game boundary: a tap just completed a game → overlay (~3.5s — long
  // enough to read AND to catch the "Didn't end?" escape hatch, which is
  // why every overlay is interactive: the tap-recency guard below means
  // it only ever fires from a LIVE answer). Guarded by a scalar
  // previous-count so unrelated score recomputes never replay it, and by
  // tap recency: the running count also moves when the user SEEKS across
  // game boundaries, which must never flash the overlay.
  useEffect(() => {
    const prev = prevGamesRef.current;
    prevGamesRef.current = gamesCount;
    if (gamesCount <= prev || mode !== "score") return;
    if (Date.now() - lastScoreTapRef.current > 1000) return;
    const g = runningScore.games[gamesCount - 1];
    // The point the game closed after — the "Didn't end?" target.
    let pointId: string | null = null;
    for (const [id, b] of runningScore.boundaryAfter) {
      if (b.game === gamesCount) {
        pointId = id;
        break;
      }
    }
    setBoundary({ game: gamesCount, you: g.you, them: g.them, pointId });
    const id = window.setTimeout(() => setBoundary(null), 3500);
    return () => window.clearTimeout(id);
  }, [gamesCount, mode, runningScore.games, runningScore.boundaryAfter]);

  // Desktop keys. Space works in both modes; scoring keys in score mode.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (serveSheet || namesSheet || e.repeat) return;
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
      } else if (
        e.key === "l" ||
        e.key === "L" ||
        e.key === "k" ||
        e.key === "K"
      ) {
        // K = skip (L kept as a legacy alias from the Let days)
        tapSkip();
      } else if (e.key === "s" || e.key === "S") {
        tapStar();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    open,
    mode,
    serveSheet,
    namesSheet,
    tapSide,
    undo,
    tapSkip,
    tapStar,
    togglePause,
  ]);

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

  // Split control: enabled while a current point (with the cut offsets and
  // room for an interior cut) is on screen in the play phase. Hidden in
  // review/summary and until the split callbacks are wired.
  const canSplit =
    !!onSplit &&
    !splitting &&
    phase === "play" &&
    !!target &&
    target.cut_t0 !== null &&
    target.t0 !== null &&
    target.t1 !== null &&
    Number(target.t1) - Number(target.t0) > 2 * SPLIT_EDGE_S;

  const progressPct = duration > 0 ? (playheadT / duration) * 100 : 0;

  // ------------------------------------------------------------------ UI

  const videoAreaClass =
    mode === null
      ? "relative aspect-video w-full bg-black"
      : mode === "watch"
        ? "relative min-h-0 w-full flex-1 bg-black"
        : "relative mx-auto aspect-video max-h-[45dvh] w-full max-w-3xl shrink-0 overflow-hidden bg-black";

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
            onSeeked={(e) => {
              setPlayheadT(e.currentTarget.currentTime);
              // A jump is not continuous playback: never let the crossing
              // detector treat pre-seek → post-seek as a played-through end.
              lastTickRef.current = null;
            }}
            onPlay={(e) => {
              setPaused(false);
              // Any resume ends the paused-at-end state (the once-per-
              // entry re-arm lives in endPauseFiredRef, so no re-pause
              // at the same boundary), and refreshes the no-auto-pause
              // guard window (covers plays we didn't initiate too).
              lastPlayAtRef.current = Date.now();
              pinEndPause(null);
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
            style={
              mode === "score" && zoomT.s > 1
                ? {
                    transform: `translate(${zoomT.x}px, ${zoomT.y}px) scale(${zoomT.s})`,
                    transformOrigin: "0 0",
                  }
                : undefined
            }
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
            {/* gesture surface: tap / double-tap / press-and-hold, plus
                pinch-zoom + pan in score mode (touch-action none there so
                the browser never hijacks the pinch). Pointer capture keeps
                pans alive off-surface, so leave only ends a hold. */}
            <div
              className="absolute inset-0 select-none"
              style={{
                touchAction: mode === "score" ? "none" : "manipulation",
              }}
              onPointerDown={onVideoPointerDown}
              onPointerMove={onVideoPointerMove}
              onPointerUp={onVideoPointerUp}
              onPointerCancel={onVideoPointerCancel}
              onPointerLeave={() => endHold()}
              onContextMenu={(e) => e.preventDefault()}
            />

            {/* flank chevrons: prev/next point, same treatment as the
                point detail view. Sized exactly to their circles so they
                never eat taps meant for the pause surface, and vertically
                centered clear of the hold-2x pill (top) and chrome
                (bottom). Hidden on the first/last-point sides. */}
            {(mode !== "score" || phase === "play") && (
              <>
                {hasPrevPoint && (
                  <button
                    type="button"
                    onClick={() => doubleTapSeek(false)}
                    aria-label="Previous point"
                    className="absolute left-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-ink/60 text-zinc-200 backdrop-blur-sm transition-colors hover:text-white"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
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
                )}
                {hasNextPoint && (
                  <button
                    type="button"
                    onClick={() => doubleTapSeek(true)}
                    aria-label="Next point"
                    className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-ink/60 text-zinc-200 backdrop-blur-sm transition-colors hover:text-white"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
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
                )}
              </>
            )}

            {/* paused-at-end Replay pill: replays the rally that just
                ended (seeks to its padded start, re-arms its boundary so
                it pauses again at the corrected end). Bottom-left, above
                the transport chrome and right of the prev-point chevron
                (left-14 clears its 40px circle on the short mobile
                video); only while auto-paused at an end. */}
            {mode === "score" &&
              phase === "play" &&
              paused &&
              endPausedId !== null && (
                <button
                  type="button"
                  onClick={replayRally}
                  aria-label="Replay this point"
                  className="absolute bottom-24 left-14 z-10 flex items-center gap-1.5 rounded-full border border-white/15 bg-ink/60 px-3 py-1.5 text-xs font-semibold text-zinc-200 backdrop-blur-sm transition-colors hover:bg-ink/80 hover:text-white"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-3.5 w-3.5"
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
                  Replay
                </button>
              )}

            {/* paused "End game" pill: the inverse boundary fix — the
                game actually ended at the rally on screen before the
                auto rule would fire (or the tail of the game was never
                scored). POSITIONAL: pins 'end' on the pinned/displayed
                rally itself, scored or not. Opposite corner from Replay,
                same quiet treatment; shown on any score-mode pause with
                a current rally, hidden when the walk already ends a game
                there. No standing chrome outside the pause state. */}
            {mode === "score" &&
              phase === "play" &&
              paused &&
              endGameTarget !== null && (
                <button
                  type="button"
                  onClick={tapEndGame}
                  aria-label="End the game after this point"
                  className="absolute bottom-24 right-14 z-10 rounded-full border border-white/15 bg-ink/60 px-3 py-1.5 text-xs font-semibold text-zinc-200 backdrop-blur-sm transition-colors hover:bg-ink/80 hover:text-white"
                >
                  End game
                </button>
              )}

            {/* score-mode zoom reset pill: shown whenever zoomed in */}
            {mode === "score" && zoomT.s > 1 && (
              <button
                type="button"
                onClick={resetZoom}
                aria-label="Reset zoom"
                className="absolute right-2 top-2 z-10 rounded-full border border-edge bg-ink/80 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-zinc-200 backdrop-blur"
              >
                1x
              </button>
            )}

            {/* score mode: the WYSIWYG point-number chip, top-center over
                the video — it flips the moment the playhead enters the
                next rally's padded span, and taps score exactly it. */}
            {mode === "score" && target && targetIdx >= 0 && (
              <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
                <span
                  key={target.id}
                  className="ks-arm flex h-8 w-8 items-center justify-center rounded-full border border-cyan-glow/60 bg-cyan-glow/15 text-xs font-semibold tabular-nums text-cyan-glow shadow-lg shadow-black/40 backdrop-blur-sm"
                >
                  {targetIdx + 1}
                </span>
              </div>
            )}

            {/* paused glyph */}
            {paused && !serveSheet && !namesSheet && phase !== "summary" && (
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

            {/* press-and-hold 2x indicator (dropped below the point chip
                in score mode so the two never overlap) */}
            {holding2x && (
              <div
                className={`pointer-events-none absolute inset-x-0 flex justify-center ${
                  mode === "score" ? "top-14" : "top-3"
                }`}
              >
                <span className="ks-fade rounded-full border border-edge bg-ink/85 px-3 py-1 text-xs font-semibold tabular-nums text-zinc-200 backdrop-blur">
                  2x ▶
                </span>
              </div>
            )}

            {/* game boundary: ~3.5s. Always live-tap-triggered (the
                recency guard blocks seek crossings), so it carries the
                escape hatch: "Didn't end?" holds the game open
                ('continue') when the auto rule fired somewhere the video
                says it shouldn't — scoring continues in the same game. */}
            {boundary && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2.5">
                <p className="ks-fade rounded-2xl border border-edge bg-ink/85 px-6 py-4 text-xl font-bold tabular-nums backdrop-blur-md">
                  Game {boundary.game} ·{" "}
                  <span className="text-cyan-glow">{boundary.you}</span>
                  <span className="text-zinc-600">-</span>
                  <span className="text-magenta-soft">{boundary.them}</span>
                </p>
                {boundary.pointId !== null && (
                  <button
                    type="button"
                    onClick={tapDidntEnd}
                    className="ks-fade pointer-events-auto rounded-full border border-edge bg-ink/70 px-3.5 py-1.5 text-xs font-medium text-zinc-300 backdrop-blur-sm transition-colors hover:border-cyan-glow/40 hover:text-white"
                  >
                    Didn&apos;t end?
                  </button>
                )}
              </div>
            )}

            {/* transient "Game ended here?" pill: after an answered point
                while a 'continue' holds the game open — one tap pins the
                boundary on that point (undo restores). Non-blocking. */}
            {mode === "score" && endedPill && !boundary && (
              <div className="absolute inset-x-0 bottom-24 z-10 flex justify-center">
                <button
                  type="button"
                  onClick={tapEndedHere}
                  className="ks-fade rounded-full border border-edge bg-ink/85 px-4 py-1.5 text-xs font-semibold text-zinc-200 backdrop-blur transition-colors hover:border-cyan-glow/40 hover:text-white"
                >
                  Game ended here?
                </button>
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
          {/* ticker: serve ball · score + games pill · serve ball.
              (The point chip lives top-center over the video; the prev/
              next chevrons flank the video itself.) */}
          <div className="mx-auto flex w-full max-w-3xl shrink-0 items-center border-b border-edge/60 px-3 py-2">
            <span className="flex w-8 justify-start">
              {server !== null && (
                <button
                  type="button"
                  onClick={flipServer}
                  aria-label={
                    server === "user"
                      ? "I serve — tap to switch server"
                      : "Give the serve to me"
                  }
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-edge bg-surface"
                >
                  {server === "user" ? (
                    <span className="serve-ball block h-3.5 w-3.5 rounded-full" />
                  ) : (
                    <span className="block h-3.5 w-3.5 rounded-full border border-zinc-600 opacity-50" />
                  )}
                </button>
              )}
            </span>
            {/* running score: this moment at the playhead, not the match's
                final totals (those live in the end summary) */}
            <span className="flex flex-1 items-baseline justify-center gap-2">
              <span
                key={`${runningScore.current.you}-${runningScore.current.them}`}
                className="ks-pop text-2xl font-bold tabular-nums tracking-tight"
              >
                <span className="text-cyan-glow">
                  {runningScore.current.you}
                </span>
                <span className="mx-1 text-zinc-600">-</span>
                <span className="text-magenta-soft">
                  {runningScore.current.them}
                </span>
              </span>
              {runningScore.games.length > 0 && (
                <span className="rounded-full border border-edge bg-surface px-2 py-0.5 text-[11px] font-semibold tabular-nums text-zinc-300">
                  {runningScore.gamesYou}-{runningScore.gamesThem}
                </span>
              )}
            </span>
            <span className="flex w-8 justify-end">
              {server !== null && (
                <button
                  type="button"
                  onClick={flipServer}
                  aria-label={
                    server === "opponent"
                      ? `${themLabel} serves — tap to switch server`
                      : `Give the serve to ${themLabel}`
                  }
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-edge bg-surface"
                >
                  {server === "opponent" ? (
                    <span className="serve-ball block h-3.5 w-3.5 rounded-full" />
                  ) : (
                    <span className="block h-3.5 w-3.5 rounded-full border border-zinc-600 opacity-50" />
                  )}
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
                {/* jump to this point's detail view (placement, notes) */}
                <button
                  type="button"
                  disabled={!target}
                  onClick={() => {
                    const p = phase === "review" ? reviewPoint : target;
                    if (!p) return;
                    const openIt = onOpenPoint;
                    const id = p.id;
                    window.addEventListener(
                      "popstate",
                      () => window.setTimeout(() => openIt(id), 0),
                      { once: true }
                    );
                    exit();
                  }}
                  aria-label="Open point view"
                  title="Open point view"
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
                      d="M14 5h5v5M19 5l-7 7M10 5H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"
                    />
                  </svg>
                </button>
                {/* Split: cut the current point in two at the playhead — a
                    fused pair of rallies. Available DURING playback (the
                    reviewer taps when the 2nd serve starts), hidden in
                    review/summary and until the callbacks are wired. */}
                {phase === "play" && onSplit && (
                  <button
                    type="button"
                    onClick={() => void splitHere()}
                    disabled={!canSplit}
                    aria-label="Split this point here"
                    title="Split here"
                    className="rounded-full border border-edge bg-surface p-2.5 text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white disabled:opacity-40"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      aria-hidden="true"
                    >
                      <circle cx="6" cy="6" r="2.6" />
                      <circle cx="6" cy="18" r="2.6" />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M8.3 7.7 20 16M8.3 16.3 20 8"
                      />
                    </svg>
                  </button>
                )}
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
                {/* mode toggle: X on the pad ↔ the watch-mode pill */}
                <button
                  type="button"
                  onClick={() => {
                    resetZoom(); // zoom is a score-mode affordance
                    setMode("watch");
                  }}
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

            {/* Skip + Delete: one thin row above the winner buttons.
                Skip (amber, like the timeline rows' Skip pills) = a let
                serve — the rally happened but doesn't count. Delete (red,
                like the app's trash affordances) = dead space — not a
                point at all; its footage stops playing. The tiny sub-
                labels are deliberate: the owner asked for the clarifying
                micro-copy here. Both flash + jump to the next rally, and
                both undo from the pad's stack. */}
            <div className="flex shrink-0 gap-3">
              <button
                type="button"
                onClick={tapSkip}
                disabled={!canTap}
                className="h-11 min-w-0 flex-1 rounded-xl border border-amber-400/40 bg-amber-400/5 text-amber-300 transition-colors hover:border-amber-400/60 hover:bg-amber-400/10 active:scale-[0.99] disabled:opacity-40"
              >
                <span className="block text-xs font-semibold leading-tight">
                  Skip
                </span>
                <span className="block text-[10px] leading-tight text-amber-300/60">
                  let serve
                </span>
              </button>
              <button
                type="button"
                onClick={tapDelete}
                disabled={!canTap}
                className="h-11 min-w-0 flex-1 rounded-xl border border-red-400/40 bg-red-500/5 text-red-300 transition-colors hover:border-red-400/60 hover:bg-red-500/10 active:scale-[0.99] disabled:opacity-40"
              >
                <span className="block text-xs font-semibold leading-tight">
                  Delete
                </span>
                <span className="block text-[10px] leading-tight text-red-300/60">
                  dead space
                </span>
              </button>
            </div>

            <div className="flex min-h-0 flex-1 gap-3">
              <button
                type="button"
                onClick={() => tapSide("user")}
                disabled={!canTap}
                aria-pressed={litYou}
                className={`min-w-0 flex-1 rounded-2xl border px-2 text-2xl font-bold transition-all active:scale-[0.98] disabled:opacity-40 ${
                  litYou
                    ? "glow-ring border-cyan-glow bg-cyan-glow/25 text-cyan-glow"
                    : "border-cyan-glow/30 bg-cyan-glow/5 text-cyan-glow"
                }`}
              >
                <span className="block truncate">{youLabel}</span>
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
              ← {youLabel} · → {themLabel} · U undo · K skip · S star · Space
              pause
            </p>
          </div>
        </>
      )}

      {/* step 0: setup sheet — player names (when the reel-usable names
          are incomplete) and/or first server (when the match has none
          yet). Both missing = ONE combined sheet; a serve answer or Done
          confirms, the quiet Skip never blocks scoring. */}
      {open && (serveSheet || namesSheet) && (
        <div className="absolute inset-0 z-10 flex items-end justify-center bg-ink/70 backdrop-blur-sm sm:items-center">
          <div className="ks-fade w-full rounded-t-2xl border border-edge bg-surface p-5 pb-8 sm:max-w-sm sm:rounded-2xl sm:pb-5">
            {namesSheet && (
              <>
                <h2 className="text-base font-semibold">
                  Who&apos;s playing?
                </h2>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Names show on the scoreboard in shares and reels.
                </p>
                <div className="mt-3 grid grid-cols-1 gap-2">
                  <label className="block">
                    <span className="text-xs font-medium text-zinc-400">
                      Your name
                    </span>
                    <input
                      type="text"
                      value={draftYou}
                      onChange={(e) => setDraftYou(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        if (serveSheet)
                          (e.target as HTMLInputElement).blur();
                        else doneNamesSheet();
                      }}
                      placeholder="You"
                      className="mt-1 w-full rounded-lg border border-edge bg-ink/60 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-zinc-400">
                      Opponent&apos;s name
                    </span>
                    <input
                      type="text"
                      value={draftThem}
                      onChange={(e) => setDraftThem(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        if (serveSheet)
                          (e.target as HTMLInputElement).blur();
                        else doneNamesSheet();
                      }}
                      placeholder="Opponent"
                      className="mt-1 w-full rounded-lg border border-edge bg-ink/60 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600"
                    />
                  </label>
                </div>
              </>
            )}
            {serveSheet && (
              <>
                <h2
                  className={`text-base font-semibold ${
                    namesSheet ? "mt-5" : ""
                  }`}
                >
                  Who served first?
                </h2>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {(
                    [
                      { value: "user", label: youLabel },
                      {
                        value: "opponent",
                        label:
                          (namesSheet && draftThem.trim()) || themLabel,
                      },
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
              </>
            )}
            {namesSheet && !serveSheet && (
              <button
                type="button"
                onClick={doneNamesSheet}
                className="glow-cta mt-4 w-full rounded-full bg-cyan-glow px-6 py-2.5 text-sm font-semibold text-ink"
              >
                Done
              </button>
            )}
            <button
              type="button"
              onClick={skipSetupSheet}
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
            {unscored.length > 0 && (
              <div className="mt-4 flex items-center justify-center gap-3">
                <span className="text-sm text-zinc-400">
                  {unscored.length} unscored
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
