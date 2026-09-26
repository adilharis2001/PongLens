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
 * ONE SWITCH, not a question asked first (Adil, 2026-09-25). It reads
 * "Cut and score" on and "Cut only" off (scoreSwitchCopy). On, it is the
 * full three-tap loop. Off, the pass wants the rallies as clips
 * and nothing else, so it never shows a score, a server or an answer row:
 * a scoreboard nobody is filling in is furniture. The raw match page sets
 * it before the marker opens (on for a match, off for practice, a draft's
 * own pass: openingMode), and here it sits in the footer (in the bottom
 * bar on a phone held sideways) from the gate on, and can be flipped at
 * any time without losing a winner already called.
 *
 * WHAT THIS FILE NEVER COMPUTES: cut_t0, cut segments, or which seconds the
 * cut keeps. The worker does that once, through the same three functions
 * the automatic pipeline uses. See handCut.ts.
 */

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { holdPageBehind } from "@/lib/pageBehind";
import { ClipPlayer, type PictureBox } from "./ClipPlayer";
import {
  BOTTOM_BAR_H,
  LET_H,
  RAIL_GAP,
  TOP_BAR_H,
  type GateButton,
  type PairTile,
  type SafeInsets,
  gateButtons,
  gateDetailFont,
  markLandscape,
  pairTileHeight,
  railPair,
} from "./markLandscape";
import { SPEEDS, SpeedMenu } from "./SpeedMenu";
import type { MatchServer } from "./serving";
import { tracksServe } from "@/lib/matchTitle";
import {
  type Mark,
  type MarkState,
  type Outcome,
  clearAwaiting,
  firstUnscored,
  followPlayback,
  gapsAround,
  gateStart,
  CLIP_POST_S as CLIP_POST,
  CLIP_PRE_S as CLIP_PRE,
  insertMark,
  lastClosedEnd as lastEnd,
  markNextServer,
  markScore,
  type CutMode,
  type Gap,
  type OpenAs,
  openAs,
  scoreSwitchCopy,
  scoringAsksFirstServer,
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

/** Longer than ClipPlayer's own double-tap window (280ms), so the pause
 *  inside a double tap never paints a play button. The clip pads,
 *  CLIP_PRE and CLIP_POST, are handCut's: the ones the worker cuts a
 *  hand-marked clip with. */
const PAUSE_GLYPH_MS = 340;

/** How far before a point Redo drops the playhead, so there is a run-up to
 *  the serve rather than landing on top of it. */
const REDO_LEAD_S = 3;

const PAD_WIDTH = 380;
const PAD_POS_KEY = "ponglens:mark-pad-pos";

let markSeq = 0;
const nextId = () => `m${++markSeq}-${Math.random().toString(36).slice(2, 8)}`;

/** What a draft save came to. "conflict": another device saved the draft
 *  since this one last did, and its copy wins. */
export type DraftSave = "saved" | "conflict";

/** The landscape bottom bar's icons, drawn as on the approved board. */
const ICON = {
  back: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5",
  fwd: "M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5",
  prev: "M15 18l-6-6 6-6",
  next: "M9 18l6-6-6-6",
  undo: "M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3",
  star: "M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z",
  again: "M4 12a8 8 0 0 1 14-5.3M20 4v4h-4M20 12a8 8 0 0 1-14 5.3M4 20v-4h4",
  remove: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
} as const;

/** Shown once a newer draft has been found, for the rest of the session. */
const NEWER_DRAFT = "Marked on another device. Reopen to see the latest.";

/** The rate nearest `rate` in the speed list, as an index. The picture's
 *  rate is always one of them, but a nearest match never shows the knob at
 *  the wrong end if it is not. */
function speedIndex(rate: number): number {
  let best = 0;
  for (let i = 1; i < SPEEDS.length; i++) {
    if (Math.abs(SPEEDS[i] - rate) < Math.abs(SPEEDS[best] - rate)) best = i;
  }
  return best;
}

/** Where marking picks up: the rally still open, wherever it sits (one
 *  marked into a gap is not at the end), or else the last point's end. */
function markingPlace(marks: Mark[]): number | null {
  return openMark(marks)?.t0 ?? lastEnd(marks);
}

/**
 * The earliest second a point may reach back to, given the mark before
 * it: that point's end, or, when it is a rally still open, its start plus
 * MIN_POINT_S, which is as far as handCut lets a point crowd it.
 */
function floorAfter(prev: Mark | undefined): number {
  if (!prev) return 0;
  return prev.t1 !== null ? prev.t1 : prev.t0 + MIN_POINT_S;
}

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
      className={`flex h-10 min-w-0 flex-1 items-center justify-center rounded-lg border px-0.5 text-center text-[10px] font-semibold leading-tight transition-colors disabled:opacity-35 ${
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
  playing,
  grow,
  onSelect,
  size = 32,
}: {
  n: number;
  mark: Mark;
  selected: boolean;
  awaiting: boolean;
  /** The picture is inside this point right now. */
  playing: boolean;
  grow: number;
  onSelect: () => void;
  /** 32 on the pad; 36 in the landscape top bar, as the board draws it. */
  size?: 32 | 36;
}) {
  const big = size === 36;
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
      data-mark-id={mark.id}
      onClick={onSelect}
      aria-label={`Point ${n}, ${said}${playing ? ", playing" : ""}`}
      aria-current={open || awaiting ? "true" : undefined}
      className={`relative flex shrink-0 items-center justify-center rounded-full border font-semibold tabular-nums transition-[width,transform,box-shadow] ${
        big ? "h-9 text-[13px]" : "h-8 overflow-hidden text-xs"
      } ${big && open ? "overflow-hidden" : ""} ${tone} ${
        playing
          ? "ring-2 ring-cyan-glow"
          : selected
            ? "ring-2 ring-white/90"
            : ""
      } ${
        open || awaiting
          ? "scale-110 shadow-[0_0_12px_rgba(255,255,255,0.35)]"
          : playing
            ? "scale-110 shadow-[0_0_12px_rgba(34,211,238,0.55)]"
            : ""
      }`}
      style={{ width: open ? Math.min(size + 28, size + grow) : size }}
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
          className={`absolute leading-none text-amber-300 ${
            big ? "right-px -top-[3px] text-[9px]" : "right-0.5 top-0 text-[8px]"
          }`}
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
  firstServer: initialFirstServer,
  matchType,
  onFirstServer,
  youLabel,
  themLabel,
  initialMarks,
  startMode,
  onModeChange,
  saveDraft,
  submit,
  onClose,
  reviewChoice,
  canStartAgain = false,
}: {
  rawUrl: string;
  durationS: number | null;
  firstServer: MatchServer | null;
  /** drills | practice | match | league | tournament, or null. Decides
   *  whether a serve rotation exists to ask about (tracksServe). */
  matchType: string | null;
  /** The answer to "Who served first?", saved onto the match row. */
  onFirstServer: (server: MatchServer) => void | Promise<void>;
  youLabel: string;
  themLabel: string;
  initialMarks: Mark[];
  /** Where the Score switch starts: the switch on the raw match page's
   *  "Mark the points yourself" panel, which starts from openingMode (on
   *  for a fresh match, off for practice, a draft's recorded pass). A
   *  match that cannot be scored opens with it off whatever this says. */
  startMode: CutMode;
  /** Told the switch's position on the way in and on every flip, so the
   *  page's own switch shows what the pass was left in. */
  onModeChange?: (mode: CutMode) => void;
  /**
   * Best effort, debounced, and flushed on close. Never blocks a tap.
   * Resolves "conflict" when a newer draft was saved elsewhere, after
   * which this session saves nothing more.
   */
  saveDraft: (marks: Mark[], mode: CutMode | null) => Promise<DraftSave>;
  /** Hands the marks to the claim. Resolves null when sent (the marker
   *  closes), a message to show, or "" to stay open without one: the host
   *  changed something the player should look at again (a coach review
   *  arriving takes Replace away, and the choice is back on Keep). */
  submit: (marks: Mark[]) => Promise<string | null>;
  onClose: () => void;
  /** Marking a processed match again: the Replace / Keep choice, set in
   *  the review sheet directly above "Cut the match". */
  reviewChoice?: ReactNode;
  /**
   * Marking a processed match again (Cut again, 2026-09-25). The marker
   * opens on the current cut's points, so it always opens at the gate
   * while there are marks, and the gate carries an outlined "Start again"
   * that clears them after "Clear all marks?".
   */
  canStartAgain?: boolean;
}) {
  /** A draft reopens where the work is, not at the front door: the pad is
   *  live at once, in scoring mode, with the first point that still has
   *  no winner selected and cued. Scoring a cut-only pass is then one
   *  answer after another, with the video playing each point back. */
  const resumed = initialMarks.length > 0;
  /**
   * Can this match be scored at all? Practice and drills have no rotation
   * and no score (tracksServe, the same test the iPhone uses), so they are
   * only ever cut: the Score switch is shown off, greyed and untappable,
   * with "Matches only" beside it, and a draft reopens as a cut-only pass
   * whatever it was saved as. Winners already on its marks are kept, not
   * cleared.
   */
  const scoringAllowed = tracksServe(matchType);
  /**
   * Every point closed and called. Not the same as done with the video:
   * someone who marked ten rallies and put the phone down has called
   * every point they marked, with most of the match still ahead.
   *
   * What separates them is how much tape is left after the last point. A
   * match that was marked to the end has a little run-out on it; one that
   * was abandoned part way has minutes. So: called AND close to the end
   * opens straight into a review, called AND miles from it asks which of
   * the two the player came back for, and anything still uncalled keeps
   * the scoring pass it had. Read once on the way in, so a draft saved
   * during the session cannot change what the screen was opened as.
   */
  /** Where the Score switch starts, decided once on the way in by the
   *  page's switch; never on for a match that cannot be scored. */
  const openedMode = useRef<CutMode>(
    scoringAllowed ? startMode : "cut"
  ).current;
  /** How the pad was opened. Fixed for the session, bar one change:
   *  "Start again" clears the marks and turns it into a fresh pass. */
  const [openedAs, setOpenedAs] = useState<OpenAs>(() =>
    openAs(initialMarks, durationS, openedMode)
  );
  const openedCalled = openedAs === "review" || openedAs === "choice";
  const [state, setState] = useState<MarkState>(() =>
    resumed
      ? {
          ...emptyState,
          marks: initialMarks,
          selectedId: openedCalled
            ? initialMarks[0]?.id ?? null
            : firstUnscored(initialMarks)?.id ?? null,
        }
      : emptyState
  );
  /** Is Score on? "cut" is off: the pad drops the half of itself that
   *  only scoring needs. The player flips it whenever they like. */
  const [mode, setMode] = useState<CutMode>(openedMode);
  const onModeChangeRef = useRef(onModeChange);
  onModeChangeRef.current = onModeChange;
  useEffect(() => {
    onModeChangeRef.current?.(mode);
  }, [mode]);
  /** Who served first, if known. Comes in from the match row and is set
   *  here the moment the player answers, so the rotation shows at once. */
  const [firstServer, setFirstServer] = useState<MatchServer | null>(
    initialFirstServer
  );
  useEffect(() => {
    if (initialFirstServer) setFirstServer(initialFirstServer);
  }, [initialFirstServer]);
  /** Asked on the way in when Score starts on and a rotation exists. */
  const [serveStep, setServeStep] = useState(
    openedMode === "score" &&
      tracksServe(matchType) &&
      initialFirstServer === null
  );
  /** Has the session started? Until it has, the pad is one button, because
   *  one button is the only thing there is to do. */
  const [started, setStarted] = useState(
    resumed && !openedCalled && !canStartAgain
  );
  /** "Clear all marks?" is up. */
  const [confirmClear, setConfirmClear] = useState(false);
  /**
   * The pad's own speed control, mirroring the scorekeeper's. The picture
   * gestures (hold left for 0.25x, hold right for 2x) still work, but the
   * floating pad covers part of the frame and whichever half it sits on
   * loses its gesture, so speed must also be reachable as a control.
   *
   * It shows the rate the picture is actually playing at, read off the
   * element (the ratechange effect below), never a copy of what this pad
   * last asked for: ClipPlayer's own pill, the hold for 0.25x / 2x and a
   * rate kept from an earlier clip all change it, and the bar has to say
   * so.
   */
  const [speed, setSpeed] = useState(1);
  const [refusal, setRefusal] = useState<string | null>(null);
  /** Another device saved this draft after this session last did. Its
   *  copy wins: nothing more is saved, and the pad says so. */
  const [newerDraft, setNewerDraft] = useState(false);
  /** Open when the player is adjusting a point's edges. */
  const [adjusting, setAdjusting] = useState<string | null>(null);
  /** While previewing a point, the second to stop at. Playing past the end
   *  of the clip would show footage the clip does not contain, which is the
   *  opposite of what a preview is for. */
  const previewUntil = useRef<number | null>(null);
  const stoppedTimer = useRef<number | null>(null);
  /** The edges being dragged in the Adjust sheet, before they are saved,
   *  and the fixed window the track draws. The window is computed ONCE on
   *  open: derived live from the draft it would rescale under the finger,
   *  which slides the other handle and moves the ground you are aiming at. */
  const [adjustDraft, setAdjustDraft] = useState<[number, number] | null>(null);
  const [adjustBounds, setAdjustBounds] = useState<[number, number] | null>(null);
  /** The draft as of the last pointer move, for the commit on release. */
  const adjustDraftRef = useRef<[number, number] | null>(null);
  /** The speed bar's own drag flag; a released finger clears it. */
  const speedDragging = useRef(false);
  const [playhead, setPlayhead] = useState(0);
  /**
   * Held still long enough to deserve a play button in the middle of the
   * picture.
   *
   * Not `paused` itself, on purpose. A single tap on the picture toggles
   * play/pause and a double tap walks the rallies, so the first tap of a
   * double tap pauses for a moment — and a glyph on raw `paused` strobes
   * in the middle of the frame every time someone reaches for the next
   * point. ClipPlayer left its own glyph off entirely for that reason.
   * Waiting out the double-tap window keeps the affordance for the
   * pauses that matter (a clip that has played out, a point waiting to be
   * called, a drag being judged) and never paints it for a gesture.
   */
  const [stopped, setStopped] = useState(false);
  /**
   * Has the picture ever run in this session?
   *
   * Until it has, ClipPlayer paints its own poster glyph on the still
   * frame and this one would sit under it, two play buttons deep. After
   * the first play that poster retires for good and this takes over.
   */
  const [everPlayed, setEverPlayed] = useState(false);
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

  /**
   * Phone landscape is laid out in numbers, not flex: the approved board
   * places every zone by arithmetic on the screen and its safe areas
   * (markLandscape.ts), and the iPhone runs the same function. The screen
   * is the root's own box; the safe areas are read off a probe padded
   * with env(), since there is no other way to ask for them.
   */
  const rootRef = useRef<HTMLDivElement | null>(null);
  /**
   * The marker owns the screen: while it is open the page behind it is not
   * drawn and none of its videos plays (pageBehind.ts). A z-index alone
   * lost to the match page's own player on a desktop, which was drawn on
   * top of the marker's video.
   */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    return holdPageBehind(root, document);
  }, []);
  const insetProbeRef = useRef<HTMLDivElement | null>(null);
  const [frame, setFrame] = useState<{
    w: number;
    h: number;
    insets: SafeInsets;
  } | null>(null);
  useEffect(() => {
    if (!overlayPad) return;
    const root = rootRef.current;
    if (!root) return;
    const px = (v: string | undefined) => {
      const n = parseFloat(v ?? "");
      return Number.isFinite(n) ? n : 0;
    };
    const measure = () => {
      const probe = insetProbeRef.current;
      const cs = probe ? getComputedStyle(probe) : null;
      const next = {
        w: root.clientWidth,
        h: root.clientHeight,
        insets: {
          left: px(cs?.paddingLeft),
          right: px(cs?.paddingRight),
          bottom: px(cs?.paddingBottom),
        },
      };
      setFrame((prev) =>
        prev &&
        prev.w === next.w &&
        prev.h === next.h &&
        prev.insets.left === next.insets.left &&
        prev.insets.right === next.insets.right &&
        prev.insets.bottom === next.insets.bottom
          ? prev
          : next
      );
    };
    measure();
    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(root);
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, [overlayPad]);
  const land = useMemo(() => {
    if (!overlayPad) return null;
    const f =
      frame ??
      (typeof window !== "undefined"
        ? { w: window.innerWidth, h: window.innerHeight, insets: undefined }
        : null);
    return f ? markLandscape(f.w, f.h, f.insets, ar) : null;
  }, [overlayPad, frame, ar]);

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

  // One speed, read from the picture. ClipPlayer applies its kept rate as
  // the element loads, before this effect runs, so read it once now as
  // well as on every change.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const sync = () => setSpeed(el.playbackRate > 0 ? el.playbackRate : 1);
    sync();
    el.addEventListener("ratechange", sync);
    return () => el.removeEventListener("ratechange", sync);
  }, [rawUrl]);

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
   * Where a reopened draft is cued: on the point the pad opened on,
   * padded as its clip will be, so pressing play shows that point and
   * stops at its end. A finished draft opens on the first point and an
   * unfinished one on the first still missing a winner; with neither,
   * the cue is where the marking stopped. Runs on the first metadata
   * event, and again after the serve card.
   */
  const cueReview = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const d = Number.isFinite(v.duration) ? v.duration : Infinity;
    const s = stateRef.current;
    const cue =
      (s.selectedId ? s.marks.find((m) => m.id === s.selectedId) : null) ??
      firstUnscored(s.marks);
    if (cue && cue.t1 !== null) {
      v.currentTime = Math.max(0, Math.min(d - 0.1, cue.t0 - CLIP_PRE));
      previewUntil.current = cue.t1 + CLIP_POST;
    } else {
      const at = markingPlace(s.marks);
      if (at === null) return;
      v.currentTime = Math.max(0, Math.min(d - 0.1, at));
      previewUntil.current = null;
    }
    setPlayhead(v.currentTime);
  }, []);
  /**
   * Who served first is asked on the way into scoring, and only where a
   * rotation exists: a match, a league, a tournament (tracksServe), never
   * a practice. The answer is on the tape, so the card leaves the video
   * playable and offers the start of it. "Not sure yet" leaves the
   * question to the match page, which asks it after the cut the way it
   * does for an automatic one.
   */
  /**
   * Does closing the serve card move the picture?
   *
   * On the way in, yes: nothing has started, and the card hands over to
   * the cue the pad opened on. Asked again mid-pass, no — the player is
   * somewhere in the tape and a jump would throw away their place.
   */
  const serveStepCue = useRef(true);
  const closeServeStep = useCallback(() => {
    setServeStep(false);
    if (!serveStepCue.current) {
      serveStepCue.current = true;
      return;
    }
    // Begin Cutting is what starts playback; the preview must not leave
    // the tape running behind a button that says begin. A draft is cued
    // back to where its work is, and the preview must not move that.
    playApi.current?.pause();
    cueReview();
  }, [cueReview]);
  const answerFirstServer = useCallback(
    (value: MatchServer) => {
      setFirstServer(value);
      void onFirstServer(value);
      closeServeStep();
    },
    [onFirstServer, closeServeStep]
  );
  const playFromStart = useCallback(() => {
    const v = videoRef.current;
    if (v) {
      v.currentTime = 0;
      setPlayhead(0);
    }
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
    cueReview();
  }, [cueReview]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const clear = () => {
      if (stoppedTimer.current !== null) {
        window.clearTimeout(stoppedTimer.current);
        stoppedTimer.current = null;
      }
    };
    const sync = () => {
      clear();
      if (el.paused) {
        stoppedTimer.current = window.setTimeout(() => {
          stoppedTimer.current = null;
          setStopped(true);
        }, PAUSE_GLYPH_MS);
      } else {
        setStopped(false);
        setEverPlayed(true);
      }
    };
    sync();
    el.addEventListener("play", sync);
    el.addEventListener("playing", sync);
    el.addEventListener("pause", sync);
    return () => {
      clear();
      el.removeEventListener("play", sync);
      el.removeEventListener("playing", sync);
      el.removeEventListener("pause", sync);
    };
  }, [rawUrl]);

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

  /**
   * An answer given to a point selected for review (rather than the one
   * that just ended) moves the review on: the next point still without a
   * winner is selected and played back, so scoring a whole cut-only draft
   * is one answer after another with the video doing the walking. When
   * none is left the selection clears and the pad is back to marking.
   */
  const advanceReview = useCallback((after: MarkState, fromId: string) => {
    const next = firstUnscored(after.marks, fromId);
    const v = videoRef.current;
    if (!next || next.t1 === null || !v) {
      setState((s) => selectMark(s, null));
      previewUntil.current = null;
      return;
    }
    setState((s) => selectMark(s, next.id));
    pausedForAnswer.current = false;
    v.currentTime = Math.max(0, next.t0 - CLIP_PRE);
    setPlayhead(v.currentTime);
    previewUntil.current = next.t1 + CLIP_POST;
    playApi.current?.play();
  }, []);

  const tapAnswer = useCallback(
    (o: Outcome) => {
      const before = stateRef.current;
      const reviewingId =
        before.awaitingId === null ? before.selectedId : null;
      const next = setOutcome(before, o);
      apply(next);
      if (next.refused) return;
      if (reviewingId) {
        // Pressing the answer a point already has takes it back off. That
        // is a correction to this point, not a verdict on it, so the
        // review stays where it is instead of walking on.
        const m = next.state.marks.find((x) => x.id === reviewingId);
        const cleared = !!m && m.winner === null && !m.isLet;
        if (!cleared) advanceReview(next.state, reviewingId);
      } else resumeAfterAnswer();
    },
    [apply, resumeAfterAnswer, advanceReview]
  );

  /**
   * Tapping a chip plays that point's CLIP back, padded exactly as the
   * worker will cut it, and stops where the clip stops.
   *
   * Without this a marked point is a number on a strip and nobody can tell
   * whether the cut is any good, which is the one thing worth checking
   * before committing eighty of them.
   */
  /** Select a point, cue its clip exactly as the worker will cut it, and
   *  play. Every path that shows a point back goes through here. */
  const playMark = useCallback(
    (id: string) => {
      const s = stateRef.current;
      const m = s.marks.find((x) => x.id === id);
      const v = videoRef.current;
      if (!m || m.t1 === null || !v) return;
      // selectMark toggles, and a reopened draft arrives with its first
      // point already selected: selecting it again would deselect it and
      // end the review walk after one clip.
      setState((st) => (st.selectedId === id ? st : selectMark(st, id)));
      pausedForAnswer.current = false;
      v.currentTime = Math.max(0, m.t0 - CLIP_PRE);
      setPlayhead(v.currentTime);
      previewUntil.current = m.t1 + CLIP_POST;
      playApi.current?.play();
    },
    []
  );

  const tapChip = useCallback(
    (id: string) => {
      const s = stateRef.current;
      // Tapping the point already playing stops it, which is the only way
      // to hold a frame in the middle of a walk.
      if (s.selectedId === id) {
        previewUntil.current = null;
        playApi.current?.pause();
        return;
      }
      playMark(id);
    },
    [playMark]
  );

  /** The same gate, for a match already cut and called: it walks the
   *  points from the first one instead of picking up the marking. */
  const beginReview = useCallback(() => {
    setStarted(true);
    const first = stateRef.current.marks.find((m) => m.t1 !== null);
    if (first) playMark(first.id);
    else playApi.current?.play();
  }, [playMark]);

  /**
   * A rally the pass went past, put back where it belongs.
   *
   * The new point lands in the middle of the hole at a rally's length,
   * and the bar opens on it straight away, because a guess in the middle
   * of fifteen seconds of dead time is a starting position and not an
   * answer. Confirm writes it; leaving it alone leaves the guess, which
   * Undo takes out.
   */
  const insertAt = useCallback(
    (gap: Gap) => {
      const span = gap.hi - gap.lo;
      const len = Math.max(MIN_POINT_S, Math.min(6, span - 0.4));
      const t0 = gap.lo + (span - len) / 2;
      const t1 = t0 + len;
      const id = nextId();
      const next = insertMark(stateRef.current, t0, t1, id);
      apply(next);
      if (next.refused) return;
      playApi.current?.pause();
      previewUntil.current = null;
      pausedForAnswer.current = false;
      const v = videoRef.current;
      if (v) {
        v.currentTime = Math.max(0, t0 - CLIP_PRE);
        setPlayhead(v.currentTime);
      }
      const draft: [number, number] = [t0, t1];
      setAdjustDraft(draft);
      adjustDraftRef.current = draft;
      setAdjustBounds([gap.lo, gap.hi]);
      setAdjusting(id);
    },
    [apply, nextId]
  );

  /** Previous or next point, from the one selected. */
  const stepMark = useCallback(
    (dir: -1 | 1) => {
      const s = stateRef.current;
      const i = s.selectedId
        ? s.marks.findIndex((m) => m.id === s.selectedId)
        : -1;
      if (i < 0) return;
      for (let j = i + dir; j >= 0 && j < s.marks.length; j += dir) {
        if (s.marks[j].t1 !== null) {
          playMark(s.marks[j].id);
          return;
        }
      }
    },
    [playMark]
  );

  /**
   * A clip has just played out. A point that still needs its winner holds
   * the picture there, because the answer row is what the pad wants next.
   * Anything else walks on to the following point after a beat, so
   * watching a marked match back is one tap rather than one per rally.
   */
  const chainAfterPreview = useCallback(() => {
    const s = stateRef.current;
    if (!s.selectedId) return;
    const i = s.marks.findIndex((m) => m.id === s.selectedId);
    if (i < 0) return;
    const done = s.marks[i];
    if (mode === "score" && !done.isLet && done.winner === null) return;
    const next = s.marks.slice(i + 1).find((m) => m.t1 !== null);
    if (!next) return;
    // Straight through, with no beat between the clips: a gap in the
    // middle of a review reads as the pad hesitating, not as a break.
    playMark(next.id);
  }, [mode, playMark]);

  /**
   * The Score switch: on or off, from the gate on, both ways.
   *
   * It used to be a question asked once on the way in ("Cut only, or cut
   * and score?") and then a pill mid-pass. It is one difference, whether
   * the pad asks who won, so it is one switch, always in the same place.
   *
   * Nothing is thrown away either way. Winners already called stay on
   * their points and come back the moment scoring is on again; a pass
   * with Score off simply stops asking.
   */
  const toggleScoring = useCallback(() => {
    const next: CutMode = mode === "score" ? "cut" : "score";
    if (next === "score" && !scoringAllowed) return;
    setMode(next);
    if (next === "cut") {
      // The answer row is about to disappear, and it is the only thing
      // that releases a picture held for an answer. Let it go first.
      setState((s) => clearAwaiting(s));
      if (pausedForAnswer.current) {
        pausedForAnswer.current = false;
        playApi.current?.play();
      }
      // "Who served first?" belongs to scoring. The switch is there from
      // the gate, where the question is already up on a fresh match, so
      // turning Score off puts the question away with it, closing as
      // "Not sure yet" would.
      if (serveStep) closeServeStep();
      return;
    }
    // Scoring with no first server has no rotation to show, so ask the
    // same question the way in asks, but never over an open rally. Mid-
    // pass, closing it leaves the playhead where it is; before the pass
    // has started, it hands back to the cue, as on the way in.
    if (
      scoringAsksFirstServer(
        stateRef.current.marks,
        scoringAllowed,
        firstServer !== null
      )
    ) {
      serveStepCue.current = !started;
      setServeStep(true);
    }
  }, [mode, scoringAllowed, firstServer, serveStep, closeServeStep, started]);

  /** Back to where the marking had got to: the rally still open, wherever
   *  it sits, or else the end of the last point. */
  const resumeMarking = useCallback(() => {
    setState((s) => selectMark(s, null));
    previewUntil.current = null;
    const at = markingPlace(stateRef.current.marks);
    const v = videoRef.current;
    if (v && at !== null) {
      v.currentTime = Math.max(0, at);
      setPlayhead(v.currentTime);
    }
    playApi.current?.play();
  }, []);

  /** The gate's other half on a partly marked match: straight back to
   *  the end of the last point, with nothing selected, marking again. */
  const beginMarking = useCallback(() => {
    setStarted(true);
    resumeMarking();
  }, [resumeMarking]);

  /**
   * The gate's lit button, whatever it says (handCut.gateStart): a fresh
   * pass plays from where the tape is; "Keep marking" on a draft with
   * points still to call plays the first of them as its clip and stops at
   * its end; "Begin review" does the same from the first point; "Keep
   * marking" on a called draft carries on from the last point's end. The
   * portrait pad, the desktop card, the landscape rail and the keyboard
   * all come through here.
   */
  const startFromGate = useCallback(() => {
    const g = gateStart(openedAs, stateRef.current.marks);
    if (g.kind === "clip") {
      setStarted(true);
      playMark(g.id);
    } else if (g.kind === "carryOn") {
      beginMarking();
    } else {
      beginCutting();
    }
  }, [openedAs, playMark, beginMarking, beginCutting]);

  /**
   * The selection follows the picture (handCut.followPlayback): played on
   * from a selected point, the next point's clip selects that point and
   * stops at its end. Only while a point is selected and nothing is being
   * adjusted, answered or marked.
   */
  const followTape = useCallback(
    (t: number) => {
      if (pausedForAnswer.current) return;
      const s = stateRef.current;
      const next = followPlayback({
        marks: s.marks,
        selectedId: s.selectedId,
        awaitingId: s.awaitingId,
        adjusting: adjusting !== null,
        t,
      });
      if (!next) return;
      setState((st) => (st.selectedId === next.id ? st : selectMark(st, next.id)));
      previewUntil.current = next.stopAt;
    },
    [adjusting]
  );

  /**
   * "Start again", confirmed: every mark goes and the pad is a fresh pass
   * from the top of the video. The empty draft is saved like any other
   * change, so reopening starts empty too. There is no undo for this; the
   * confirmation is the safeguard.
   */
  const clearAll = useCallback(() => {
    setConfirmClear(false);
    playApi.current?.pause();
    previewUntil.current = null;
    pausedForAnswer.current = false;
    setAdjusting(null);
    adjustDraftRef.current = null;
    setState(emptyState);
    setOpenedAs("fresh");
    setStarted(false);
    const v = videoRef.current;
    if (v) {
      v.currentTime = 0;
      setPlayhead(0);
    }
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
    const to = Math.max(
      floorAfter(s.marks[i - 1]),
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

  /**
   * Adjust is a bar, not a sheet: the point's edges appear between the
   * chips and the buttons with the picture still in view. The window
   * reaches past the clip on both sides so an edge can be dragged
   * outwards, but never into a neighbouring rally.
   *
   * Dragging only previews. Confirm is what writes the new edges, and
   * until it is pressed Resume is dark, so a point cannot be left
   * half-dragged: the one button that opened the bar is the one that
   * closes it, in the same place under the same thumb.
   */
  const openAdjust = useCallback(() => {
    const st = stateRef.current;
    const m = st.selectedId ? st.marks.find((x) => x.id === st.selectedId) : null;
    if (!m || m.t1 === null) return;
    const i = st.marks.findIndex((x) => x.id === m.id);
    const prevEnd = floorAfter(st.marks[i - 1]);
    const nextStart =
      i < st.marks.length - 1 ? st.marks[i + 1].t0 : durationS ?? m.t1 + 30;
    const draft: [number, number] = [m.t0, m.t1];
    setAdjustDraft(draft);
    adjustDraftRef.current = draft;
    setAdjustBounds([Math.max(prevEnd, m.t0 - 8), Math.min(nextStart, m.t1 + 8)]);
    setAdjusting(m.id);
    // The point's preview stop would fire as a handle is dragged past it
    // and chain to the next point, closing the bar mid-drag.
    previewUntil.current = null;
    playApi.current?.pause();
  }, [durationS]);

  const confirmAdjust = useCallback(() => {
    const id = adjusting;
    const d = adjustDraftRef.current;
    setAdjusting(null);
    adjustDraftRef.current = null;
    if (!id || !d) return;
    const m = stateRef.current.marks.find((x) => x.id === id);
    if (!m || m.t1 === null) return;
    if (d[0] !== m.t0 || d[1] !== m.t1) {
      apply(setEdges(stateRef.current, id, d[0], d[1]));
    }
  }, [adjusting, apply]);

  const seekBy = useCallback((delta: number) => {
    const v = videoRef.current;
    if (!v) return;
    const d = Number.isFinite(v.duration) ? v.duration : Infinity;
    v.currentTime = Math.max(0, Math.min(d - 0.05, v.currentTime + delta));
  }, []);

  /* ------------------------------------------------------------- keyboard */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || reviewing || confirmClear) return;
      const t = e.target;
      if (t instanceof HTMLElement && t.closest("input, textarea, select")) return;

      if (!started) {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          startFromGate();
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
          if (e.shiftKey || mode === "cut") seekBy(-5);
          else tapAnswer("user");
          return;
        case "ArrowRight":
          e.preventDefault();
          if (e.shiftKey || mode === "cut") seekBy(5);
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
    open,
    tapBegin,
    tapReset,
    tapEnd,
    tapAnswer,
    tapUndo,
    tapStar,
    seekBy,
    reviewing,
    confirmClear,
    startFromGate,
  ]);

  /* ---------------------------------------------------------- draft saves */

  const modeRef = useRef(mode);
  modeRef.current = mode;
  /**
   * What the stored draft holds, as far as this session knows: what it
   * opened on, then whatever it last sent. A save goes only when the marks
   * or the mode have moved on from it, so opening the marker writes
   * nothing, and a pass with nothing marked never writes an empty draft
   * over no draft at all.
   */
  const savedRef = useRef<{ marks: Mark[]; mode: CutMode | null }>({
    marks: state.marks,
    mode,
  });
  /** A change is waiting for its save. */
  const pendingSave = useRef(false);
  const newerDraftRef = useRef(false);

  /**
   * Send the waiting change now. The debounce ends here, and so do
   * closing the marker and the page going to the background, so the last
   * taps before the phone is put down are saved rather than dropped with
   * the timer.
   */
  const flushSave = useCallback(() => {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (!pendingSave.current || newerDraftRef.current) return;
    pendingSave.current = false;
    const marks = stateRef.current.marks;
    const m = modeRef.current;
    const before = savedRef.current;
    if (marks === before.marks && m === before.mode) return;
    if (marks.length === 0 && before.marks.length === 0) return;
    savedRef.current = { marks, mode: m };
    saveDraft(marks, m).then(
      (result) => {
        if (result === "conflict") {
          newerDraftRef.current = true;
          setNewerDraft(true);
        }
      },
      () => {
        // Deliberately quiet. The strip renders from local state, so a
        // failed save costs a later retry (the next change, or closing)
        // and never a tap.
        if (savedRef.current.marks === marks) savedRef.current = before;
        pendingSave.current = true;
      }
    );
  }, [saveDraft]);
  const flushSaveRef = useRef(flushSave);
  flushSaveRef.current = flushSave;

  useEffect(() => {
    const saved = savedRef.current;
    if (state.marks === saved.marks && mode === saved.mode) return;
    pendingSave.current = true;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(
      () => flushSaveRef.current(),
      SAVE_DEBOUNCE_MS
    );
  }, [state.marks, mode]);

  // Leaving by any route saves what is waiting: unmounting, and the page
  // being hidden, which on a phone is often the last thing that happens
  // before the tab is thrown away.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flushSaveRef.current();
    };
    const onPageHide = () => flushSaveRef.current();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      flushSaveRef.current();
    };
  }, []);

  /** Close, saving first. */
  const closeMarker = useCallback(() => {
    flushSave();
    onClose();
  }, [flushSave, onClose]);

  /* ------------------------------------------------------- derived scores */

  const awaiting = state.awaitingId !== null;
  const canAnswer = awaiting || state.selectedId !== null;
  const sum = useMemo(() => summarize(state.marks), [state.marks]);

  // The rotation and the game walk are the product's own, never re-derived,
  // and a match marked again brings the owner's game ends with its marks.
  const score = useMemo(() => markScore(state.marks), [state.marks]);
  const nextServer: MatchServer | null = useMemo(
    () => markNextServer(state.marks, firstServer),
    [state.marks, firstServer]
  );

  const grow = open ? Math.max(0, playhead - open.t0) : 0;

  /** The point the picture is inside, padded as its clip will be. Read
   *  from the playhead rather than from what was tapped, so it is right
   *  whether the pad is walking the strip or the tape is just running. */
  const playingId = useMemo(() => {
    for (const m of state.marks) {
      if (m.t1 === null) continue;
      if (playhead >= m.t0 - CLIP_PRE && playhead <= m.t1 + CLIP_POST) {
        return m.id;
      }
    }
    return null;
  }, [playhead, state.marks]);

  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    el.scrollTo({ left: el.scrollWidth, behavior: "smooth" });
  }, [state.marks.length, overlayPad]);
  // Adjust belongs to one selected point; when the selection moves on, so
  // does the bar.
  useEffect(() => {
    if (adjusting && state.selectedId !== adjusting) {
      // The bar belongs to one point. Moving to another leaves the drag
      // unconfirmed, and unconfirmed means unwritten.
      setAdjusting(null);
      adjustDraftRef.current = null;
    }
  }, [adjusting, state.selectedId]);
  // A review walks the strip from the front; the chip under review must
  // be on screen, or the strip is a row of numbers ending at the wrong end.
  useEffect(() => {
    const el = stripRef.current;
    const id = state.selectedId ?? playingId;
    if (!el || !id) return;
    // By the mark's id, never its position: the "+" beside a selected
    // chip is a child of the strip too, and counting children lands one
    // chip off as soon as it shows.
    const chip = el.querySelector<HTMLElement>(
      `[data-mark-id="${CSS.escape(id)}"]`
    );
    chip?.scrollIntoView?.({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [state.selectedId, playingId, state.marks, overlayPad]);

  /* --------------------------------------------------------------- submit */

  const doSubmit = useCallback(async () => {
    // Sending would put these marks over the newer draft, which is the
    // one thing the newer-draft rule exists to stop.
    if (newerDraftRef.current) {
      setSubmitError(NEWER_DRAFT);
      return;
    }
    const check = validate(stateRef.current.marks, durationS);
    if (!check.ok) {
      setSubmitError(check.reason);
      return;
    }
    setBusy(true);
    setSubmitError(null);
    const err = await submit(stateRef.current.marks);
    setBusy(false);
    if (err !== null) {
      // "" is the host asking for a second look, with nothing to say.
      if (err) setSubmitError(err);
    } else {
      // The claim froze the row with these marks in it; a save after it
      // would only be refused.
      pendingSave.current = false;
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      onClose();
    }
  }, [durationS, submit, onClose]);

  /* ----------------------------------------------------------- pad pieces */

  const ticker = (
    <div className="flex w-full shrink-0 items-center gap-3 border-b border-edge/60 px-3 py-2">
      <span className="flex items-baseline gap-2">
        {mode === "cut" ? (
          <span className="text-2xl font-bold tabular-nums tracking-tight text-zinc-200">
            {sum.total}
            <span className="ml-1.5 text-[11px] font-medium text-zinc-500">
              {sum.total === 1 ? "point" : "points"}
            </span>
          </span>
        ) : (
          <>
            <span className="text-2xl font-bold tabular-nums tracking-tight">
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
          {nextServer === "user" ? "You serve" : `${themLabel} serves`}
        </span>
      )}
    </div>
  );

  /** Only ever beside the point being stood on: a "+" against every chip
   *  is a row of plus signs rather than an offer. */
  const gaps = gapsAround(state.marks, state.selectedId, durationS);
  const plusButton = (gap: Gap, where: "before" | "after") => (
    <button
      type="button"
      onClick={() => insertAt(gap)}
      title="Add a rally here"
      aria-label={
        where === "before"
          ? "Add a rally before this point"
          : "Add a rally after this point"
      }
      className="flex h-8 w-6 shrink-0 items-center justify-center rounded-full border border-dashed border-zinc-600 text-zinc-500 transition-colors hover:border-cyan-glow/60 hover:text-cyan-glow"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>
  );

  /** The strip's contents: a chip per rally, and the "+" beside the one
   *  selected. The same in both layouts, at the size each one draws. */
  const chips = (size: 32 | 36) =>
    state.marks.map((m, i) => (
      <Fragment key={m.id}>
        {state.selectedId === m.id && gaps.before && plusButton(gaps.before, "before")}
        <MarkChip
          n={i + 1}
          mark={m}
          selected={state.selectedId === m.id}
          awaiting={state.awaitingId === m.id}
          playing={playingId === m.id}
          grow={m.t1 === null ? grow : 0}
          onSelect={() => tapChip(m.id)}
          size={size}
        />
        {state.selectedId === m.id &&
          gaps.after &&
          plusButton(gaps.after, "after")}
      </Fragment>
    ));
  const strip = (
    <div
      ref={stripRef}
      className="flex w-full shrink-0 items-center gap-1.5 overflow-x-auto border-b border-edge/60 px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{ minHeight: 52 }}
    >
      {state.marks.length === 0 ? (
        <span className="text-[11px] text-zinc-500">Nothing marked yet.</span>
      ) : (
        chips(32)
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

  /** The bar is showing this point's edges, waiting to be confirmed. */
  const adjustOn = selectedMark !== null && adjusting === selectedMark.id;

  /** Take the selected point out. Undo puts it back. */
  const removeSelected = () => {
    if (!selectedMark) return;
    apply(removeMark(stateRef.current, selectedMark.id));
    setAdjusting(null);
    setState((st) => selectMark(st, null));
  };
  const rowGrow = floating ? "flex shrink-0 gap-2" : "flex min-h-16 flex-[3] gap-2";
  const rhythmPair = reviewing_ ? (
    <div className={rowGrow}>
      <button
        type="button"
        onClick={adjustOn ? confirmAdjust : openAdjust}
        className={`${floating ? "h-16" : "min-h-16"} glow-cta flex-1 rounded-xl border-2 border-cyan-glow bg-cyan-glow text-base font-bold text-ink transition-colors active:scale-[0.99]`}
      >
        {adjustOn ? "Confirm" : "Adjust"}
      </button>
      <button
        type="button"
        onClick={resumeMarking}
        disabled={adjustOn}
        className={`${floating ? "h-16" : "min-h-16"} flex-1 rounded-xl border-2 border-edge bg-surface text-base font-bold text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white active:scale-[0.99] disabled:opacity-35 disabled:hover:border-edge disabled:hover:text-zinc-300`}
      >
        Resume
      </button>
    </div>
  ) : (
    <div className={rowGrow}>
      <button
        type="button"
        onClick={open ? tapReset : tapBegin}
        className={`${floating ? "h-16" : "min-h-16"} flex-1 rounded-xl border-2 text-base font-bold transition-colors active:scale-[0.99] ${
          open
            ? "border-edge bg-surface text-zinc-400 hover:border-amber-400/50 hover:text-amber-200"
            : "glow-cta border-cyan-glow bg-cyan-glow text-ink"
        }`}
      >
        {open ? "Back to last point" : "Begin Point"}
      </button>
      <button
        type="button"
        onClick={tapEnd}
        disabled={!open}
        className={`${floating ? "h-16" : "min-h-16"} flex-1 rounded-xl border-2 text-base font-bold transition-colors active:scale-[0.99] disabled:opacity-35 ${
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
    <div className={floating ? "flex shrink-0 gap-2" : "flex min-h-14 flex-[2] gap-2"}>
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
          className={`${floating ? "h-14" : "min-h-14"} min-w-0 flex-1 rounded-xl border px-1 text-base font-bold transition-all active:scale-[0.98] disabled:opacity-30 ${
            canAnswer ? lit : "border-edge bg-surface text-zinc-500"
          } ${awaiting ? "animate-pulse ring-2 ring-white/60" : ""}`}
        >
          <span className="block truncate">{label}</span>
        </button>
      ))}
    </div>
  );

  /**
   * One strip, six controls: the tape, the history and the point you are
   * on, all within a thumb's reach of each other.
   *
   * The five second nudges are here as well as on the picture. On the
   * picture they turn into Prev and Next the moment a point is selected,
   * which is exactly when someone wants to shift the frame a little
   * before adjusting an edge — and on a desktop the picture's buttons are
   * a long way from the pad.
   *
   * Six across leaves about fifty pixels a button, so the labels are set
   * a size down and allowed to take two lines rather than be cut off.
   */
  const utilRow = (
    <div className="flex shrink-0 gap-1.5">
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
      <Util label="−5s" onClick={() => seekBy(-5)} />
      <Util label="+5s" onClick={() => seekBy(5)} />
      <Util
        label="Mark again"
        onClick={() => selectedMark && redoPoint(selectedMark.id)}
        disabled={!reviewing_}
      />
      <Util label="Remove" onClick={removeSelected} disabled={!reviewing_} />
    </div>
  );

  /* ------------------------------------------------------------- the bar */

  /**
   * The bar between the chips and the buttons. It always holds something
   * horizontal to drag: the playback speed by default, and the selected
   * point's edges while Adjust is on. Both are the scorekeeper's own
   * controls, moved out of menus and sheets so the picture never leaves
   * the screen while a thumb is on them.
   */
  const speedIdx = speedIndex(speed);
  const speedFromX = useCallback(
    (clientX: number, el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (clientX - r.left) / Math.max(1, r.width)));
      const idx = Math.round(f * (SPEEDS.length - 1));
      const next = SPEEDS[idx];
      if (next !== undefined && next !== speed) chooseSpeed(next);
    },
    [speed, chooseSpeed]
  );
  const speedBar = (
    <div className="flex h-full items-center gap-3">
      <span className="w-9 shrink-0 text-[11px] font-semibold tabular-nums text-zinc-200">
        {speed}x
      </span>
      <div
        role="slider"
        aria-label="Playback speed"
        aria-valuemin={SPEEDS[0]}
        aria-valuemax={SPEEDS[SPEEDS.length - 1]}
        aria-valuenow={speed}
        className="relative h-8 min-w-0 flex-1 touch-none select-none"
        onPointerDown={(e) => {
          e.preventDefault();
          speedDragging.current = true;
          try {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          } catch {
            /* a synthetic pointer has no capture; the move still lands */
          }
          speedFromX(e.clientX, e.currentTarget as HTMLElement);
        }}
        onPointerMove={(e) => {
          if (!speedDragging.current) return;
          speedFromX(e.clientX, e.currentTarget as HTMLElement);
        }}
        onPointerUp={() => {
          speedDragging.current = false;
        }}
        onPointerCancel={() => {
          speedDragging.current = false;
        }}
        onLostPointerCapture={() => {
          speedDragging.current = false;
        }}
      >
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-white/10" />
        {SPEEDS.map((v, i) => (
          <span
            key={v}
            className={`absolute top-1/2 h-2 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${
              i <= speedIdx ? "bg-cyan-glow/60" : "bg-white/25"
            }`}
            style={{ left: `${(i / (SPEEDS.length - 1)) * 100}%` }}
          />
        ))}
        <span
          className="pointer-events-none absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-cyan-glow bg-ink shadow-[0_0_8px_rgba(34,211,238,0.6)]"
          style={{ left: `${(speedIdx / (SPEEDS.length - 1)) * 100}%` }}
        />
      </div>
      <span className="w-10 shrink-0 text-right text-[10px] text-zinc-500">speed</span>
    </div>
  );

  const adjustingMark =
    adjusting && adjustDraft && adjustBounds
      ? state.marks.find((x) => x.id === adjusting) ?? null
      : null;
  /** The two-handle bar. `land` is the landscape bottom bar's row, which
   *  the board draws with a narrower number and a 34 px track. */
  const renderRange = (land: boolean) => {
    if (!adjustingMark || adjustingMark.t1 === null || !adjustDraft || !adjustBounds) return null;
    const m = adjustingMark;
    const [dT0, dT1] = adjustDraft;
    const i = state.marks.findIndex((x) => x.id === m.id);
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
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          /* synthetic pointers carry no capture */
        }
      },
      onPointerMove: (e: React.PointerEvent) => {
        if (!(e.buttons & 1) && e.pointerType === "mouse") return;
        const track = (e.currentTarget as HTMLElement).parentElement;
        if (!track) return;
        const t = fromX(e.clientX, track);
        const clamped = Math.min(hi, Math.max(lo, t));
        const cur = adjustDraftRef.current ?? [dT0, dT1];
        const next: [number, number] =
          edge === "start"
            ? [Math.min(clamped, cur[1] - MIN_POINT_S), cur[1]]
            : [cur[0], Math.max(clamped, cur[0] + MIN_POINT_S)];
        adjustDraftRef.current = next;
        setAdjustDraft(next);
        // The picture follows the handle: the frame under the finger is
        // the one being judged.
        const v = videoRef.current;
        if (v) {
          v.currentTime = Math.max(0, edge === "start" ? next[0] : next[1]);
          setPlayhead(v.currentTime);
        }
      },
    });
    return (
      <div className={`flex h-full items-center ${land ? "gap-2.5" : "gap-3"}`}>
        <span
          className={`shrink-0 text-[11px] font-semibold tabular-nums text-zinc-200 ${
            land ? "w-[22px] text-center" : "w-9"
          }`}
        >
          {i + 1}
        </span>
        <div
          className={`relative min-w-0 flex-1 touch-none select-none ${
            land ? "h-[34px]" : "h-8"
          }`}
        >
          <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-white/10">
            <span
              className="absolute inset-y-0 bg-cyan-glow/45"
              style={{ left: `${pct(dT0)}%`, width: `${Math.max(0, pct(dT1) - pct(dT0))}%` }}
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
              className={`absolute flex h-8 w-9 -translate-x-1/2 touch-none items-center justify-center ${
                land ? "top-px" : "top-0"
              }`}
              style={{ left: `${pct(edge === "start" ? dT0 : dT1)}%` }}
            >
              <span className="h-8 w-0.5 rounded-full bg-cyan-glow" />
              <span className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-cyan-glow bg-ink shadow-[0_0_8px_rgba(34,211,238,0.6)]" />
            </button>
          ))}
        </div>
        <span
          className={`shrink-0 text-[10px] tabular-nums text-zinc-400 ${
            land ? "w-[34px]" : "w-10 text-right"
          }`}
        >
          {(dT1 - dT0).toFixed(1)}s
        </span>
      </div>
    );
  };
  const rangeBar = renderRange(false);

  const barStrip = (
    <div className="w-full shrink-0 border-b border-edge/60 px-3" style={{ height: 46 }}>
      {rangeBar ?? speedBar}
    </div>
  );

  const legend = (
    <div className="hidden shrink-0 flex-wrap gap-x-3 gap-y-1 text-[10px] text-zinc-500 lg:flex">
      {(mode === "cut"
        ? [
            ["S", open ? "Back to last point" : "Begin"],
            ["E", "End"],
            ["U", "Undo"],
            ["T", "Star"],
            ["Space", "Play"],
          ]
        : [
            ["S", open ? "Back to last point" : "Begin"],
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

  /** Done opens the review sheet, which is where the cut is sent: it is
   *  the pass's submit, so it wears the primary button (Adil, 2026-09-25).
   *  Without a closed point it cannot open anything, and a disabled
   *  primary that still glows reads as live, so it loses the glow too. */
  const openReview = () => {
    playApi.current?.pause();
    setReviewing(true);
  };
  const doneButton = (
    <button
      type="button"
      onClick={openReview}
      disabled={sum.total === 0}
      className={`h-11 shrink-0 rounded-full bg-cyan-glow px-6 text-sm font-bold text-ink transition-opacity active:scale-[0.99] disabled:opacity-40 ${
        sum.total === 0 ? "" : "glow-cta"
      }`}
    >
      Done
    </button>
  );

  /**
   * The Score switch (portrait and desktop footer), from the gate on. Its
   * label names the pass, "Cut and score" or "Cut only", with no sentence
   * beside it here: the footer has no room for one (Adil, 2026-09-25).
   * Practice and drills have no score to keep: the switch reads "Cut
   * only", greyed, and cannot be turned on; the reason is there for a
   * screen reader.
   */
  const scoring = mode === "score";
  const switchCopy = scoreSwitchCopy(mode, scoringAllowed);
  const scoreTrack = (small: boolean) => (
    <span
      aria-hidden="true"
      className={`relative block shrink-0 rounded-full border transition-colors ${
        small ? "h-[12px] w-[22px]" : "h-6 w-11"
      } ${scoring ? "border-cyan-glow/60 bg-cyan-glow/30" : "border-edge bg-surface-2"}`}
    >
      <span
        className={`absolute rounded-full transition-all ${
          small ? "top-px h-2 w-2" : "top-0.5 h-[1.125rem] w-[1.125rem]"
        } ${
          scoring
            ? `${small ? "left-[11px]" : "left-5"} bg-cyan-glow`
            : `${small ? "left-px" : "left-0.5"} bg-zinc-500`
        }`}
      />
    </span>
  );
  const scoreSwitch = (
    <div className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={scoring}
        aria-describedby={scoringAllowed ? undefined : "mark-score-matches-only"}
        onClick={toggleScoring}
        disabled={!scoringAllowed}
        className="flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap text-[12px] font-semibold text-zinc-300 transition-colors enabled:hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {switchCopy.label}
        {scoreTrack(false)}
      </button>
      {!scoringAllowed && (
        <span id="mark-score-matches-only" className="sr-only">
          {switchCopy.line}
        </span>
      )}
    </div>
  );

  /**
   * The gate: the one thing to press before the pass begins. Ordinary
   * buttons at the top of the pad, the same heights everywhere (Adil,
   * 2026-09-25: stretched to fill the portrait pad, "Begin Cutting" read
   * as a giant slab; he chose the plain buttons back over a full pad). The
   * footer still sits at the foot. "Start again" follows the buttons.
   */
  const startAgainShown = canStartAgain && state.marks.length > 0;
  /**
   * Each button with the line under it (markLandscape.gateButtons): a
   * 12 px grey line that says what Keep marking and Start again do, shown
   * when the marker opens on points already there (post-rollout audit B,
   * wording approved by Adil 2026-09-26).
   */
  const gateTap = (b: GateButton) => {
    if (b.action === "reviewPoints") return beginReview();
    if (b.action === "startAgain") {
      playApi.current?.pause();
      return setConfirmClear(true);
    }
    return startFromGate();
  };
  const gateButtonClass = (b: GateButton) =>
    b.lit
      ? "glow-cta h-16 w-full shrink-0 rounded-xl bg-cyan-glow text-base font-bold text-ink active:scale-[0.99]"
      : b.action === "startAgain"
        ? "h-11 w-full shrink-0 rounded-xl border-2 border-edge bg-surface text-sm font-bold text-zinc-300 transition-colors hover:border-amber-400/50 hover:text-amber-200 active:scale-[0.99]"
        : "h-12 w-full shrink-0 rounded-xl border-2 border-edge bg-surface text-sm font-bold text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white active:scale-[0.99]";
  const beginCuttingButton = (
    <div
      className={
        floating
          ? "flex shrink-0 flex-col gap-2"
          : "flex min-h-0 flex-1 flex-col gap-2.5"
      }
    >
      {gateButtons(openedAs, startAgainShown).map((b) => (
        <div key={b.action} className="flex shrink-0 flex-col gap-1.5">
          <button type="button" onClick={() => gateTap(b)} className={gateButtonClass(b)}>
            {b.label}
          </button>
          {b.detail && (
            <p className="px-1 text-[12px] leading-snug text-zinc-500">{b.detail}</p>
          )}
        </div>
      ))}
    </div>
  );

  /** The refusal of the moment, or, once a newer draft has turned up,
   *  that line for the rest of the session. */
  const statusText = refusal ?? (newerDraft ? NEWER_DRAFT : null);
  const refusalLine = statusText ? (
    <p
      role="status"
      className="shrink-0 text-center text-[12px] font-semibold text-amber-300"
    >
      {statusText}
    </p>
  ) : null;

  /* -------------------------------------------------------------- overlay */


  /**
   * Five seconds either way, on the picture itself, the way the match
   * player carries its transport. They sit at the picture's mid-height on
   * a phone in portrait and on a desktop, and along the top in landscape,
   * where the columns of tiles own both edges.
   */
  const stepIdx = state.selectedId
    ? state.marks.findIndex((m) => m.id === state.selectedId)
    : -1;
  const hasPrev =
    stepIdx > 0 && state.marks.slice(0, stepIdx).some((m) => m.t1 !== null);
  const hasNext =
    stepIdx >= 0 && state.marks.slice(stepIdx + 1).some((m) => m.t1 !== null);

  const videoOverlay = useCallback(
    (picture: PictureBox) => {
      // While a marked point is selected the pair walks the strip; while
      // marking, it nudges the tape.
      const stepping = reviewing_;
      const skip =
        "pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-ink/60 text-[11px] font-semibold text-zinc-100 transition-colors active:bg-ink/80";
      const midY = picture.top + picture.height / 2 - 20;
      return (
        <>
          {/* In landscape the nudges live in the bottom bar: nothing
              permanent sits on the picture there. */}
          {!overlayPad && (
            <div className="pointer-events-none absolute inset-0 z-[9]">
              <button
                type="button"
                onClick={() => (stepping ? stepMark(-1) : seekBy(-5))}
                disabled={stepping && !hasPrev}
                aria-label={stepping ? "Previous point" : "Back five seconds"}
                className={`${skip} absolute disabled:opacity-30`}
                style={{ left: picture.left + 10, top: midY }}
              >
                {stepping ? "Prev" : "−5s"}
              </button>
              <button
                type="button"
                onClick={() => (stepping ? stepMark(1) : seekBy(5))}
                disabled={stepping && !hasNext}
                aria-label={stepping ? "Next point" : "Forward five seconds"}
                className={`${skip} absolute disabled:opacity-30`}
                style={{ left: picture.left + picture.width - 50, top: midY }}
              >
                {stepping ? "Next" : "+5s"}
              </button>
            </div>
          )}
          {started && everPlayed && stopped && (
            <div className="pointer-events-none absolute inset-0 z-[9]">
              <button
                type="button"
                onClick={() => playApi.current?.play()}
                data-pad-play="1"
                aria-label="Play"
                className="pointer-events-auto absolute flex items-center justify-center rounded-full border border-white/15 bg-ink/60 transition-colors active:bg-ink/80"
                style={{
                  left: picture.left + picture.width / 2 - 24,
                  top: picture.top + picture.height / 2 - 24,
                  width: 48,
                  height: 48,
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  className="ml-0.5 h-6 w-6 text-zinc-100"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M8 5v14l11-7z" />
                </svg>
              </button>
            </div>
          )}
          {/* Landscape has no pad for the refusal line to sit in, so it
              comes up on the picture for its two seconds, on a solid
              backing that stays readable over any footage. */}
          {overlayPad && statusText && (
            <div className="pointer-events-none absolute inset-x-0 z-[9] flex justify-center px-3" style={{ top: picture.top + 10 }}>
              <p
                role="status"
                className="rounded-full bg-ink/85 px-3 py-1 text-center text-[12px] font-semibold text-amber-300"
              >
                {statusText}
              </p>
            </div>
          )}
        </>
      );
    },
    [
      overlayPad,
      seekBy,
      reviewing_,
      stepMark,
      hasPrev,
      hasNext,
      started,
      stopped,
      everPlayed,
      statusText,
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
      {barStrip}
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
          <span className="min-w-0 truncate text-[11px] text-zinc-500">
            {mode === "cut"
              ? sum.open
                ? "One point still open"
                : `${sum.total} ${sum.total === 1 ? "point" : "points"}`
              : sum.unscored > 0
                ? `${sum.total} ${sum.total === 1 ? "point" : "points"} · ${sum.unscored} to score`
                : `${sum.total} ${sum.total === 1 ? "point" : "points"}`}
          </span>
          <div className="flex shrink-0 items-center gap-3">
            {scoreSwitch}
            {doneButton}
          </div>
        </div>
        {legend}
      </div>
    </>
  );

  /* ------------------------------------------------------ phone landscape */

  /**
   * The phone held sideways, as approved on 2026-09-24: Scorekeeper's
   * landscape language. A solid top bar (score, chips, Done, close), the
   * answers on the left rail, the pair on the right rail, the tools along
   * a solid bottom bar, and the picture in the box they leave, with
   * nothing permanent on it. Every size and colour below is the board's
   * (docs/superpowers/specs/2026-09-24-ios-hand-cut-landscape-mockup.dc.html).
   *
   * With Score off the layout stays the same and the answers grey out,
   * so the pair never moves when the switch is flipped.
   */
  const landChrome = (() => {
    if (!land) return null;
    const g = land;

    const pair = railPair({
      started,
      opened: openedAs,
      reviewing: reviewing_,
      adjusting: adjustOn,
      open: open !== null,
      startAgain: startAgainShown,
    });
    const onPair = (t: PairTile) => {
      switch (t.action) {
        case "beginCutting":
        case "beginReview":
        case "keepMarking":
          return startFromGate();
        case "reviewPoints":
          return beginReview();
        case "begin":
          return tapBegin();
        case "reset":
          return tapReset();
        case "end":
          return tapEnd();
        case "adjust":
          return openAdjust();
        case "confirm":
          return confirmAdjust();
        case "resume":
          return resumeMarking();
        case "startAgain":
          playApi.current?.pause();
          return setConfirmClear(true);
      }
    };

    // Answers: lit only while there is a point to answer in a scoring
    // pass; greyed out, and still there, with Score off.
    const answersOn = mode === "score" && canAnswer;
    const pulse = mode === "score" && awaiting;
    const answer = (
      value: Outcome,
      label: string,
      rgb: string,
      text: string,
      height: number,
      fontSize: number
    ) => (
      <button
        key={value}
        type="button"
        onClick={() => tapAnswer(value)}
        disabled={!answersOn}
        className={`flex w-full shrink-0 items-center justify-center rounded-2xl px-2 text-center font-bold leading-[1.12] transition-all active:scale-[0.98] ${
          pulse ? "animate-pulse" : ""
        }`}
        style={{
          height,
          fontSize,
          color: text,
          ...(answersOn
            ? {
                backgroundColor: "#1B1B26",
                backgroundImage: `linear-gradient(rgba(${rgb},0.28), rgba(${rgb},0.28))`,
                border: `2px solid rgba(${rgb},0.9)`,
                boxShadow: `0 0 16px rgba(${rgb},0.35)`,
                ...(pulse
                  ? { outline: "2px solid rgba(255,255,255,0.6)", outlineOffset: 2 }
                  : null),
              }
            : {
                background: "#1B1B26",
                border: `1px solid rgba(${rgb},0.35)`,
                opacity: 0.3,
              }),
        }}
      >
        <span className="block max-w-full truncate">{label}</span>
      </button>
    );

    const stepping = reviewing_;
    const tool = (
      key: string,
      label: string,
      icon: string,
      onClick: () => void,
      disabled: boolean,
      opts: { lit?: boolean; aria?: string } = {}
    ) => (
      <button
        key={key}
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={opts.aria ?? label}
        className={`flex h-[34px] min-w-0 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-[9px] px-0.5 transition-colors active:scale-[0.98] disabled:opacity-35 ${
          opts.lit ? "bg-amber-400/15 text-amber-300" : "bg-surface-2 text-zinc-200"
        }`}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill={opts.lit ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d={icon} />
        </svg>
        <span className="whitespace-nowrap text-[10px] font-medium leading-[1.1]">
          {label}
        </span>
      </button>
    );
    const starLit = !!state.marks.find(
      (m) => m.id === (state.awaitingId ?? state.selectedId)
    )?.starred;
    const tools = [
      stepping
        ? tool("step-back", "Prev", ICON.prev, () => stepMark(-1), !hasPrev, {
            aria: "Previous point",
          })
        : tool("step-back", "−5s", ICON.back, () => seekBy(-5), false, {
            aria: "Back five seconds",
          }),
      tool("undo", "Undo", ICON.undo, tapUndo, !started || state.undo.length === 0),
      <SpeedMenu
        key="speed"
        value={speed}
        onChange={chooseSpeed}
        label="Speed"
        containerClassName="relative min-w-0"
        className="flex h-[34px] w-full min-w-0 flex-col items-center justify-center gap-0.5 rounded-[9px] bg-surface-2 px-0.5 text-[13px] font-bold leading-none text-zinc-200 active:scale-[0.98]"
        labelClassName="whitespace-nowrap text-[10px] font-medium leading-[1.1]"
      />,
      tool("star", "Star", ICON.star, tapStar, !started || state.marks.length === 0, {
        lit: starLit,
      }),
      tool(
        "again",
        "Mark again",
        ICON.again,
        () => selectedMark && redoPoint(selectedMark.id),
        !reviewing_
      ),
      tool("remove", "Remove", ICON.remove, removeSelected, !reviewing_),
      // The Score switch as a tile: its state where the other tiles have
      // an icon. On practice it is there, off and greyed, and says why;
      // the reason stays readable while the switch and its word dim.
      <button
        key="score"
        type="button"
        role="switch"
        aria-checked={scoring}
        aria-describedby={scoringAllowed ? undefined : "mark-score-matches-only-land"}
        onClick={toggleScoring}
        disabled={!scoringAllowed}
        className="flex h-[34px] min-w-0 flex-col items-center justify-center gap-[3px] overflow-hidden rounded-[9px] bg-surface-2 px-0.5 text-zinc-200 transition-colors active:scale-[0.98]"
      >
        <span className={`flex flex-col items-center gap-[3px] ${scoringAllowed ? "" : "opacity-35"}`}>
          {scoreTrack(true)}
          <span className="whitespace-nowrap text-[10px] font-medium leading-[1.1]">
            {switchCopy.label}
          </span>
        </span>
        {!scoringAllowed && (
          <span id="mark-score-matches-only-land" className="sr-only">
            {switchCopy.line}
          </span>
        )}
      </button>,
      stepping
        ? tool("step-fwd", "Next", ICON.next, () => stepMark(1), !hasNext, {
            aria: "Next point",
          })
        : tool("step-fwd", "+5s", ICON.fwd, () => seekBy(5), false, {
            aria: "Forward five seconds",
          }),
    ];
    const range = renderRange(true);

    return (
      <>
        {/* Top bar: the score (or the count), the chips, Done, close. */}
        <div
          className="absolute inset-x-0 top-0 border-b border-edge bg-surface"
          style={{ height: TOP_BAR_H }}
        >
          <div
            className="absolute top-0 flex items-center gap-2.5"
            style={{ left: g.x0, width: g.avail, height: TOP_BAR_H }}
          >
            {mode === "cut" ? (
              <div className="flex shrink-0 items-baseline gap-1.5">
                <span className="text-[20px] font-bold tabular-nums text-zinc-200">
                  {sum.total}
                </span>
                <span className="text-[11px] text-zinc-500">
                  {sum.total === 1 ? "point" : "points"}
                </span>
              </div>
            ) : (
              <div className="flex shrink-0 items-center gap-2.5">
                <span className="whitespace-nowrap text-[20px] font-bold tabular-nums">
                  <span className="text-cyan-glow">{score.current.you}</span>
                  <span className="text-zinc-600"> - </span>
                  <span className="text-magenta-soft">{score.current.them}</span>
                </span>
                {score.gamesYou + score.gamesThem > 0 && (
                  <span className="rounded-full border border-edge px-2 py-0.5 text-[11px] font-semibold tabular-nums text-zinc-300">
                    {score.gamesYou}-{score.gamesThem}
                  </span>
                )}
                {nextServer && (
                  <span className="flex items-center gap-[5px] whitespace-nowrap text-[13px] text-zinc-300">
                    <span
                      aria-hidden="true"
                      className={`block h-[7px] w-[7px] rounded-full ${
                        nextServer === "user" ? "bg-cyan-glow" : "bg-magenta-soft"
                      }`}
                    />
                    {nextServer === "user" ? "You serve" : `${themLabel} serves`}
                  </span>
                )}
              </div>
            )}
            {/* The strip scrolls; its row hugs the right, next to Done,
                and a long one scrolls from there. */}
            <div
              ref={stripRef}
              className="h-full min-w-0 flex-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              <div className="ml-auto flex h-full w-max items-center gap-2 px-1.5">
                {state.marks.length === 0 ? (
                  <span className="whitespace-nowrap text-xs text-zinc-500">
                    Nothing marked yet.
                  </span>
                ) : (
                  chips(36)
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={openReview}
              disabled={sum.total === 0}
              className={`h-[34px] shrink-0 rounded-full bg-cyan-glow px-5 text-sm font-bold text-ink transition-opacity active:scale-[0.99] disabled:opacity-40 ${
                sum.total === 0 ? "" : "glow-cta"
              }`}
            >
              Done
            </button>
            <button
              type="button"
              onClick={closeMarker}
              aria-label="Close"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-zinc-200"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Left rail: the three answers. */}
        <div
          className="absolute flex flex-col"
          style={{ left: g.leftX, top: g.yMid, width: g.tileW, height: g.boxH, gap: RAIL_GAP }}
        >
          {answer("user", youLabel, "34,211,238", "#22d3ee", g.answerH, g.answerFont)}
          {answer("opponent", themLabel, "232,121,249", "#f0abfc", g.answerH, g.answerFont)}
          {answer("let", "Let", "255,185,0", "#ffd230", LET_H, 17)}
        </div>

        {/* Right rail: the pair, or the gate before anything has begun. */}
        <div
          className="absolute flex flex-col"
          style={{ left: g.rightX, top: g.yMid, width: g.tileW, height: g.boxH, gap: RAIL_GAP }}
        >
          {pair.map((t) => (
            <button
              key={t.action}
              type="button"
              onClick={() => onPair(t)}
              disabled={t.tone === "off"}
              className={`flex w-full shrink-0 items-center justify-center rounded-2xl border-2 px-2 text-center font-bold leading-[1.12] transition-colors active:scale-[0.99] disabled:opacity-35 ${
                t.tone === "lit"
                  ? "glow-cta border-cyan-glow bg-cyan-glow text-ink"
                  : "border-edge bg-surface-2 text-zinc-300"
              }`}
              style={{
                height: pairTileHeight(t, pair.length, g.boxH),
                fontSize: g.pairFont,
              }}
            >
              {t.detail ? (
                // The gate's line, smaller, inside the tile. The column
                // wraps rather than overflows: on a rail too short for
                // it the line moves into a second column this box
                // clips, so the label is never pushed out of its tile.
                <span className="flex h-full w-full flex-col flex-wrap content-start items-center justify-center overflow-hidden py-1.5">
                  <span className="w-full">{t.label}</span>
                  <span
                    className={`w-full pt-1 font-medium leading-[1.2] ${
                      t.tone === "lit" ? "text-ink/75" : "text-zinc-400"
                    }`}
                    style={{ fontSize: gateDetailFont(g.tileW) }}
                  >
                    {t.detail}
                  </span>
                </span>
              ) : (
                t.label
              )}
            </button>
          ))}
        </div>

        {/* Bottom bar: the tools, or the point's edges while adjusting. */}
        <div
          className="absolute inset-x-0 border-t border-edge bg-surface"
          style={{ top: g.bottomTop, height: g.bottomH }}
        >
          {range ? (
            <div
              className="absolute"
              style={{ left: g.x0, width: g.avail, top: 3, height: BOTTOM_BAR_H - 7 }}
            >
              {range}
            </div>
          ) : (
            <div
              className="absolute grid gap-1.5"
              style={{
                left: g.x0,
                width: g.avail,
                top: 3,
                height: BOTTOM_BAR_H - 7,
                gridTemplateColumns: `repeat(${tools.length}, minmax(0, 1fr))`,
              }}
            >
              {tools}
            </div>
          )}
        </div>
      </>
    );
  })();

  /* --------------------------------------------------------------- render */

  // On <body>, from every host (the unprocessed page, More options, the
  // preview page), so nothing the host sits inside can clip it, stack it
  // or transform it, and so holdPageBehind can hide the whole page as
  // <body>'s other children. The marker only ever opens from a tap, on
  // the client.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={rootRef}
      className={
        land
          ? "fixed inset-0 z-[80] overflow-hidden bg-black"
          : `fixed inset-0 z-[80] flex bg-ink ${
              floating ? "flex-col" : "portrait:flex-col landscape:flex-row"
            }`
      }
      // Landscape pads its own bottom bar for the home indicator.
      style={land ? undefined : { paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {/* Reads the safe areas for the landscape arithmetic. First in every
          layout, so the player below keeps its place in the tree and is
          never remounted (and reloaded) by a rotation. */}
      <div
        ref={insetProbeRef}
        aria-hidden="true"
        className="pointer-events-none invisible fixed left-0 top-0 h-0 w-0"
        style={{
          paddingLeft: "env(safe-area-inset-left)",
          paddingRight: "env(safe-area-inset-right)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      />
      {/* The box is sized on this div, never on the element: a media element
          has no intrinsic size until metadata arrives. */}
      <div
        className={
          land
            ? "absolute overflow-hidden rounded-lg bg-[#111]"
            : floating
              ? "relative min-h-0 flex-1"
              : portrait
                ? "relative w-full shrink-0"
                : "relative h-full flex-1"
        }
        style={
          land
            ? { left: land.picX, top: land.yMid, width: land.boxW, height: land.boxH }
            : !floating && portrait
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
              chainAfterPreview();
              return;
            }
            if (started) followTape(el.currentTime);
          }}
          onLoadedMetadata={(el) => {
            if (el.videoWidth > 0 && el.videoHeight > 0) {
              setAr(el.videoWidth / el.videoHeight);
            }
            resumeToLastPoint();
          }}
          onClose={closeMarker}
          overlay={videoOverlay}
          bare={land !== null}
        />
      </div>

      {land
        ? landChrome
        : (floating ? (
          <div className="pointer-events-none absolute inset-0 z-10">
            <div
              ref={padCardRef}
              {...padDragHandlers}
              className="pointer-events-auto absolute flex max-h-[calc(100%-2rem)] flex-col overflow-y-auto rounded-2xl border border-edge bg-ink/90 shadow-2xl shadow-black/50"
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

      {serveStep && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-end justify-center">
          <div
            className={`ks-fade pointer-events-auto border border-edge bg-surface p-5 ${
              land
                ? "absolute rounded-2xl shadow-2xl shadow-black/50"
                : "w-full rounded-t-2xl pb-8 sm:mb-6 sm:max-w-sm sm:rounded-2xl sm:pb-5"
            }`}
            style={
              land
                ? {
                    // Over the picture, clear of the bottom bar, so the
                    // tools and the rails stay in reach while the start
                    // of the match plays.
                    width: Math.min(384, land.avail),
                    left: Math.max(
                      land.x0,
                      land.picX + (land.boxW - Math.min(384, land.avail)) / 2
                    ),
                    bottom: land.bottomH + 10,
                  }
                : undefined
            }
          >
            <h2 className="text-base font-semibold">Who served first?</h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              Sets the serve rotation for the whole match. Play the start if
              you need to check.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {(
                [
                  ["user", youLabel],
                  ["opponent", themLabel],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => answerFirstServer(value)}
                  className="truncate rounded-lg border border-edge bg-ink/40 px-4 py-3 text-sm font-semibold text-zinc-300 transition-colors hover:border-cyan-glow/40"
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={playFromStart}
                className="rounded-full border border-edge px-4 py-2 text-xs font-semibold text-zinc-200 transition-colors hover:border-cyan-glow/50"
              >
                Play from the start
              </button>
              <button
                type="button"
                onClick={closeServeStep}
                className="rounded-full border border-edge px-4 py-2 text-xs font-semibold text-zinc-400 transition-colors hover:border-zinc-500"
              >
                Not sure yet
              </button>
            </div>
          </div>
        </div>
      )}

      {reviewing && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-ink/70 p-4 backdrop-blur-sm">
          <div className="max-h-full w-full max-w-sm overflow-y-auto overscroll-contain rounded-2xl border border-edge bg-surface p-6">
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
            {reviewChoice && <div className="mt-5">{reviewChoice}</div>}
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

      <ConfirmDialog
        open={confirmClear}
        title="Clear all marks?"
        confirmLabel="Clear"
        onCancel={() => setConfirmClear(false)}
        onConfirm={clearAll}
      />
    </div>,
    document.body,
  );
}
