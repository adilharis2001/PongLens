"use client";

/**
 * Mark the points: the scorekeeper's pad, pointed at the ORIGINAL upload.
 *
 * The player watches their own video and taps twice per rally — once as the
 * serve goes up, once to say who won. Playback never stops, and the strip
 * fills in as they go. When they finish, the worker builds a real cut from
 * the marks and the match opens like any other.
 *
 * A SEPARATE COMPONENT, NOT A THIRD MODE IN Player.tsx. That file is 8324
 * lines and its header comment is a behavioural spec of its own; the one
 * feature that must not break is the scorekeeper, and the cheapest way to
 * not break it is to not touch it. What is shared is shared by IMPORT
 * (ClipPlayer, serving, gameScore) rather than by copy, so the rotation and
 * the game walk stay single implementations.
 *
 * The video layer is ClipPlayer in cut mode — the same component
 * RawMatchView already mounts on this file — which is why nothing here
 * rebuilds play/pause, double-tap seek, hold-for-speed, pinch zoom, the
 * transport or fullscreen.
 *
 * WHAT THIS FILE NEVER COMPUTES: cut_t0, cut segments, or which seconds the
 * cut keeps. The worker does that once, through the same three functions
 * the automatic pipeline uses. See handCut.ts.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ClipPlayer, type PictureBox } from "./ClipPlayer";
import { computeMatchScore } from "./gameScore";
import { computeServing, type MatchServer } from "./serving";
import type { Point } from "@/lib/types";
import {
  type Mark,
  type MarkState,
  type Outcome,
  asPoints,
  emptyState,
  endMark,
  openMark,
  selectMark,
  startMark,
  summarize,
  toggleStar,
  undoLast,
  validate,
} from "./handCut";

/** How long a refusal stays on screen. Long enough to read, short enough
 *  that it is gone before the next rally needs the space. */
const REFUSE_MS = 2000;

/** Draft autosave. Every tap re-arms it; nothing on screen ever waits for
 *  the network, so a flaky connection costs nothing but a later save. */
const SAVE_DEBOUNCE_MS = 1500;

let markSeq = 0;
const nextId = () => `m${++markSeq}-${Math.random().toString(36).slice(2, 8)}`;

/* ------------------------------------------------------------------ pad */

/**
 * The pad's control primitive, carrying its own name.
 *
 * Copied from Player.tsx's PadControl for the reason its comment gives: at
 * 16px an icon alone is ambiguous, and a first-time user should not have to
 * press a button to find out what it does.
 */
function PadControl({
  label,
  aria,
  onClick,
  disabled,
  lit,
  tone = "plain",
  mini,
  children,
}: {
  label: string;
  aria?: string;
  onClick: () => void;
  disabled?: boolean;
  lit?: boolean;
  tone?: "plain" | "amber" | "cyan";
  mini?: boolean;
  children?: React.ReactNode;
}) {
  const toneClass = lit
    ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
    : tone === "amber"
      ? "border-amber-400/40 bg-amber-400/5 text-amber-300 hover:border-amber-400/60"
      : tone === "cyan"
        ? "border-cyan-glow/40 bg-cyan-glow/5 text-cyan-glow hover:border-cyan-glow/60"
        : mini
          ? "border-white/10 bg-ink/60 text-zinc-300 hover:text-white"
          : "border-edge bg-surface text-zinc-300 hover:border-cyan-glow/50 hover:text-white";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={aria ?? label}
      className={`flex flex-col items-center justify-center rounded-xl border transition-colors disabled:opacity-40 ${
        mini ? "h-10 w-10 shrink-0 gap-0.5" : "h-12 min-w-11 flex-1 gap-1"
      } ${toneClass}`}
    >
      {children}
      <span
        className={`whitespace-nowrap font-semibold leading-none ${
          mini ? "text-[9px]" : "text-[10px]"
        }`}
      >
        {label}
      </span>
    </button>
  );
}

/** One rally in the strip. Closed chips take their outcome's colour; the
 *  open one grows, because an open rally's length is not yet known and a
 *  draining ring would be claiming otherwise. */
function MarkChip({
  n,
  mark,
  current,
  selected,
  grow,
  onSelect,
}: {
  n: number;
  mark: Mark;
  current: boolean;
  selected: boolean;
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
      aria-current={current ? "true" : undefined}
      className={`relative flex h-8 shrink-0 items-center justify-center overflow-hidden rounded-full border text-xs font-semibold tabular-nums transition-[width,transform,box-shadow] ${tone} ${
        selected ? "ring-2 ring-white/90" : ""
      } ${current ? "scale-110 shadow-[0_0_12px_rgba(255,255,255,0.35)]" : ""}`}
      style={{ width: open ? Math.min(64, 32 + grow) : 32 }}
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
  matchId,
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
  matchId: string;
  rawUrl: string;
  durationS: number | null;
  firstServer: MatchServer | null;
  youLabel: string;
  themLabel: string;
  initialMarks: Mark[];
  /** Best effort, debounced. Never blocks a tap. */
  saveDraft: (marks: Mark[]) => Promise<void>;
  /** Hands the marks to claim_hand_cut. Resolves to an error slug or null. */
  submit: (marks: Mark[]) => Promise<string | null>;
  onClose: () => void;
}) {
  const [state, setState] = useState<MarkState>(() =>
    initialMarks.length ? { ...emptyState, marks: initialMarks } : emptyState
  );
  const [refusal, setRefusal] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playApi = useRef<{ play: () => void; pause: () => void } | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const refuseTimer = useRef<number | null>(null);
  const saveTimer = useRef<number | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);

  /* -------------------------------------------------- layout, four shapes */

  // matchMedia rather than CSS variants, for the reason Player.tsx gives:
  // the desktop pad differs in STRUCTURE (it floats and carries a key
  // legend), not only in styling, and the repo's dual-render idiom would
  // mount two copies of a component that owns a video.
  const [floating, setFloating] = useState(false);
  const [overlayPad, setOverlayPad] = useState(false);
  const [portrait, setPortrait] = useState(true);
  /** From the file itself. A 9:16 upload needs a different shape entirely
   *  (see the box rule below), and guessing 16:9 would letterbox it. */
  const [ar, setAr] = useState(16 / 9);
  useEffect(() => {
    const desk = window.matchMedia("(min-width: 1024px) and (pointer: fine)");
    // The predicate string is copied verbatim from Player.tsx so the two
    // scorekeepers can never disagree about what a phone in landscape is.
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

  const tapStart = useCallback(() => {
    apply(startMark(stateRef.current, nowT(), rateNow(), nextId()));
  }, [apply, nowT, rateNow]);

  const tapOutcome = useCallback(
    (o: Outcome) => {
      apply(endMark(stateRef.current, nowT(), o));
    },
    [apply, nowT]
  );

  const tapUndo = useCallback(() => setState((s) => undoLast(s)), []);

  const tapStar = useCallback(() => {
    const s = stateRef.current;
    const target =
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

      switch (e.key) {
        case " ":
          e.preventDefault();
          if (videoRef.current?.paused) playApi.current?.play();
          else playApi.current?.pause();
          return;
        case "s":
        case "S":
          e.preventDefault();
          tapStart();
          return;
        case "ArrowLeft":
          if (e.shiftKey) {
            e.preventDefault();
            seekBy(-10);
            return;
          }
          e.preventDefault();
          tapOutcome("user");
          return;
        case "ArrowRight":
          if (e.shiftKey) {
            e.preventDefault();
            seekBy(10);
            return;
          }
          e.preventDefault();
          tapOutcome("opponent");
          return;
        case "k":
        case "K":
        case "l":
        case "L":
          e.preventDefault();
          tapOutcome("let");
          return;
        case "e":
        case "E":
          e.preventDefault();
          tapOutcome("end");
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
  }, [tapStart, tapOutcome, tapUndo, tapStar, seekBy, reviewing]);

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

  const open = openMark(state.marks);
  const sum = useMemo(() => summarize(state.marks), [state.marks]);

  // The rotation and the game walk are the product's own, never re-derived.
  const scorePoints = useMemo(
    () => asPoints(state.marks) as unknown as Point[],
    [state.marks]
  );
  const score = useMemo(() => computeMatchScore(scorePoints), [scorePoints]);
  const serving = useMemo(
    () => computeServing(scorePoints, firstServer),
    [scorePoints, firstServer]
  );
  /** Who serves the rally being marked now: the one after the last closed
   *  point, which is what the rotation answers for a point that does not
   *  exist yet. Falls back to the opener. */
  const nextServer: MatchServer | null = useMemo(() => {
    const closed = scorePoints;
    if (!closed.length) return firstServer;
    // computeServing answers per existing point; the next server is the
    // rotation's answer for the point after the last one, which it gives
    // by re-walking with a placeholder.
    const probe = [
      ...closed,
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

  // Keep the newest chip in view without stealing focus.
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

  /* ----------------------------------------------------------------- bits */

  const canOutcome = open !== null || state.selectedId !== null;

  const ticker = (
    <div
      className={
        overlayPad
          ? "pointer-events-auto flex items-center gap-3 rounded-xl bg-ink/50 px-3 py-1 backdrop-blur-sm"
          : "flex w-full shrink-0 items-center gap-3 border-b border-edge/60 px-3 py-2"
      }
    >
      <span className="flex items-baseline gap-2">
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
      </span>
      <span className="ml-auto flex items-center gap-2 text-[11px] text-zinc-400">
        {nextServer && (
          <>
            <span
              className={`block h-2.5 w-2.5 rounded-full ${
                nextServer === "user" ? "bg-cyan-glow" : "bg-magenta-soft"
              }`}
              aria-hidden="true"
            />
            {nextServer === "user" ? `${youLabel} serves` : `${themLabel} serves`}
          </>
        )}
      </span>
    </div>
  );

  const strip = (
    <div
      ref={stripRef}
      className={
        overlayPad
          ? "pointer-events-auto flex gap-1.5 overflow-x-auto rounded-xl bg-ink/50 px-2 py-1 backdrop-blur-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          : "flex w-full shrink-0 gap-1.5 overflow-x-auto border-b border-edge/60 px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      }
    >
      {state.marks.length === 0 ? (
        <span className="py-1.5 text-[11px] text-zinc-500">Nothing marked yet.</span>
      ) : (
        state.marks.map((m, i) => (
          <MarkChip
            key={m.id}
            n={i + 1}
            mark={m}
            current={m.t1 === null}
            selected={state.selectedId === m.id}
            grow={m.t1 === null ? grow : 0}
            onSelect={() => setState((s) => selectMark(s, m.id))}
          />
        ))
      )}
    </div>
  );

  /** The two big answers. Dimmed and inert with nothing open, but they keep
   *  their boxes: a target that moves is one you have to look at, and this
   *  screen is used without looking away from the ball. */
  const winnerTiles = (
    <div
      className={
        overlayPad
          ? "pointer-events-auto flex flex-col gap-2"
          : "flex min-h-[64px] flex-1 gap-2.5"
      }
      // The floating card is content-sized, so flex-1 collapses these to
      // nothing; a fixed height keeps the two answers the biggest targets
      // on the pad, which is what they are on the scorekeeper.
      style={overlayPad ? { width: 88 } : floating ? { height: 132 } : undefined}
    >
      <button
        type="button"
        onClick={() => tapOutcome("user")}
        disabled={!canOutcome}
        className={`min-w-0 flex-1 rounded-2xl border px-2 font-bold transition-all active:scale-[0.98] disabled:opacity-30 ${
          overlayPad ? "h-20 text-base backdrop-blur-sm" : "text-xl"
        } h-full border-cyan-glow/40 bg-cyan-glow/10 text-cyan-glow`}
      >
        <span className="block truncate">{youLabel}</span>
      </button>
      <button
        type="button"
        onClick={() => tapOutcome("opponent")}
        disabled={!canOutcome}
        className={`min-w-0 flex-1 rounded-2xl border px-2 font-bold transition-all active:scale-[0.98] disabled:opacity-30 ${
          overlayPad ? "h-20 text-base backdrop-blur-sm" : "text-xl"
        } h-full border-magenta-glow/40 bg-magenta-glow/10 text-magenta-soft`}
      >
        <span className="block truncate">{themLabel}</span>
      </button>
    </div>
  );

  const secondaryRow = (
    <div
      className={
        overlayPad ? "pointer-events-auto flex flex-col gap-2" : "flex shrink-0 gap-2"
      }
      style={overlayPad ? { width: 88 } : undefined}
    >
      <PadControl
        label="Let"
        aria="This point was a let"
        tone="amber"
        onClick={() => tapOutcome("let")}
        disabled={!canOutcome}
      />
      <PadControl
        label="End"
        aria="End the point without saying who won"
        onClick={() => tapOutcome("end")}
        disabled={!canOutcome}
      />
    </div>
  );

  const controlRow = (
    <div
      className={
        overlayPad ? "pointer-events-auto flex flex-col gap-2" : "flex shrink-0 gap-2"
      }
      style={overlayPad ? { width: 88 } : undefined}
    >
      <PadControl
        label="Undo"
        onClick={tapUndo}
        disabled={state.undo.length === 0}
        mini={overlayPad}
      />
      <PadControl
        label="Star"
        onClick={tapStar}
        disabled={state.marks.length === 0}
        mini={overlayPad}
      />
      <PadControl label="-10s" aria="Back ten seconds" onClick={() => seekBy(-10)} mini={overlayPad} />
      <PadControl label="+10s" aria="Forward ten seconds" onClick={() => seekBy(10)} mini={overlayPad} />
    </div>
  );

  const primary = (
    <button
      type="button"
      onClick={tapStart}
      className={`w-full shrink-0 rounded-xl border-2 font-semibold transition-colors active:scale-[0.99] ${
        overlayPad ? "h-20 text-sm backdrop-blur-sm" : "h-14 text-base"
      } ${
        open
          ? "border-edge bg-surface text-zinc-300"
          : "glow-cta border-cyan-glow bg-cyan-glow text-ink"
      }`}
    >
      Point starts
    </button>
  );

  const legend = (
    <div className="mt-2 hidden shrink-0 flex-wrap gap-x-3 gap-y-1 px-1 text-[10px] text-zinc-500 lg:flex">
      {[
        ["S", "Point starts"],
        ["←", youLabel],
        ["→", themLabel],
        ["K", "Let"],
        ["E", "End"],
        ["U", "Undo"],
        ["T", "Star"],
        ["Space", "Play"],
      ].map(([k, v]) => (
        <span key={k} className="flex items-center gap-1">
          <kbd className="rounded border border-edge bg-surface px-1 py-0.5 font-mono text-[9px] text-zinc-400">
            {k}
          </kbd>
          {v}
        </span>
      ))}
    </div>
  );

  const refusalLine = refusal && (
    <p
      role="status"
      className={`shrink-0 text-center text-[12px] font-semibold text-amber-300 ${
        overlayPad ? "pointer-events-none absolute inset-x-0 top-24 z-20" : "py-1"
      }`}
    >
      {refusal}
    </p>
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

  /* -------------------------------------------------------------- overlay */

  /**
   * Phone landscape: the pad dissolves into edge bands over a full-bleed
   * picture, the shape Player.tsx uses for the same reason. Every camera in
   * this product is aimed at the table, so the centre of the frame is the
   * one place chrome must never sit.
   *
   * GEOMETRY IS EXPLICIT, NOT FLEX. The height here is genuinely scarce and
   * a stretched flex child silently overflows the bottom of the screen,
   * which is exactly what the first attempt did. Budget, at 852x348 with
   * ClipPlayer's 52px cut-mode transport reserved:
   *
   *   band height          348 - 52 = 296
   *   top bar              ticker 30 + gap 4 + strip 32   = 66
   *   right column         Let/End 36 + Me 84 + Anton 84
   *                        + 2 gaps of 6                  = 216
   *   bottom inset                                        = 6
   *   66 + 216 + 6 = 288, inside 296 with 8 to spare.
   *
   * Both columns are bottom-anchored so they end where thumbs rest in a
   * landscape grip, and nothing in them moves between states.
   */
  const landscapeBands = useCallback(
    (picture: PictureBox) => {
      // Two different floors on purpose. The left column only has to clear
      // the transport; the right one also has to clear ClipPlayer's own
      // speed and zoom pills, which live in the bottom-RIGHT corner about
      // 26px above the transport. Measured against the rendered player, not
      // assumed: the first attempt put the opponent's tile straight through
      // them.
      const base = picture.chromeFloor + 6;
      const baseRight = picture.chromeFloor + 34;
      const tile =
        "pointer-events-auto rounded-xl border font-semibold backdrop-blur-sm transition-colors disabled:opacity-30 active:scale-[0.98]";
      return (
        <div className="pointer-events-none absolute inset-0 z-10">
          {/* top bar: score left, chips centre, Done right */}
          <div
            className="pointer-events-auto absolute flex items-center gap-2 rounded-xl bg-ink/50 px-3 backdrop-blur-sm"
            style={{ left: 4, top: 4, height: 30 }}
          >
            <span className="text-base font-bold tabular-nums">
              <span className="text-cyan-glow">{score.current.you}</span>
              <span className="mx-1 text-zinc-600">-</span>
              <span className="text-magenta-soft">{score.current.them}</span>
            </span>
            {nextServer && (
              <span
                className={`block h-2 w-2 rounded-full ${
                  nextServer === "user" ? "bg-cyan-glow" : "bg-magenta-soft"
                }`}
                aria-label={nextServer === "user" ? `${youLabel} serves` : `${themLabel} serves`}
              />
            )}
          </div>
          <div
            ref={stripRef}
            className="pointer-events-auto absolute flex items-center gap-1.5 overflow-x-auto rounded-xl bg-ink/50 px-2 backdrop-blur-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={{ left: 116, right: 176, top: 38, height: 30 }}
          >
            {state.marks.length === 0 ? (
              <span className="text-[11px] text-zinc-400">Nothing marked yet.</span>
            ) : (
              state.marks.map((m, i) => (
                <MarkChip
                  key={m.id}
                  n={i + 1}
                  mark={m}
                  current={m.t1 === null}
                  selected={state.selectedId === m.id}
                  grow={m.t1 === null ? grow : 0}
                  onSelect={() => setState((st) => selectMark(st, m.id))}
                />
              ))
            )}
          </div>
          <div className="pointer-events-auto absolute" style={{ right: 76, top: 4 }}>
            {doneButton}
          </div>

          {/* left: the one thing pressed most, under the left thumb */}
          <button
            type="button"
            onClick={tapStart}
            className={`${tile} absolute ${
              open
                ? "border-edge bg-ink/70 text-zinc-200"
                : "border-cyan-glow bg-cyan-glow/90 text-ink"
            }`}
            style={{ left: 4, bottom: base, width: 96, height: 92 }}
          >
            Point starts
          </button>
          <button
            type="button"
            onClick={tapUndo}
            disabled={state.undo.length === 0}
            className={`${tile} absolute border-white/15 bg-ink/60 text-xs text-zinc-200`}
            style={{ left: 4, bottom: base + 98, width: 96, height: 40 }}
          >
            Undo
          </button>

          {/* right: the answers, stacked bottom-up */}
          <button
            type="button"
            onClick={() => tapOutcome("opponent")}
            disabled={!canOutcome}
            className={`${tile} absolute border-magenta-glow/50 bg-magenta-glow/15 text-magenta-soft`}
            style={{ right: 4, bottom: baseRight, width: 104, height: 70 }}
          >
            <span className="block truncate px-1">{themLabel}</span>
          </button>
          <button
            type="button"
            onClick={() => tapOutcome("user")}
            disabled={!canOutcome}
            className={`${tile} absolute border-cyan-glow/50 bg-cyan-glow/15 text-cyan-glow`}
            style={{ right: 4, bottom: baseRight + 76, width: 104, height: 70 }}
          >
            <span className="block truncate px-1">{youLabel}</span>
          </button>
          <button
            type="button"
            onClick={() => tapOutcome("let")}
            disabled={!canOutcome}
            className={`${tile} absolute border-amber-400/40 bg-amber-400/10 text-[11px] text-amber-300`}
            style={{ right: 58, bottom: baseRight + 152, width: 50, height: 32 }}
          >
            Let
          </button>
          <button
            type="button"
            onClick={() => tapOutcome("end")}
            disabled={!canOutcome}
            className={`${tile} absolute border-white/15 bg-ink/60 text-[11px] text-zinc-200`}
            style={{ right: 4, bottom: baseRight + 152, width: 50, height: 32 }}
          >
            End
          </button>

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
      score,
      nextServer,
      youLabel,
      themLabel,
      state,
      grow,
      doneButton,
      tapStart,
      tapUndo,
      tapOutcome,
      canOutcome,
      open,
      refusal,
    ]
  );

  /* ----------------------------------------------------------------- pad */

  const padBody = (
    <>
      {ticker}
      {strip}
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        {refusalLine}
        {controlRow}
        {secondaryRow}
        {winnerTiles}
        {primary}
        <div className="flex shrink-0 items-center justify-between gap-2">
          <span className="text-[11px] text-zinc-500">
            {sum.total} {sum.total === 1 ? "point" : "points"}
          </span>
          {doneButton}
        </div>
        {/* Its own row, and it wraps. Sharing a line with the count pushed
            Done off the edge of the 380px pad. */}
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
      {/* Video. The box is sized on this div, never on the element: a media
          element has no intrinsic size until metadata arrives. */}
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
                // A 9:16 upload hits the 46dvh arm and goes tall-and-narrow
                // rather than 148px wide.
                height: `min(calc(100vw / ${ar.toFixed(4)}), 46dvh)`,
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
          onTime={(el) => setPlayhead(el.currentTime)}
          onLoadedMetadata={(el) => {
            if (el.videoWidth > 0 && el.videoHeight > 0) {
              setAr(el.videoWidth / el.videoHeight);
            }
          }}
          onClose={onClose}
          overlay={overlayPad ? landscapeBands : undefined}
        />
      </div>

      {/* Pad. Absent in the landscape overlay, where it rides the picture. */}
      {!overlayPad &&
        (floating ? (
          <div className="pointer-events-none absolute inset-0 z-10">
            <div
              className="pointer-events-auto absolute flex max-h-[calc(100%-2rem)] w-[380px] flex-col overflow-y-auto rounded-2xl border border-edge bg-ink/90 shadow-2xl shadow-black/50 backdrop-blur-md"
              style={{ right: 24, top: "50%", transform: "translateY(-50%)" }}
            >
              {padBody}
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-col portrait:flex-1 landscape:h-full landscape:w-[380px] landscape:flex-none landscape:overflow-y-auto landscape:border-l landscape:border-edge">
            {padBody}
          </div>
        ))}

      {/* Review. Same shape as the scorekeeper's summary: what you did,
          what is unfinished, and the one irreversible button. */}
      {reviewing && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-ink/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-edge bg-surface p-6">
            <p className="text-lg font-semibold">
              {sum.total} {sum.total === 1 ? "point" : "points"} marked.
            </p>
            {sum.unscored > 0 && (
              <p className="mt-2 text-sm text-zinc-400">
                {sum.unscored} {sum.unscored === 1 ? "has" : "have"} no winner yet.
                You can score {sum.unscored === 1 ? "it" : "them"} from the match.
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
