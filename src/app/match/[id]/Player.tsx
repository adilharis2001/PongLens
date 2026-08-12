"use client";

import {
  Fragment,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { createClient } from "@/lib/supabase/client";
import type { Note, Point, ServeStartMeta, Tag } from "@/lib/types";
import { TIGHT_PAD, effectivePad } from "./clipEdit";
import { ModifyClip } from "./ModifyClip";
import { runJoinPlan, runSplitPlan } from "./modifyOps";
import {
  computeMatchScore,
  createBoundaryWalk,
  gameBoundaryAction,
  gameWinner,
  stepBoundaryWalk,
  type GameEndOverride,
  type GameSummary,
  type MatchScore,
} from "./gameScore";
import { KeyCap } from "@/components/KeyCap";
import { Annotator } from "./Annotator";
import { NoteComposer, PointNoteThread } from "./Notes";
import { PointTags } from "./Tags";
import type { MapLabels } from "./PlacementMap";
import { PointScorecard, useSaveFlash } from "./PointScorecard";
import {
  customReasonValue,
  hasLossAnalysis,
  lossReasonsFor,
  MAX_CUSTOM_REASON_LEN,
  serverContextLine,
} from "./scorecard";
import {
  armedPointId,
  paddedEnd,
  pauseEnd,
  playingPointId,
  rallyEnd,
  type ClipPad,
} from "./playhead";
import { fusedSplitCut } from "./fusedPoint";
import { ScoreBug } from "./ScoreBug";
import { GesturesButton } from "./GesturesSheet";
import { hintEligible, markHintDone, markHintShown } from "./gestureHints";
import type { MatchServer, ServeInfo } from "./serving";
import {
  NORMAL_SPEED_IDX,
  SPEEDS as SPEED_VALUES,
  SpeedMenu,
} from "./SpeedMenu";

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
 * seek. The takeover at 100dvh is the baseline "fullscreen"; the expand
 * button on the transport goes further — real element fullscreen plus a
 * landscape orientation lock where the platform allows it, and on iPhone
 * Safari (which still has no element fullscreen) a rotated fake-landscape
 * presentation of the same takeover. The one thing still never used is the
 * NATIVE video fullscreen (webkitEnterFullscreen): it hands playback to
 * the system player and every custom control disappears.
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
 *   - The pad's Replay control seeks back to the current rally's cut_t0,
 *     explicitly re-arms its boundary, and plays — a replay pauses again
 *     at the same end. It works any time, not only at a paused end:
 *     mid-rally it starts the rally on screen over.
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

/** Rates and the pill that picks them, shared with the pad (SpeedMenu.tsx). */
const SPEEDS = SPEED_VALUES;

/**
 * Replay: a closed loop, not the hooked arrow. That hook is Undo, one
 * button along in the same row — at 16px alone the two would read as the
 * same picture, which is why every control in that row now carries a tiny
 * text label as well.
 */

/** Desktop floating pad: width, and where it was last dropped. */
const PAD_WIDTH = 380;
const PAD_POS_KEY = "ponglens:score-pad-pos";

function ReplayIcon({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* 300 degrees of circle, open at the top-left, with the arrowhead
          sitting in the gap pointing back the way it came. */}
      <path d="M20.5 12a8.5 8.5 0 1 1-2.9-6.4" />
      <path d="M18.6 2.4v3.4h-3.4" />
    </svg>
  );
}

/** A pennant on a pole: the game-boundary control. */
function FlagIcon({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5.5 21V3.5" />
      <path d="M5.5 4h12.3l-2.6 4 2.6 4H5.5" />
    </svg>
  );
}

/**
 * One control in the pad's row: an icon with its name under it. The label
 * is not decoration — Undo's hooked arrow and Replay's closed loop are the
 * same picture at 16px, and a first-time scorer should never have to tap
 * something to find out what it does. Three states: quiet, `lit` (this
 * point already carries the thing), and `attention` (the app is suggesting
 * this tap right now — the Game-ended glow after an answer crosses a
 * held-open game's real end).
 */
function PadControl({
  label,
  aria,
  onClick,
  disabled,
  lit,
  attention,
  pressed,
  children,
}: {
  label: string;
  aria?: string;
  onClick: () => void;
  disabled?: boolean;
  lit?: boolean;
  attention?: boolean;
  pressed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={aria ?? label}
      aria-pressed={pressed}
      className={`flex h-12 min-w-[2.75rem] shrink-0 flex-col items-center justify-center gap-1 whitespace-nowrap rounded-xl border px-1.5 transition-colors disabled:opacity-40 ${
        lit
          ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
          : attention
            ? "border-cyan-glow/60 bg-cyan-glow/10 text-cyan-glow shadow-[0_0_12px_rgba(34,211,238,0.3)]"
            : "border-edge bg-surface text-zinc-300 hover:border-cyan-glow/50 hover:text-white"
      }`}
    >
      {children}
      <span className="text-[9px] font-medium leading-none">{label}</span>
    </button>
  );
}

/** Single-tap vs double-tap vs press-and-hold disambiguation windows. */
const HOLD_MS = 250;

/** Press-and-hold rates: left half of the frame slows down, right speeds up. */
const HOLD_SLOW = 0.25;
const HOLD_FAST = 2;
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

/** How long after scoring a point the note button still means "about THAT
 *  one". Scoring advances, so the playhead alone cannot tell a note meant
 *  for the rally you just judged from one meant for the rally now playing;
 *  past this, the playhead is the better guess. */
const SCORED_NOTE_WINDOW_MS = 15_000;


/** The split at_t must sit at least this far inside the point on both edges
 *  (matches split_point's window; the Modify machinery in modifyOps.ts
 *  clamps with the same constant). */
const SPLIT_EDGE_S = 0.3;

/**
 * The one-tap door to "why did I lose that".
 *
 * Sits in the top-RIGHT of the OPPONENT's score button, which is the only
 * button meaning "I lost this point" and so the only one with a question
 * behind it. Top-right is where a right thumb rests coming off the button's
 * centre, and it is the far corner from your own side's tap zone.
 * A matching pill on your own side would either ask a question that does
 * not exist or do nothing; the asymmetry is the product saying, without a
 * word, that it asks about losses.
 *
 * Tapping it scores exactly what the button around it scores, so a miss in
 * either direction is free: you either get the overlay you did not want, or
 * you miss it and tap again. Neither can put the point on the wrong player.
 */
function WhyPill({
  disabled,
  label,
  answered,
  onClick,
}: {
  disabled: boolean;
  label: string;
  /** The point already carries a reason: shown filled, so a pass leaves a
   *  visible trail of which losses you have explained. */
  answered: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`absolute right-2 top-2 flex h-11 items-center justify-center rounded-full border px-4 text-xs font-semibold transition-colors disabled:opacity-40 ${
        answered
          ? "border-magenta-glow bg-magenta-glow/25 text-magenta-soft"
          : "border-magenta-glow/40 bg-ink/60 text-magenta-soft/80"
      }`}
    >
      Why
    </button>
  );
}

/**
 * Footage left after an answer that is worth staying for.
 *
 * Answering early is the pad's fast path — you tap the moment the ball hits
 * the net, with the post pad still to run. That tail is a second or two of
 * walk-back and nothing can hide in it. But a clip the cutter fused holds a
 * WHOLE second rally, and a rally needs a serve plus a couple of shots: it
 * cannot happen in under ~3.5s. So past this much remaining footage we stop
 * jumping to the next point, play the rest of THIS one, and offer the split.
 * Below it, nothing changes.
 */
const TAIL_WATCH_S = 3.5;

/** Backward lead for a split placed by hand: the tap always lands a beat
 *  after the deciding shot, so cutting AT it would clip the next serve. */
const SPLIT_LEAD_S = 0.6;

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
    }
  | {
      /** Modify-modal Split (2-3 way). ONE compound undo: reverse every
       *  split_point via unsplit_point (tail-most child first), then restore
       *  the root point's pre-split winner/skip. The children's own outcomes
       *  vanish with the deleted rows. */
      type: "modify-split";
      unsplits: {
        parentId: string;
        childId: string;
        prevT1: number;
        prevTightEnd: boolean;
        prevEdited: boolean;
      }[];
      rootId: string;
      rootPrevWinner: "user" | "opponent" | null;
      rootPrevSkipped: boolean;
      rootCutT0: number | null;
    }
  | {
      /** Modify-modal Adjust (timing fix). Undo writes the previous
       *  t0/t1/tight flags back — itself just another timing save. */
      type: "adjust";
      pointId: string;
      prevT0: number;
      prevT1: number;
      prevTightStart: boolean;
      prevTightEnd: boolean;
    }
  | {
      /** "Match starts here" sweep — every point before the current one,
       *  in one entry. Undo restores the whole set in one write. */
      type: "bulk-delete";
      pointIds: string[];
      firstCutT0: number | null;
    };

/**
 * The rally the surface is ABOUT at time t — one answer, shared by the chip
 * ring, the ticker score and tap targeting, so they can never disagree.
 *
 * WYSIWYG on its own flips to the next rally the moment the playhead reaches
 * its padded start, which on close-together cuts happens BEFORE the previous
 * rally's stop fires. The number under the ring then jumped forward, the
 * video stopped a beat later, and the pin dragged it back: a visible stutter
 * on every point, and for that half-second a tap would have answered the
 * wrong rally.
 *
 * So while a rally still has a stop coming, it stays the target. `hold` is
 * only true in score/play — watch mode has no stops and should follow the
 * picture. A run that STARTED at or after the previous rally's end (chevron,
 * chip, answer-advance) never holds: you are watching the new one.
 */
function targetAt(
  ps: Point[],
  t: number,
  pad: ClipPad,
  hold: boolean,
  runStart: number | null,
  firedId: string | null
): Point | null {
  const id = playingPointId(ps, t);
  const cur = id ? (ps.find((p) => p.id === id) ?? null) : null;
  if (!cur) {
    const aid = armedPointId(ps, t, pad);
    return aid ? (ps.find((p) => p.id === aid) ?? null) : null;
  }
  if (!hold) return cur;
  const i = ps.indexOf(cur);
  const prev = i > 0 ? ps[i - 1] : null;
  if (!prev || prev.id === firedId) return cur;
  const stop = isUnscored(prev) ? pauseEnd(prev, pad) : paddedEnd(prev, pad);
  const rEnd = rallyEnd(prev, pad);
  if (stop === null || rEnd === null || t >= stop) return cur;
  if (runStart === null || runStart >= rEnd) return cur;
  return prev;
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
  /**
   * Open the takeover in score mode. Resumes at the first unscored point,
   * or at `atPointId` when the caller has somewhere specific to land — the
   * point you were just looking at, coming back from its detail view.
   */
  openScore: (atPointId?: string) => void;
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
    onUndoDelete: (pointId: string | string[]) => void;
    /**
     * Bulk "the match starts here" sweep: soft-delete every visible point
     * before this one, with NO snackbar (the takeover covers it — the
     * pad's own Undo owns recovery). Only offered while the whole match
     * is untouched.
     */
    onDeleteAllBefore?: (point: Point) => void;
    /**
     * Non-null when the reel-usable names are incomplete (either player
     * unnamed under the current side mapping): prefills for the score-mode
     * names sheet. null = both known, never prompt.
     */
    namesPrompt: { you: string; them: string } | null;
    /** Persist the names sheet's answers (MatchView owns the columns). */
    onSaveNames: (you: string, them: string) => void;
    onSaveFirstServer: (v: MatchServer) => void;
    onSetWinner: (
      point: Point,
      value: "user" | "opponent" | null,
      /** Cut-video playhead at the tap — Keep score's flowing session
       *  only, where the video sits at the rally's end (067). */
      scoredAtCutS?: number
    ) => void;
    /**
     * Admin, on their own match (089). Shows the serve-start label under
     * the pad. The DB trigger enforces the same rule, so this only decides
     * whether the control is worth rendering.
     */
    canLabelServeStart?: boolean;
    /**
     * Stamp (or clear, with null) where the serve began, in cut-video
     * seconds. meta records whether the tap was made live or while paused,
     * which is what makes the reaction-time lag correctable offline.
     */
    onSetServeStart?: (
      point: Point,
      atCutS: number | null,
      meta: ServeStartMeta | null
    ) => void;
    /** Mark/unmark a point skipped (is_let column). */
    onSetSkipped: (point: Point, value: boolean) => void;
    onSetServer: (point: Point, value: "user" | "opponent") => void;
    /** Pin/clear a game boundary after a point (game_end_override). */
    onSetGameOverride: (point: Point, value: GameEndOverride) => void;
    /** Name/clear the winner of the game ending at a point (099) — for
     *  pinned ends the score can't prove (points lost to a cut). */
    onSetGameWinner?: (
      point: Point,
      value: "user" | "opponent" | null
    ) => void;
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
    /**
     * Modify-modal Join: the Player has already run merge_points (the
     * survivor grew its t1, the merged-away rows are hard-deleted in the DB).
     * This applies the optimistic local state — patch the survivor, drop the
     * removed rows, schedule a reclip. Optional; wired alongside onSplit.
     */
    onMerge?: (
      survivorId: string,
      patch: Partial<Point>,
      removedIds: string[]
    ) => void;
    /**
     * Modify-modal Adjust: save new t0/t1 for a point. MatchView owns the
     * write (tight-flag dissolution, optimistic mirror, reclip schedule);
     * resolves false when the save failed. Optional; wired alongside
     * onSplit.
     */
    onAdjustTiming?: (
      point: Point,
      t0: number,
      t1: number,
      /** Undo path: restore these tight flags instead of dissolving. */
      tight?: { tight_start: boolean; tight_end: boolean }
    ) => Promise<boolean>;
    /** Open a point's detail view (the transient chip pill uses it). */
    onOpenPoint: (pointId: string) => void;
    /** Viewer, for notes written from the watch chrome (player or coach). */
    userId: string;
    /** Match owner, so a coach's note is styled and labelled as one. */
    ownerId: string;
    /** Every note on the match; the sheets filter to the point on screen. */
    notes: Note[];
    /** author_id -> display name, for note attribution. */
    authorNames: Map<string, string>;
    /** A note written here; the page owns the notes list. */
    onNoteAdded: (note: Note) => void;
    /** Player names for the analysis questions (see MatchView's mapLabels). */
    mapLabels: MapLabels;
    /** Neutral / third-party match: the questions name the players. */
    neutral: boolean;
    /** Apply an analysis-panel write to the page's copy of the point. */
    onPointUpdate: (pointId: string, patch: Partial<Point>) => void;
    /** The owner's own "why I lost it" pills (loss_reason_labels, 060). */
    customReasons?: { id: string; label: string }[];
    onCreateCustomReason?: (label: string) => Promise<string | null>;
    /** Mirrors open/closed so the page can hide its floating score pill. */
    onOpenChange: (open: boolean) => void;
    /** Tags (035): a point's resolved tags, for the sheets' Notes areas. */
    tagsForPoint: (pointId: string) => Tag[];
    /** The owner's vocabulary, recent-first, for the picker. */
    tagVocab: Tag[];
    onToggleTag: (pointId: string, tag: Tag) => void;
    onCreateTag: (pointId: string, label: string) => void;
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
    onDeleteAllBefore,
    namesPrompt,
    onSaveNames,
    onSaveFirstServer,
    onSetWinner,
    canLabelServeStart = false,
    onSetServeStart,
    onSetSkipped,
    onSetServer,
    onSetGameOverride,
    onSetGameWinner,
    onToggleStar,
    onSplit,
    onUnsplit,
    onMerge,
    onAdjustTiming,
    onOpenPoint,
    onOpenChange,
    userId,
    ownerId,
    notes,
    authorNames,
    onNoteAdded,
    mapLabels,
    neutral,
    onPointUpdate,
    customReasons = [],
    onCreateCustomReason,
    tagsForPoint,
    tagVocab,
    onToggleTag,
    onCreateTag,
  },
  ref
) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const open = mode !== null;

  // ---------------------------------------------- desktop floating pad
  // With a real screen and a pointer, the score pad detaches from the
  // right rail and floats over a full-bleed video. matchMedia rather than
  // CSS variants because the floating pad differs in STRUCTURE (drag
  // handlers, in-pad Replay, the kbd row), not just in styles — and the
  // dual-render idiom would double several hundred lines of pad.
  const [floatingPad, setFloatingPad] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px) and (pointer: fine)");
    const update = () => setFloatingPad(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // ------------------------------------------------------- fullscreen
  // The expand button on the transport. Two implementations behind one
  // control:
  //  - Real element fullscreen on the takeover root where the platform
  //    has it (Android Chrome, desktop, iPad) — browser chrome goes away,
  //    every existing layout keeps working because it is the same element,
  //    and on touch devices we additionally ask for a landscape
  //    orientation lock (granted in fullscreen on Android; a no-op where
  //    it isn't).
  //  - iPhone Safari still has no element fullscreen, so there the button
  //    switches to FAKE landscape: the takeover stays a fixed overlay but
  //    is sized to the rotated viewport (width 100dvh, height 100dvw) and
  //    turned 90° — the standard trick mobile video players use. Safari's
  //    own chrome stays, which is as far as the platform lets a web page
  //    go; the picture still presents landscape without the user touching
  //    their rotation lock.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [fsActive, setFsActive] = useState(false);
  const [fakeFs, setFakeFs] = useState(false);
  // Viewport orientation as state: the fake mode only rotates while the
  // device is actually portrait (physically landscape it would be
  // rotating AWAY from landscape).
  const [isPortrait, setIsPortrait] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(orientation: portrait)");
    const update = () => setIsPortrait(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const fsSupported =
    typeof document !== "undefined" &&
    !!(
      document.fullscreenEnabled ||
      (document as Document & { webkitFullscreenEnabled?: boolean })
        .webkitFullscreenEnabled
    );

  const toggleFullscreen = useCallback(() => {
    const root = rootRef.current;
    if (!fsSupported) {
      setFakeFs((v) => !v);
      return;
    }
    if (!root) return;
    const doc = document as Document & {
      webkitFullscreenElement?: Element | null;
      webkitExitFullscreen?: () => void;
    };
    const el = root as HTMLDivElement & {
      webkitRequestFullscreen?: () => void;
    };
    const active = document.fullscreenElement ?? doc.webkitFullscreenElement;
    if (active) {
      if (document.exitFullscreen) void document.exitFullscreen();
      else doc.webkitExitFullscreen?.();
      return;
    }
    if (el.requestFullscreen) {
      void el
        .requestFullscreen({ navigationUI: "hide" })
        .catch(() => undefined);
    } else {
      el.webkitRequestFullscreen?.();
    }
    // Phones and tablets: fullscreen for a video means landscape. The
    // lock is only grantable inside fullscreen and only on platforms
    // that implement it (Android) — everywhere else this rejects and
    // the device's own rotation stays in charge.
    if (window.matchMedia("(pointer: coarse)").matches) {
      const so = screen.orientation as ScreenOrientation & {
        lock?: (o: string) => Promise<void>;
      };
      void so.lock?.("landscape").catch(() => undefined);
    }
  }, [fsSupported]);

  // Mirror the browser's fullscreen state (Esc, the system gesture and
  // our own exits all land here) and release the orientation lock when
  // fullscreen ends — a locked orientation outside fullscreen strands
  // the whole app sideways.
  useEffect(() => {
    const onChange = () => {
      const doc = document as Document & {
        webkitFullscreenElement?: Element | null;
      };
      const active = !!(
        document.fullscreenElement ?? doc.webkitFullscreenElement
      );
      setFsActive(active);
      if (!active) {
        try {
          (
            screen.orientation as ScreenOrientation & { unlock?: () => void }
          ).unlock?.();
        } catch {
          // nothing was locked
        }
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);

  // Closing the takeover ends both fullscreen flavours with it.
  useEffect(() => {
    if (open) return;
    setFakeFs(false);
    const doc = document as Document & {
      webkitFullscreenElement?: Element | null;
      webkitExitFullscreen?: () => void;
    };
    if (document.fullscreenElement ?? doc.webkitFullscreenElement) {
      if (document.exitFullscreen)
        void document.exitFullscreen().catch(() => undefined);
      else doc.webkitExitFullscreen?.();
    }
  }, [open]);

  // The fake mode is only a rotation while the viewport is portrait.
  const fakeLandscape = open && fakeFs && !fsActive && isPortrait;

  // Where the pad was dropped. null = the default perch (right edge,
  // vertically centred, styled inline where the card renders). A drag
  // converts to px, and the spot persists: where the pad sits is a
  // preference, not something to renegotiate every match.
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
    if (!floatingPad || mode !== "score") return;
    try {
      const raw = localStorage.getItem(PAD_POS_KEY);
      if (raw) {
        const p = JSON.parse(raw) as { x?: unknown; y?: unknown };
        if (typeof p.x === "number" && typeof p.y === "number") {
          setPadPos(clampPadPos({ x: p.x, y: p.y }));
        }
      }
    } catch {
      // an unreadable stored spot just means the default perch
    }
    const onResize = () => setPadPos((cur) => (cur ? clampPadPos(cur) : cur));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [floatingPad, mode, clampPadPos]);

  // Drag from anywhere on the pad that isn't a control. Style writes go
  // straight to the node during the drag — React re-renders mid-drag (the
  // playhead ticks constantly) leave an unchanged style prop alone — then
  // one commit on release.
  const padDragHandlers = {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const t = e.target as HTMLElement;
      if (t.closest("button, a, input, textarea, select, [role='slider']"))
        return;
      const card = padCardRef.current;
      if (!card) return;
      // Kills the text selection a drag across the score would start.
      // Safe here: interactive targets already returned above.
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
        // storage blocked — the drag still holds for this session
      }
    },
    onPointerCancel: () => {
      padDragRef.current = null;
      const card = padCardRef.current;
      if (card) card.style.cursor = "";
    },
  };

  // Playhead mirror for DISPLAY (chips, point chip, pre-lit buttons).
  // Updated by media events and optimistically by every programmatic seek,
  // so the UI is right even before any timeupdate fires. Tap TARGETING
  // reads video.currentTime directly (see resolveTargetPoint).
  const [playheadT, setPlayheadT] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState<{ s: number; e: number }[]>([]);
  const [paused, setPaused] = useState(true);
  const [speedIdx, setSpeedIdx] = useState(NORMAL_SPEED_IDX);
  // The network can't keep up (waiting/stalled): a spinner says so.
  // Without it a choppy connection reads as the app freezing — the video
  // stops, nothing acknowledges why, and taps appear to do nothing.
  const [stalled, setStalled] = useState(false);

  /**
   * Where the PICTURE actually is inside the video element.
   *
   * object-contain letterboxes: on a portrait phone a 16:9 match paints a
   * band across the middle with a couple of hundred dead pixels above and
   * below it. Anything anchored to the element's own corners (the score
   * bug) therefore floats out in the black, nowhere near the match — and
   * nowhere near where the exported reel burns the same table. So the
   * overlay is placed against the picture's edges instead, which is the
   * one rectangle that means anything in every orientation.
   */
  const [frame, setFrame] = useState<{
    bottomGap: number;
    left: number;
    height: number;
  } | null>(null);

  // Chrome visibility: single tap toggles, auto-hides while playing.
  const [controlsVisible, setControlsVisible] = useState(true);
  // The speed menu lives INSIDE the auto-hiding chrome, so the chrome has to
  // stay put while it is open.
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  // Note sheet (watch mode): composing a note about the point on screen.
  const [noteSheet, setNoteSheet] = useState<Point | null>(null);
  // Frame annotation (watch mode, paused): the frame captured at tap
  // time from the ON-SCREEN video, then the uploaded image waiting to be
  // attached to the note being written.
  const [annotate, setAnnotate] = useState<{
    point: Point;
    frame: HTMLCanvasElement;
  } | null>(null);
  const [pendingImage, setPendingImage] = useState<{
    path: string;
    preview: string;
  } | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  // Playback always wins over annotation: the video carries
  // crossOrigin="anonymous" so the paused frame is readable, but if the
  // bucket's CORS rule ever regresses the media fetch would fail — one
  // retry without crossOrigin restores playback (drawing then reports
  // its "can't read the frame" message instead).
  const [corsOff, setCorsOff] = useState(false);
  const corsRetryT = useRef<number | null>(null);
  useEffect(() => {
    if (!corsOff) return;
    const v = videoRef.current;
    if (!v) return;
    const t = corsRetryT.current ?? 0;
    const onMeta = () => {
      v.currentTime = t;
    };
    v.addEventListener("loadedmetadata", onMeta, { once: true });
    v.load();
    return () => v.removeEventListener("loadedmetadata", onMeta);
  }, [corsOff]);
  // Point picker (watch mode): jump straight to any rally in the match.
  const [pointPicker, setPointPicker] = useState(false);
  /** The game end tapped in the chip strip, offered for removal. */
  const [gameBreak, setGameBreak] = useState<{
    pointId: string;
    game: number;
    you: number;
    them: number;
  } | null>(null);
  // A clip whose tail we are playing out after an early answer, and where
  // that tail ends. Cleared when it plays out (we advance then), or as soon
  // as the playhead leaves the clip by any other route.
  const playTailRef = useRef<{ id: string; end: number } | null>(null);
  // The "this might be two points" offer, on the clip just answered.
  // atCut is where a split would land (the detected gap, else the playhead
  // at the time of the offer); certain=true only with gap evidence.
  const [splitNudge, setSplitNudge] = useState<{
    pointId: string;
    atCut: number;
    certain: boolean;
  } | null>(null);
  // Analysis panel (score mode): the point whose detail is being recorded,
  // and the shared "Saved" line its questions report through.
  const [analysisPoint, setAnalysisPoint] = useState<Point | null>(null);
  /**
   * The point whose reason is being asked, in the fast overlay. Distinct
   * from analysisPoint: this one asks a SINGLE question and leaves on the
   * answer, where the panel is the unhurried door with notes and tags.
   */
  const [whyPoint, setWhyPoint] = useState<Point | null>(null);
  const padFlash = useSaveFlash();
  const [controlsNonce, setControlsNonce] = useState(0);
  const showControls = useCallback(() => {
    setControlsVisible(true);
    setControlsNonce((n) => n + 1);
  }, []);
  const showControlsRef = useRef(showControls);
  showControlsRef.current = showControls;

  // Score-mode session state.
  const [phase, setPhase] = useState<Phase>("play");
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  // Modify modal: the point it was opened for (null = closed), and an
  // in-flight guard for the split/join orchestration round-trips.
  const [modifyPoint, setModifyPoint] = useState<Point | null>(null);
  const [modifyBusy, setModifyBusy] = useState(false);
  // The nudge's suggested cut, handed to the Modify sheet as its seeded
  // split marker. Null when Modify opens from its own pad button.
  const [modifyInitialCut, setModifyInitialCut] = useState<number | null>(
    null
  );
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
  // Auto-dismiss timer for the boundary overlay, held in a ref so it
  // survives effect re-runs. (The setting effect depends on runningScore,
  // whose identity changes on every playhead move; a per-effect cleanup
  // would cancel this timer as the video plays on past the boundary and
  // leave the overlay stuck with no way to clear it.)
  const boundaryTimer = useRef<number | null>(null);
  // Transient "a game probably just ended" nudge: after an answered point
  // while a 'continue' override holds the game open past the auto
  // condition. It used to be a pill floated over the footage; now it
  // briefly lights the pad's Game-ended control and retargets it at that
  // exact point. Non-blocking either way.
  const [endedPill, setEndedPill] = useState<{ pointId: string } | null>(
    null
  );
  const endedPillTimer = useRef<number | null>(null);
  // "Who won this game?" — asked right after the owner pins an end at a
  // score the 11-clear-by-2 rule can't decide (points lost to a cut). The
  // answer lands on the closing point (game_winner_override, 099);
  // skipping leaves the game counted for nobody, exactly as before.
  const [winnerAsk, setWinnerAsk] = useState<{
    pointId: string;
    you: number;
    them: number;
  } | null>(null);
  /**
   * A point the user just ended ON PURPOSE.
   *
   * "Game didn't end" exists to correct the AUTO rule when it fires
   * somewhere the video says the game kept going. Offering it on a point
   * you explicitly ended a moment ago is the app arguing with an
   * instruction it just took — so that one boundary skips the overlay and
   * lets the score flash do the confirming instead. Every later point still
   * gets the escape hatch.
   */
  const explicitEndRef = useRef<string | null>(null);
  const [reviewIds, setReviewIds] = useState<string[]>([]);
  const [reviewIdx, setReviewIdx] = useState(0);

  // Gesture feedback.
  const [flash, setFlash] = useState<{ label: string; key: number } | null>(
    null
  );
  const flashTimer = useRef<number | null>(null);
  // The rate a press-and-hold is currently applying, or null.
  const [holdRate, setHoldRate] = useState<number | null>(null);
  // First-time gesture hints (gestureHints.ts): one per viewer open,
  // shown at most twice ever, dead forever on first real use.
  const [hint, setHint] = useState<"dtap" | "hold" | null>(null);
  const [scoreHint, setScoreHint] = useState(false);
  const hintTimer = useRef<number | null>(null);

  // Closing the takeover clears any live hint (a new open re-arms).
  useEffect(() => {
    if (open) return;
    setHint(null);
    setScoreHint(false);
    if (hintTimer.current) {
      window.clearTimeout(hintTimer.current);
      hintTimer.current = null;
    }
  }, [open]);
  const holdRateRef = useRef<number | null>(null);
  holdRateRef.current = holdRate;

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

  /** The untransformed video box, for zoom math that must not read the
   *  scaled element's own rect. */
  const zoomSurfaceRef = useRef<HTMLDivElement | null>(null);

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

  /**
   * Step the zoom from a button, keeping the middle of the frame pinned —
   * the same state and clamps the pinch uses, just reachable. There is no
   * table geometry on the client (the corners live in the pipeline's
   * match.json), so the centre is the anchor: a well-framed recording has
   * the table there, and a finger drag corrects anything else.
   */
  const zoomBy = useCallback(
    (factor: number) => {
      const rect = zoomSurfaceRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      const z = zoomRef.current;
      const next = Math.min(ZOOM_MAX, Math.max(1, z.s * factor));
      if (Math.abs(next - z.s) < 0.001) return;
      const k = next / z.s;
      applyZoom(
        next,
        rect.width / 2 - k * (rect.width / 2 - z.x),
        rect.height / 2 - k * (rect.height / 2 - z.y),
        rect
      );
    },
    [applyZoom]
  );

  /** Back to the whole frame. No button of its own — the takeover's exit
   *  and the pad's close call it so a zoom never survives a session. */
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
  // The point-number strip above the transport auto-follows the current
  // point, keeping it centered (or as close as the ends allow).
  const chipStripRef = useRef<HTMLDivElement | null>(null);

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
   * Spans of rallies marked Skipped (a let, or anything the reviewer
   * decided doesn't count), in cut-video seconds.
   *
   * Deleted footage is dead everywhere. A skipped rally is different: it
   * happened, it is still in the timeline, and in score mode you must be
   * able to land on it and change your mind. But watching the match back,
   * a let is exactly the thing you do not need to sit through — so watch
   * mode plays past them and score mode does not.
   */
  const letSpans = useMemo(() => {
    const out: { start: number; end: number }[] = [];
    for (const p of points) {
      if (!p.is_let || p.cut_t0 === null) continue;
      const end = paddedEnd(p, pad);
      if (end === null) continue;
      out.push({ start: Number(p.cut_t0), end });
    }
    return out.sort((a, b) => a.start - b.start);
  }, [points, pad]);
  const letSpansRef = useRef(letSpans);
  letSpansRef.current = letSpans;
  /** Previous watch-mode tick, so we only skip a let we ran INTO. Nulled
   *  on any pause/seek: landing inside a let on purpose stays put. */
  const watchTickRef = useRef<number | null>(null);

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

  /**
   * Each point's span in CUT time — its padded start through its padded
   * end, clamped to the next point's start the way the skip spans are, so
   * a clip whose pad overhangs its neighbour doesn't read as longer than
   * it plays. The strip's countdown ring divides the playhead by this.
   */
  const chipSpans = useMemo(() => {
    const m = new Map<string, { start: number; end: number }>();
    const cut = points.filter((p) => p.cut_t0 !== null);
    const starts = cut
      .map((p) => Number(p.cut_t0))
      .sort((a, b) => a - b);
    for (const p of cut) {
      const start = Number(p.cut_t0);
      let end = paddedEnd(p, pad) ?? start;
      const next = starts.find((s) => s > start + 0.01);
      if (next !== undefined && end > next) end = next;
      if (end > start) m.set(p.id, { start, end });
    }
    return m;
  }, [points, pad]);

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
      // Skipped-rally auto-skip, WATCH mode only (see letSpans): playing
      // INTO a let jumps past it, so a watch-through is the match without
      // the rallies that didn't count. Landing inside one deliberately —
      // the point picker, a scrub, a chevron — leaves it alone, because
      // the previous tick is null after any seek and only a crossing
      // qualifies.
      if (modeRef.current === "watch" && !scrubbing.current && !v.paused) {
        const t = v.currentTime;
        const prev = watchTickRef.current;
        watchTickRef.current = t;
        if (prev !== null && t > prev) {
          for (const s of letSpansRef.current) {
            if (t < s.start) break;
            if (prev < s.start && t < s.end - 0.05) {
              v.currentTime = s.end;
              setPlayheadT(s.end);
              watchTickRef.current = s.end;
              return;
            }
          }
        }
      } else {
        watchTickRef.current = null;
      }
      setPlayheadT(v.currentTime);
      // Pause-at-point-end: every rally stops the video ONCE, at its own
      // boundary (stopAt below) — cut_t0 is the PADDED start, see
      // playhead.ts. An UNSCORED rally stops at pauseEnd, rally end plus a
      // beat of post pad, so the landing and the players' reaction are on
      // screen while you answer. An already-answered one stops at
      // paddedEnd, the full clip extent: past it lies ball retrieval and
      // walk-backs the point view will never show, and playing them made
      // one point look like two different points depending on where you
      // watched it.
      //
      // Crossing = the boundary lies inside this playback step ((prev, t],
      // ~250ms ticks) checked against every visible rally, not just the
      // WYSIWYG one. That is the whole reason this is a crossing test and
      // not "the current point's end has passed": when the gap between
      // rallies is short the next rally's padded span starts BEFORE the
      // finished rally's boundary, so the resolver already says "next"
      // while the stop still belongs to the rally that just ended.
      // endPausedId pins it — chip ring, ticker score, taps and Replay all
      // follow the pin, and they must never disagree with each other.
      //
      // Seeks and pauses null lastTickRef, so jumps and scrubs never read
      // as crossings. NEVER-FREEZE rules: a consumed boundary re-arms only
      // >= REARM_BACK_S before it (deliberate replay) or when a different
      // rally's boundary is crossed, and no pause fires within
      // PLAY_GUARD_MS of a play() start — so resuming from paused-at-end
      // always makes real progress.
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
        // Where this rally stops the video: unanswered → the answer beat,
        // answered → the end of its clip.
        const stopAt = (p: Point) =>
          isUnscored(p) ? pauseEnd(p, cpad) : paddedEnd(p, cpad);
        // Playing out an answered clip's tail: when it runs out, move on
        // exactly as the answer would have. Any other departure from the
        // clip (chevron, chip, scrub) retires the tail instead.
        const tail = playTailRef.current;
        if (tail) {
          if (t >= tail.end) {
            playTailRef.current = null;
            const tp = ps.find((x) => x.id === tail.id);
            if (tp) {
              advanceRef.current(tp);
              return;
            }
          } else if (playingPointId(ps, t) !== tail.id && t < tail.end - 0.5) {
            playTailRef.current = null;
          }
        }
        if (endPauseFiredRef.current !== null) {
          const fp = ps.find((pt) => pt.id === endPauseFiredRef.current);
          const fend = fp ? stopAt(fp) : null;
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
            const end = stopAt(p);
            if (end === null || end <= prev || end > t) continue;
            if (p.id !== endPauseFiredRef.current) {
              // Crossing a DIFFERENT rally's boundary retires the
              // consumed one — its end can pause again on a later replay.
              endPauseFiredRef.current = null;
            }
            // Only stop for a rally whose deciding shot this playback run
            // actually covered: the run must have started before the
            // rally's END (the deciding shot itself, whichever boundary
            // this rally uses) AND not inside a LATER rally's span (the
            // positional start check — see startCut above). A replay or
            // resume that starts at the next rally's padded start never
            // gets hijacked by the previous rally's overhanging boundary.
            const rEnd = rallyEnd(p, cpad) ?? end;
            const watched =
              runStart !== null &&
              runStart < rEnd - 0.05 &&
              (startCut === null ||
                p.cut_t0 === null ||
                startCut <= Number(p.cut_t0));
            if (endPauseFiredRef.current !== p.id && watched && !guarded) {
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

  // Measure the letterbox: the gap under the picture and the gap beside it,
  // in element pixels. Re-measured on resize (rotation included) and when
  // the video's own dimensions arrive.
  useEffect(() => {
    const v = videoRef.current;
    if (!open || !v) return;
    const measure = () => {
      const cw = v.clientWidth;
      const ch = v.clientHeight;
      const vw = v.videoWidth;
      const vh = v.videoHeight;
      if (!cw || !ch || !vw || !vh) return setFrame(null);
      const scale = Math.min(cw / vw, ch / vh);
      setFrame({
        bottomGap: (ch - vh * scale) / 2,
        left: (cw - vw * scale) / 2,
        // The picture's own height, which is what the score bug sizes
        // itself against — the reel burns its table at a fraction of the
        // frame, so the app has to scale with the picture to match.
        height: vh * scale,
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(v);
    v.addEventListener("loadedmetadata", measure);
    return () => {
      ro.disconnect();
      v.removeEventListener("loadedmetadata", measure);
    };
  }, [open, videoUrl, mode]);

  const onProgress = useCallback((v: HTMLVideoElement) => {
    const b = v.buffered;
    const ranges: { s: number; e: number }[] = [];
    for (let i = 0; i < b.length; i++) ranges.push({ s: b.start(i), e: b.end(i) });
    setBuffered(ranges);
  }, []);

  // ------------------------------------------------------- playhead points

  const armedId = useMemo(
    () => armedPointId(points, playheadT, pad),
    [points, playheadT, pad]
  );
  const armedPoint = armedId
    ? (points.find((p) => p.id === armedId) ?? null)
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
      : (endPausedPoint ??
        targetAt(
          points,
          playheadT,
          pad,
          mode === "score" && phase === "play",
          runStartTRef.current,
          endPauseFiredRef.current
        ) ??
        armedPoint);
  // THE point the screen is about: what a winner/skip tap scores, what the
  // ticker score is as of, and what the strip rings. It must be one id, not
  // two — the strip used to ring the raw WYSIWYG point, so whenever the
  // pause landed inside the next rally's padded span (a short gap between
  // rallies, which the full post pad now reaches past more often) the ring
  // sat on the NEXT number while every button still answered the point you
  // had just watched.
  const targetId = displayTarget?.id ?? null;

  // Keep the current point centered in the chip strip as playback advances
  // (or as close to center as the ends allow). Manual scroll math off
  // getBoundingClientRect. Deferred a beat so it also lands correctly on
  // open, AFTER the fullscreen + video layout has settled (a single frame
  // is too early — the strip still measures 0-width mid-mount). Re-runs when
  // the score pad opens (mode) or the point changes; the clientWidth guard
  // skips any pre-layout pass. The lag is imperceptible during playback.
  useEffect(() => {
    if (mode !== "score" || !targetId) return;
    const t = window.setTimeout(() => {
      const strip = chipStripRef.current;
      const active = strip?.querySelector<HTMLElement>(
        `[data-chip-id="${targetId}"]`
      );
      if (!strip || !active || strip.clientWidth === 0) return;
      const stripRect = strip.getBoundingClientRect();
      const activeRect = active.getBoundingClientRect();
      const delta =
        activeRect.left -
        stripRect.left -
        (strip.clientWidth / 2 - active.clientWidth / 2);
      // Instant, not smooth: the video's continuous repaint interrupts a
      // smooth scroll here and it never lands. The jump is small per point.
      strip.scrollTo({ left: strip.scrollLeft + delta });
    }, 120);
    return () => window.clearTimeout(t);
  }, [targetId, mode]);

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

  // The newest note on the rally the playhead is in, for the watch overlay,
  // plus how many others it is standing in front of. Recomputes as the
  // playhead crosses into each point, so the overlay follows the video.
  const watchNote = useMemo(() => {
    const id = displayTarget?.id;
    if (!id) return null;
    const mine = notes.filter((n) => n.point_id === id);
    const note = mine[mine.length - 1];
    if (!note) return null;
    const author =
      note.author_id === userId
        ? "You"
        : (authorNames.get(note.author_id) ?? "").trim() ||
          (note.author_id === ownerId ? "Player" : "Coach");
    return { note, author, more: mine.length - 1 };
  }, [notes, displayTarget, userId, ownerId, authorNames]);

  // The same walk stopping one point EARLIER: the score going INTO the rally
  // on screen. That is what the watch-mode bug shows, and what the exported
  // reel burns in — a scoreboard that has already counted the point you are
  // watching tells you how it ends before you see it.
  const enteringScore = useMemo(() => {
    const idx = displayTarget ? (indexById.get(displayTarget.id) ?? -1) : -1;
    return computeMatchScore(points.slice(0, Math.max(0, idx)));
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
    return targetAt(
      ps,
      t,
      padRef.current,
      modeRef.current === "score" && phase === "play",
      runStartTRef.current,
      endPauseFiredRef.current
    );
  }, [phase, reviewIds, reviewIdx, playheadT]);

  // Serve ball: the server of the rally the surface is ABOUT — targetId,
  // the same pin-first, hold-aware answer the chip ring, ticker score and
  // taps use. It used to read the raw WYSIWYG resolver instead, which
  // flips at the next rally's padded start — on close-together cuts that
  // start comes BEFORE the previous rally's pause boundary, so the serve
  // light jumped to the next server mid-rally, the auto-pause then pinned
  // back to the rally that just ended, and the light snapped back: a
  // visible serve-rotation stutter on every tight gap.
  const currentRallyId =
    targetId ?? points.find((p) => p.cut_t0 !== null)?.id ?? null;
  const server = currentRallyId
    ? (serving.get(currentRallyId)?.server ?? null)
    : null;

  // Flank chevron availability: hidden on the first-point side (nothing
  // before) and the last-point side (nothing after).
  const cutPoints = useMemo(
    () => points.filter((p) => p.cut_t0 !== null),
    [points]
  );
  // Same base doubleTapSeek steps from (pinned rally first), so the
  // chevrons are hidden on exactly the sides they cannot move toward.
  const playingCutIdx = targetId
    ? cutPoints.findIndex((p) => p.id === targetId)
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
    // The component never unmounts, so a zoom left on would still be there
    // the next time the takeover opens. Closing is the reset.
    resetZoom();
    window.history.back();
  }, [resetZoom]);

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
      // Discovery: the double-tap hint first; hold-for-speed on a later
      // open, once double-tap is learned or spent. One hint per open.
      const name = hintEligible("dtap")
        ? ("dtap" as const)
        : hintEligible("hold")
          ? ("hold" as const)
          : null;
      if (name) {
        markHintShown(name);
        setHint(name);
        if (hintTimer.current) window.clearTimeout(hintTimer.current);
        hintTimer.current = window.setTimeout(() => setHint(null), 7000);
      }
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

  const openScore = useCallback((atPointId?: string) => {
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
    //
    // Unless the caller named a point. Coming back from that point's
    // detail view, "where scoring stopped" is the wrong answer — you were
    // looking at THIS rally a second ago, and being dropped somewhere else
    // is the thing that makes leaving the detail view feel like losing
    // your place.
    const ps = pointsRef.current;
    const requested = atPointId
      ? (ps.find((p) => p.id === atPointId) ?? null)
      : null;
    const first = requested ?? ps.find(isUnscored) ?? null;
    const i = first ? ps.indexOf(first) : -1;
    resumeToastRef.current = null;
    const v = videoRef.current;
    const cur = v && v.readyState >= 1 ? v.currentTime : playheadT;
    const base = first && first.cut_t0 !== null ? Number(first.cut_t0) : cur;
    const startT = snapLanding(base, true);
    if (startT !== cur) seekTo(startT);
    // No "Resuming from…" when the caller named the point: you asked to be
    // put back exactly here, so being told where you are is noise.
    if (!requested && first && i > 0) {
      resumeToastRef.current = `Resuming from point ${i + 1}`;
    }
    openTakeover("score");
    // First-time keep score: the first auto-pause carries one line of
    // teaching ("Tap who won this point"), dead on the first answer.
    if (hintEligible("score")) {
      markHintShown("score");
      setScoreHint(true);
    }
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
  // The tap handler is defined before these and holds a stale closure
  // otherwise; the gesture layer is built once and lives for the session.
  const togglePauseRef = useRef(togglePause);
  togglePauseRef.current = togglePause;

  const setSpeed = useCallback(
    (rate: number) => {
      const i = SPEEDS.indexOf(rate as (typeof SPEEDS)[number]);
      if (i < 0) return;
      setSpeedIdx(i);
      const v = videoRef.current;
      if (v) v.playbackRate = rate;
      showControls();
    },
    [showControls]
  );

  // Auto-hide the chrome ~2.5s into uninterrupted playback. Never while the
  // speed menu is open — it hangs off a control inside the chrome.
  useEffect(() => {
    if (!open || !controlsVisible || paused || speedMenuOpen) return;
    const id = window.setTimeout(() => setControlsVisible(false), 2500);
    return () => window.clearTimeout(id);
  }, [open, controlsVisible, paused, controlsNonce, speedMenuOpen]);

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

  /** Leave the player and open a point's detail view. */
  const openPointById = useCallback(
    (id: string) => {
      dismissPill();
      // Open only once Back has landed on the match page's history entry,
      // so the ?p= sync sticks to it.
      const openIt = onOpenPoint;
      window.addEventListener(
        "popstate",
        () => window.setTimeout(() => openIt(id), 0),
        { once: true }
      );
      exit();
    },
    [dismissPill, onOpenPoint, exit]
  );

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

  /** 700ms suits the running commentary ("Point 12", "Skipped"). A game
   *  closing is a result, not commentary — it takes a longer beat, which
   *  is what the card across the footage used to buy. */
  const showFlash = useCallback((label: string, ms = 700) => {
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    setFlash({ label, key: Date.now() });
    flashTimer.current = window.setTimeout(() => setFlash(null), ms);
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
      // Direction in the label: the flash is what teaches the gesture.
      showFlash(
        `${forward ? "Next" : "Back"} · point ${
          (indexById.get(target.id) ?? 0) + 1
        }`
      );
      markHintDone("dtap");
      setHint((h) => (h === "dtap" ? null : h));
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
      setHoldRate(null);
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
      if (ptrs.size === 2) {
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
      // Press-and-hold ~250ms changes the rate while held, and WHICH rate
      // is which half you are holding: left slows to 0.25x, right runs at
      // 2x. Same side split as the double-tap seek (left = back, right =
      // forward), so one mental model covers both gestures: the left of
      // the frame is "let me see that", the right is "get on with it".
      const held = g.downX < g.width / 2 ? HOLD_SLOW : HOLD_FAST;
      g.holdTimer = window.setTimeout(() => {
        g.holdTimer = null;
        g.holding = true;
        const v = videoRef.current;
        g.priorRate = v ? v.playbackRate : SPEEDS[speedIdx];
        if (v) v.playbackRate = held;
        setHoldRate(held);
        markHintDone("hold");
        setHint((h) => (h === "hold" ? null : h));
      }, HOLD_MS);
    },
    [speedIdx, endHold]
  );

  const onVideoPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const ptrs = activePtrs.current;
      if (!ptrs.has(e.pointerId)) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
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
      // Single tap (after the double-tap window): the whole frame is the
      // play/pause control, in BOTH modes. Watching footage is a two-state
      // job — running or stopped — and reaching for a target in the middle
      // of the picture to stop it is a step nobody needs. The chrome comes
      // up with the pause and hides itself again on play, so it is never
      // something you have to toggle by hand. Score mode used to reserve
      // the tap for showing/hiding the chrome, with a big centre play
      // glyph as the resume control — two different pause vocabularies in
      // one player, and the glyph was a control the watch side had already
      // proven nobody needs.
      g.singleTimer = window.setTimeout(() => {
        g.singleTimer = null;
        togglePauseRef.current();
        showControlsRef.current();
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
  /** Straight to the next rally, skipping whatever is left of this clip. */
  const jumpAfter = useCallback(
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
      playTailRef.current = null;
      endPauseFiredRef.current = null; // destination's boundary re-arms
      seekTo(Number(next.cut_t0)); // zoom persists across the advance
      playNow();
      return true;
    },
    [seekTo, playNow]
  );

  const advanceFrom = useCallback(
    (p: Point) => {
      // Answered early, with real footage still to run: finish this clip
      // instead of jumping over frames nobody has looked at. If a second
      // rally is in there you now watch it happen; if it is just the post
      // pad, playTailRef lands you on the next point a second later, which
      // is what the jump would have done anyway.
      const v = videoRef.current;
      const now = v && v.readyState >= 1 ? v.currentTime : playheadT;
      const own = paddedEnd(p, padRef.current);
      if (own !== null && own - now > TAIL_WATCH_S) {
        playTailRef.current = { id: p.id, end: own };
        endPauseFiredRef.current = p.id; // its own end must not stop us here
        playNow();
        return true;
      }
      return jumpAfter(p);
    },
    [jumpAfter, playNow, playheadT]
  );
  // onTime needs to advance when a tail finishes, and it is defined first.
  const advanceRef = useRef(advanceFrom);
  advanceRef.current = advanceFrom;

  /**
   * The rally the surface is currently ABOUT: the pinned one while paused at
   * an end (the resolver may already have flipped to the next rally), else
   * whichever one the playhead is inside. The same answer the chip, the taps
   * and the chevrons use — anything acting on "this point" starts here.
   */
  const currentPoint = useCallback((): Point | null => {
    const ps = pointsRef.current;
    if (endPausedRef.current) {
      const pinned = ps.find((p) => p.id === endPausedRef.current);
      if (pinned) return pinned;
    }
    const v = videoRef.current;
    const t = v && v.readyState >= 1 ? v.currentTime : playheadT;
    const id = playingPointId(ps, t);
    return id ? (ps.find((p) => p.id === id) ?? null) : null;
  }, [playheadT]);

  /**
   * Replay the rally on screen: seek back to its padded start (cut_t0) and
   * play it again. Explicitly re-arms the boundary — a short rally can be
   * closer to its end than REARM_BACK_S, and the replay MUST stop at the
   * (corrected) end again.
   *
   * Drives the paused-at-end "Replay" pill in score mode and the replay
   * control in the watch chrome, which are the same action.
   */
  const replayRally = useCallback(() => {
    const p = currentPoint();
    if (!p || p.cut_t0 === null) return;
    endPauseFiredRef.current = null; // re-arm: stop at this end again
    seekTo(Number(p.cut_t0)); // zoom persists across the replay
    playNow();
  }, [currentPoint, seekTo, playNow]);

  /** Watch mode: pause and open the note sheet on the rally on screen. */
  const openNoteSheet = useCallback(() => {
    const p = currentPoint();
    if (!p) return;
    videoRef.current?.pause();
    setNoteSheet(p);
  }, [currentPoint]);

  /** Drop the pending annotated image (note closed without saving). The
   *  uploaded file stays in R2 — harmless, and the note may still come. */
  const clearPendingImage = useCallback(() => {
    setPendingImage((cur) => {
      if (cur) URL.revokeObjectURL(cur.preview);
      return null;
    });
  }, []);

  /**
   * Capture the paused frame from the ON-SCREEN video element. WebKit
   * (every iPhone browser) black-frames or stalls drawImage from hidden,
   * never-presented videos (bugs.webkit.org 237424 and friends), so the
   * visible element — provably painting the frame — is the only reliable
   * source. Null when the pixels are unreadable: CORS fallback active,
   * or a privacy shield blocking canvas readback.
   */
  const captureFrame = useCallback((): HTMLCanvasElement | null => {
    const v = videoRef.current;
    if (!v || v.videoWidth === 0) return null;
    try {
      const scale = Math.min(1, 1280 / v.videoWidth);
      const c = document.createElement("canvas");
      c.width = Math.round(v.videoWidth * scale);
      c.height = Math.round(v.videoHeight * scale);
      const ctx = c.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(v, 0, 0, c.width, c.height);
      // Taint probe: throw here, not at save time.
      ctx.getImageData(0, 0, 1, 1);
      return c;
    } catch {
      return null;
    }
  }, []);

  /**
   * THE ANSWER IS THE EXIT. One chip saves the reason, closes the overlay
   * and moves to the next point — no confirm, no dismiss, no clock. That
   * single rule is what makes the pass fast, so nothing in here bends it.
   *
   * Single-select on purpose: with the tap doubling as the exit there is
   * only room for one reason, and being made to name the PRIMARY cause
   * sharpens the chart more than a soup of co-selected chips would. The
   * panel behind "More details" is where a point can carry several.
   */
  const answerWhy = useCallback(
    async (value: string) => {
      const p = whyPoint;
      if (!p) return;
      setWhyPoint(null);
      setWhyCustomOpen(false);
      setWhyCustom("");
      onPointUpdate(p.id, { loss_reasons: [value] });
      advanceRef.current(p);
      const { error } = await createClient()
        .from("points")
        .update({ loss_reasons: [value] })
        .eq("id", p.id);
      // The advance already happened, so a failed write cannot block the
      // pass — roll the optimistic value back and say so instead.
      if (error) {
        onPointUpdate(p.id, { loss_reasons: p.loss_reasons ?? null });
        showFlash("Couldn't save that reason");
      }
    },
    [whyPoint, onPointUpdate, showFlash],
  );

  /** Hand off to the unhurried door: the follow-ups, a note, a tag. The
   *  point is already scored, so the panel opens straight into questions. */
  const whyMoreDetails = useCallback(() => {
    const p = whyPoint;
    if (!p) return;
    setWhyPoint(null);
    advanceAfterSheetRef.current = p.id;
    setAnalysisPoint(p);
  }, [whyPoint]);

  /** Back to the pad without answering — where the score buttons are live
   *  again, so a mis-tapped winner can be corrected. Never advances. */
  const closeWhy = useCallback(() => {
    setWhyPoint(null);
    setWhyCustomOpen(false);
    setWhyCustom("");
  }, []);

  /**
   * Naming your own reason without leaving the fast lane.
   *
   * It breaks the one-tap rule on purpose — typing cannot be one tap — but
   * it lands in the same place: the pill is created, applied, and the
   * overlay exits to the next point exactly as a built-in chip would. The
   * alternative was sending people through More details for a word they
   * already had in their head, which is the long way round for the reason
   * they most wanted to record.
   */
  const [whyCustomOpen, setWhyCustomOpen] = useState(false);
  const [whyCustom, setWhyCustom] = useState("");

  const submitWhyCustom = useCallback(async () => {
    const label = whyCustom.trim();
    const p = whyPoint;
    if (!label || !p || !onCreateCustomReason) return;

    // ADVANCE FIRST, before any await. Creating the pill is a round trip,
    // and awaiting it here would take play() out of the tap's call stack —
    // which iOS refuses, leaving the next point sitting paused after a
    // custom reason but playing after every built-in one. The write follows
    // optimistically, the same way answerWhy already handles a chip.
    setWhyPoint(null);
    setWhyCustomOpen(false);
    setWhyCustom("");
    advanceRef.current(p);

    const id = await onCreateCustomReason(label);
    if (!id) {
      showFlash("Couldn't save that reason");
      return;
    }
    const value = customReasonValue(id);
    onPointUpdate(p.id, { loss_reasons: [value] });
    const { error } = await createClient()
      .from("points")
      .update({ loss_reasons: [value] })
      .eq("id", p.id);
    if (error) {
      onPointUpdate(p.id, { loss_reasons: p.loss_reasons ?? null });
      showFlash("Couldn't save that reason");
    }
  }, [whyCustom, whyPoint, onCreateCustomReason, onPointUpdate, showFlash]);

  /**
   * Score mode: pause and slide the analysis panel in over the pad.
   *
   * Prefers the point JUST SCORED over the one under the playhead. Scoring
   * advances and plays, so within a few seconds of a tap the playhead is
   * already on the next rally — which is why a note written right after
   * scoring used to attach to the following point. Both resolveTargetPoint
   * and currentPoint read the playhead, so neither can tell the difference;
   * only the tap knows.
   *
   * The window is what keeps it honest. Opening this seconds after scoring
   * means "about the one I just did"; opening it after scrubbing somewhere
   * deliberately means "about what I'm looking at", and by then the window
   * has closed. The bubble on the score buttons needs none of this — it
   * passes its point directly.
   */
  const openAnalysisPanel = useCallback(() => {
    const recent = lastScoredRef.current;
    const justScored =
      recent && Date.now() - recent.at < SCORED_NOTE_WINDOW_MS
        ? (pointsRef.current.find((pt) => pt.id === recent.id) ?? null)
        : null;
    const p = justScored ?? currentPoint();
    if (!p) return;
    videoRef.current?.pause();
    setAnalysisPoint(p);
  }, [currentPoint]);

  /**
   * Closing the sheet resumes whatever the note interrupted, so a note
   * costs a note and not the rhythm of the pass.
   */
  const closeAnalysisPanel = useCallback(() => {
    const resumeId = advanceAfterSheetRef.current;
    advanceAfterSheetRef.current = null;
    setAnalysisPoint(null);
    if (!resumeId) return;
    const p = pointsRef.current.find((pt) => pt.id === resumeId);
    if (p) advanceRef.current(p);
  }, []);


  /**
   * Horizontal drag on the pad: left pulls the analysis panel in, right
   * pushes it back out. The panel arrives from the right, so the gesture
   * moves the same way the panel does.
   *
   * The pad is wall-to-wall tap targets (Me / Them / Skip / Delete), so a
   * drag that turns into a swipe has to swallow the click it would
   * otherwise finish with — `fired` stays set until onClickCapture eats
   * the click, which is the difference between opening the panel and
   * opening the panel AND scoring the point.
   */
  const padSwipe = useRef({ x: 0, y: 0, active: false, fired: false });
  const padSwipeHandlers = (dir: "open" | "close") => ({
    onPointerDown: (e: React.PointerEvent) => {
      padSwipe.current = {
        x: e.clientX,
        y: e.clientY,
        active: true,
        fired: false,
      };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const g = padSwipe.current;
      if (!g.active || g.fired) return;
      const dx = e.clientX - g.x;
      const dy = e.clientY - g.y;
      if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      g.active = false;
      // Opening is directional (the panel comes from the right, so you pull
      // it in leftwards). CLOSING takes either direction: there is nothing
      // to the panel's right, so a swipe that way can only mean "put this
      // back", and half the time that is the swipe people try.
      if (dir === "close" || dx < 0) {
        g.fired = true;
        if (dir === "open") openAnalysisPanel();
        else closeAnalysisPanel();
      }
    },
    onPointerUp: () => {
      padSwipe.current.active = false;
    },
    onPointerCancel: () => {
      padSwipe.current.active = false;
    },
    onClickCapture: (e: React.MouseEvent) => {
      if (!padSwipe.current.fired) return;
      padSwipe.current.fired = false;
      e.preventDefault();
      e.stopPropagation();
    },
  });

  /**
   * Offer the split on a clip that was answered with a rally's worth of
   * footage still to run — the shape of a clip the cutter fused.
   *
   * The trigger is REMAINING SECONDS, not a fraction of the clip: what
   * decides whether a second rally can be hiding is how much unwatched
   * footage is left, and a percentage would nudge on every quick answer to
   * a short point while missing a late answer on a long one.
   *
   * The bounce data sharpens it where it exists (an actual quiet stretch
   * places the cut and firms up the wording) but is never required — the
   * offer stands on the timing alone, worded as a question.
   */
  const offerSplitIfEarly = useCallback((p: Point) => {
    // One offer at a time, and answering anything retires the last one: the
    // tail it belonged to has been watched by then, and a stale offer that
    // outlives its clip is how you split the wrong point.
    setSplitNudge(null);
    if (!onSplit || p.cut_t0 === null || p.t0 === null || p.t1 === null) return;
    const v = videoRef.current;
    const now = v && v.readyState >= 1 ? v.currentTime : 0;
    const own = paddedEnd(p, padRef.current);
    if (own === null || own - now <= TAIL_WATCH_S) return;
    const gap = fusedSplitCut(p, padRef.current);
    // Without gap evidence, cut a beat before where they answered — the tap
    // always lands after the deciding shot (same lead the pad's Split uses).
    const atCut = gap ?? Math.max(Number(p.cut_t0) + 0.4, now - SPLIT_LEAD_S);
    setSplitNudge({ pointId: p.id, atCut, certain: gap !== null });
  }, [onSplit]);

  /** Light the pad's Game-ended control for a just-answered point (only
   *  offered while a 'continue' override holds the game open). A glow on
   *  a standing control gets a little longer than the old over-video pill
   *  did — it is quieter, so it needs the extra beat to be noticed. */
  const showEndedPill = useCallback((pointId: string) => {
    if (endedPillTimer.current) window.clearTimeout(endedPillTimer.current);
    setEndedPill({ pointId });
    endedPillTimer.current = window.setTimeout(() => {
      endedPillTimer.current = null;
      setEndedPill(null);
    }, 4000);
  }, []);

  /**
   * Set when a score-and-note tap holds the advance back: closing the sheet
   * resumes it, so writing a note costs the note and nothing else.
   */
  const advanceAfterSheetRef = useRef<string | null>(null);

  /** The last point scored from the pad, for the note-target rule above. */
  const lastScoredRef = useRef<{ id: string; at: number } | null>(null);

  /**
   * Whether the Why pill has a question behind it.
   *
   * The loss reasons are strictly first-person, so a neutral match (the
   * owner named their own side as somebody who is not them) has no "you" to
   * ask about, and the pill would open an overlay that cannot mean
   * anything. Better absent than empty.
   */
  const whyAvailable = !neutral;

  /** Whether the OWNER served the point being asked about — the rotation is
   *  the authority, and it decides which mirror chip is offered. */
  const whyServed = useMemo(() => {
    if (!whyPoint) return null;
    const server = serving.get(whyPoint.id)?.server;
    return server == null ? null : server === "user";
  }, [whyPoint, serving]);

  const whyOptions = useMemo(
    () => lossReasonsFor(whyServed, customReasons),
    [whyServed, customReasons],
  );

  const whyServerLine = useMemo(
    () =>
      serverContextLine(
        whyServed,
        { you: mapLabels.you, them: mapLabels.them },
        neutral,
      ),
    [whyServed, mapLabels.you, mapLabels.them, neutral],
  );

  /**
   * Admin serve-start label (089). Stamps the cut-video playhead onto the
   * rally the surface is about — the same resolveTargetPoint the score tap
   * uses, so the label and the chip can never disagree about which point
   * is being talked about.
   *
   * A second tap RE-STAMPS rather than toggling off. The common correction
   * is "I tapped late", and the fix for that is to scrub back and tap
   * again; clearing is the rare case and gets its own control.
   *
   * Allowed while paused on purpose: pausing on the toss is the accurate
   * way to mark it, and meta.paused is what lets the offline analysis tell
   * a deliberate frame-accurate mark from a live one carrying reaction
   * time. Without that flag every label has to be treated as the looser.
   */
  const markServeStart = useCallback(
    (src: "key" | "button") => {
      if (!canLabelServeStart || !onSetServeStart) return;
      const p = resolveTargetPoint();
      if (!p) return;
      const v = videoRef.current;
      if (!v || v.readyState < 1) return;
      onSetServeStart(p, Math.round(v.currentTime * 100) / 100, {
        paused: v.paused,
        rate: v.playbackRate,
        src,
      });
    },
    [canLabelServeStart, onSetServeStart, resolveTargetPoint]
  );

  const clearServeStart = useCallback(() => {
    if (!canLabelServeStart || !onSetServeStart) return;
    const p = resolveTargetPoint();
    if (p) onSetServeStart(p, null, null);
  }, [canLabelServeStart, onSetServeStart, resolveTargetPoint]);

  const tapSide = useCallback(
    (side: "user" | "opponent", opts?: { thenWhy?: boolean }) => {
      const p = resolveTargetPoint();
      if (!p) return;
      lastScoreTapRef.current = Date.now();
      markHintDone("score");
      setScoreHint(false);
      // A bubble tap on a point already given to this side changes nothing
      // to undo; pushing an entry anyway would spend the user's next Undo
      // on a no-op.
      const noOp =
        opts?.thenWhy && p.confirmed_winner === side && !p.is_let;
      if (!noOp) {
        setUndoStack((s) => [
          ...s,
          {
            type: "tap",
            pointId: p.id,
            prevWinner: p.confirmed_winner,
            prevSkipped: p.is_let,
          },
        ]);
      }
      const hadOutcome = p.confirmed_winner !== null || p.is_let;
      /**
       * The big button TOGGLES — tapping the winner it already shows clears
       * it, which is how a mis-score is corrected. Why never does: it means
       * "they won it, and here is why I lost", so on a point already given
       * to them it re-affirms and opens the overlay rather than silently
       * un-scoring the point you came to explain. Saying why must never
       * cost you the score.
       */
      const next = opts?.thenWhy
        ? side
        : p.confirmed_winner === side
          ? null
          : side;
      if (next !== p.confirmed_winner || p.is_let) {
        // The training label (067): where the playhead sat when the human
        // called the point. Only the flowing session — in review or on
        // chip corrections the playhead says nothing about the rally end.
        const v = videoRef.current;
        const atCut =
          phase === "play" && next !== null && v && v.readyState >= 1
            ? Math.round(v.currentTime * 100) / 100
            : undefined;
        onSetWinner(p, next, atCut);
      }
      lastScoredRef.current = next === null ? null : { id: p.id, at: Date.now() };
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
      /**
       * SCORE AND SAY WHY, in one tap. The note bubble inside each score
       * button scores its side exactly like the button around it, then
       * holds the advance and opens the sheet ON THIS POINT.
       *
       * Binding the sheet to the tap rather than to the playhead is the
       * whole trick: the advance has already moved the playhead by the
       * time anything else could ask, which is why the tool-row note
       * button used to land on the following rally.
       *
       * A mis-tap costs a dismissal, never a wrong score — the bubble and
       * the button around it score identically, so hitting the wrong one
       * cannot put the point on the wrong player.
       */
      if (opts?.thenWhy && next !== null) {
        videoRef.current?.pause();
        pinEndPause(null);
        // The winner this tap just set, applied locally: `p` was read
        // BEFORE onSetWinner, so handing it over as-is would open on a
        // point the overlay still believes is unscored.
        setWhyPoint({ ...p, confirmed_winner: next, is_let: false });
        return;
      }
      // ADVANCE ON ANY NEW ANSWER: a winner on a rally that had NO
      // outcome yet advances to the next rally and plays — one gesture,
      // whether paused-at-end or mid-rally. CHANGING an existing outcome
      // (toggle-off, switching winner) is a correction: it never
      // advances, the rally just keeps playing (or stays paused where
      // the user put it).
      if (!hadOutcome && next !== null) {
        pinEndPause(null);
        offerSplitIfEarly(p);
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
      offerSplitIfEarly,
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

  // ------------------------------------------------------ Modify modal
  // (The old in-pad scissor "Split at the playhead" is retired — the Modify
  // modal below is the retroactive, all-in-one replacement. The split
  // machinery it drives — split_point + child cut_t0 mapping, unsplit_point
  // undo — is unchanged; see performSplit.)

  // Open the Modify modal for the rally on screen (the pad's Modify button).
  const tapModify = useCallback(() => {
    const p = resolveTargetPoint();
    if (!p) return;
    videoRef.current?.pause();
    setModifyInitialCut(null);
    setModifyPoint(p);
  }, [resolveTargetPoint]);

  const closeModify = useCallback(() => {
    if (modifyBusy) return;
    setModifyPoint(null);
  }, [modifyBusy]);

  /**
   * Modify → Split: cut ONE point into N (2-3) in a single action. The
   * modal supplies N-1 marker times in CUT-video seconds and the N segment
   * outcomes. We map each marker to a SOURCE at_t through the same anchor
   * math as splitHere (the cut keeps source durations intact within the
   * span, so ONE linear map source(T) = anchor + (T - cut_t0) covers the
   * whole original point regardless of the splits we make along the way),
   * call split_point sequentially down the tail, then write each segment's
   * winner/skip. Undo is ONE compound {type:'modify-split'} entry.
   */
  const performSplit = useCallback(
    async (
      target: Point,
      cutTimes: number[],
      segments: ("user" | "opponent" | "skip")[],
      /** Land on the FIRST new segment rather than on the next point: the
       *  early-answer split leaves that segment unanswered, so it is the
       *  whole reason for splitting. The modal scores every segment itself
       *  and lands past them all. */
      landOnChild = false
    ) => {
      if (modifyBusy || !onSplit) return;
      const A = pointsRef.current.find((p) => p.id === target.id) ?? target;
      if (A.cut_t0 === null || A.t0 === null || A.t1 === null) return;
      const cpad = padRef.current;
      const cutT0 = Number(A.cut_t0);
      const origWinner = A.confirmed_winner;
      const origSkipped = A.is_let;
      // The point to advance to once we're done: splitting keeps every
      // child inside A's span, so the next timeline point after A is the
      // right landing (the segments are scored in the modal).
      const orderedAtStart = pointsRef.current;
      const aIdx = orderedAtStart.findIndex((p) => p.id === A.id);
      const nextAfterModify =
        aIdx >= 0 ? (orderedAtStart[aIdx + 1] ?? null) : null;

      setModifyBusy(true);
      videoRef.current?.pause();

      // The marker math and the split_point sequence live in modifyOps.ts,
      // shared with the point view's Modify.
      const { ok, created, unsplits } = await runSplitPlan({
        point: A,
        pad: cpad,
        cutTimes,
        onChild: onSplit,
      });
      if (!ok) {
        setModifyBusy(false);
        if (unsplits.length === 0) {
          showToast("Couldn't place the split. Try again.");
          return;
        }
        // Leave whatever succeeded reversible.
        setUndoStack((s) => [
          ...s,
          {
            type: "modify-split",
            unsplits,
            rootId: A.id,
            rootPrevWinner: origWinner,
            rootPrevSkipped: origSkipped,
            rootCutT0: cutT0,
          },
        ]);
        setModifyPoint(null);
        showToast("Couldn't finish the split. Undo to revert.");
        return;
      }

      // Apply each segment's outcome: [root, ...children] in timeline order.
      const segPoints = [A, ...created];
      for (let i = 0; i < segPoints.length && i < segments.length; i++) {
        const d = segments[i];
        if (d === "skip") onSetSkipped(segPoints[i], true);
        else onSetWinner(segPoints[i], d);
      }

      setUndoStack((s) => [
        ...s,
        {
          type: "modify-split",
          unsplits,
          rootId: A.id,
          rootPrevWinner: origWinner,
          rootPrevSkipped: origSkipped,
          rootCutT0: cutT0,
        },
      ]);
      setModifyBusy(false);
      setModifyPoint(null);
      pinEndPause(null);
      endPauseFiredRef.current = null;
      playTailRef.current = null;
      const landing = landOnChild
        ? (created[0] ?? nextAfterModify)
        : nextAfterModify;
      // Advance to the landing point — for the modal every segment is
      // already scored, so re-landing on this one would make the user watch
      // it again; for the early-answer split the new segment is the one
      // still missing an answer.
      if (landing && landing.cut_t0 !== null) {
        seekTo(Number(landing.cut_t0));
        playNow();
      } else {
        seekTo(cutT0);
      }
      showFlash(landOnChild ? "Split" : `Split into ${segPoints.length}`);
    },
    [
      modifyBusy,
      onSplit,
      onSetWinner,
      onSetSkipped,
      pinEndPause,
      seekTo,
      playNow,
      showFlash,
      showToast,
    ]
  );

  /**
   * Modify → Join: merge this point with the next `count` (1-2) visible
   * points into one. merge_points keeps the survivor (this point), grows its
   * t1 to the last point's t1, clears tight_end, hard-deletes the rest. We
   * then set the merged point's winner. Join is destructive (the rows are
   * gone) — the modal confirms it and it is NOT pushed to the undo stack.
   */
  const performJoin = useCallback(
    async (count: number, winner: "user" | "opponent" | "skip") => {
      if (modifyBusy || !onMerge || !modifyPoint) return;
      const ps = pointsRef.current;
      const i = ps.findIndex((p) => p.id === modifyPoint.id);
      if (i < 0) return;
      const A = ps[i];

      setModifyBusy(true);
      videoRef.current?.pause();
      const plan = await runJoinPlan({ point: A, points: ps, count });
      if (!plan) {
        setModifyBusy(false);
        showToast("Couldn't join. Try again.");
        return;
      }
      const { survivor, survivorPatch, mergedIds } = plan;
      onMerge(A.id, survivorPatch, mergedIds);
      if (winner === "skip") onSetSkipped(survivor, true);
      else onSetWinner(survivor, winner);

      setModifyBusy(false);
      setModifyPoint(null);
      pinEndPause(null);
      endPauseFiredRef.current = null;
      // Advance past the merged range: the survivor is scored, so land on
      // the point after the last one we joined, not back on the survivor.
      const lastIdx = ps.findIndex((p) => p.id === mergedIds[mergedIds.length - 1]);
      const nextAfter = lastIdx >= 0 ? (ps[lastIdx + 1] ?? null) : null;
      if (nextAfter && nextAfter.cut_t0 !== null) {
        seekTo(Number(nextAfter.cut_t0));
        playNow();
      } else if (A.cut_t0 !== null) {
        seekTo(Number(A.cut_t0));
      }
      showFlash("Joined");
    },
    [
      modifyBusy,
      onMerge,
      modifyPoint,
      onSetWinner,
      onSetSkipped,
      pinEndPause,
      seekTo,
      playNow,
      showFlash,
      showToast,
    ]
  );

  /**
   * Modify → Adjust: save the dragged t0/t1. MatchView owns the write and
   * the reclip; here we push the undo entry and keep the session flowing.
   */
  const performAdjust = useCallback(
    async (t0New: number, t1New: number) => {
      if (modifyBusy || !onAdjustTiming || !modifyPoint) return;
      const A =
        pointsRef.current.find((p) => p.id === modifyPoint.id) ?? modifyPoint;
      if (A.t0 === null || A.t1 === null) return;
      const prev = {
        prevT0: Number(A.t0),
        prevT1: Number(A.t1),
        prevTightStart: A.tight_start,
        prevTightEnd: A.tight_end,
      };
      setModifyBusy(true);
      const ok = await onAdjustTiming(A, t0New, t1New);
      setModifyBusy(false);
      if (!ok) {
        showToast("Couldn't save the timing. Try again.");
        return;
      }
      setUndoStack((s) => [...s, { type: "adjust", pointId: A.id, ...prev }]);
      setModifyPoint(null);
      showFlash("Timing saved · updating clip", 2000);
    },
    [modifyBusy, onAdjustTiming, modifyPoint, showFlash, showToast]
  );

  // Serve ball tap: flip who served the rally on screen. The override
  // re-anchors the ITTF rotation, so every later point recomputes too.
  const flipServer = useCallback(() => {
    if (!currentRallyId || !server) return;
    const p = pointsRef.current.find((pt) => pt.id === currentRallyId);
    if (!p) return;
    const next = server === "user" ? "opponent" : "user";
    onSetServer(p, next);
    // Name the downstream effect: the flip re-anchors the whole rotation,
    // not just this rally (same copy as the point view's chip menu).
    showFlash(
      next === "user"
        ? youLabel === "Me"
          ? "I serve — rotation updated"
          : `${youLabel} serves — rotation updated`
        : `${themLabel} serves — rotation updated`
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

  /**
   * After pinning 'end' on p: does the game that just closed prove its own
   * winner? A pinned end at 10-7 (points lost to a cut) doesn't, and a
   * game the score can't call counts for nobody in the tally — so ask.
   * The walk is re-run locally with the pin forced on p because the
   * optimistic points update may not have landed in pointsRef yet.
   */
  const askWinnerIfUnproven = useCallback(
    (p: Point) => {
      if (!onSetGameWinner) return;
      const walk = createBoundaryWalk();
      let final: GameSummary | null = null;
      for (const pt of pointsRef.current) {
        const winner = !pt.is_let ? (pt.confirmed_winner ?? null) : null;
        const override: GameEndOverride =
          pt.id === p.id ? "end" : (pt.game_end_override ?? null);
        const ended = stepBoundaryWalk(walk, winner, override);
        if (pt.id === p.id) {
          final = ended;
          break;
        }
      }
      if (final && gameWinner(final) === null) {
        setWinnerAsk({ pointId: p.id, you: final.you, them: final.them });
      }
    },
    [onSetGameWinner]
  );

  /** Every "Game ended" path lands here: pin 'end' on p (undoable), skip
   *  the "did it though?" overlay for an end the user asked for, and ask
   *  who won when the closed score can't say. */
  const pinEndAt = useCallback(
    (p: Point) => {
      explicitEndRef.current = p.id;
      lastScoreTapRef.current = Date.now(); // so the score flash confirms
      applyGameOverride(p, "end");
      askWinnerIfUnproven(p);
    },
    [applyGameOverride, askWinnerIfUnproven]
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

  /** The nudge's "Game ended": pin an explicit 'end' on the just-answered
   *  point (closing a game held open by 'continue'). */
  const tapEndedHere = useCallback(() => {
    if (!endedPill) return;
    const p = pointsRef.current.find((pt) => pt.id === endedPill.pointId);
    if (!p) return;
    pinEndAt(p);
    setEndedPill(null);
  }, [endedPill, pinEndAt]);

  // "Game ended" target (the inverse fix: the game was actually over
  // BEFORE the auto rule fired — e.g. the real score was miscounted
  // upward, or the tail of the game was never scored at all). The
  // boundary is POSITIONAL: it pins 'end' on the rally the surface is
  // about — pin-first and hold-aware, the same displayTarget everything
  // else follows — scored, skipped, or unscored alike (the walk honors
  // overrides on every visible point). Pause where the video shows the
  // side-switch (or don't: the control works mid-playback now that it
  // lives in the pad) and the game closes exactly there, even with a run
  // of unscored rallies behind it. Null when the walk already closes a
  // game at that rally — the control offers "Didn't end" there instead.
  const endGameTarget = useMemo(() => {
    if (phase !== "play") return null;
    const p = displayTarget;
    if (!p) return null;
    return score.boundaryAfter.has(p.id) ? null : p;
  }, [phase, displayTarget, score.boundaryAfter]);

  const tapEndGame = useCallback(() => {
    if (!endGameTarget) return;
    pinEndAt(endGameTarget);
  }, [endGameTarget, pinEndAt]);

  // "Game ended" target: the LAST scored point in timeline order. Only
  // offered once the current game is held OPEN past the auto boundary — i.e.
  // the auto rule fired, you tapped "Didn't end", and you're now counting on
  // (e.g. to 12-9). In that state the game will never auto-close, so this is
  // the way to end it — at the point you most recently scored, even after
  // the video has advanced. Not shown during normal counting (1-0, 1-1, …):
  // a game that hasn't crossed 11 doesn't need a manual end. Hidden once
  // that point already closes a game.
  const endHereTarget = useMemo(() => {
    if (mode !== "score" || phase !== "play") return null;
    // Use the PLAYHEAD's running score (not the `score` prop, which follows
    // the selected pane point). Offer the manual end only once the game on
    // screen is held OPEN past the auto boundary — a 'continue' with no
    // closing 'end', i.e. you crossed 11, tapped "Didn't end", and kept
    // counting (e.g. to 15-0). Target the last scored point up to the
    // playhead, which is where "here" ends the game.
    if (!runningScore.open) return null;
    const idx = displayTarget ? (indexById.get(displayTarget.id) ?? -1) : -1;
    if (idx < 0) return null;
    let last: Point | null = null;
    for (let i = 0; i <= idx; i++) {
      const p = points[i];
      if (!p.is_let && p.confirmed_winner !== null) last = p;
    }
    if (!last) return null;
    return runningScore.boundaryAfter.has(last.id) ? null : last;
  }, [mode, phase, points, displayTarget, indexById, runningScore]);

  const tapEndHere = useCallback(() => {
    if (!endHereTarget) return;
    pinEndAt(endHereTarget);
    showFlash("Game ended");
  }, [endHereTarget, pinEndAt, showFlash]);

  /**
   * ONE control in the pad for the whole game boundary — the score is only
   * ever a guess about where a game ended, and the correction should live
   * in the same place whichever way it needs to go:
   *
   *   a game just closed          → "Didn't end"  (reopen, keep counting)
   *   a game ends at this rally   → "Didn't end"  (reopen it here)
   *   an answer just crossed the
   *   held-open game's real end   → "Game ended"  (close at that point;
   *                                  `attention` lights the button)
   *   a game is held open         → "Game ended"  (close at the last
   *                                  scored point)
   *   anywhere else               → "Game ended"  (close after the rally
   *                                  on screen)
   *
   * Ordered so the freshest fact wins. It used to be a corner pill over
   * the footage and paused-only; in the pad it can simply always be there
   * — no standing chrome over the video, and no waiting for the next
   * pause to end a game the video already showed ending (players
   * switching sides at 10-7 because a cut ate the last point).
   */
  const boundaryControl = useMemo(() => {
    if (mode !== "score" || phase !== "play") return null;
    if (boundary?.pointId)
      return {
        label: "Didn't end",
        aria: "The game did not end here, keep counting",
        onTap: tapDidntEnd,
        endsHere: true,
        attention: false,
      };
    const anchor = displayTarget;
    if (anchor && score.boundaryAfter.has(anchor.id)) {
      const a = gameBoundaryAction(anchor.game_end_override, true);
      return {
        label: "Didn't end",
        aria: "The game did not end at this point, keep counting",
        onTap: () => {
          applyGameOverride(anchor, a.next);
          showFlash("Game continues");
        },
        endsHere: true,
        attention: false,
      };
    }
    if (endedPill)
      return {
        label: "Game ended",
        aria: "Mark the game as ended at the point just answered",
        onTap: tapEndedHere,
        endsHere: false,
        attention: true,
      };
    if (endHereTarget)
      return {
        label: "Game ended",
        aria: "Mark the game as ended here",
        onTap: tapEndHere,
        endsHere: false,
        attention: false,
      };
    if (endGameTarget)
      return {
        label: "Game ended",
        aria: "Mark the game as ended after this point",
        onTap: tapEndGame,
        endsHere: false,
        attention: false,
      };
    return null;
  }, [
    mode,
    phase,
    boundary,
    displayTarget,
    score.boundaryAfter,
    endedPill,
    endGameTarget,
    endHereTarget,
    tapDidntEnd,
    tapEndedHere,
    tapEndGame,
    tapEndHere,
    applyGameOverride,
    showFlash,
  ]);

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
    if (e.type === "modify-split") {
      // Reverse a Modify Split: unsplit every child (tail-most first — the
      // stored order already reverses the split sequence), then restore the
      // root point's pre-split winner/skip. Each unsplit_point hard-deletes
      // its child and restores the parent's t1/tight_end atomically.
      pinEndPause(null);
      endPauseFiredRef.current = null;
      (async () => {
        const supabase = createClient();
        for (const u of e.unsplits) {
          const { error } = await supabase.rpc("unsplit_point", {
            p_parent: u.parentId,
            p_child: u.childId,
            parent_t1: u.prevT1,
            parent_tight_end: u.prevTightEnd,
            parent_edited: u.prevEdited,
          });
          if (error) {
            showToast("Couldn't fully undo. Try again.");
            return;
          }
          onUnsplit?.(
            u.parentId,
            { t1: u.prevT1, tight_end: u.prevTightEnd, edited: true },
            u.childId
          );
        }
        // Root restore: children are gone, so only the root's own outcome
        // needs putting back.
        const root = pointsRef.current.find((pt) => pt.id === e.rootId);
        if (root) {
          if (root.confirmed_winner !== e.rootPrevWinner)
            onSetWinner(root, e.rootPrevWinner);
          if (root.is_let !== e.rootPrevSkipped)
            onSetSkipped(root, e.rootPrevSkipped);
        }
        if (e.rootCutT0 !== null && phase !== "review") {
          seekTo(e.rootCutT0);
          playNow();
        }
      })();
      return;
    }
    if (e.type === "bulk-delete") {
      onUndoDelete(e.pointIds);
      if (e.firstCutT0 !== null && phase !== "review") {
        seekTo(e.firstCutT0);
        playNow();
      }
      return;
    }
    if (e.type === "adjust") {
      // Reverse an Adjust: write the previous timing back — itself just
      // another timing save, with the tight flags restored explicitly
      // (the forward save may have dissolved them, and the generic write
      // can't know an edge moved BACK onto a split boundary).
      const p = pointsRef.current.find((pt) => pt.id === e.pointId);
      if (!p || !onAdjustTiming) return;
      (async () => {
        const ok = await onAdjustTiming(p, e.prevT0, e.prevT1, {
          tight_start: e.prevTightStart,
          tight_end: e.prevTightEnd,
        });
        if (!ok) showToast("Couldn't undo the timing change. Try again.");
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
    onAdjustTiming,
    onSetWinner,
    onSetSkipped,
    onSetGameOverride,
    pinEndPause,
    showToast,
    phase,
    seekTo,
    playNow,
  ]);

  // "Match starts here": while the WHOLE match is untouched (no winner, no
  // skip, no star anywhere) and the pad has moved past the first point,
  // offer to sweep the earlier points away — recorded warm-up is the top
  // reason a match's head is junk. The first real answer retires the offer
  // for good; a session dismiss retires it for this session.
  const [startHereDismissed, setStartHereDismissed] = useState(false);
  const matchUntouched = useMemo(
    () =>
      points.every(
        (p) => p.confirmed_winner === null && !p.is_let && !p.starred
      ),
    [points]
  );
  const startHereCount = useMemo(() => {
    if (!matchUntouched || startHereDismissed) return 0;
    const id = displayTarget?.id;
    if (!id) return 0;
    return Math.max(0, indexById.get(id) ?? 0);
  }, [matchUntouched, startHereDismissed, displayTarget, indexById]);
  const tapStartHere = useCallback(() => {
    const p = resolveTargetPoint();
    if (!p || !onDeleteAllBefore) return;
    const idx = indexById.get(p.id) ?? 0;
    if (idx < 1) return;
    const before = pointsRef.current.slice(0, idx);
    onDeleteAllBefore(p);
    setUndoStack((s) => [
      ...s,
      {
        type: "bulk-delete",
        pointIds: before.map((b) => b.id),
        firstCutT0:
          before[0]?.cut_t0 === null || before[0] === undefined
            ? null
            : Number(before[0].cut_t0),
      },
    ]);
    showFlash(
      `${before.length} point${before.length === 1 ? "" : "s"} removed`
    );
  }, [resolveTargetPoint, onDeleteAllBefore, indexById, showFlash]);

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
    // An end the user asked for needs no "did it though?" — see
    // explicitEndRef. The flash below still confirms it closed.
    const asked = pointId !== null && pointId === explicitEndRef.current;
    explicitEndRef.current = null;
    if (!asked) {
      setBoundary({ game: gamesCount, you: g.you, them: g.them, pointId });
    }
    // The result is an announcement, not an event to acknowledge: it goes
    // through the same flash every other confirmation uses instead of a
    // card across the footage. The correction lives in the pad's
    // Game-ended control, which reads "Didn't end" while this is fresh.
    showFlash(`Game ${gamesCount} · ${g.you}-${g.them}`, 2000);
    if (boundaryTimer.current) window.clearTimeout(boundaryTimer.current);
    boundaryTimer.current = window.setTimeout(() => {
      boundaryTimer.current = null;
      setBoundary(null);
    }, 5000);
  }, [
    gamesCount,
    mode,
    runningScore.games,
    runningScore.boundaryAfter,
    showFlash,
  ]);

  // Clear the boundary auto-dismiss timer on unmount.
  useEffect(
    () => () => {
      if (boundaryTimer.current) window.clearTimeout(boundaryTimer.current);
    },
    []
  );

  /**
   * Press-and-hold rate for the keyboard, watch mode only. The rate lasts
   * exactly as long as the key is down and restores whatever was set
   * before, so a peek at double speed never strands someone who was
   * reviewing at a half. Routed through setSpeed rather than the video
   * element so the speed pill keeps telling the truth.
   *
   * Both read through refs so the two callbacks never change identity.
   * They did at first, and it made the whole thing a no-op: pressing S
   * changed speedIdx, which rebuilt holdSpeed, which re-ran the key
   * effect, whose cleanup released the hold in the same render. The rate
   * went down and back up before a frame was drawn.
   */
  const heldFrom = useRef<number | null>(null);
  const speedIdxRef = useRef(speedIdx);
  speedIdxRef.current = speedIdx;
  const setSpeedRef = useRef(setSpeed);
  setSpeedRef.current = setSpeed;
  const holdSpeed = useCallback((target: number) => {
    if (heldFrom.current !== null) return;
    heldFrom.current = SPEEDS[speedIdxRef.current];
    setSpeedRef.current(target);
  }, []);
  const releaseSpeed = useCallback(() => {
    if (heldFrom.current === null) return;
    setSpeedRef.current(heldFrom.current);
    heldFrom.current = null;
  }, []);

  // Desktop keys. Space works in both modes; the review keys are watch
  // mode's, the scoring keys are score mode's, and the two sets never
  // overlap — in score mode the arrows score a point and S stars one.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (
        serveSheet ||
        namesSheet ||
        noteSheet ||
        pointPicker ||
        annotate ||
        e.repeat
      )
        return;
      const t = e.target;
      if (t instanceof HTMLElement && t.closest("input, textarea, select"))
        return;
      if (e.key === " ") {
        e.preventDefault();
        togglePause();
        return;
      }
      if (mode !== "score") {
        // Watch mode: the same review keys the coach workspace carries.
        // Desktop only, and the media query is the gate rather than the
        // layout, so a phone with a keyboard attached still behaves the
        // way the phone expects.
        if (!window.matchMedia("(min-width: 1024px)").matches) return;
        switch (e.key) {
          case "ArrowLeft":
            e.preventDefault();
            doubleTapSeek(false);
            return;
          case "ArrowRight":
            e.preventDefault();
            doubleTapSeek(true);
            return;
          case "r":
          case "R":
            e.preventDefault();
            replayRally();
            return;
          case "n":
          case "N":
            e.preventDefault();
            openNoteSheet();
            return;
          case "s":
          case "S":
            e.preventDefault();
            holdSpeed(0.25);
            return;
          case "f":
          case "F":
            e.preventDefault();
            holdSpeed(2);
            return;
          default:
            return;
        }
      }
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
      } else if (e.key === "t" || e.key === "T") {
        // T, not S. S is hold-for-slow-motion in the watch player, and one
        // letter meaning two different things across two screens of the
        // same video is how a coach stars a point by accident.
        tapStar();
      } else if (canLabelServeStart && (e.key === "b" || e.key === "B")) {
        // B for "begin" (089, admin). Not S — same reason as T above.
        e.preventDefault();
        markServeStart("key");
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (["s", "S", "f", "F"].includes(e.key)) releaseSpeed();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    // Losing the window ends the hold too: coming back to a video stuck in
    // slow motion would be worse than having no shortcut.
    window.addEventListener("blur", releaseSpeed);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", releaseSpeed);
      // Deliberately NOT releasing here. setSpeed calls showControls, which
      // moves state, which re-identifies half the callbacks this effect
      // depends on, which re-runs it — so releasing in the cleanup undid
      // every hold a few milliseconds after it started. Keyup and blur end
      // the hold; unmount is handled on its own below.
    };
  }, [
    open,
    mode,
    serveSheet,
    namesSheet,
    noteSheet,
    pointPicker,
    annotate,
    tapSide,
    undo,
    tapSkip,
    tapStar,
    togglePause,
    doubleTapSeek,
    replayRally,
    openNoteSheet,
    holdSpeed,
    releaseSpeed,
    canLabelServeStart,
    markServeStart,
  ]);

  // The hold cannot outlive the player. Its own effect, so it runs on
  // unmount and never on a re-render.
  useEffect(() => () => releaseSpeed(), [releaseSpeed]);

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
  const litYou =
    !!target && !target.is_let && target.confirmed_winner === "user";
  const litThem =
    !!target && !target.is_let && target.confirmed_winner === "opponent";
  const canTap = !!target;
  // Whether the rally on screen already carries a serve-start label (089).
  const serveStartMarked =
    displayTarget?.serve_start_at_cut_s !== null &&
    displayTarget?.serve_start_at_cut_s !== undefined;

  const progressPct = duration > 0 ? (playheadT / duration) * 100 : 0;

  // ------------------------------------------------------------------ UI

  // -webkit-touch-callout INHERITS, and the finger never actually lands on
  // the <video>: the gesture surface covers it. Suppressing the callout on
  // the video alone left the browser's long-press menu (Brave's playlist
  // prompt, Safari's save sheet) firing from the layer above it, so the
  // whole area opts out and every layer in it inherits that.
  const NO_CALLOUT = "select-none [-webkit-touch-callout:none]";
  const videoAreaClass =
    mode === null
      ? `relative aspect-video w-full bg-black ${NO_CALLOUT}`
      : mode === "watch"
        ? `relative min-h-0 w-full flex-1 bg-black ${NO_CALLOUT}`
        : floatingPad
          ? // desktop: the pad floats, so the video owns the whole screen.
            `relative h-full min-h-0 w-full flex-1 overflow-hidden bg-black ${NO_CALLOUT}`
          : fakeLandscape
            ? // fake landscape (iPhone fullscreen): the box is already
              // rotated, so the CSS orientation variants — which read the
              // real viewport — would pick portrait. Landscape layout,
              // stated outright.
              `relative h-full min-h-0 flex-1 overflow-hidden bg-black ${NO_CALLOUT}`
            : // portrait: a capped 16:9 strip on top of the controls. landscape
              // (phone-landscape, tablet-landscape): fill the left side,
              // controls become the right rail.
              `relative overflow-hidden bg-black portrait:mx-auto portrait:aspect-video portrait:max-h-[45dvh] portrait:w-full portrait:max-w-3xl portrait:shrink-0 landscape:h-full landscape:min-h-0 landscape:flex-1 ${NO_CALLOUT}`;

  return (
    <div
      ref={rootRef}
      className={
        open
          ? fakeLandscape
            ? // The rotated takeover (iPhone fullscreen): a fixed box sized
              // to the rotated viewport, turned 90° — inset-0 is replaced
              // by the explicit box in `style`. Orientation variants can't
              // apply inside (the viewport is still portrait), so the
              // landscape layout is stated directly — and the direction
              // rides in `style` with the box, beyond the reach of a stale
              // dev stylesheet.
              "fixed z-[80] flex bg-ink"
            : mode === "score"
              ? // score mode goes two-column in landscape (phone-landscape,
                // tablet-landscape, desktop): video left, controls rail right.
                // Both directions are variant-based so neither overrides the
                // other (an unconditional flex-col would win on order).
                "fixed inset-0 z-[80] flex bg-ink portrait:flex-col landscape:flex-row"
              : "fixed inset-0 z-[80] flex flex-col bg-ink"
          : "relative"
      }
      style={
        open
          ? fakeLandscape
            ? {
                top: 0,
                left: 0,
                width: "100dvh",
                height: "100dvw",
                transform: "rotate(90deg) translateY(-100%)",
                transformOrigin: "top left",
                flexDirection: mode === "score" ? "row" : "column",
              }
            : { paddingBottom: "env(safe-area-inset-bottom)" }
          : undefined
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
            // Readable pixels for frame annotation. If the bucket's CORS
            // rule ever breaks this fetch, onError retries once without —
            // playback always wins over drawing.
            crossOrigin={corsOff ? undefined : "anonymous"}
            onError={() => {
              if (!corsOff) {
                corsRetryT.current = videoRef.current?.currentTime ?? 0;
                setCorsOff(true);
              }
            }}
            // Press-and-hold on this video means 2x, not "save this file".
            // A long press on a media element otherwise raises the browser's
            // own callout — Brave's "Add to Brave Playlist", Safari's
            // save/share sheet — right on top of the frame you are holding
            // to watch. -webkit-touch-callout is what suppresses it on iOS
            // (both browsers are WebKit there); the rest close the other
            // doors into the raw file that the same gesture opens.
            disablePictureInPicture
            controlsList="nodownload noplaybackrate noremoteplayback"
            onContextMenu={(e) => e.preventDefault()}
            onLoadedMetadata={(e) => onLoadedMetadata(e.currentTarget)}
            onTimeUpdate={(e) => onTime(e.currentTarget)}
            onProgress={(e) => onProgress(e.currentTarget)}
            // Buffering visibility: waiting/stalled show the spinner,
            // anything that means frames are moving again clears it.
            onWaiting={() => setStalled(true)}
            onStalled={() => setStalled(true)}
            onPlaying={() => setStalled(false)}
            onCanPlay={() => setStalled(false)}
            onSeeked={(e) => {
              setPlayheadT(e.currentTarget.currentTime);
              // A jump is not continuous playback: never let the crossing
              // detector treat pre-seek → post-seek as a played-through end,
              // and never let a deliberate landing inside a skipped rally
              // read as running into one.
              lastTickRef.current = null;
              watchTickRef.current = null;
            }}
            onPlay={(e) => {
              setPaused(false);
              // Any resume ends the paused-at-end state (the once-per-
              // entry re-arm lives in endPauseFiredRef, so no re-pause
              // at the same boundary), and refreshes the no-auto-pause
              // guard window (covers plays we didn't initiate too).
              lastPlayAtRef.current = Date.now();
              pinEndPause(null);
              // A play() that lands mid-hold keeps the held rate, whichever
              // side is being held.
              e.currentTarget.playbackRate =
                gesture.current.holding && holdRateRef.current !== null
                  ? holdRateRef.current
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
              setStalled(false);
            }}
            onEnded={() => {
              if (mode === "score" && phase === "play") setPhase("summary");
            }}
            className="h-full w-full select-none bg-black object-contain [-webkit-touch-callout:none]"
            style={
              zoomT.s > 1
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
              ref={zoomSurfaceRef}
              className="absolute inset-0 select-none [-webkit-touch-callout:none]"
              // "none" in both modes now that watch zooms too: the pinch is
              // ours to interpret, and the browser's own gesture would fight
              // it half-way through.
              style={{ touchAction: "none" }}
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

            {/* No Replay or Game-ended pills over the footage any more:
                both live in the pad's control row (with labels), always
                reachable — not just at a paused end. Buttons floating over
                the video after every point were the single most-disliked
                thing about this screen. */}

            {/* No reset-zoom pill: nothing floats over the footage for a
                state the − button and a pinch already undo. */}

            {/* (The WYSIWYG point number used to sit top-center over the
                video. The strip below carries it — the current point is
                the lit chip — so it was one badge over the picture for
                nothing.) */}

            {/* Notes on the rally playing, over the top of the frame (watch
                mode only — the pad and the point view have their own room
                for this). The whole reason to write a note is to find it
                again on the next watch-through, and having to remember
                which points had one, then open a sheet to check, is how
                notes quietly stop being worth writing. Newest first, two
                lines, the rest one tap away. */}
            {mode === "watch" && watchNote && (
              <button
                type="button"
                onClick={openNoteSheet}
                // Width-capped and left-anchored, not edge-to-edge: on a
                // landscape phone or a desktop window a full-bleed strip is
                // a banner across the match. On a portrait phone the cap is
                // wider than the screen, so it still fills the margin.
                className="absolute left-3 top-14 z-10 flex w-[calc(100%-1.5rem)] max-w-sm items-stretch gap-2.5 rounded-lg border border-white/10 bg-ink/85 p-2.5 text-left shadow-lg shadow-black/40 backdrop-blur-sm transition-colors hover:border-white/20"
              >
                <span
                  className={`w-[3px] shrink-0 rounded-sm ${
                    watchNote.note.author_id === ownerId
                      ? "bg-cyan-glow/70"
                      : "bg-amber-400/70"
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[10px] font-semibold text-zinc-400">
                    {watchNote.author}
                  </span>
                  <span className="mt-0.5 block line-clamp-2 text-xs leading-snug text-zinc-200">
                    {watchNote.note.body?.trim() || "Voice note"}
                  </span>
                </span>
                {watchNote.more > 0 && (
                  <span className="shrink-0 self-center rounded-full border border-edge bg-surface px-2 py-0.5 text-[10px] font-semibold tabular-nums text-zinc-400">
                    +{watchNote.more}
                  </span>
                )}
              </button>
            )}

            {/* Score bug (watch mode, scored matches): the broadcast table
                the exported reel burns in, so the app and the file you
                share read the same. Bottom-left, clear of the transport
                row, and it stays put when the chrome fades — it is
                information, not a control. Coaches get it too. */}
            {mode === "watch" && score.confirmedCount > 0 && (
              <ScoreBug
                score={enteringScore}
                you={youLabel}
                them={opponentName || "Them"}
                pictureHeight={frame?.height}
                className="absolute z-10"
                style={{
                  // Bottom-left of the PICTURE, 12px in, exactly where the
                  // reel burns it.
                  //
                  // The floor only matters when the picture reaches the
                  // bottom of the screen (landscape, desktop, any 9:16
                  // clip): there it has to clear the transport row, but
                  // ONLY while the transport row is on screen. Holding it
                  // 56px up permanently left it hovering in the middle of
                  // nothing every time the chrome faded, which is most of
                  // the time you are watching.
                  left: Math.max(12, (frame?.left ?? 0) + 12),
                  bottom: Math.max(
                    controlsVisible ? 52 : 12,
                    (frame?.bottomGap ?? 0) + 12
                  ),
                  transition: "bottom 200ms ease-out",
                }}
              />
            )}

            {/* No paused glyph in either mode: the frame itself plays and
                pauses (single tap, both modes), and the transport bar says
                which state you are in. Score mode used to keep a big centre
                play disc; it left with the tap unification — a third answer
                to a question already answered twice. */}

            {/* Buffering: the network fell behind (waiting/stalled). Named
                so a choppy connection reads as the connection's problem —
                without it the video just stops and the app looks hung. */}
            {stalled && !paused && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <svg
                  viewBox="0 0 32 32"
                  className="h-10 w-10 animate-spin text-white/80 drop-shadow-[0_0_6px_rgba(0,0,0,0.6)]"
                  aria-label="Buffering"
                  role="status"
                >
                  <circle
                    cx="16"
                    cy="16"
                    r="13"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeDasharray="24 58"
                  />
                </svg>
              </div>
            )}

            {/* Transient confirmations ride high — the transport owns the
                lower band of a short portrait video. */}
            {flash && (
              <div className="pointer-events-none absolute inset-x-0 top-14 flex justify-center">
                <span
                  key={flash.key}
                  className="ks-fade rounded-full border border-cyan-glow/60 bg-cyan-glow/15 px-4 py-2 text-sm font-semibold tabular-nums text-cyan-glow backdrop-blur-sm"
                >
                  {flash.label}
                </span>
              </div>
            )}

            {/* first-time gesture hint: one at a time, at most twice ever,
                dead on first real use (gestureHints.ts) */}
            {hint && (
              <div className="pointer-events-none absolute inset-x-0 top-14 z-10 flex justify-center px-6">
                <span className="ks-fade rounded-full border border-edge bg-ink/85 px-4 py-2 text-center text-[13px] font-medium text-zinc-200 backdrop-blur">
                  {hint === "dtap"
                    ? "Double tap the right side for the next point"
                    : "Hold the video for speed: right is 2x, left is slow"}
                </span>
              </div>
            )}

            {/* Press-and-hold rate indicator: says which rate you got, since
                the same gesture now gives two depending on the side.
                (Dropped below the point chip in score mode so the two never
                overlap.) */}
            {holdRate !== null && (
              <div
                className={`pointer-events-none absolute inset-x-0 flex justify-center ${
                  mode === "score" ? "top-14" : "top-3"
                }`}
              >
                <span className="ks-fade rounded-full border border-edge bg-ink/85 px-3 py-1 text-xs font-semibold tabular-nums text-zinc-200 backdrop-blur">
                  {holdRate}x {holdRate < 1 ? "◀▶" : "▶▶"}
                </span>
              </div>
            )}

            {/* No card across the footage when a game closes: the score
                flashes like any other confirmation, and the correction is
                the pad's Game-ended control (reading "Didn't end" while
                the just-closed boundary is fresh). */}

            {/* No transient "Game ended here?" pill over the footage: the
                same nudge now lights the pad's Game-ended control
                (boundaryControl's `attention` case) and retargets it at
                the point just answered. */}

            {/* resume / info toast */}
            {toast && (
              <div className="pointer-events-none absolute inset-x-0 bottom-24 flex justify-center">
                <p className="ks-fade rounded-full border border-edge bg-ink/85 px-4 py-1.5 text-xs text-zinc-300 backdrop-blur">
                  {toast}
                </p>
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
              {/* Left: the gestures sheet, same corner in both modes. */}
              <GesturesButton
                mode={mode === "score" ? "score" : "watch"}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-edge bg-ink/70 text-sm font-semibold text-zinc-300 backdrop-blur transition-colors hover:text-white"
              />
              {/* Watch-mode review controls. Reviewing footage is a
                  different job from scoring it: you want the point again,
                  slower, and somewhere to put what you noticed. Score mode
                  has its own Replay pill and its own pad, so these stay out
                  of it. Notes are open to coaches too — they are the people
                  most likely to be writing one. The close ✕ ends the row in
                  both modes. */}
              {/* Tighter gaps on a phone: the row now ends with the close ✕,
                  and at 390px the Keep score pill wrapped to two lines. */}
              <div className="flex items-center gap-1.5 sm:gap-2">
              {mode === "watch" && (
                <>
                  <button
                    type="button"
                    onClick={replayRally}
                    aria-label="Replay this point"
                    title="Replay this point"
                    className="rounded-full border border-edge bg-ink/70 p-2 text-zinc-300 backdrop-blur transition-colors hover:text-white"
                  >
                    <ReplayIcon className="h-4 w-4" />
                  </button>
                  {/* Speed sits with the review controls, not down on the
                      transport — watching slowly is a review job. */}
                  <SpeedMenu
                    value={SPEEDS[speedIdx]}
                    onChange={setSpeed}
                    onOpenChange={setSpeedMenuOpen}
                    // This row is the chrome across the TOP of the video:
                    // upward is off the screen.
                    drop="down"
                    className="shrink-0 rounded-full border border-edge bg-ink/70 px-2.5 py-1.5 text-[11px] font-semibold tabular-nums text-zinc-200 backdrop-blur"
                  />
                  {/* Star, same as the pad's: the one point you want in the
                      export. Watching is when you notice it. */}
                  {canScore && (
                    <button
                      type="button"
                      onClick={tapStar}
                      disabled={!starTarget}
                      aria-label={
                        starTarget?.starred ? "Remove star" : "Star this point"
                      }
                      title={
                        starTarget?.starred ? "Remove star" : "Star this point"
                      }
                      aria-pressed={!!starTarget?.starred}
                      className={`rounded-full border p-2 backdrop-blur transition-colors disabled:opacity-40 ${
                        starTarget?.starred
                          ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                          : "border-edge bg-ink/70 text-zinc-300 hover:text-white"
                      }`}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        className="h-4 w-4"
                        fill={starTarget?.starred ? "currentColor" : "none"}
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z" />
                      </svg>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      videoRef.current?.pause();
                      setPointPicker(true);
                    }}
                    aria-label="Jump to a point"
                    title="Jump to a point"
                    className="rounded-full border border-edge bg-ink/70 p-2 text-zinc-300 backdrop-blur transition-colors hover:text-white"
                  >
                    {/* Every point at once, which is what the sheet shows.
                        A list glyph reads as "menu", and the pad's
                        arrow-out-of-box already means "leave for the point
                        page" — a different promise from "jump there in
                        this video". */}
                    <svg
                      viewBox="0 0 24 24"
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      aria-hidden="true"
                    >
                      <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
                      <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
                      <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
                      <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={openNoteSheet}
                    aria-label="Add a note on this point"
                    title="Add a note on this point"
                    className="rounded-full border border-edge bg-ink/70 p-2 text-zinc-300 backdrop-blur transition-colors hover:text-white"
                  >
                    {/* A note: a page with a turned-up corner and writing on
                        it. Not a pencil (over a match that promises you can
                        edit the match) and not a speech bubble (that is a
                        conversation, not something you jot down). */}
                    <svg
                      viewBox="0 0 24 24"
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M19.5 5.2v8.4L13.6 19.5H5.6a1.6 1.6 0 0 1-1.6-1.6V5.2a1.6 1.6 0 0 1 1.6-1.6h12.3a1.6 1.6 0 0 1 1.6 1.6Z" />
                      <path d="M19.5 13.6h-4.3a1.6 1.6 0 0 0-1.6 1.6v4.3" />
                      <path d="M7.8 8.4h7.9M7.8 11.7h4.6" />
                    </svg>
                  </button>
                  {canScore && (
                    <button
                      type="button"
                      // Wrapped: openScore's first argument is a point id,
                      // and onClick would hand it the MouseEvent.
                      onClick={() => openScore()}
                      className="whitespace-nowrap rounded-full border border-cyan-glow/50 bg-ink/70 px-3 py-1.5 text-xs font-semibold text-cyan-glow backdrop-blur transition-colors hover:bg-cyan-glow/10 sm:px-3.5"
                    >
                      Score Keeper
                    </button>
                  )}
                </>
              )}
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
              </div>
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
                {/* Zoom lives on the transport in BOTH modes: pinch is
                    invisible, and a camera parked across the hall is the
                    common case. Speed sits up top with the review controls
                    (watch) or on the pad (score), so nothing repeats. */}
                {(
                  <span className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => zoomBy(1 / 1.5)}
                      disabled={zoomT.s <= 1.001}
                      aria-label="Zoom out"
                      title="Zoom out"
                      className="rounded-full border border-edge bg-ink/60 p-1.5 text-zinc-200 transition-colors hover:text-white disabled:opacity-30"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        className="h-3.5 w-3.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        aria-hidden="true"
                      >
                        <circle cx="11" cy="11" r="7" />
                        <path d="m20 20-3.4-3.4M8 11h6" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => zoomBy(1.5)}
                      disabled={zoomT.s >= ZOOM_MAX - 0.001}
                      aria-label="Zoom in"
                      title="Zoom in"
                      className="rounded-full border border-edge bg-ink/60 p-1.5 text-zinc-200 transition-colors hover:text-white disabled:opacity-30"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        className="h-3.5 w-3.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        aria-hidden="true"
                      >
                        <circle cx="11" cy="11" r="7" />
                        <path d="m20 20-3.4-3.4M8 11h6M11 8v6" />
                      </svg>
                    </button>
                    {/* Full screen, where every video player keeps it. Real
                        element fullscreen (+ a landscape lock on phones that
                        grant one) where the platform has it; on iPhone
                        Safari the same button rotates the takeover into a
                        fake landscape instead — see the fullscreen section
                        up top. */}
                    <button
                      type="button"
                      onClick={toggleFullscreen}
                      aria-label={
                        fsActive || fakeFs
                          ? "Exit full screen"
                          : "Full screen"
                      }
                      title={
                        fsActive || fakeFs
                          ? "Exit full screen"
                          : "Full screen"
                      }
                      className="rounded-full border border-edge bg-ink/60 p-1.5 text-zinc-200 transition-colors hover:text-white"
                    >
                      {fsActive || fakeFs ? (
                        <svg
                          viewBox="0 0 24 24"
                          className="h-3.5 w-3.5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
                        </svg>
                      ) : (
                        <svg
                          viewBox="0 0 24 24"
                          className="h-3.5 w-3.5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
                        </svg>
                      )}
                    </button>
                  </span>
                )}
              </div>

              {/* The keys, said once under the transport. It rides the same
                  fade as the rest of the chrome, so it is there when you
                  are looking for a control and gone while you watch.
                  Watch mode only: in score mode these keys score. */}
              {mode !== "score" && (
                <p className="hidden items-center justify-center gap-1.5 px-3 pb-2 text-[11px] text-zinc-500 lg:flex">
                  <KeyCap>space</KeyCap> play
                  <span className="px-1">·</span>
                  <KeyCap>←</KeyCap>
                  <KeyCap>→</KeyCap> point
                  <span className="px-1">·</span>
                  hold <KeyCap>S</KeyCap> 0.25x
                  <span className="px-1">·</span>
                  hold <KeyCap>F</KeyCap> 2x
                  <span className="px-1">·</span>
                  <KeyCap>R</KeyCap> replay
                  <span className="px-1">·</span>
                  <KeyCap>N</KeyCap> note
                </p>
              )}
            </div>
          </>
        )}
      </div>

      {/* ------------------------------------------------- score mode */}
      {open && mode === "score" && (
        <div
          ref={padCardRef}
          {...(floatingPad ? padDragHandlers : {})}
          className={
            floatingPad
              ? // The floating card. z-10 keeps parity with the rail: over
                // the video chrome by DOM order, still under every sheet
                // (game break, note, setup) that renders after it.
                "absolute z-10 flex flex-col overflow-y-auto rounded-2xl border border-edge bg-ink/90 shadow-2xl shadow-black/50 backdrop-blur-md"
              : fakeLandscape
                ? // Rotated fullscreen: the right rail, stated directly —
                  // the orientation variants below read the real (portrait)
                  // viewport and would stack the pad under the video. The
                  // width and flex land in `style` (with the rotation box),
                  // where a stale dev stylesheet can't lose them.
                  "relative flex h-full min-h-0 flex-col overflow-y-auto"
                : "relative flex min-h-0 flex-col portrait:flex-1 landscape:h-full landscape:w-[380px] landscape:flex-none landscape:overflow-y-auto landscape:border-l landscape:border-edge"
          }
          style={
            floatingPad
              ? {
                  width: PAD_WIDTH,
                  maxHeight: "calc(100% - 1rem)",
                  ...(padPos
                    ? { left: padPos.x, top: padPos.y }
                    : {
                        right: 24,
                        top: "50%",
                        transform: "translateY(-50%)",
                      }),
                }
              : fakeLandscape
                ? {
                    width: PAD_WIDTH,
                    flex: "none",
                    borderLeft: "1px solid var(--color-edge)",
                  }
                : undefined
          }
        >
          {/* grab bar: the one place that LOOKS draggable. The whole card
              drags from any dead space, but an affordance has to say so
              somewhere. */}
          {floatingPad && (
            <div
              className="flex h-5 shrink-0 items-center justify-center"
              style={{ cursor: "grab" }}
              title="Drag to move"
              aria-hidden="true"
            >
              <span className="h-1 w-9 rounded-full bg-white/20" />
            </div>
          )}
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
                    <span className="serve-ball-you block h-3.5 w-3.5 rounded-full" />
                  ) : (
                    <span className="block h-3.5 w-3.5 rounded-full border border-zinc-600 opacity-50" />
                  )}
                </button>
              )}
            </span>
            {/* running score: this moment at the playhead, not the match's
                final totals (those live in the end summary) */}
            <span className="flex flex-1 flex-col items-center justify-center">
              <span className="flex items-baseline justify-center gap-2">
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
                {runningScore.gamesYou + runningScore.gamesThem > 0 && (
                  <span className="rounded-full border border-edge bg-surface px-2 py-0.5 text-[11px] font-semibold tabular-nums text-zinc-300">
                    {runningScore.gamesYou}-{runningScore.gamesThem}
                  </span>
                )}
              </span>
              {/* Says out loud what the two lit balls mean, so the colour
                  reads as "this side serves" without anyone guessing. */}
              {server !== null && (
                <span className="mt-0.5 text-[10px] leading-none text-zinc-500">
                  {server === "user"
                    ? youLabel === "Me"
                      ? "You serve"
                      : `${youLabel} serves`
                    : `${themLabel} serves`}
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
                    <span className="serve-ball-them block h-3.5 w-3.5 rounded-full" />
                  ) : (
                    <span className="block h-3.5 w-3.5 rounded-full border border-zinc-600 opacity-50" />
                  )}
                </button>
              )}
            </span>
          </div>

          {/* point navigator: a horizontal, auto-centering strip of every
              point. Lives here below the video — NOT over the footage — so
              the match view stays clean; the current point stays centered as
              playback advances. */}
          {hasChips && (
            <div
              ref={chipStripRef}
              className="mx-auto flex w-full max-w-3xl shrink-0 gap-1.5 overflow-x-auto border-b border-edge/60 px-3 py-2"
            >
              {points.map((p, i) => {
                if (p.cut_t0 === null) return null;
                // The strip doubles as progress: fill says what a point
                // holds, and the same cyan-you / magenta-them pairing the
                // rest of the match view uses. A DASHED, empty chip is one
                // you haven't answered — so how far you've got, and any gap
                // you skipped past, is visible without counting.
                const state = p.is_let
                  ? "skip"
                  : p.confirmed_winner === "user"
                    ? "you"
                    : p.confirmed_winner === "opponent"
                      ? "them"
                      : "todo";
                const tone =
                  state === "you"
                    ? "border-cyan-glow/60 bg-cyan-glow/20 text-cyan-glow"
                    : state === "them"
                      ? "border-magenta-glow/60 bg-magenta-glow/20 text-magenta-soft"
                      : state === "skip"
                        ? "border-amber-400/40 bg-amber-400/10 text-amber-300/80"
                        : "border-dashed border-zinc-600 bg-transparent text-zinc-500 hover:border-cyan-glow/40";
                const said =
                  state === "you"
                    ? `${youLabel} won`
                    : state === "them"
                      ? `${themLabel} won`
                      : state === "skip"
                        ? "skipped"
                        : "not scored yet";
                // Tapping a chip grows "Go to point" out of it, rather than
                // floating a pill over the middle of the footage — the one
                // thing on this screen you are actually trying to watch.
                // The offer belongs where the tap happened.
                const expanded = pill?.id === p.id;
                // A game closing after this point. The boundary walk already
                // knows, so the strip can show it rather than leaving you to
                // count to eleven — and a run of chips reads as a game
                // instead of one undifferentiated line of numbers.
                const ends = score.boundaryAfter.get(p.id);
                // The playing chip counts itself down: the ring is the
                // point's own footage running out, so "how much of this
                // rally is left" (and a fused clip that goes on far too
                // long) is readable without watching the scrub bar.
                const span =
                  targetId === p.id ? chipSpans.get(p.id) : undefined;
                const remaining = span
                  ? 1 -
                    Math.min(
                      1,
                      Math.max(
                        0,
                        (playheadT - span.start) / (span.end - span.start)
                      )
                    )
                  : null;
                return (
                  <Fragment key={p.id}>
                  <div
                    data-chip-id={p.id}
                    // WHERE YOU ARE has to be unmissable: the current chip
                    // grows a step and carries a white glow the whole time
                    // it is current — a thin ring alone was the single
                    // thing on the strip people failed to see. The ring is
                    // white, kept separate from fill, so position and
                    // outcome never compete for the same colour; while the
                    // point plays the countdown ring below replaces the
                    // static ring (two circles on one chip read as noise)
                    // but the glow and the size stay.
                    className={`flex h-8 shrink-0 items-center overflow-hidden rounded-full border transition-[transform,box-shadow,color] ${tone} ${
                      targetId === p.id && !p.edited
                        ? `scale-110 shadow-[0_0_12px_rgba(255,255,255,0.4)] ${
                            remaining === null ? "ring-2 ring-white/90" : ""
                          }`
                        : ""
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => tapChip(p, i + 1)}
                      aria-label={`Go to point ${i + 1}, ${said}${
                        p.edited ? ", updating clip" : ""
                      }`}
                      title={p.edited ? "Updating clip" : undefined}
                      aria-current={targetId === p.id ? "true" : undefined}
                      className="relative flex h-full w-8 shrink-0 items-center justify-center text-xs font-semibold tabular-nums"
                    >
                      {/* A timing edit leaves this chip's clip stale while
                          the worker recuts it. The spinner is that state
                          made visible — without it an Adjust looks like
                          nothing happened. It replaces the countdown and
                          position rings for the duration: the footage it
                          would be counting down is the stale cut. Clears
                          itself through the match view's pending-clip
                          poll. */}
                      {p.edited && (
                        <svg
                          viewBox="0 0 32 32"
                          className="pointer-events-none absolute inset-0 animate-spin text-cyan-glow/90"
                          aria-hidden="true"
                        >
                          <circle
                            cx="16"
                            cy="16"
                            r="14"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeDasharray="26 62"
                          />
                        </svg>
                      )}
                      {remaining !== null && !p.edited && (
                        <svg
                          viewBox="0 0 32 32"
                          className="pointer-events-none absolute inset-0 -rotate-90"
                          aria-hidden="true"
                        >
                          {/* track, so the playing chip stays marked once
                              the ring has run all the way down */}
                          <circle
                            cx="16"
                            cy="16"
                            r="14"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            className="text-white/20"
                          />
                          <circle
                            cx="16"
                            cy="16"
                            r="14"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            className="text-white/90 transition-[stroke-dashoffset] duration-300 ease-linear"
                            strokeDasharray={2 * Math.PI * 14}
                            strokeDashoffset={2 * Math.PI * 14 * (1 - remaining)}
                          />
                        </svg>
                      )}
                      {i + 1}
                    </button>
                    {/* A SEPARATE button, so tapping the number again just
                        re-seeks — the two actions never share a target. */}
                    {expanded && (
                      <button
                        type="button"
                        onClick={() => openPointById(p.id)}
                        className="ks-fade h-full whitespace-nowrap pr-3 text-[11px] font-semibold"
                      >
                        Go to point →
                      </button>
                    )}
                  </div>
                  {ends && (
                    // Tappable: a game that ended in the wrong place (or
                    // never ended at all) is the one thing on this strip you
                    // can't fix by scoring differently, so the divider owns
                    // its own way out.
                    <button
                      type="button"
                      onClick={() =>
                        setGameBreak({
                          pointId: p.id,
                          game: ends.game,
                          you: ends.you,
                          them: ends.them,
                        })
                      }
                      aria-label={`Game ${ends.game} ended here at ${ends.you}-${ends.them} — tap to change`}
                      title={`Game ${ends.game}: ${ends.you}-${ends.them}`}
                      className="group flex h-8 shrink-0 flex-col items-center justify-center gap-1 rounded px-1"
                    >
                      {/* The hairline is the divider doing its structural
                          job; the score below it is the control. */}
                      <span className="block h-3 w-px bg-zinc-600" />
                      {/* Bordered, because in this strip a border is
                          already what marks something tappable — every
                          point chip is a bordered pill, and this was the
                          one interactive thing in the row without one,
                          which is exactly why it read as decoration. A
                          new signal (an underline, a caret) would have
                          been a second vocabulary for the same idea.
                          zinc-600 matches the hairline above rather than
                          the darker --edge, which disappears against this
                          strip at 1px. active: as well as hover:, since
                          the phone this is used on has no hover at all. */}
                      <span className="block rounded-full border border-zinc-600 bg-ink/60 px-1.5 py-0.5 text-[9px] font-semibold leading-none tabular-nums text-zinc-400 transition-colors group-hover:border-cyan-glow/50 group-hover:text-zinc-200 group-active:border-cyan-glow group-active:text-cyan-glow">
                        {ends.you}-{ends.them}
                      </span>
                    </button>
                  )}
                  </Fragment>
                );
              })}
            </div>
          )}

          {/* pad — swipe left anywhere on it for the analysis panel.
              (Not while floating: a horizontal swipe there is a card drag,
              and the analysis button is a real click away.) */}
          <div
            {...(floatingPad ? {} : padSwipeHandlers("open"))}
            className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-3 p-3"
          >
            {/* The control row: every icon carries its name, because at
                16px Undo's hooked arrow and Replay's closed loop are the
                same picture, and a first-time scorer should not have to
                tap buttons to learn them. Scrolls sideways if a width
                can't seat all of it. Tagging moved into Analysis (the
                panel already carries the tag picker) — the clip-
                disposition actions (Skip · Delete · Modify) keep the
                equal-width row below. */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
                <PadControl
                  label="Undo"
                  aria="Undo last tap"
                  onClick={undo}
                  disabled={undoStack.length === 0}
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
                </PadControl>
                {/* Replay the rally on screen, any time — not only at a
                    paused end. Mid-rally it starts this point over. */}
                <PadControl
                  label="Replay"
                  aria="Replay this point"
                  onClick={replayRally}
                  disabled={!target}
                >
                  <ReplayIcon className="h-4 w-4" />
                </PadControl>
                <SpeedMenu
                  value={SPEEDS[speedIdx]}
                  onChange={setSpeed}
                  label="Speed"
                  className="flex h-12 min-w-[2.75rem] shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-edge bg-surface px-1.5 text-xs font-semibold tabular-nums text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white"
                />
                <PadControl
                  label="Star"
                  aria={
                    starTarget?.starred ? "Remove star" : "Star this point"
                  }
                  onClick={tapStar}
                  disabled={!starTarget}
                  lit={!!starTarget?.starred}
                  pressed={!!starTarget?.starred}
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
                </PadControl>
                {/* The game boundary, in the row like everything else. The
                    label says what the tap DOES: "Game ended" closes a game
                    at the rally on screen (asking who won when the score
                    can't say), "Didn't end" reopens one that closed here.
                    It glows for a beat when an answer crosses a held-open
                    game's real end. */}
                {boundaryControl ? (
                  <PadControl
                    label={boundaryControl.label}
                    aria={boundaryControl.aria}
                    onClick={boundaryControl.onTap}
                    lit={boundaryControl.endsHere}
                    attention={boundaryControl.attention}
                  >
                    <FlagIcon className="h-4 w-4" />
                  </PadControl>
                ) : (
                  <PadControl
                    label="Game ended"
                    aria="Mark the game as ended"
                    onClick={() => undefined}
                    disabled
                  >
                    <FlagIcon className="h-4 w-4" />
                  </PadControl>
                )}
                {/* Analysis: the one door into everything you can record
                    about the point beyond who won it — including tags. It
                    slides in over the pad rather than opening a new screen
                    — you are mid-pass through a match, and the video must
                    not go anywhere. */}
                <PadControl
                  label="Analysis"
                  aria="Add analysis for this point"
                  onClick={openAnalysisPanel}
                  disabled={!target}
                  lit={!!target?.confirmed_how}
                >
                  {/* The point's record, not a settings panel: a sheet with
                      lines on it. Sliders read as "configure something". */}
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
                    <path d="M14 3v5h5" />
                    <path d="M9 13h6M9 17h4" />
                  </svg>
                </PadControl>
                {/* jump to this point's detail view (placement, notes) */}
                <PadControl
                  label="Details"
                  aria="Open point view"
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
                  disabled={!target}
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
                </PadControl>
              </div>
              {phase === "review" && (
                <button
                  type="button"
                  onClick={nextReview}
                  className="shrink-0 rounded-full border border-cyan-glow/50 bg-cyan-glow/10 px-4 py-2 text-xs font-semibold text-cyan-glow"
                >
                  Next
                </button>
              )}
            </div>

            {/* "Match starts here" — only while nothing in the match has
                been answered yet and the pad sits past point 1 (jumped
                ahead, or deleted through warm-up one by one). The first
                real answer retires it for good, so it can never interrupt
                actual scoring. */}
            {phase === "play" && startHereCount > 0 && onDeleteAllBefore && (
              <div className="ks-fade flex shrink-0 items-center gap-2 rounded-xl border border-edge bg-surface px-3 py-2">
                <span className="min-w-0 flex-1 text-[11px] leading-snug text-zinc-300">
                  Match starts here? The {startHereCount} earlier point
                  {startHereCount === 1 ? "" : "s"} can go.
                </span>
                <button
                  type="button"
                  onClick={tapStartHere}
                  className="shrink-0 rounded-full border border-cyan-glow/50 px-3 py-1 text-[11px] font-semibold text-cyan-glow transition-colors hover:bg-cyan-glow/10"
                >
                  Remove them
                </button>
                <button
                  type="button"
                  onClick={() => setStartHereDismissed(true)}
                  aria-label="Keep the earlier points"
                  className="shrink-0 rounded-full border border-edge px-3 py-1 text-[11px] font-semibold text-zinc-300 transition-colors hover:bg-surface-2 hover:text-white"
                >
                  Keep
                </button>
              </div>
            )}

            {/* "That clip might be two points" — offered on the clip you
                just answered when a rally's worth of footage was still to
                run. It sits in the pad, not over the video, because the
                video is now playing the part you had not seen: watch it,
                then decide. Non-blocking and never in the way of the next
                answer; ignoring it costs nothing, and the clip advances on
                its own when the footage runs out. */}
            {phase === "play" && splitNudge && (
              <div className="ks-fade flex shrink-0 items-center gap-2 rounded-xl border border-amber-400/40 bg-amber-400/5 px-3 py-2">
                {/* Named, because the offer outlives the clip: the tail
                    plays out and the pad moves on, and "this clip" would
                    then be pointing at the wrong one. */}
                <span className="min-w-0 flex-1 text-[11px] leading-snug text-amber-200/90">
                  <span className="font-semibold">
                    Point {(indexById.get(splitNudge.pointId) ?? 0) + 1}
                  </span>
                  {splitNudge.certain
                    ? " looks like two points."
                    : " — two points in there?"}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const p = pointsRef.current.find(
                      (x) => x.id === splitNudge.pointId
                    );
                    setSplitNudge(null);
                    // Splitting outright here proved confusing — the cut
                    // lands sight-unseen. Open the Modify sheet instead,
                    // with the suggested cut seeded as its split marker:
                    // the user SEES where the split goes, adjusts it on
                    // the scrub timeline, and confirms.
                    if (p) {
                      videoRef.current?.pause();
                      setModifyInitialCut(splitNudge.atCut);
                      setModifyPoint(p);
                    }
                  }}
                  className="shrink-0 rounded-full border border-amber-400/50 px-3 py-1 text-[11px] font-semibold text-amber-200 transition-colors hover:bg-amber-400/10"
                >
                  Split
                </button>
                {/* "No" rather than a bare dismiss: answering the question
                    also answers what to do next. If there is only one point
                    in the clip then the rest of it is the walk-back, and
                    waiting through it is time you did not need to spend. */}
                <button
                  type="button"
                  onClick={() => {
                    const p = pointsRef.current.find(
                      (x) => x.id === splitNudge.pointId
                    );
                    setSplitNudge(null);
                    playTailRef.current = null;
                    if (p) jumpAfter(p);
                  }}
                  className="shrink-0 rounded-full border border-edge px-3 py-1 text-[11px] font-semibold text-zinc-300 transition-colors hover:bg-surface-2 hover:text-white"
                >
                  No
                </button>
              </div>
            )}

            {/* Clip-disposition row: three equal buttons above the winner
                pads. Skip (amber) = a let — the rally happened but doesn't
                count. Delete (red) = dead space — not a point at all; its
                footage stops playing. Modify (cyan) = split this point into
                2-3 or join it with the next — retroactive, from a modal (the
                reviewer watches the whole point, THEN acts). Skip/Delete
                flash + jump to the next rally and undo from the pad's stack;
                Modify opens the sheet. The tiny sublabels are the owner's
                clarifying micro-copy. Hidden in review/summary phases where
                per-clip disposition doesn't apply. */}
            {phase === "play" && (
              <div className="flex shrink-0 gap-2.5">
                <button
                  type="button"
                  onClick={tapSkip}
                  disabled={!canTap}
                  className="h-12 min-w-0 flex-1 rounded-xl border border-amber-400/40 bg-amber-400/5 px-1 text-amber-300 transition-colors hover:border-amber-400/60 hover:bg-amber-400/10 active:scale-[0.99] disabled:opacity-40"
                >
                  <span className="block text-xs font-semibold leading-tight">
                    Skip
                  </span>
                  <span className="block truncate text-[10px] leading-tight text-amber-300/60">
                    let
                  </span>
                </button>
                <button
                  type="button"
                  onClick={tapDelete}
                  disabled={!canTap}
                  className="h-12 min-w-0 flex-1 rounded-xl border border-red-400/40 bg-red-500/5 px-1 text-red-300 transition-colors hover:border-red-400/60 hover:bg-red-500/10 active:scale-[0.99] disabled:opacity-40"
                >
                  <span className="block text-xs font-semibold leading-tight">
                    Delete
                  </span>
                  <span className="block truncate text-[10px] leading-tight text-red-300/60">
                    dead space
                  </span>
                </button>
                <button
                  type="button"
                  onClick={tapModify}
                  disabled={!canTap || !onSplit}
                  className="h-12 min-w-0 flex-1 rounded-xl border border-cyan-glow/40 bg-cyan-glow/5 px-1 text-cyan-glow transition-colors hover:border-cyan-glow/60 hover:bg-cyan-glow/10 active:scale-[0.99] disabled:opacity-40"
                >
                  <span className="block text-xs font-semibold leading-tight">
                    Modify
                  </span>
                  <span className="block truncate text-[10px] leading-tight text-cyan-glow/60">
                    split · join · adjust
                  </span>
                </button>
              </div>
            )}

            {/* first-time keep score: the forced pause asks the question,
                right above the buttons that answer it (gestureHints.ts) */}
            {scoreHint && endPausedId !== null && (
              <p className="ks-fade mb-2 shrink-0 text-center text-[13px] font-semibold text-cyan-glow">
                Tap who won this point
              </p>
            )}
            {/* Your side is a plain button: winning a point asks nothing,
                so one tap and you are moving. The opponent's side carries
                Why in its inner corner — that button means "I lost this
                one", which is the only case with a question behind it. */}
            {/* Both halves are wrapped the same way even though only one
                carries a pill: a bare button as a flex child adds its own
                padding and border ON TOP of the distributed space, which
                made the two sides 18px apart. Identical structure, identical
                widths. */}
            <div
              // Rail/portrait: fill whatever height is left. Floating: the
              // card is content-sized, so the buttons take a fixed, still
              // generous height instead of a collapsed one.
              className={`relative flex gap-3 ${
                floatingPad ? "shrink-0" : "min-h-0 flex-1"
              }`}
              style={floatingPad ? { height: 176 } : undefined}
            >
              <div className="relative min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => tapSide("user")}
                  disabled={!canTap}
                  aria-pressed={litYou}
                  className={`h-full w-full rounded-2xl border px-2 text-2xl font-bold transition-all active:scale-[0.98] disabled:opacity-40 ${
                    litYou
                      ? "glow-ring border-cyan-glow bg-cyan-glow/25 text-cyan-glow"
                      : "border-cyan-glow/30 bg-cyan-glow/5 text-cyan-glow"
                  }`}
                >
                  <span className="block truncate">{youLabel}</span>
                </button>
              </div>
              <div className="relative min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => tapSide("opponent")}
                  disabled={!canTap}
                  aria-pressed={litThem}
                  className={`h-full w-full rounded-2xl border px-2 text-2xl font-bold transition-all active:scale-[0.98] disabled:opacity-40 ${
                    litThem
                      ? "border-magenta-glow bg-magenta-glow/25 text-magenta-soft shadow-[0_0_18px_rgba(232,121,249,0.4)]"
                      : "border-magenta-glow/30 bg-magenta-glow/5 text-magenta-soft"
                  }`}
                >
                  <span className="block truncate">{themLabel}</span>
                </button>
                {whyAvailable && (
                  <WhyPill
                    disabled={!canTap}
                    answered={!!displayTarget?.loss_reasons?.length}
                    label={`${themLabel} won it — say why you lost`}
                    onClick={() => tapSide("opponent", { thenWhy: true })}
                  />
                )}
              </div>
            </div>

            {/* Serve start (089), admin only. Under the winner buttons so
                appearing can never move the targets about to be tapped —
                the same reason Replay sits below them. A real pill at
                text-sm, not a small grey link: marking the serve is a real
                action. Lit when this point already carries a label; the
                number itself stays off the pad, since the scrubber already
                shows the time and two clocks that can disagree read as a
                bug. */}
            {canLabelServeStart && (
              <div className="flex shrink-0 items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => markServeStart("button")}
                  disabled={!canTap}
                  aria-pressed={serveStartMarked}
                  aria-label="Mark where the serve began"
                  className={`h-9 flex-1 rounded-full border text-sm font-semibold transition-colors disabled:opacity-40 ${
                    serveStartMarked
                      ? "border-cyan-glow bg-cyan-glow/20 text-cyan-glow"
                      : "border-edge bg-surface text-zinc-200 hover:border-cyan-glow/50 hover:text-white"
                  }`}
                >
                  Serve start
                </button>
                {serveStartMarked && (
                  <button
                    type="button"
                    onClick={clearServeStart}
                    className="shrink-0 text-sm text-zinc-400 transition-colors hover:text-zinc-200"
                  >
                    Clear
                  </button>
                )}
              </div>
            )}

            {/* Replay and the game boundary moved into the control row at
                the top of the pad, one place for every layout — the
                desktop-only row that used to sit here is gone with the
                over-video pills. */}

            {floatingPad ? (
              // Desktop has the room to say the keys out loud.
              <div className="flex shrink-0 flex-wrap items-center justify-center gap-2.5 pb-1 text-[11px] text-zinc-500">
                {(
                  [
                    ["←", youLabel],
                    ["→", themLabel],
                    ["U", "Undo"],
                    ["K", "Skip"],
                    ["T", "Star"],
                    // Admin only, so it appears in the legend only when the
                    // key actually does something (089).
                    ...(canLabelServeStart ? [["B", "Serve start"]] : []),
                    ["Space", "Pause"],
                  ] as [string, string][]
                ).map(([k, what]) => (
                  <span key={k} className="flex items-center gap-1">
                    <kbd className="rounded border border-edge bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-zinc-300">
                      {k}
                    </kbd>
                    {what}
                  </span>
                ))}
              </div>
            ) : (
              <p className="hidden text-center text-[11px] text-zinc-600 lg:block">
                ← {youLabel} · → {themLabel} · U undo · K skip · T star ·
                {canLabelServeStart ? " B serve start · " : " "}
                Space pause
              </p>
            )}
          </div>

          {/* The Why overlay: ONE question over the pad, never over the
              video — the rally you are explaining has to stay on screen.
              Sits above the pad rather than replacing it, because the point
              is already scored and the buttons underneath have no job until
              the answer moves us on. */}
          {open && mode === "score" && whyPoint && (
            <div className="ks-fade absolute inset-0 z-20 flex flex-col justify-end bg-ink/80 backdrop-blur-sm">
              <button
                type="button"
                aria-label="Back without saying why"
                onClick={closeWhy}
                className="absolute inset-0"
              />
              <div className="relative w-full rounded-t-2xl border-t border-edge bg-surface p-4 pb-6">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-zinc-100">
                      Why did you lose it?
                    </h2>
                    {whyServerLine && (
                      <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                        {whyServerLine}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={closeWhy}
                    aria-label="Skip the question"
                    className="shrink-0 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-300"
                  >
                    Skip
                  </button>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {whyOptions.map((r) => {
                    const active = whyPoint.loss_reasons?.includes(r.value);
                    return (
                      <button
                        key={r.value}
                        type="button"
                        onClick={() => void answerWhy(r.value)}
                        aria-pressed={active}
                        className={`rounded-full border px-3.5 py-2.5 text-xs font-medium transition-colors ${
                          active
                            ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                            : "border-edge bg-ink/40 text-zinc-200 hover:border-cyan-glow/40"
                        }`}
                      >
                        {r.label}
                      </button>
                    );
                  })}
                  {/* Neither of these is a reason, so both are dashed —
                      nothing here should read as one more way the point
                      ended. */}
                  {onCreateCustomReason && !whyCustomOpen && (
                    <button
                      type="button"
                      onClick={() => setWhyCustomOpen(true)}
                      className="rounded-full border border-dashed border-edge bg-transparent px-3.5 py-2.5 text-xs font-medium text-zinc-400 transition-colors hover:border-cyan-glow/40 hover:text-zinc-200"
                    >
                      Enter custom
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={whyMoreDetails}
                    className="rounded-full border border-dashed border-edge bg-transparent px-3.5 py-2.5 text-xs font-medium text-zinc-400 transition-colors hover:border-cyan-glow/40 hover:text-zinc-200"
                  >
                    More details →
                  </button>
                </div>

                {onCreateCustomReason && whyCustomOpen && (
                  <div className="mt-2.5 flex gap-2">
                    <input
                      // Typed for the iOS no-zoom guard in globals.css,
                      // which keys off input[type="text"].
                      type="text"
                      autoFocus
                      value={whyCustom}
                      maxLength={MAX_CUSTOM_REASON_LEN}
                      onChange={(e) => setWhyCustom(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void submitWhyCustom();
                        }
                        if (e.key === "Escape") {
                          setWhyCustomOpen(false);
                          setWhyCustom("");
                        }
                      }}
                      placeholder="Misread the pips"
                      aria-label="Your own reason"
                      className="min-w-0 flex-1 rounded-full border border-edge bg-ink/40 px-3.5 py-2.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-glow/50 focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={!whyCustom.trim()}
                      onClick={() => void submitWhyCustom()}
                      className="shrink-0 rounded-full border border-cyan-glow/50 bg-cyan-glow/10 px-3.5 py-2.5 text-xs font-semibold text-cyan-glow transition-colors hover:bg-cyan-glow/20 disabled:opacity-40"
                    >
                      Add
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Analysis panel: slides in over the PAD, never over the video —
              the frame you are judging has to stay on screen while you
              answer. Same questions as the point view (one component), plus
              a note, on the point that was on screen when you opened it. */}
          {analysisPoint && (
            <div
              {...(floatingPad ? {} : padSwipeHandlers("close"))}
              className="ks-slide-left absolute inset-0 z-20 flex flex-col overflow-y-auto bg-ink"
            >
              <div className="flex items-center justify-between border-b border-edge/60 px-3 py-2.5">
                <h2 className="text-sm font-semibold text-zinc-200">
                  Point {(indexById.get(analysisPoint.id) ?? 0) + 1}
                </h2>
                <button
                  type="button"
                  onClick={closeAnalysisPanel}
                  className="rounded-full border border-edge bg-surface px-3.5 py-1.5 text-xs font-semibold text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white"
                >
                  Done
                </button>
              </div>
              <div className="space-y-3 p-3">
                {/* Only mounted when it has a question to ask. A point you
                    WON asks nothing and an unscored one has no outcome to
                    explain, so the card would render as an empty bordered
                    box above the notes — which reads as something that
                    failed to load rather than as nothing to do. */}
                {hasLossAnalysis(analysisPoint, neutral) && (
                  <PointScorecard
                    key={analysisPoint.id}
                    point={analysisPoint}
                    serve={serving.get(analysisPoint.id)}
                    neutral={neutral}
                    mapLabels={mapLabels}
                    flash={padFlash}
                    variant="analysis"
                    customReasons={customReasons}
                    onCreateCustomReason={onCreateCustomReason}
                    onPointUpdate={(patch) => {
                      setAnalysisPoint((p) =>
                        p ? ({ ...p, ...patch } as Point) : p
                      );
                      onPointUpdate(analysisPoint.id, patch);
                    }}
                  />
                )}
                <div className="rounded-xl border border-edge bg-surface-2/40 p-4">
                  <h3 className="text-sm font-semibold text-zinc-200">Notes</h3>
                  <div className="mt-2 space-y-2.5">
                    <PointTags
                      pointLabel={`Point ${
                        (indexById.get(analysisPoint.id) ?? 0) + 1
                      }`}
                      tags={tagsForPoint(analysisPoint.id)}
                      vocab={tagVocab}
                      onToggle={(tag) => onToggleTag(analysisPoint.id, tag)}
                      onCreate={(label) =>
                        onCreateTag(analysisPoint.id, label)
                      }
                    />
                    <PointNoteThread
                      notes={notes.filter(
                        (n) => n.point_id === analysisPoint.id
                      )}
                      matchId={matchId}
                      ownerId={ownerId}
                      viewerId={userId}
                      authorNames={authorNames}
                    />
                    <NoteComposer
                      matchId={matchId}
                      pointId={analysisPoint.id}
                      userId={userId}
                      placeholder="What did you notice?"
                      onNoteAdded={onNoteAdded}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* "Who won this game?" — right after pinning an end at a score the
          11-clear-by-2 rule can't decide (points lost to a cut, so 10-7
          proves nothing). The answer lands on the closing point
          (game_winner_override) and the games tally counts it; skipping
          leaves the game counted for nobody, which is what happened
          silently before. Undoing the end clears the answer with it. */}
      {open && winnerAsk && (
        <div className="absolute inset-0 z-20 flex items-end justify-center bg-ink/70 p-4 backdrop-blur-sm sm:items-center">
          <div className="ks-fade w-full rounded-2xl border border-edge bg-surface p-5 sm:max-w-xs">
            <h2 className="text-base font-semibold">Who won this game?</h2>
            <p className="mt-1 text-sm leading-snug text-zinc-400">
              The recorded score is{" "}
              <span className="tabular-nums">
                {winnerAsk.you}-{winnerAsk.them}
              </span>
              , which doesn&apos;t decide it. Some points may be missing
              from the video.
            </p>
            <div className="mt-5 flex gap-2.5">
              <button
                type="button"
                onClick={() => {
                  const p = pointsRef.current.find(
                    (pt) => pt.id === winnerAsk.pointId
                  );
                  setWinnerAsk(null);
                  if (!p || !onSetGameWinner) return;
                  onSetGameWinner(p, "user");
                  showFlash(`Game to ${youLabel === "Me" ? "you" : youLabel}`);
                }}
                className="h-12 min-w-0 flex-1 rounded-xl border border-cyan-glow/40 bg-cyan-glow/10 px-2 text-base font-bold text-cyan-glow transition-colors hover:bg-cyan-glow/15"
              >
                <span className="block truncate">{youLabel}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const p = pointsRef.current.find(
                    (pt) => pt.id === winnerAsk.pointId
                  );
                  setWinnerAsk(null);
                  if (!p || !onSetGameWinner) return;
                  onSetGameWinner(p, "opponent");
                  showFlash(`Game to ${themLabel}`);
                }}
                className="h-12 min-w-0 flex-1 rounded-xl border border-magenta-glow/40 bg-magenta-glow/10 px-2 text-base font-bold text-magenta-soft transition-colors hover:bg-magenta-glow/15"
              >
                <span className="block truncate">{themLabel}</span>
              </button>
            </div>
            <button
              type="button"
              onClick={() => setWinnerAsk(null)}
              className="mt-2.5 w-full rounded-full border border-edge px-4 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:text-white"
            >
              Not sure
            </button>
          </div>
        </div>
      )}

      {/* Game break, tapped in the chip strip. Removing holds the game open
          through this point ('continue'), which reads the same whether the
          end came from the score or from a Game ended tap — and it lands
          on the pad's undo stack like every other answer. */}
      {open && gameBreak && (
        <div className="absolute inset-0 z-20 flex items-end justify-center bg-ink/70 p-4 backdrop-blur-sm sm:items-center">
          <div className="ks-fade w-full rounded-2xl border border-edge bg-surface p-5 sm:max-w-xs">
            <h2 className="text-base font-semibold">
              Game {gameBreak.game} ended here
            </h2>
            <p className="mt-1 text-sm tabular-nums text-zinc-400">
              {gameBreak.you}-{gameBreak.them}
            </p>
            {/* A score that can't prove its winner (points lost to a cut)
                gets the question here too, so a game ended from the strip
                — or skipped past in the moment — can still be counted.
                Tapping the named side again clears the answer. */}
            {onSetGameWinner &&
              gameWinner({ you: gameBreak.you, them: gameBreak.them }) ===
                null &&
              (() => {
                const bp = points.find((pt) => pt.id === gameBreak.pointId);
                const named = bp?.game_winner_override ?? null;
                if (!bp) return null;
                return (
                  <div className="mt-4">
                    <p className="text-xs font-medium text-zinc-400">
                      Who won it? The score doesn&apos;t decide.
                    </p>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        aria-pressed={named === "user"}
                        onClick={() =>
                          onSetGameWinner(
                            bp,
                            named === "user" ? null : "user"
                          )
                        }
                        className={`h-10 min-w-0 flex-1 rounded-xl border px-2 text-sm font-bold transition-colors ${
                          named === "user"
                            ? "border-cyan-glow bg-cyan-glow/20 text-cyan-glow"
                            : "border-cyan-glow/30 bg-cyan-glow/5 text-cyan-glow hover:bg-cyan-glow/10"
                        }`}
                      >
                        <span className="block truncate">{youLabel}</span>
                      </button>
                      <button
                        type="button"
                        aria-pressed={named === "opponent"}
                        onClick={() =>
                          onSetGameWinner(
                            bp,
                            named === "opponent" ? null : "opponent"
                          )
                        }
                        className={`h-10 min-w-0 flex-1 rounded-xl border px-2 text-sm font-bold transition-colors ${
                          named === "opponent"
                            ? "border-magenta-glow bg-magenta-glow/20 text-magenta-soft"
                            : "border-magenta-glow/30 bg-magenta-glow/5 text-magenta-soft hover:bg-magenta-glow/10"
                        }`}
                      >
                        <span className="block truncate">{themLabel}</span>
                      </button>
                    </div>
                  </div>
                );
              })()}
            <div className="mt-5 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  const p = pointsRef.current.find(
                    (pt) => pt.id === gameBreak.pointId
                  );
                  setGameBreak(null);
                  if (!p) return;
                  applyGameOverride(p, "continue");
                  showFlash("Game continues");
                }}
                className="rounded-full border border-red-400/40 bg-red-500/5 px-4 py-2.5 text-sm font-semibold text-red-300 transition-colors hover:bg-red-500/10"
              >
                Game didn&apos;t end here
              </button>
              <button
                type="button"
                onClick={() => setGameBreak(null)}
                className="rounded-full border border-edge px-4 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:text-white"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Point picker (watch mode): the chevrons walk one rally at a time,
          which is fine for "again" and useless for "the one near the end
          where I kept missing the push". Same chips as the Keep-score
          strip, so a point's colour means the same thing everywhere: cyan
          you, magenta them, amber skipped, dashed unanswered. */}
      {open && pointPicker && (
        <div className="absolute inset-0 z-20 flex items-end justify-center bg-ink/70 backdrop-blur-sm sm:items-center">
          <div className="ks-fade flex max-h-[70%] w-full flex-col rounded-t-2xl border border-edge bg-surface sm:max-w-md sm:rounded-2xl">
            <div className="flex items-center justify-between px-5 pt-5">
              <h2 className="text-base font-semibold">Jump to a point</h2>
              <button
                type="button"
                onClick={() => setPointPicker(false)}
                className="text-xs text-zinc-500 transition-colors hover:text-zinc-300"
              >
                Close
              </button>
            </div>
            <div
              className="flex flex-wrap gap-2 overflow-y-auto p-5"
              style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
            >
              {points.map((p, i) => {
                if (p.cut_t0 === null) return null;
                const tone = p.is_let
                  ? "border-amber-400/40 bg-amber-400/10 text-amber-300/80"
                  : p.confirmed_winner === "user"
                    ? "border-cyan-glow/60 bg-cyan-glow/20 text-cyan-glow"
                    : p.confirmed_winner === "opponent"
                      ? "border-magenta-glow/60 bg-magenta-glow/20 text-magenta-soft"
                      : "border-dashed border-zinc-600 text-zinc-500";
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setPointPicker(false);
                      pinEndPause(null);
                      endPauseFiredRef.current = null;
                      seekTo(Number(p.cut_t0));
                      playNow(); // same gesture, so iOS allows the play
                    }}
                    aria-label={`Play point ${i + 1}`}
                    aria-current={displayTarget?.id === p.id ? "true" : undefined}
                    className={`flex h-9 w-9 items-center justify-center rounded-full border text-xs font-semibold tabular-nums transition-colors ${tone} ${
                      displayTarget?.id === p.id ? "ring-2 ring-white/80" : ""
                    }`}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Note sheet (watch mode): the thought you had about the point you
          just watched, typed or spoken, without leaving the video. Same
          composer, same notes, as the point view — it attaches to the point
          on screen. The video is already paused by the time this opens. */}
      {/* Frame annotation: draw over the paused frame, then the drawing
          lands in the note sheet below as an attached image. */}
      {open && annotate && (
        <Annotator
          frame={annotate.frame}
          onCancel={() => setAnnotate(null)}
          onSave={async (blob) => {
            const form = new FormData();
            form.append("image", blob, "frame.jpg");
            const res = await fetch("/api/note-image", {
              method: "POST",
              body: form,
            });
            const data = res.ok ? await res.json() : null;
            if (!data?.image_path) throw new Error("upload failed");
            clearPendingImage();
            setPendingImage({
              path: String(data.image_path),
              preview: URL.createObjectURL(blob),
            });
            setNoteSheet(annotate.point);
            setAnnotate(null);
          }}
        />
      )}

      {/* No standalone tag sheet: tagging lives inside the Analysis panel
          (PointTags there), one door for everything recorded on a point
          beyond who won it. */}

      {open && noteSheet && (
        <div className="absolute inset-0 z-20 flex items-end justify-center bg-ink/70 backdrop-blur-sm sm:items-center">
          <div className="ks-fade w-full rounded-t-2xl border border-edge bg-surface p-5 pb-8 sm:max-w-md sm:rounded-2xl sm:pb-5">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-base font-semibold">
                Note on point {(indexById.get(noteSheet.id) ?? 0) + 1}
              </h2>
              <button
                type="button"
                onClick={() => {
                  setNoteSheet(null);
                  clearPendingImage();
                  setCaptureError(null);
                }}
                className="text-xs text-zinc-500 transition-colors hover:text-zinc-300"
              >
                Close
              </button>
            </div>
            <div className="mt-3 max-h-[45vh] space-y-2.5 overflow-y-auto">
              {/* Drawing is part of writing the note, not its own job:
                  the frame on screen is the moment being written about,
                  so the pencil lives here with the words. */}
              {pendingImage ? (
                <div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={pendingImage.preview}
                    alt="Annotated frame, attached to this note"
                    className="w-full rounded-lg border border-edge"
                  />
                  <div className="mt-1.5 flex gap-3 text-[11px] font-medium">
                    <button
                      type="button"
                      onClick={() => {
                        const f = captureFrame();
                        if (!f) {
                          setCaptureError(
                            "This browser couldn't read the frame."
                          );
                          return;
                        }
                        setCaptureError(null);
                        setAnnotate({ point: noteSheet, frame: f });
                      }}
                      className="text-zinc-500 transition-colors hover:text-zinc-300"
                    >
                      Redraw
                    </button>
                    <button
                      type="button"
                      onClick={clearPendingImage}
                      className="text-zinc-500 transition-colors hover:text-red-400"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    const f = captureFrame();
                    if (!f) {
                      setCaptureError(
                        "This browser couldn't read the frame."
                      );
                      return;
                    }
                    setCaptureError(null);
                    setAnnotate({ point: noteSheet, frame: f });
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-edge px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:border-cyan-glow/40 hover:text-white"
                >
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
                      d="M4 20l1-4.5L16.5 4a2.1 2.1 0 0 1 3 0l.5.5a2.1 2.1 0 0 1 0 3L8.5 19 4 20Z"
                    />
                  </svg>
                  Draw on this frame
                </button>
              )}
              {captureError && (
                <p className="text-xs text-amber-300/90">{captureError}</p>
              )}
              <PointTags
                pointLabel={`Point ${(indexById.get(noteSheet.id) ?? 0) + 1}`}
                tags={tagsForPoint(noteSheet.id)}
                vocab={tagVocab}
                onToggle={(tag) => onToggleTag(noteSheet.id, tag)}
                onCreate={(label) => onCreateTag(noteSheet.id, label)}
              />
              <PointNoteThread
                notes={notes.filter((n) => n.point_id === noteSheet.id)}
                matchId={matchId}
                ownerId={ownerId}
                viewerId={userId}
                authorNames={authorNames}
              />
              <NoteComposer
                matchId={matchId}
                pointId={noteSheet.id}
                userId={userId}
                placeholder="What did you notice?"
                imagePath={pendingImage?.path ?? null}
                onNoteAdded={(n) => {
                  onNoteAdded(n);
                  setNoteSheet(null);
                  clearPendingImage();
                }}
              />
            </div>
          </div>
        </div>
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
                  Names show on the scoreboard in shares and exports.
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

      {/* Modify modal: retroactive split / join for the current point.
          Opened from the pad's Modify button; owns its own scrub video so
          the pad's playback state is untouched. */}
      {open && mode === "score" && modifyPoint && (
        <ModifyClip
          point={modifyPoint}
          points={points}
          videoUrl={videoUrl}
          pad={pad}
          initialCut={modifyInitialCut}
          youLabel={youLabel}
          themLabel={themLabel}
          busy={modifyBusy}
          onClose={closeModify}
          onSplit={(cutTimes, segments) =>
            void performSplit(modifyPoint, cutTimes, segments)
          }
          onJoin={(count, winner) => void performJoin(count, winner)}
          onAdjust={(t0, t1) => void performAdjust(t0, t1)}
          adjustLocked={modifyPoint.edited}
        />
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
