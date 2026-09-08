"use client";

/**
 * Mark the points: the scorekeeper's pad, pointed at the ORIGINAL upload.
 *
 * THE RHYTHM, and everything here serves it:
 *
 *   Begin Point  ->  End Point  ->  Me / Them / Let  ->  Begin Point ...
 *
 * Three taps per rally, and the video never stops for any of them. Begin
 * and End sit side by side because they are the same thought a beat apart;
 * having to cross the pad to end a rally is what made the first version
 * hard to use. The three answers share one row, and that row LIGHTS UP the
 * moment a point ends, because at that instant it is the only thing the pad
 * wants from you.
 *
 * A SEPARATE COMPONENT, NOT A THIRD MODE IN Player.tsx. That file is 8324
 * lines and its header is a behavioural spec of its own; the one feature
 * that must not break is the scorekeeper, and the cheapest way not to break
 * it is not to touch it. What is shared is shared by IMPORT (ClipPlayer,
 * serving, gameScore), so the ITTF rotation stays one implementation.
 *
 * TWO MODES, asked once on the way in. "Cut only" wants the rallies as
 * clips and nothing else, so it never shows a score, a server or an answer
 * row: a scoreboard nobody is filling in is furniture. "Cut and score"
 * is the full three-tap loop.
 *
 * WHAT THIS FILE NEVER COMPUTES: cut_t0, cut segments, or which seconds the
 * cut keeps. The worker does that once, through the same three functions
 * the automatic pipeline uses. See handCut.ts.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ClipPlayer, type PictureBox } from "./ClipPlayer";
import { computeMatchScore } from "./gameScore";
import { SpeedMenu } from "./SpeedMenu";
import { computeServing, type MatchServer } from "./serving";
import type { Point } from "@/lib/types";
import {
  type Mark,
  type MarkState,
  type Outcome,
  asPoints,
  clearAwaiting,
  lastClosedEnd as lastEnd,
  MIN_POINT_S,
  emptyState,
  endMark,
  openMark,
  resetOpen,
  selectMark,
  removeMark,
  setEdges,
  setOutcome,
  startMark,
  summarize,
  toggleStar,
  undoLast,
  validate,
} from "./handCut";

/** How long a refusal stays on screen. Long enough to read, gone before
 *  the next rally needs the space. */
const REFUSE_MS = 2000;

/** Draft autosave. Every tap re-arms it; nothing on screen waits for the
 *  network, so a flaky connection costs a later save and never a tap. */
const SAVE_DEBOUNCE_MS = 1500;

/** The floating desktop card, and where it was last dropped. Its own key,
 *  because it is a different card at a different size from Keep score's. */
/** The pads the worker cuts a hand-marked clip with, mirrored here so the
 *  preview shows the clip the player will actually get rather than the
 *  bare rally. Must match claim_hand_cut's clip_pads. */
const CLIP_PRE = 1.2;
const CLIP_POST = 1.3;

/** How far before a point Redo drops the playhead, so there is a run-up to
 *  the serve rather than landing on top of it. */
const REDO_LEAD_S = 3;

const PAD_WIDTH = 380;
const PAD_POS_KEY = "ponglens:mark-pad-pos";

let markSeq = 0;
const nextId = () => `m${++markSeq}-${Math.random().toString(36).slice(2, 8)}`;

/* ---------------------------------------------------------------- pieces */

/** A small utility control. Deliberately the SMALLEST thing on the pad:
 *  Undo and the seek pair are used a few times a session, and the rhythm
 *  buttons above them are used eighty. */
function Util({
  label,
  onClick,
  disabled,
  lit,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  lit?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`h-10 flex-1 rounded-lg border text-[11px] font-semibold transition-colors disabled:opacity-35 ${
        lit
          ? "border-amber-400/60 bg-amber-400/15 text-amber-300"
          : "border-edge bg-surface text-zinc-400 hover:border-cyan-glow/40 hover:text-zinc-100"
      }`}
    >
      {label}
    </button>
  );
}

/** One rally in the strip. Closed chips take their answer's colour; the
 *  open one grows, because an open rally's length is not yet known and a
 *  draining ring would be claiming otherwise. */
function MarkChip({
  n,
  mark,
  selected,
  awaiting,
  grow,
  onSelect,
}: {
  n: number;
  mark: Mark;
  selected: boolean;
  awaiting: boolean;
  grow: number;
  onSelect: () => void;
}) {
  const open = mark.t1 === null;
  const tone = open
    ? "border-cyan-glow bg-cyan-glow/10 text-cyan-glow"
    : mark.isLet
      ? "border-amber-400/50 bg-amber-400/10 text-amber-300/90"
      : mark.winner === "user"
        ? "border-cyan-glow/60 bg-cyan-glow/20 text-cyan-glow"
        : mark.winner === "opponent"
          ? "border-magenta-glow/60 bg-magenta-glow/20 text-magenta-soft"
          : "border-dashed border-zinc-600 bg-transparent text-zinc-500";
  const said = open
    ? "in progress"
    : mark.isLet
      ? "let"
      : mark.winner === "user"
        ? "you won"
        : mark.winner === "opponent"
          ? "they won"
          : "not called";
  return (
    <button
      type="button"
      data-chip={n}
      onClick={onSelect}
      aria-label={`Point ${n}, ${said}`}
      aria-current={open || awaiting ? "true" : undefined}
      className={`relative flex h-8 shrink-0 items-center justify-center overflow-hidden rounded-full border text-xs font-semibold tabular-nums transition-[width,transform,box-shadow] ${tone} ${
        selected ? "ring-2 ring-white/90" : ""
      } ${
        open || awaiting
          ? "scale-110 shadow-[0_0_12px_rgba(255,255,255,0.35)]"
          : ""
      }`}
      style={{ width: open ? Math.min(60, 32 + grow) : 32 }}
    >
      {open && (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 bg-cyan-glow/25 transition-[width] duration-300 ease-linear"
          style={{ width: `${Math.min(100, grow * 3)}%` }}
        />
      )}
      <span className="relative">{n}</span>
      {mark.starred && (
        <span
          aria-hidden="true"
          className="absolute right-0.5 top-0 text-[8px] leading-none text-amber-300"
        >
          &#9733;
        </span>
      )}
    </button>
  );
}

/* ---------------------------------------------------------------- screen */

export function MarkPoints({
  rawUrl,
  durationS,
  firstServer,
  youLabel,
  themLabel,
  initialMarks,
  saveDraft,
  submit,
  onClose,
}: {
  rawUrl: string;
  durationS: number | null;
  firstServer: MatchServer | null;
  youLabel: string;
  themLabel: string;
  initialMarks: Mark[];
  /** Best effort, debounced. Never blocks a tap. */
  saveDraft: (marks: Mark[]) => Promise<void>;
  /** Hands the marks to claim_hand_cut. Resolves to a message or null. */
  submit: (marks: Mark[]) => Promise<string | null>;
  onClose: () => void;
}) {
  const [state, setState] = useState<MarkState>(() =>
    initialMarks.length ? { ...emptyState, marks: initialMarks } : emptyState
  );
  /** Cut only, or cut and score? Asked once, before anything else, so the
   *  pad can drop the half of itself the answer does not need. */
  const [mode, setMode] = useState<"cut" | "score" | null>(null);
  /** Has the session started? Until it has, the pad is one button, because
   *  one button is the only thing there is to do. */
  const [started, setStarted] = useState(false);
  /** The pad's own speed control, mirroring the scorekeeper's. The picture
   *  gestures (hold left for 0.25x, hold right for 2x) still work, but the
   *  floating pad covers part of the frame and whichever half it sits on
   *  loses its gesture, so speed must also be reachable as a control. */
  const [speed, setSpeed] = useState(1);
  const [refusal, setRefusal] = useState<string | null>(null);
  /** Open when the player is adjusting a point's edges. */
  const [adjusting, setAdjusting] = useState<string | null>(null);
  /** While previewing a point, the second to stop at. Playing past the end
   *  of the clip would show footage the clip does not contain, which is the
   *  opposite of what a preview is for. */
  const previewUntil = useRef<number | null>(null);
  /** The edges being dragged in the Adjust sheet, before they are saved,
   *  and the fixed window the track draws. The window is computed ONCE on
   *  open: derived live from the draft it would rescale under the finger,
   *  which slides the other handle and moves the ground you are aiming at. */
  const [adjustDraft, setAdjustDraft] = useState<[number, number] | null>(null);
  const [adjustBounds, setAdjustBounds] = useState<[number, number] | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  /** The rally in progress, if there is one. Declared up here because the
   *  keyboard handler and the pair both branch on it. */
  const open = openMark(state.marks);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playApi = useRef<{ play: () => void; pause: () => void } | null>(null);
  /** ClipPlayer owns the playback rate: it re-applies its own on every
   *  load, so setting the element's rate directly gets silently reverted.
   *  The rail drives it through here instead, which also keeps the
   *  player's own speed pill in step. */
  const speedApi = useRef<{
    hold: (target: number) => void;
    release: () => void;
    set: (rate: number) => void;
  } | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const refuseTimer = useRef<number | null>(null);
  /**
   * Did WE pause the video, waiting for who won?
   *
   * Only set when End Point closes a rally in scoring mode. It matters that
   * this is a flag and not just "is it paused": a player who paused by hand
   * to look at something must not have the video yanked back into motion by
   * an answer, so only a pause this screen caused is one this screen undoes.
   */
  const pausedForAnswer = useRef(false);
  const saveTimer = useRef<number | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);

  /* -------------------------------------------------- layout, four shapes */

  // matchMedia rather than CSS variants: the desktop pad differs in
  // STRUCTURE (it drags and carries a key legend), not only in styling,
  // and the repo's dual-render idiom would mount two copies of a component
  // that owns a video.
  const [floating, setFloating] = useState(false);
  const [overlayPad, setOverlayPad] = useState(false);
  const [portrait, setPortrait] = useState(true);
  /** From the file itself. A 9:16 upload needs a different shape entirely,
   *  and guessing 16:9 would letterbox it. */
  const [ar, setAr] = useState(16 / 9);
  useEffect(() => {
    const desk = window.matchMedia("(min-width: 1024px) and (pointer: fine)");
    // Copied verbatim from Player.tsx so the two scorekeepers can never
    // disagree about what a phone in landscape is.
    const land = window.matchMedia(
      "(orientation: landscape) and (pointer: coarse) and (max-height: 500px)"
    );
    const port = window.matchMedia("(orientation: portrait)");
    const sync = () => {
      setFloating(desk.matches);
      setOverlayPad(land.matches);
      setPortrait(port.matches);
    };
    sync();
    desk.addEventListener("change", sync);
    land.addEventListener("change", sync);
    port.addEventListener("change", sync);
    return () => {
      desk.removeEventListener("change", sync);
      land.removeEventListener("change", sync);
      port.removeEventListener("change", sync);
    };
  }, []);

  /* ------------------------------------------------------- dragging (desktop) */

  const [padPos, setPadPos] = useState<{ x: number; y: number } | null>(null);
  const padCardRef = useRef<HTMLDivElement | null>(null);
  const padDragRef = useRef<{
    px: number;
    py: number;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);

  const clampPadPos = useCallback((p: { x: number; y: number }) => {
    const card = padCardRef.current;
    const w = card?.offsetWidth ?? PAD_WIDTH;
    const h = card?.offsetHeight ?? 480;
    return {
      x: Math.min(Math.max(8, p.x), Math.max(8, window.innerWidth - w - 8)),
      y: Math.min(Math.max(8, p.y), Math.max(8, window.innerHeight - h - 8)),
    };
  }, []);

  useEffect(() => {
    if (!floating) return;
    try {
      const raw = localStorage.getItem(PAD_POS_KEY);
      if (raw) {
        const v = JSON.parse(raw);
        if (typeof v?.x === "number" && typeof v?.y === "number") {
          setPadPos(clampPadPos(v));
        }
      }
    } catch {
      // Storage blocked, or someone else's value. The default spot is fine.
    }
  }, [floating, clampPadPos]);

  const padDragHandlers = {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const t = e.target as HTMLElement;
      if (t.closest("button, a, input, textarea, select")) return;
      const card = padCardRef.current;
      if (!card) return;
      // Kills the text selection a drag across the score would start. Safe
      // here: interactive targets already returned above.
      e.preventDefault();
      const r = card.getBoundingClientRect();
      padDragRef.current = {
        px: e.clientX,
        py: e.clientY,
        x: r.left,
        y: r.top,
        moved: false,
      };
      card.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const d = padDragRef.current;
      const card = padCardRef.current;
      if (!d || !card) return;
      const dx = e.clientX - d.px;
      const dy = e.clientY - d.py;
      if (!d.moved && Math.hypot(dx, dy) < 3) return;
      d.moved = true;
      const next = clampPadPos({ x: d.x + dx, y: d.y + dy });
      card.style.left = `${next.x}px`;
      card.style.top = `${next.y}px`;
      card.style.right = "auto";
      card.style.transform = "none";
      card.style.cursor = "grabbing";
    },
    onPointerUp: () => {
      const d = padDragRef.current;
      padDragRef.current = null;
      const card = padCardRef.current;
      if (card) card.style.cursor = "";
      if (!d?.moved || !card) return;
      const r = card.getBoundingClientRect();
      const next = clampPadPos({ x: r.left, y: r.top });
      setPadPos(next);
      try {
        localStorage.setItem(PAD_POS_KEY, JSON.stringify(next));
      } catch {
        // Storage blocked; the drag still holds for this session.
      }
    },
    onPointerCancel: () => {
      padDragRef.current = null;
      const card = padCardRef.current;
      if (card) card.style.cursor = "";
    },
  };

  /* ------------------------------------------------------------- the taps */

  /** The live clock, never the last timeupdate. At 2x a throttled tick is
   *  most of a second of video, and a mark taken off a stale one is wrong
   *  by exactly the amount the player can see. */
  const nowT = useCallback(() => {
    const v = videoRef.current;
    if (!v || !Number.isFinite(v.currentTime)) return 0;
    return v.currentTime;
  }, []);

  const rateNow = useCallback(() => {
    const v = videoRef.current;
    return v && v.playbackRate > 0 ? v.playbackRate : 1;
  }, []);

  const chooseSpeed = useCallback((rate: number) => {
    setSpeed(rate);
    speedApi.current?.set(rate);
  }, []);

  const refuse = useCallback((why: string) => {
    setRefusal(why);
    if (refuseTimer.current) window.clearTimeout(refuseTimer.current);
    refuseTimer.current = window.setTimeout(() => setRefusal(null), REFUSE_MS);
  }, []);

  const apply = useCallback(
    (next: { state: MarkState; refused?: string }) => {
      if (next.refused) {
        refuse(next.refused);
        return;
      }
      setState(next.state);
    },
    [refuse]
  );

  /** The one button before anything has begun. It starts playback in the
   *  same gesture, because "begin" and "and now watch it" are one thought,
   *  and because a browser only lets a video play from a real user tap. */
  const beginCutting = useCallback(() => {
    setStarted(true);
    playApi.current?.play();
  }, []);

  /**
   * Reopening a draft lands where the marking stopped, not at zero.
   * A refresh in the middle of a 40 minute pass would otherwise mean
   * scrubbing back by hand to find the place, which is the moment someone
   * gives up on the feature. Runs once, on the first metadata event.
   */
  const resumedRef = useRef(false);
  const resumeToLastPoint = useCallback(() => {
    if (resumedRef.current) return;
    resumedRef.current = true;
    const last = lastEnd(stateRef.current.marks);
    const v = videoRef.current;
    if (last === null || !v) return;
    const d = Number.isFinite(v.duration) ? v.duration : Infinity;
    v.currentTime = Math.max(0, Math.min(d - 0.1, last));
    setPlayhead(v.currentTime);
  }, []);

  /** Let it run again, if we were the ones holding it. */
  const resumeAfterAnswer = useCallback(() => {
    if (!pausedForAnswer.current) return;
    pausedForAnswer.current = false;
    playApi.current?.play();
  }, []);

  /**
   * Reset: the Begin tap was too early.
   *
   * Throws the open rally away and rewinds to where the last finished
   * point ended, then plays, so the run-up to the serve comes round again.
   * Pressing Begin a beat early happens constantly; this is the fix for it
   * that does not require ending a rally which never started.
   */
  const tapReset = useCallback(() => {
    const { state: next, backTo } = resetOpen(stateRef.current);
    setState(next);
    previewUntil.current = null;
    pausedForAnswer.current = false;
    const v = videoRef.current;
    if (v) {
      v.currentTime = Math.max(0, backTo);
      setPlayhead(v.currentTime);
    }
    playApi.current?.play();
  }, []);

  const tapBegin = useCallback(() => {
    // Held for an answer, and they pressed on instead. Carry on and leave
    // the point uncalled. It cannot start a rally here: the video has not
    // moved since the last one ended, so a new point would begin before
    // that end and be refused, which would strand the session with the
    // picture frozen and no way forward.
    if (pausedForAnswer.current) {
      setState((s) => clearAwaiting(s));
      resumeAfterAnswer();
      refuse("Left uncalled.");
      return;
    }
    apply(startMark(stateRef.current, nowT(), rateNow(), nextId()));
  }, [apply, nowT, rateNow, resumeAfterAnswer, refuse]);

  const tapEnd = useCallback(() => {
    const next = endMark(stateRef.current, nowT());
    apply(next);
    // Hold the picture until the point is called. Watching the next rally
    // start while still deciding who won the last one is the thing that
    // makes a pass feel rushed, and the answer row is already pulsing for
    // it. Cut-only mode has nothing to answer, so it never stops.
    if (!next.refused && mode === "score") {
      playApi.current?.pause();
      pausedForAnswer.current = true;
    }
  }, [apply, nowT, mode]);

  const tapAnswer = useCallback(
    (o: Outcome) => {
      const next = setOutcome(stateRef.current, o);
      apply(next);
      if (!next.refused) resumeAfterAnswer();
    },
    [apply, resumeAfterAnswer]
  );

  /**
   * Tapping a chip plays that point's CLIP back, padded exactly as the
   * worker will cut it, and stops where the clip stops.
   *
   * Without this a marked point is a number on a strip and nobody can tell
   * whether the cut is any good, which is the one thing worth checking
   * before committing eighty of them.
   */
  const tapChip = useCallback(
    (id: string) => {
      const s = stateRef.current;
      const wasSelected = s.selectedId === id;
      setState(selectMark(s, id));
      const m = s.marks.find((x) => x.id === id);
      const v = videoRef.current;
      if (wasSelected || !m || m.t1 === null || !v) {
        previewUntil.current = null;
        return;
      }
      pausedForAnswer.current = false;
      v.currentTime = Math.max(0, m.t0 - CLIP_PRE);
      setPlayhead(v.currentTime);
      previewUntil.current = m.t1 + CLIP_POST;
      playApi.current?.play();
    },
    []
  );

  /** Back to where the marking had got to. */
  const resumeMarking = useCallback(() => {
    setState((s) => selectMark(s, null));
    previewUntil.current = null;
    const last = lastEnd(stateRef.current.marks);
    const v = videoRef.current;
    if (v && last !== null) {
      v.currentTime = Math.max(0, last);
      setPlayhead(v.currentTime);
    }
    playApi.current?.play();
  }, []);

  /**
   * Start this point over. The mark goes, and the playhead lands a few
   * seconds before it began so there is a run-up to the serve — but never
   * back inside the previous rally, which is already cut and does not want
   * re-watching.
   */
  const redoPoint = useCallback((id: string) => {
    const s = stateRef.current;
    const i = s.marks.findIndex((m) => m.id === id);
    if (i < 0) return;
    const m = s.marks[i];
    const prevEnd = i > 0 ? s.marks[i - 1].t1 : null;
    const to = Math.max(
      prevEnd ?? 0,
      Math.max(0, m.t0 - REDO_LEAD_S)
    );
    setState(selectMark(removeMark(s, id).state, null));
    setAdjusting(null);
    previewUntil.current = null;
    const v = videoRef.current;
    if (v) {
      v.currentTime = to;
      setPlayhead(to);
    }
    playApi.current?.play();
  }, []);

  const tapUndo = useCallback(() => {
    setState((s) => undoLast(s));
    // Undoing the end reopens the rally, so the picture has to run again.
    resumeAfterAnswer();
  }, [resumeAfterAnswer]);

  const tapStar = useCallback(() => {
    const s = stateRef.current;
    const target =
      s.awaitingId ??
      s.selectedId ??
      openMark(s.marks)?.id ??
      s.marks[s.marks.length - 1]?.id ??
      null;
    if (target) apply(toggleStar(s, target));
  }, [apply]);

  const seekBy = useCallback((delta: number) => {
    const v = videoRef.current;
    if (!v) return;
    const d = Number.isFinite(v.duration) ? v.duration : Infinity;
    v.currentTime = Math.max(0, Math.min(d - 0.05, v.currentTime + delta));
  }, []);

  /* ------------------------------------------------------------- keyboard */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || reviewing) return;
      const t = e.target;
      if (t instanceof HTMLElement && t.closest("input, textarea, select")) return;

      if (!started) {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          beginCutting();
        }
        return;
      }

      switch (e.key) {
        case " ":
          e.preventDefault();
          // Taking manual control releases our hold, either direction.
          pausedForAnswer.current = false;
          if (videoRef.current?.paused) playApi.current?.play();
          else playApi.current?.pause();
          return;
        case "s":
        case "S":
          e.preventDefault();
          if (open) tapReset();
          else tapBegin();
          return;
        case "e":
        case "E":
          e.preventDefault();
          tapEnd();
          return;
        case "ArrowLeft":
          e.preventDefault();
          if (e.shiftKey || mode === "cut") seekBy(-10);
          else tapAnswer("user");
          return;
        case "ArrowRight":
          e.preventDefault();
          if (e.shiftKey || mode === "cut") seekBy(10);
          else tapAnswer("opponent");
          return;
        case "k":
        case "K":
        case "l":
        case "L":
          if (mode === "cut") return;
          e.preventDefault();
          tapAnswer("let");
          return;
        case "u":
        case "U":
          e.preventDefault();
          tapUndo();
          return;
        case "t":
        case "T":
          e.preventDefault();
          tapStar();
          return;
        default:
          return;
      }
    };
    // CAPTURE PHASE. A focused <video> swallows keys, which FullMatch.tsx
    // records having cost this repo a round already.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [
    mode,
    speed,
    chooseSpeed,
    started,
    beginCutting,
    open,
    tapBegin,
    tapReset,
    tapEnd,
    tapAnswer,
    tapUndo,
    tapStar,
    seekBy,
    reviewing,
  ]);

  /* ---------------------------------------------------------- draft saves */

  useEffect(() => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void saveDraft(stateRef.current.marks).catch(() => {
        // Deliberately silent. The strip renders from local state, so a
        // failed save costs a later retry and never a tap.
      });
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [state.marks, saveDraft]);

  /* ------------------------------------------------------- derived scores */

  const awaiting = state.awaitingId !== null;
  const canAnswer = awaiting || state.selectedId !== null;
  const sum = useMemo(() => summarize(state.marks), [state.marks]);

  // The rotation and the game walk are the product's own, never re-derived.
  const scorePoints = useMemo(
    () => asPoints(state.marks) as unknown as Point[],
    [state.marks]
  );
  const score = useMemo(() => computeMatchScore(scorePoints), [scorePoints]);
  const nextServer: MatchServer | null = useMemo(() => {
    if (!scorePoints.length) return firstServer;
    const probe = [
      ...scorePoints,
      {
        id: "__next__",
        confirmed_winner: null,
        is_let: false,
        server_override: null,
        game_end_override: null,
        game_winner_override: null,
      } as unknown as Point,
    ];
    return computeServing(probe, firstServer).get("__next__")?.server ?? null;
  }, [scorePoints, firstServer]);

  const grow = open ? Math.max(0, playhead - open.t0) : 0;

  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    el.scrollTo({ left: el.scrollWidth, behavior: "smooth" });
  }, [state.marks.length]);

  /* --------------------------------------------------------------- submit */

  const doSubmit = useCallback(async () => {
    const check = validate(stateRef.current.marks, durationS);
    if (!check.ok) {
      setSubmitError(check.reason);
      return;
    }
    setBusy(true);
    setSubmitError(null);
    const err = await submit(stateRef.current.marks);
    setBusy(false);
    if (err) setSubmitError(err);
    else onClose();
  }, [durationS, submit, onClose]);

  /* ----------------------------------------------------------- pad pieces */

  const ticker = (
    <div
      className={
        overlayPad
          ? "pointer-events-auto flex items-center gap-2 rounded-xl bg-ink/50 px-3 backdrop-blur-sm"
          : "flex w-full shrink-0 items-center gap-3 border-b border-edge/60 px-3 py-2"
      }
      style={overlayPad ? { height: 30 } : undefined}
    >
      <span className="flex items-baseline gap-2">
        {mode === "cut" ? (
          <span
            className={`font-bold tabular-nums tracking-tight text-zinc-200 ${
              overlayPad ? "text-base" : "text-2xl"
            }`}
          >
            {sum.total}
            <span className="ml-1.5 text-[11px] font-medium text-zinc-500">
              {sum.total === 1 ? "point" : "points"}
            </span>
          </span>
        ) : (
          <>
            <span
              className={`font-bold tabular-nums tracking-tight ${
                overlayPad ? "text-base" : "text-2xl"
              }`}
            >
              <span className="text-cyan-glow">{score.current.you}</span>
              <span className="mx-1 text-zinc-600">-</span>
              <span className="text-magenta-soft">{score.current.them}</span>
            </span>
            {score.gamesYou + score.gamesThem > 0 && (
              <span className="rounded-full border border-edge bg-surface px-2 py-0.5 text-[11px] font-semibold tabular-nums text-zinc-300">
                {score.gamesYou}-{score.gamesThem}
              </span>
            )}
          </>
        )}
      </span>
      {mode !== "cut" && nextServer && (
        <span className="ml-auto flex items-center gap-2 text-[11px] text-zinc-400">
          <span
            className={`block h-2.5 w-2.5 rounded-full ${
              nextServer === "user" ? "bg-cyan-glow" : "bg-magenta-soft"
            }`}
            aria-hidden="true"
          />
          {!overlayPad &&
            (nextServer === "user" ? `${youLabel} serves` : `${themLabel} serves`)}
        </span>
      )}
    </div>
  );

  const strip = (
    <div
      ref={stripRef}
      className={
        overlayPad
          ? "pointer-events-auto flex items-center gap-1.5 overflow-x-auto rounded-xl bg-ink/50 px-2 backdrop-blur-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          : "flex w-full shrink-0 items-center gap-1.5 overflow-x-auto border-b border-edge/60 px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      }
      style={overlayPad ? { height: 32 } : { minHeight: 52 }}
    >
      {state.marks.length === 0 ? (
        <span className="text-[11px] text-zinc-500">Nothing marked yet.</span>
      ) : (
        state.marks.map((m, i) => (
          <MarkChip
            key={m.id}
            n={i + 1}
            mark={m}
            selected={state.selectedId === m.id}
            awaiting={state.awaitingId === m.id}
            grow={m.t1 === null ? grow : 0}
            onSelect={() => tapChip(m.id)}
          />
        ))
      )}
    </div>
  );

  /** The rhythm pair. The biggest thing on the pad, because it is what the
   *  session is: begin a rally, end a rally, eighty times. Whichever one is
   *  next is the lit one, so the pad always says what to press. */
  /**
   * The pair. Begin and End while marking; Adjust and Resume once an
   * existing point is selected, because Begin and End mean nothing to a
   * rally whose edges are already set. Same two slots either way, so
   * nothing on the pad moves under a thumb.
   */
  const selectedMark = state.selectedId
    ? state.marks.find((m) => m.id === state.selectedId) ?? null
    : null;
  const reviewing_ = selectedMark !== null && selectedMark.t1 !== null;

  const rhythmPair = reviewing_ ? (
    <div className="flex shrink-0 gap-2">
      <button
        type="button"
        onClick={() => {
          if (!selectedMark || selectedMark.t1 === null) return;
          const i = state.marks.findIndex((x) => x.id === selectedMark.id);
          const prevEnd = i > 0 ? state.marks[i - 1].t1 ?? 0 : 0;
          const nextStart =
            i < state.marks.length - 1
              ? state.marks[i + 1].t0
              : durationS ?? selectedMark.t1 + 30;
          setAdjustDraft([selectedMark.t0, selectedMark.t1]);
          // Reach past the clip on both sides so an edge can be dragged
          // outwards, but never into a neighbouring rally.
          setAdjustBounds([
            Math.max(prevEnd, selectedMark.t0 - 8),
            Math.min(nextStart, selectedMark.t1 + 8),
          ]);
          setAdjusting(selectedMark.id);
          playApi.current?.pause();
        }}
        className="glow-cta h-16 flex-1 rounded-xl border-2 border-cyan-glow bg-cyan-glow text-base font-bold text-ink transition-colors active:scale-[0.99]"
      >
        Adjust
      </button>
      <button
        type="button"
        onClick={resumeMarking}
        className="h-16 flex-1 rounded-xl border-2 border-edge bg-surface text-base font-bold text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white active:scale-[0.99]"
      >
        Resume
      </button>
    </div>
  ) : (
    <div className="flex shrink-0 gap-2">
      <button
        type="button"
        onClick={open ? tapReset : tapBegin}
        className={`h-16 flex-1 rounded-xl border-2 text-base font-bold transition-colors active:scale-[0.99] ${
          open
            ? "border-edge bg-surface text-zinc-400 hover:border-amber-400/50 hover:text-amber-200"
            : "glow-cta border-cyan-glow bg-cyan-glow text-ink"
        }`}
      >
        {open ? "Reset" : "Begin Point"}
      </button>
      <button
        type="button"
        onClick={tapEnd}
        disabled={!open}
        className={`h-16 flex-1 rounded-xl border-2 text-base font-bold transition-colors active:scale-[0.99] disabled:opacity-35 ${
          open
            ? "glow-cta border-cyan-glow bg-cyan-glow text-ink"
            : "border-edge bg-surface text-zinc-400"
        }`}
      >
        End Point
      </button>
    </div>
  );

  /** The three answers, one row. They pulse the instant a point ends,
   *  because that is the only moment the pad is waiting on the player. */
  const answerRow = (
    <div className="flex shrink-0 gap-2">
      {(
        [
          ["user", youLabel, "border-cyan-glow bg-cyan-glow/15 text-cyan-glow"],
          ["opponent", themLabel, "border-magenta-glow bg-magenta-glow/15 text-magenta-soft"],
          ["let", "Let", "border-amber-400/70 bg-amber-400/10 text-amber-300"],
        ] as const
      ).map(([value, label, lit]) => (
        <button
          key={value}
          type="button"
          onClick={() => tapAnswer(value)}
          disabled={!canAnswer}
          className={`h-14 min-w-0 flex-1 rounded-xl border px-1 text-base font-bold transition-all active:scale-[0.98] disabled:opacity-30 ${
            canAnswer ? lit : "border-edge bg-surface text-zinc-500"
          } ${awaiting ? "animate-pulse ring-2 ring-white/60" : ""}`}
        >
          <span className="block truncate">{label}</span>
        </button>
      ))}
    </div>
  );

  const utilRow = (
    <div className="flex shrink-0 gap-2">
      <Util label="Undo" onClick={tapUndo} disabled={state.undo.length === 0} />
      <Util
        label="Star"
        onClick={tapStar}
        disabled={state.marks.length === 0}
        lit={
          !!state.marks.find(
            (m) => m.id === (state.awaitingId ?? state.selectedId)
          )?.starred
        }
      />
      <Util label="-10s" onClick={() => seekBy(-10)} />
      <Util label="+10s" onClick={() => seekBy(10)} />
      <SpeedMenu
        value={speed}
        onChange={chooseSpeed}
        drop="up"
        containerClassName="relative flex-1"
        className="flex h-10 w-full items-center justify-center rounded-lg border border-edge bg-surface text-[11px] font-semibold tabular-nums text-zinc-400 transition-colors hover:border-cyan-glow/40 hover:text-zinc-100"
      />
    </div>
  );

  const legend = (
    <div className="hidden shrink-0 flex-wrap gap-x-3 gap-y-1 text-[10px] text-zinc-500 lg:flex">
      {(mode === "cut"
        ? [
            ["S", open ? "Reset" : "Begin"],
            ["E", "End"],
            ["U", "Undo"],
            ["T", "Star"],
            ["Space", "Play"],
          ]
        : [
            ["S", open ? "Reset" : "Begin"],
            ["E", "End"],
            ["←", youLabel],
            ["→", themLabel],
            ["K", "Let"],
            ["U", "Undo"],
            ["T", "Star"],
            ["Space", "Play"],
          ]
      ).map(([k, v]) => (
        <span key={k} className="flex items-center gap-1">
          <kbd className="rounded border border-edge bg-surface px-1 py-0.5 font-mono text-[9px] text-zinc-400">
            {k}
          </kbd>
          {v}
        </span>
      ))}
    </div>
  );

  const doneButton = (
    <button
      type="button"
      onClick={() => {
        playApi.current?.pause();
        setReviewing(true);
      }}
      disabled={sum.total === 0}
      className="shrink-0 rounded-full border border-edge px-4 py-2 text-xs font-semibold text-zinc-200 transition-colors hover:border-cyan-glow/50 disabled:opacity-40"
    >
      Done
    </button>
  );

  const beginCuttingButton = (
    <button
      type="button"
      onClick={beginCutting}
      className="glow-cta h-16 w-full shrink-0 rounded-xl bg-cyan-glow text-base font-bold text-ink active:scale-[0.99]"
    >
      Begin Cutting
    </button>
  );

  const refusalLine = refusal ? (
    <p
      role="status"
      className="shrink-0 text-center text-[12px] font-semibold text-amber-300"
    >
      {refusal}
    </p>
  ) : null;

  /* -------------------------------------------------------------- overlay */

  const landscapeBands = useCallback(
    (picture: PictureBox) => {
      // Two floors on purpose. The left column only clears the transport;
      // the right one also clears ClipPlayer's speed and zoom pills, which
      // live in the bottom-RIGHT corner about 26px above it. Measured
      // against the rendered player, not assumed.
      const base = picture.chromeFloor + 6;
      const baseRight = picture.chromeFloor + 34;
      const tile =
        "pointer-events-auto rounded-xl border font-bold backdrop-blur-sm transition-all disabled:opacity-30 active:scale-[0.98]";
      return (
        <div className="pointer-events-none absolute inset-0 z-10">
          <div className="absolute left-1 top-1">{ticker}</div>
          <div
            className="absolute"
            style={{ left: 116, right: 176, top: 38 }}
          >
            {strip}
          </div>
          <div className="pointer-events-auto absolute" style={{ right: 76, top: 4 }}>
            {doneButton}
          </div>

          {!started ? (
            <button
              type="button"
              onClick={beginCutting}
              className={`${tile} glow-cta absolute border-cyan-glow bg-cyan-glow text-ink`}
              style={{
                left: "50%",
                bottom: base + 40,
                transform: "translateX(-50%)",
                width: 200,
                height: 56,
              }}
            >
              Begin Cutting
            </button>
          ) : (
            <>
              {/* left thumb: the pair, in the same two boxes whichever
                  meaning they carry, so nothing moves under a thumb */}
              <button
                type="button"
                onClick={reviewing_ ? resumeMarking : tapEnd}
                disabled={!reviewing_ && !open}
                className={`${tile} absolute ${
                  !reviewing_ && open
                    ? "glow-cta border-cyan-glow bg-cyan-glow text-ink"
                    : "border-edge bg-ink/70 text-zinc-300"
                }`}
                style={{ left: 4, bottom: base, width: 100, height: 62 }}
              >
                {reviewing_ ? "Resume" : "End Point"}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!reviewing_) {
                    if (open) tapReset();
                    else tapBegin();
                    return;
                  }
                  if (!selectedMark || selectedMark.t1 === null) return;
                  const idx = state.marks.findIndex(
                    (x) => x.id === selectedMark.id
                  );
                  const prevEnd = idx > 0 ? state.marks[idx - 1].t1 ?? 0 : 0;
                  const nextStart =
                    idx < state.marks.length - 1
                      ? state.marks[idx + 1].t0
                      : durationS ?? selectedMark.t1 + 30;
                  setAdjustDraft([selectedMark.t0, selectedMark.t1]);
                  setAdjustBounds([
                    Math.max(prevEnd, selectedMark.t0 - 8),
                    Math.min(nextStart, selectedMark.t1 + 8),
                  ]);
                  setAdjusting(selectedMark.id);
                  playApi.current?.pause();
                }}
                className={`${tile} absolute ${
                  reviewing_ || !open
                    ? "glow-cta border-cyan-glow bg-cyan-glow text-ink"
                    : "border-edge bg-ink/70 text-zinc-300"
                }`}
                style={{ left: 4, bottom: base + 68, width: 100, height: 62 }}
              >
                {reviewing_ ? "Adjust" : open ? "Reset" : "Begin Point"}
              </button>
              <button
                type="button"
                onClick={tapUndo}
                disabled={state.undo.length === 0}
                className={`${tile} absolute border-white/15 bg-ink/60 text-[11px] font-semibold text-zinc-200`}
                style={{ left: 4, bottom: base + 136, width: 100, height: 34 }}
              >
                Undo
              </button>

              {/* right thumb: the three answers, pulsing when asked for */}
              {(
                [
                  ["let", "Let", "border-amber-400/70 bg-amber-400/15 text-amber-300", 0],
                  ["opponent", themLabel, "border-magenta-glow bg-magenta-glow/20 text-magenta-soft", 40],
                  ["user", youLabel, "border-cyan-glow bg-cyan-glow/20 text-cyan-glow", 106],
                ] as const
              ).map(([value, label, lit, offset]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => tapAnswer(value)}
                  disabled={!canAnswer}
                  className={`${tile} absolute px-1 ${
                    canAnswer ? lit : "border-edge bg-ink/60 text-zinc-500"
                  } ${awaiting ? "animate-pulse ring-2 ring-white/60" : ""}`}
                  style={{
                    right: 4,
                    bottom: baseRight + offset,
                    width: 104,
                    height: value === "let" ? 34 : 60,
                  }}
                >
                  <span className="block truncate">{label}</span>
                </button>
              ))}
            </>
          )}

          {refusal && (
            <p
              role="status"
              className="pointer-events-none absolute inset-x-0 text-center text-[12px] font-semibold text-amber-300"
              style={{ top: 78 }}
            >
              {refusal}
            </p>
          )}
        </div>
      );
    },
    [
      ticker,
      strip,
      doneButton,
      started,
      beginCutting,
      open,
      tapBegin,
      tapEnd,
      tapUndo,
      tapAnswer,
      canAnswer,
      awaiting,
      state.undo.length,
      youLabel,
      themLabel,
      refusal,
    ]
  );

  /* ------------------------------------------------------------ pad body */

  const padBody = (
    <>
      {/* The grab bar is the one place that LOOKS draggable. The whole card
          drags from any dead space, but an affordance has to say so. */}
      {floating && (
        <div
          className="flex h-5 shrink-0 items-center justify-center"
          style={{ cursor: "grab" }}
          title="Drag to move"
          aria-hidden="true"
        >
          <span className="h-1 w-9 rounded-full bg-white/20" />
        </div>
      )}
      {ticker}
      {strip}
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 p-3">
        {refusalLine}
        {!started ? (
          beginCuttingButton
        ) : (
          <>
            {rhythmPair}
            {mode !== "cut" && answerRow}
            {utilRow}
          </>
        )}
        <div className="flex shrink-0 items-center justify-between gap-2">
          <span className="text-[11px] text-zinc-500">
            {mode === "cut"
              ? sum.open
                ? "One point still open"
                : ""
              : `${sum.total} ${sum.total === 1 ? "point" : "points"}`}
          </span>
          {doneButton}
        </div>
        {legend}
      </div>
    </>
  );

  /* --------------------------------------------------------------- render */

  return (
    <div
      className={`fixed inset-0 z-[80] flex bg-ink ${
        floating ? "flex-col" : "portrait:flex-col landscape:flex-row"
      }`}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {/* The box is sized on this div, never on the element: a media element
          has no intrinsic size until metadata arrives. */}
      <div
        className={
          overlayPad || floating
            ? "relative min-h-0 flex-1"
            : portrait
              ? "relative w-full shrink-0"
              : "relative h-full flex-1"
        }
        style={
          !overlayPad && !floating && portrait
            ? {
                // A min() of the two real limits. Never viewport-minus-a-
                // constant: that is comfortable at 844 and brutal at 660.
                height: `min(calc(100vw / ${ar.toFixed(4)}), 42dvh)`,
              }
            : undefined
        }
      >
        <ClipPlayer
          src={rawUrl}
          mode="cut"
          fill
          readPixels={false}
          videoElRef={videoRef}
          playRef={playApi}
          speedRef={speedApi}
          onTime={(el) => {
            setPlayhead(el.currentTime);
            const stop = previewUntil.current;
            if (stop !== null && el.currentTime >= stop) {
              previewUntil.current = null;
              playApi.current?.pause();
            }
          }}
          onLoadedMetadata={(el) => {
            if (el.videoWidth > 0 && el.videoHeight > 0) {
              setAr(el.videoWidth / el.videoHeight);
            }
            resumeToLastPoint();
          }}
          onClose={onClose}
          overlay={overlayPad ? landscapeBands : undefined}
        />
      </div>

      {!overlayPad &&
        (floating ? (
          <div className="pointer-events-none absolute inset-0 z-10">
            <div
              ref={padCardRef}
              {...padDragHandlers}
              className="pointer-events-auto absolute flex max-h-[calc(100%-2rem)] flex-col overflow-y-auto rounded-2xl border border-edge bg-ink/90 shadow-2xl shadow-black/50 backdrop-blur-md"
              style={{
                width: PAD_WIDTH,
                ...(padPos
                  ? { left: padPos.x, top: padPos.y }
                  : { right: 24, top: "50%", transform: "translateY(-50%)" }),
              }}
            >
              {padBody}
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-col portrait:flex-1 landscape:h-full landscape:w-[380px] landscape:flex-none landscape:overflow-y-auto landscape:border-l landscape:border-edge">
            {padBody}
          </div>
        ))}

      {/* Adjust: the point's edges on a track, dragged. Modelled on the
          scorekeeper's own Modify sheet (ModifyClip.tsx) — the same cyan
          band for what the clip keeps, the same handle as a line with a
          ringed knob, the same rule that the picture follows the handle so
          the frame under your finger is the one you are judging. */}
      {adjusting && adjustDraft && adjustBounds && (() => {
        const m = state.marks.find((x) => x.id === adjusting);
        if (!m || m.t1 === null) return null;
        const [dT0, dT1] = adjustDraft;
        const i = state.marks.findIndex((x) => x.id === adjusting);
        const [lo, hi] = adjustBounds;
        const span = Math.max(0.5, hi - lo);
        const pct = (t: number) => ((t - lo) / span) * 100;
        const fromX = (clientX: number, el: HTMLElement) => {
          const r = el.getBoundingClientRect();
          const f = Math.min(1, Math.max(0, (clientX - r.left) / Math.max(1, r.width)));
          return lo + f * span;
        };
        const drag = (edge: "start" | "end") => ({
          onPointerDown: (e: React.PointerEvent) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          },
          onPointerMove: (e: React.PointerEvent) => {
            if (!(e.buttons & 1) && e.pointerType === "mouse") return;
            const track = (e.currentTarget as HTMLElement).parentElement;
            if (!track) return;
            const t = fromX(e.clientX, track);
            setAdjustDraft((d) => {
              if (!d) return d;
              const [a, b] = d;
              const clamped = Math.min(hi, Math.max(lo, t));
              return edge === "start"
                ? [Math.min(clamped, b - MIN_POINT_S), b]
                : [a, Math.max(clamped, a + MIN_POINT_S)];
            });
            const v = videoRef.current;
            if (v) {
              v.currentTime = Math.max(0, t);
              setPlayhead(v.currentTime);
            }
          },
        });
        return (
          <div className="absolute inset-0 z-30 flex items-end justify-center bg-ink/70 backdrop-blur-sm sm:items-center">
            <div className="ks-fade w-full rounded-t-2xl border border-edge bg-surface p-5 pb-8 sm:max-w-md sm:rounded-2xl sm:pb-5">
              <h2 className="text-base font-semibold">
                Point {i + 1}
              </h2>
              <p className="mt-0.5 text-xs text-zinc-500">
                Drag the handles until the band covers the rally.
              </p>

              <div className="relative mt-5 h-10 touch-none select-none">
                <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-white/10">
                  <span
                    className="absolute inset-y-0 bg-cyan-glow/45"
                    style={{
                      left: `${pct(dT0)}%`,
                      width: `${Math.max(0, pct(dT1) - pct(dT0))}%`,
                    }}
                  />
                </div>
                <span
                  className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-glow shadow-[0_0_8px_rgba(34,211,238,0.7)]"
                  style={{ left: `${Math.min(100, Math.max(0, pct(playhead)))}%` }}
                />
                {(["start", "end"] as const).map((edge) => (
                  <button
                    key={edge}
                    type="button"
                    aria-label={edge === "start" ? "Start of point" : "End of point"}
                    {...drag(edge)}
                    className="absolute top-0 flex h-10 w-8 -translate-x-1/2 touch-none items-center justify-center"
                    style={{ left: `${pct(edge === "start" ? dT0 : dT1)}%` }}
                  >
                    <span className="h-10 w-0.5 rounded-full bg-cyan-glow" />
                    <span className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-cyan-glow bg-ink shadow-[0_0_8px_rgba(34,211,238,0.6)]" />
                  </button>
                ))}
              </div>

              <p className="mt-2 text-center text-xs text-zinc-400">
                {(dT1 - dT0).toFixed(1)}s long
              </p>

              <div className="mt-5 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    apply(setEdges(stateRef.current, m.id, dT0, dT1));
                    setAdjusting(null);
                  }}
                  className="glow-cta flex-1 rounded-full bg-cyan-glow px-4 py-2.5 text-sm font-semibold text-ink"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setAdjusting(null)}
                  className="flex-1 rounded-full border border-edge px-4 py-2.5 text-sm font-semibold text-zinc-300 transition-colors hover:text-white"
                >
                  Cancel
                </button>
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => redoPoint(m.id)}
                  className="flex-1 rounded-full border border-edge px-4 py-2 text-xs font-semibold text-zinc-400 transition-colors hover:border-cyan-glow/50 hover:text-zinc-100"
                >
                  Mark it again
                </button>
                <button
                  type="button"
                  onClick={() => {
                    apply(removeMark(stateRef.current, m.id));
                    setAdjusting(null);
                    setState((st) => selectMark(st, null));
                  }}
                  className="flex-1 rounded-full border border-edge px-4 py-2 text-xs font-semibold text-zinc-400 transition-colors hover:border-amber-400/60 hover:text-amber-200"
                >
                  Remove point
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* The one question asked on the way in, in the same dress as the
          scorekeeper's own setup sheet: bottom-anchored on a phone,
          centred on a desktop, one card on a dimmed backdrop. */}
      {mode === null && (
        <div className="absolute inset-0 z-30 flex items-end justify-center bg-ink/70 backdrop-blur-sm sm:items-center">
          <div className="ks-fade w-full rounded-t-2xl border border-edge bg-surface p-5 pb-8 sm:max-w-sm sm:rounded-2xl sm:pb-5">
            <h2 className="text-base font-semibold">
              Cut only, or cut and score?
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              You can score it later either way.
            </p>
            <div className="mt-4 grid grid-cols-1 gap-2">
              <button
                type="button"
                onClick={() => setMode("score")}
                className="rounded-lg border border-edge bg-ink/40 px-4 py-3 text-left transition-colors hover:border-cyan-glow/40"
              >
                <span className="block text-sm font-semibold text-zinc-100">
                  Cut and score
                </span>
                <span className="mt-0.5 block text-xs text-zinc-500">
                  Say who won each point as you go.
                </span>
              </button>
              <button
                type="button"
                onClick={() => setMode("cut")}
                className="rounded-lg border border-edge bg-ink/40 px-4 py-3 text-left transition-colors hover:border-cyan-glow/40"
              >
                <span className="block text-sm font-semibold text-zinc-100">
                  Cut only
                </span>
                <span className="mt-0.5 block text-xs text-zinc-500">
                  Mark where each rally starts and ends.
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {reviewing && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-ink/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-edge bg-surface p-6">
            <p className="text-lg font-semibold">
              {sum.total} {sum.total === 1 ? "point" : "points"} marked.
            </p>
            {mode !== "cut" && sum.unscored > 0 && (
              <p className="mt-2 text-sm text-zinc-400">
                {sum.unscored} {sum.unscored === 1 ? "has" : "have"} no winner
                yet. You can score {sum.unscored === 1 ? "it" : "them"} from the
                match.
              </p>
            )}
            {sum.open && (
              <p className="mt-2 text-sm text-amber-300/90">
                One point has no ending and will not be included.
              </p>
            )}
            {sum.long > 0 && (
              <p className="mt-2 text-sm text-amber-300/90">
                {sum.long} {sum.long === 1 ? "point is" : "points are"} over two
                minutes long. Check you did not miss an ending.
              </p>
            )}
            <p className="mt-3 text-sm text-zinc-400">
              This match cannot be processed automatically afterwards.
            </p>
            {submitError && (
              <p className="mt-3 text-sm text-amber-300/90">{submitError}</p>
            )}
            <button
              type="button"
              onClick={doSubmit}
              disabled={busy}
              className="glow-cta mt-5 w-full rounded-full bg-cyan-glow px-4 py-3 text-sm font-semibold text-ink disabled:opacity-50"
            >
              {busy ? "Sending" : "Cut the match"}
            </button>
            <button
              type="button"
              onClick={() => setReviewing(false)}
              className="mt-3 w-full rounded-full border border-edge px-4 py-2.5 text-sm font-semibold text-zinc-200 transition-colors hover:bg-surface-2"
            >
              Keep marking
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
