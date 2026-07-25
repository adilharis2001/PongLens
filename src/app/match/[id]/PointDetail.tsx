"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { createClient } from "@/lib/supabase/client";
import type { Note, Point } from "@/lib/types";
import { clipPad, effectivePad, TIGHT_PAD } from "./clipEdit";
import { ClipPlayer } from "./ClipPlayer";
import type { GameEndOverride } from "./gameScore";
import {
  PlacementMap,
  hasPlacementBounces,
  type MapLabels,
} from "./PlacementMap";
import { NoteComposer, NoteItem } from "./Notes";
import {
  DIRECTIONS,
  HOW_GROUPS,
  SKIP_REASONS,
  canonicalHow,
  canonicalSkipReason,
  directionApplies,
  directionLabel,
  howLabel,
} from "./scorecard";
import type { ServeInfo } from "./serving";
import { otherSide, physicalSideForGame, type Side } from "./sides";

// The outcome-detail flow is a small in-place wizard that replaces the old
// two-stacked-questions layout: pick HOW it ended, then (only when placement
// is a meaningful signal) WHERE the ball went, then collapse to an editable
// SUMMARY. One question occupies the spot at a time; steps cross-fade.
type FlowStep = "how" | "placement" | "summary";

/**
 * The point detail body: clip, server line, placement, scorecard, notes.
 * Rendered inside the mobile sheet and the desktop split-view pane.
 * Mount with key={point.id} so scorecard state resets per point.
 */
export function PointDetail({
  matchId,
  ownerId,
  point,
  serve,
  notes,
  userId,
  userSide,
  gameIndex,
  gameEnd,
  onSetGameOverride,
  mapLabels,
  neutral = false,
  onSetUserSide,
  strictness,
  nav,
  onPointUpdate,
  onNoteAdded,
  onDelete,
  deleteBefore,
  onSplit,
  onClipEdited,
  onShare,
  onOpenInPlayer,
}: {
  matchId: string;
  ownerId: string;
  point: Point;
  serve: ServeInfo | undefined;
  notes: Note[];
  userId: string;
  userSide: Side | null;
  /** 0-based game this point belongs to (players change ends each game). */
  gameIndex: number;
  /** Game-boundary walk facts for THIS point (from computeMatchScore):
   * endsHere — a game closes after this point (auto or 'end' override);
   * openHere — a prior 'continue' still holds the game open here. */
  gameEnd: { endsHere: boolean; openHere: boolean };
  /** Write this point's game_end_override ('end' | 'continue' | null =
   * auto). Optimistic in MatchView; resolves false on a failed save. */
  onSetGameOverride: (v: GameEndOverride) => Promise<boolean>;
  mapLabels: MapLabels;
  /** Neutral / third-party match (see MatchView's `neutral`): the scorecard
   * names the two players instead of "Me"/"Them"/"I won". Normal = false. */
  neutral?: boolean;
  /** Owner-only: set matches.user_side from the map's orientation prompt
   * while untagged (same write PlayerTagging uses). Absent for coaches. */
  onSetUserSide?: (side: Side) => void;
  strictness: string;
  /** Prev/next point navigation, rendered as chevrons flanking the clip.
   * Hidden while editing timing (the native scrubber needs the space). */
  nav?: {
    hasPrev: boolean;
    hasNext: boolean;
    onPrev: () => void;
    onNext: () => void;
  };
  onPointUpdate: (patch: Partial<Point>) => void;
  onNoteAdded: (note: Note) => void;
  onDelete: (point: Point) => void;
  /** Bulk "delete everything before this point" — warm-up rallies and
   * mid-session breaks. Only passed when the owner has ≥2 earlier visible
   * points; confirmation is inline here, onConfirm does the batched write. */
  deleteBefore?: { count: number; onConfirm: () => void };
  onSplit: (newPoint: Point) => void;
  onClipEdited: () => void;
  /** Open the public-link ShareSheet for this point (owner only). */
  onShare?: () => void;
  /** Jump to this point's moment in the full-match Player. */
  onOpenInPlayer?: () => void;
}) {
  const isOwner = ownerId === userId;
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Clip edit mode: draft t0/t1 on the SOURCE-VIDEO timeline. The clip file
  // spans [max(0, t0 - pre), t1 + post] (context padding by strictness,
  // except split-boundary edges which are cut tight — see effectivePad), so
  // clipBase maps <video> playhead seconds back onto source seconds. If a
  // reclip is still pending the clip on screen was cut with the previous
  // t0/t1 and the mapping is approximate until the worker catches up.
  const pad = clipPad(strictness);
  // Pads the CURRENT clip file was cut with. Derived from the point's
  // tight_start/tight_end flags rather than from clip duration: the flags
  // are the same input the worker cut from, while duration is unavailable
  // until metadata loads and ambiguous while a reclip is pending.
  const filePad = effectivePad(pad, point.tight_start, point.tight_end);
  const [editing, setEditing] = useState(false);
  const [t0d, setT0d] = useState(0);
  const [t1d, setT1d] = useState(0);
  const [clipBase, setClipBase] = useState(0);
  const [savingEdit, setSavingEdit] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const hasTiming = point.t0 !== null && point.t1 !== null;
  const editDirty =
    hasTiming && (t0d !== Number(point.t0) || t1d !== Number(point.t1));
  // Pads the NEXT clip will be cut with under the current draft: manually
  // re-timing a split-boundary edge clears its tight flag on save, so a
  // moved edge previews (and saves) with the full strictness pad again.
  const draftPad = effectivePad(
    pad,
    point.tight_start && t0d === Number(point.t0),
    point.tight_end && t1d === Number(point.t1)
  );
  // A reclip is in flight for this point: the clip on screen no longer
  // matches t0/t1, so stacking further timing edits on it would be editing
  // blind. Clip-editing actions lock (standard disabled look — the pulsing
  // "Updating clip" badge already explains why) until the worker clears
  // `edited`; MatchView's pending-clips poll refreshes the flag every ~8s
  // whenever any point has edited=true, so the lock releases on its own.
  const clipLocked = point.edited;

  // Scorecard state. One outcome per point: you won / they won / skipped
  // (is_let). Chips reflect only what's confirmed — with taps saving
  // immediately, a prefilled-but-unsaved selection would lie.
  const [outcome, setOutcome] = useState<"user" | "opponent" | "skip" | null>(
    point.is_let ? "skip" : point.confirmed_winner
  );
  // confirmed_how partitions by outcome: winner-hows vs skip reasons.
  const [how, setHow] = useState<string>(
    point.is_let
      ? canonicalSkipReason(point.confirmed_how)
      : point.confirmed_how
        ? canonicalHow(point.confirmed_how)
        : ""
  );
  const [savedFlash, setSavedFlash] = useState(false);
  const savedTimer = useRef<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();

  // Placement of the deciding ball (fh/bh/mid), its own column. Independent
  // of the outcome; captured as the second step of the flow below.
  const [direction, setDirection] = useState<string>(point.direction ?? "");

  // Which step of the outcome-detail wizard is on screen. On mount we land on
  // the SUMMARY when a how is already recorded (no re-nagging on revisit) and
  // on HOW otherwise. The placement step is only ever reached live — right
  // after a placement-relevant how is tapped, or via the summary's edit.
  const [flowStep, setFlowStep] = useState<FlowStep>(() =>
    (point.is_let ? "skip" : point.confirmed_winner) &&
    !point.is_let &&
    point.confirmed_how
      ? "summary"
      : "how"
  );

  // Confirmed scored outcome (what the boundary walk actually counts) —
  // the game-boundary line below only ever shows on these points.

  // Inline confirm for "Delete all before" (no browser confirm()). Keyed
  // mount (key={point.id}) resets it whenever the point changes.
  const [confirmingBefore, setConfirmingBefore] = useState(false);

  // Every explicit interaction saves immediately — there is no
  // Confirm/Update button. One atomic write per change
  // (winner and is_let are mutually exclusive — DB constraint
  // points_let_never_scored — so both sides of the pair travel together).
  const writeScorecard = useCallback(
    async (patch: {
      confirmed_winner: "user" | "opponent" | null;
      confirmed_how: string | null;
      is_let: boolean;
    }) => {
      setSaveError(null);
      const supabase = createClient();
      const { error } = await supabase
        .from("points")
        .update(patch)
        .eq("id", point.id);
      if (error) {
        setSaveError("Couldn't save. Tap again.");
        return;
      }
      onPointUpdate(patch);
      setSavedFlash(true);
      if (savedTimer.current) window.clearTimeout(savedTimer.current);
      savedTimer.current = window.setTimeout(() => setSavedFlash(false), 1500);
    },
    [point.id, onPointUpdate]
  );

  // Game-boundary override tap ("It didn't" / "Game ended here?" /
  // "End game here" / their Undos). The write lives in MatchView
  // (optimistic, shared with Keep score); here we only flash Saved or
  // surface the failure like every other scorecard tap.
  const pickGameEnd = useCallback(
    async (v: GameEndOverride) => {
      setSaveError(null);
      const ok = await onSetGameOverride(v);
      if (!ok) {
        setSaveError("Couldn't save. Tap again.");
        return;
      }
      setSavedFlash(true);
      if (savedTimer.current) window.clearTimeout(savedTimer.current);
      savedTimer.current = window.setTimeout(() => setSavedFlash(false), 1500);
    },
    [onSetGameOverride]
  );

  const pickOutcome = useCallback(
    (next: "user" | "opponent" | "skip") => {
      const confirmedOutcome: "user" | "opponent" | "skip" | null =
        point.is_let ? "skip" : point.confirmed_winner;
      if (next === confirmedOutcome) {
        // Tapping the confirmed outcome clears it (same as timeline rows).
        setOutcome(null);
        setHow("");
        setFlowStep("how");
        void writeScorecard({
          confirmed_winner: null,
          confirmed_how: null,
          is_let: false,
        });
        return;
      }
      // Switching between the winner and skip partitions drops a how that
      // isn't valid on the other side.
      const nextHow =
        next === "skip" ? canonicalSkipReason(how) : canonicalHow(how);
      setOutcome(next);
      setHow(nextHow);
      // A fresh winner side re-opens the flow: straight to summary if a how
      // carried over, otherwise ask how first. (Skip has its own UI.)
      setFlowStep(next !== "skip" && nextHow ? "summary" : "how");
      void writeScorecard(
        next === "skip"
          ? { confirmed_winner: null, confirmed_how: nextHow || null, is_let: true }
          : { confirmed_winner: next, confirmed_how: nextHow || null, is_let: false }
      );
    },
    [point.is_let, point.confirmed_winner, how, writeScorecard]
  );

  // Low-level write of the placement column, shared by the placement chips
  // and the "drop stale placement" path when a non-placement how is chosen.
  const saveDirection = useCallback(
    async (next: string) => {
      const prev = direction;
      setDirection(next);
      setSaveError(null);
      const supabase = createClient();
      const { error } = await supabase
        .from("points")
        .update({ direction: next || null })
        .eq("id", point.id);
      if (error) {
        setSaveError("Couldn't save. Tap again.");
        setDirection(prev);
        return false;
      }
      onPointUpdate({ direction: (next || null) as Point["direction"] });
      setSavedFlash(true);
      if (savedTimer.current) window.clearTimeout(savedTimer.current);
      savedTimer.current = window.setTimeout(() => setSavedFlash(false), 1500);
      return true;
    },
    [direction, point.id, onPointUpdate]
  );

  const pickHow = useCallback(
    (v: string) => {
      setHow(v);
      if (outcome) {
        void writeScorecard(
          outcome === "skip"
            ? { confirmed_winner: null, confirmed_how: v || null, is_let: true }
            : {
                confirmed_winner: outcome,
                confirmed_how: v || null,
                is_let: false,
              }
        );
      }
      // Skip keeps its flat toggle UI; only the winner flow advances.
      if (!outcome || outcome === "skip") return;
      if (directionApplies(v)) {
        // Placement is a meaningful signal here — ask where it went next.
        setFlowStep("placement");
      } else {
        // Luck / "other": placement doesn't inform anything. Drop any stale
        // direction so the data and summary don't carry a placement that no
        // longer applies, and finalize straight to the summary.
        if (direction) void saveDirection("");
        setFlowStep("summary");
      }
    },
    [outcome, direction, writeScorecard, saveDirection]
  );

  // Placement step: a tap picks fh/bh/mid (or "na" to dismiss) and finalizes
  // to the summary. No toggle — the flow always moves forward from here.
  const pickPlacement = useCallback(
    async (v: "fh" | "bh" | "mid" | "na") => {
      const ok = await saveDirection(v === "na" ? "" : v);
      if (ok) setFlowStep("summary");
    },
    [saveDirection]
  );

  // "Who served?" — writes server_override; the ITTF rotation re-anchors
  // from the most recent override, so one fix heals later points too.
  const pickServer = useCallback(
    async (v: "user" | "opponent") => {
      if (serve?.server === v) return; // already showing this server
      setSaveError(null);
      const supabase = createClient();
      const { error } = await supabase
        .from("points")
        .update({ server_override: v })
        .eq("id", point.id);
      if (error) {
        setSaveError("Couldn't save. Tap again.");
        return;
      }
      onPointUpdate({ server_override: v });
      setSavedFlash(true);
      if (savedTimer.current) window.clearTimeout(savedTimer.current);
      savedTimer.current = window.setTimeout(() => setSavedFlash(false), 1500);
    },
    [serve?.server, point.id, onPointUpdate]
  );

  useEffect(() => {
    let cancelled = false;
    setVideoUrl(null);
    setVideoError(null);
    if (!point.clip_path) {
      setVideoError("No clip for this point.");
      return;
    }
    (async () => {
      try {
        const res = await fetch("/api/media-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ matchId, pointId: point.id }),
        });
        const data = res.ok ? await res.json() : null;
        if (!data?.url) throw new Error("no url");
        if (!cancelled) setVideoUrl(data.url);
      } catch {
        if (!cancelled) setVideoError("Couldn't load the clip. Try again.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [matchId, point.id, point.clip_path]);

  const startEditing = useCallback(() => {
    if (!hasTiming) return;
    const t0 = Number(point.t0);
    setT0d(t0);
    setT1d(Number(point.t1));
    setClipBase(Math.max(0, t0 - filePad.pre));
    setEditError(null);
    setEditing(true);
  }, [hasTiming, point.t0, point.t1, filePad.pre]);

  // Keep playback inside the window the NEW clip will cover, so nudges
  // preview live. Footage outside the current clip file can't preview until
  // the reclip lands; we clamp to what exists.
  const previewClamp = useCallback(
    (v: HTMLVideoElement) => {
      if (!editing) return;
      const lo = Math.max(0, t0d - draftPad.pre - clipBase);
      const hi = Math.max(lo + 0.2, t1d + draftPad.post - clipBase);
      if (v.currentTime < lo - 0.1) v.currentTime = lo;
      if (v.currentTime > hi) {
        v.pause();
        v.currentTime = hi;
      }
    },
    [editing, t0d, t1d, clipBase, draftPad.pre, draftPad.post]
  );

  // Seek targets below use the FULL pads on purpose: a nudged edge loses
  // its tight flag on save, so full context is what the next clip covers;
  // previewClamp then bounds the seek to what draftPad actually allows.
  const nudge = useCallback(
    (which: "start" | "end", delta: number) => {
      setEditError(null);
      const v = videoRef.current;
      if (which === "start") {
        const next = Math.min(Math.max(0, t0d + delta), t1d - 0.5);
        setT0d(next);
        if (v) v.currentTime = Math.max(0, next - pad.pre - clipBase);
      } else {
        const next = Math.max(t1d + delta, t0d + 0.5);
        setT1d(next);
        if (v) {
          const hi = Math.max(0, next + pad.post - clipBase);
          v.currentTime = Math.max(0, Math.min(hi, v.duration || hi) - 2);
          void v.play().catch(() => undefined);
        }
      }
    },
    [t0d, t1d, clipBase, pad.pre, pad.post]
  );

  const saveTiming = useCallback(async (): Promise<boolean> => {
    setSavingEdit(true);
    setEditError(null);
    // Manually re-timing a split-boundary edge dissolves that boundary:
    // clear its tight flag so the reclip pads the moved edge with the full
    // strictness context again (draftPad previews exactly this).
    const patch: Partial<Point> = { t0: t0d, t1: t1d };
    if (point.tight_start && t0d !== Number(point.t0)) patch.tight_start = false;
    if (point.tight_end && t1d !== Number(point.t1)) patch.tight_end = false;
    const supabase = createClient();
    const { error } = await supabase
      .from("points")
      .update(patch)
      .eq("id", point.id);
    setSavingEdit(false);
    if (error) {
      setEditError("Couldn't save the timing. Try again.");
      return false;
    }
    // a DB trigger marks the point edited on any t0/t1 change
    onPointUpdate({ ...patch, edited: true });
    onClipEdited();
    return true;
  }, [
    t0d,
    t1d,
    point.id,
    point.t0,
    point.t1,
    point.tight_start,
    point.tight_end,
    onPointUpdate,
    onClipEdited,
  ]);

  const splitHere = useCallback(async () => {
    const v = videoRef.current;
    if (!v || splitting) return;
    const at = Math.round((clipBase + v.currentTime) * 100) / 100;
    if (at < t0d + 0.3 || at > t1d - 0.3) {
      setEditError(
        "Play to the moment the next point starts, then split. The playhead is outside this point right now."
      );
      return;
    }
    setSplitting(true);
    setEditError(null);
    // persist unsaved nudges first so the split works off the same numbers
    if (editDirty && !(await saveTiming())) {
      setSplitting(false);
      return;
    }
    // Child cut_t0 — the child's PADDED start inside the cut video. The
    // cut keeps source durations intact within an activity span, so any
    // source time x inside the parent's span maps to
    //   cut(x) = parent_cut_t0 + (x - parentPaddedSrcStart)
    // where parentPaddedSrcStart = max(0, parent_t0 - parentEffPre) is the
    // source moment the parent's cut_t0 is anchored on (filePad.pre: full
    // strictness pre, or TIGHT_PAD if the parent is itself split-born).
    // The child's start edge is a split boundary (tight_start), padded
    // with min(pre, TIGHT_PAD), so its anchor is at - that sliver:
    //   child_cut_t0 = cut(at - min(pre, TIGHT_PAD))
    // Legacy parents without cut_t0 (pre-011 cuts) keep the child at null.
    const childCutT0 =
      point.cut_t0 === null || point.t0 === null
        ? null
        : Math.round(
            (Number(point.cut_t0) +
              (at - Math.min(pad.pre, TIGHT_PAD)) -
              Math.max(0, Number(point.t0) - filePad.pre)) *
              100
          ) / 100;
    const supabase = createClient();
    const { data, error } = await supabase.rpc("split_point", {
      p_id: point.id,
      at_t: at,
      child_cut_t0: childCutT0,
    });
    setSplitting(false);
    if (error || !data) {
      setEditError("Couldn't split the point. Try again.");
      return;
    }
    setT1d(at);
    // the RPC set tight_end on the parent — its new t1 IS the shared
    // split boundary, so the next reclip cuts it tight there
    onPointUpdate({ t1: at, edited: true, tight_end: true });
    onSplit(data as Point);
    onClipEdited();
    setEditing(false);
  }, [
    splitting,
    clipBase,
    t0d,
    t1d,
    editDirty,
    saveTiming,
    point.id,
    point.cut_t0,
    point.t0,
    pad.pre,
    filePad.pre,
    onPointUpdate,
    onSplit,
    onClipEdited,
  ]);

  // Scorecard actor labels for the pick buttons: "Me"/"Them" normally, the
  // two players' names in a neutral / third-party match (mapLabels carries
  // the names). Normal wording is untouched.
  const youLabel = neutral ? mapLabels.you : "Me";
  const themLabel = neutral ? mapLabels.them : "Them";

  // Group labels follow the selected winner so "They missed" reads right.
  // Neutral names the actor; normal keeps the "I"/"They" pronouns.
  const groupLabel = (g: (typeof HOW_GROUPS)[number]) => {
    if (g.id === "miss") {
      if (neutral)
        return outcome === "opponent"
          ? `${mapLabels.you} missed`
          : `${mapLabels.them} missed`;
      return outcome === "opponent" ? "I missed" : "They missed";
    }
    if (g.id === "won") {
      if (outcome !== "opponent" && outcome !== "user") return "Won it";
      if (neutral)
        return outcome === "opponent"
          ? `${mapLabels.them} won it`
          : `${mapLabels.you} won it`;
      return outcome === "opponent" ? "They won it" : "I won it";
    }
    return g.label;
  };

  // Placement follow-up: only meaningful for hows where the ball was aimed.
  const placementRelevant = directionApplies(how);
  // The question adapts to who won — "they" placed it on your side, or "you"
  // placed it on theirs — so the answer reads as tactical intent either way.
  const placementActor =
    outcome === "opponent"
      ? neutral
        ? mapLabels.them
        : "they"
      : neutral
        ? mapLabels.you
        : "you";
  const placementPrompt = `Where did ${placementActor} place the ball to win the point?`;
  const placementValueLabel = directionLabel(direction);

  // Cross-fade the wizard step in place; a plain fade when motion is reduced.
  const stepMotion = reduceMotion
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { duration: 0.12 },
      }
    : {
        initial: { opacity: 0, y: 6 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -6 },
        transition: { duration: 0.18, ease: "easeOut" as const },
      };

  return (
    <div className="space-y-6">
      {/* clip */}
      <div className="relative overflow-hidden rounded-xl border border-edge bg-ink">
        {videoUrl ? (
          editing ? (
            // Editing keeps the native scrubber for frame-accurate nudges.
            <video
              ref={videoRef}
              src={videoUrl}
              controls
              playsInline
              autoPlay
              preload="metadata"
              onTimeUpdate={(e) => previewClamp(e.currentTarget)}
              className="max-h-[45vh] w-full bg-black lg:max-h-[52vh]"
            />
          ) : (
            <ClipPlayer src={videoUrl} />
          )
        ) : !point.clip_path && point.edited ? (
          <div className="flex aspect-video animate-pulse items-center justify-center bg-surface-2/40">
            <p className="text-sm text-zinc-400">Updating clip…</p>
          </div>
        ) : !point.clip_path && hasTiming ? (
          <p className="p-6 text-center text-sm text-zinc-400">
            Clip unavailable — the original video has expired, but your
            timing edits are saved.
          </p>
        ) : videoError ? (
          <p className="p-6 text-center text-sm text-red-300">{videoError}</p>
        ) : (
          <div className="flex aspect-video items-center justify-center">
            <p className="text-sm text-zinc-500">Loading clip…</p>
          </div>
        )}
        {videoUrl && point.edited && (
          <span className="pointer-events-none absolute right-2 top-2 animate-pulse rounded-full border border-cyan-glow/40 bg-ink/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-cyan-glow">
            Updating clip
          </span>
        )}
        {/* prev/next chevrons flank the clip — the video is where the eyes
            are, so navigation lives on it. Vertically centered: clear of
            the mute toggle (top-right) and the progress bar (bottom). Only
            their own circles catch taps; the rest of the surface stays
            ClipPlayer's tap-to-play. Hidden while editing (native controls
            own the frame). */}
        {nav && !editing && nav.hasPrev && (
          <button
            type="button"
            onClick={nav.onPrev}
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
              <path strokeLinecap="round" strokeLinejoin="round" d="m15 6-6 6 6 6" />
            </svg>
          </button>
        )}
        {nav && !editing && nav.hasNext && (
          <button
            type="button"
            onClick={nav.onNext}
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
              <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
            </svg>
          </button>
        )}
      </div>

      {/* clip actions */}
      {isOwner && (
        <div>
          <div className="flex flex-wrap items-center gap-3">
          {isOwner && (
            <div className="ml-auto flex items-center gap-1.5">
              {/* Share is THE action on a point (the one prominent button);
                  Edit clip and the trash stay secondary beside it */}
              {onShare && !editing && (
                <button
                  type="button"
                  onClick={onShare}
                  className="glow-cta rounded-full bg-cyan-glow px-3.5 py-1.5 text-xs font-semibold text-ink"
                >
                  Share
                </button>
              )}
              {hasTiming && !editing && (
                <button
                  type="button"
                  onClick={startEditing}
                  disabled={clipLocked}
                  className="rounded-full border border-edge px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white disabled:pointer-events-none disabled:opacity-50"
                >
                  Edit clip
                </button>
              )}
              {/* jump to this moment in the full match (the Player) */}
              {onOpenInPlayer && !editing && (
                <button
                  type="button"
                  onClick={onOpenInPlayer}
                  aria-label="Watch in full video"
                  title="Watch in full video"
                  className="rounded-full border border-edge p-2 text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <rect x="3" y="6" width="18" height="12" rx="2" />
                    <path d="M10 9.5v5l4.5-2.5-4.5-2.5Z" fill="currentColor" stroke="none" />
                  </svg>
                </button>
              )}
              {/* direct single-tap soft delete (undo lives in the
                  snackbar + Removed section); icon-only — the trash
                  says it, the aria-label/tooltip keep it accessible */}
              <button
                type="button"
                onClick={() => onDelete(point)}
                aria-label="Not a point"
                title="Not a point"
                className="rounded-full border border-red-400/40 bg-red-500/10 p-2 text-red-300 transition-colors hover:border-red-400/70 hover:text-red-200"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
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
              </button>
            </div>
          )}
          </div>

          {/* bulk cleanup: everything before this point in one gesture
              (warm-up rallies, mid-session breaks). Deliberately quiet —
              a muted text button under the action row; tapping swaps it
              for an inline confirm, and the snackbar Undo restores the
              whole set afterwards. */}
          {deleteBefore && !editing && (
            <div className="mt-2 flex min-h-[1.75rem] flex-wrap items-center justify-end gap-3">
              {confirmingBefore ? (
                <>
                  <span className="text-xs text-zinc-400">
                    Delete {deleteBefore.count} earlier point
                    {deleteBefore.count === 1 ? "" : "s"}?
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmingBefore(false);
                      deleteBefore.onConfirm();
                    }}
                    className="rounded-full border border-red-400/50 bg-red-500/15 px-3 py-1.5 text-xs font-semibold text-red-300 transition-colors hover:border-red-400/80 hover:text-red-200"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingBefore(false)}
                    className="text-xs text-zinc-500 transition-colors hover:text-zinc-300"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingBefore(true)}
                  className="text-xs text-zinc-500 transition-colors hover:text-zinc-300"
                >
                  Delete all before
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* clip edit mode: nudge start/end + split (owner only) */}
      {isOwner && editing && (
        <section className="rounded-xl border border-cyan-glow/30 bg-surface-2/40 p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-semibold text-zinc-200">
              Fix clip timing
            </h3>
            <span className="text-xs tabular-nums text-zinc-500">
              {(t1d - t0d).toFixed(1)}s
            </span>
          </div>

          {(["start", "end"] as const).map((which) => (
            <div
              key={which}
              className="mt-3 flex items-center justify-between gap-3"
            >
              <span className="w-10 text-xs font-medium capitalize text-zinc-400">
                {which}
              </span>
              <span className="text-xs tabular-nums text-zinc-500">
                {(which === "start" ? t0d : t1d).toFixed(1)}s
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => nudge(which, -1)}
                  disabled={clipLocked}
                  className="rounded-lg border border-edge bg-ink/40 px-3.5 py-2 text-sm font-semibold text-zinc-200 transition-colors hover:border-cyan-glow/40 disabled:pointer-events-none disabled:opacity-50"
                >
                  -1s
                </button>
                <button
                  type="button"
                  onClick={() => nudge(which, 1)}
                  disabled={clipLocked}
                  className="rounded-lg border border-edge bg-ink/40 px-3.5 py-2 text-sm font-semibold text-zinc-200 transition-colors hover:border-cyan-glow/40 disabled:pointer-events-none disabled:opacity-50"
                >
                  +1s
                </button>
              </div>
            </div>
          ))}

          {t0d - draftPad.pre < clipBase - 0.05 && (
            <p className="mt-2 text-[11px] text-zinc-500">
              The earlier footage isn&apos;t in the current clip — it shows
              once the clip updates.
            </p>
          )}

          <button
            type="button"
            onClick={() => void splitHere()}
            disabled={splitting || clipLocked}
            className="mt-4 w-full rounded-lg border border-edge bg-ink/40 px-4 py-2.5 text-sm font-semibold text-zinc-200 transition-colors hover:border-cyan-glow/40 disabled:pointer-events-none disabled:opacity-50"
          >
            {splitting ? "Splitting…" : "Split at this moment"}
          </button>
          <p className="mt-1.5 text-[11px] text-zinc-500">
            Two rallies in one clip? Play to where the second one starts,
            then split.
          </p>

          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              disabled={savingEdit || !editDirty || clipLocked}
              onClick={() => {
                void saveTiming().then((ok) => {
                  if (ok) setEditing(false);
                });
              }}
              className="rounded-full bg-cyan-glow px-5 py-2 text-sm font-semibold text-ink disabled:pointer-events-none disabled:opacity-50"
            >
              {savingEdit ? "Saving…" : "Save timing"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="text-sm text-zinc-500 hover:text-zinc-300"
            >
              {editDirty ? "Cancel" : "Done"}
            </button>
          </div>
          {editError && (
            <p className="mt-2 text-xs text-red-400">{editError}</p>
          )}
        </section>
      )}

      {/* scorecard: the owner's call, hidden for coach viewers.
          Ordered the way a point unfolds: serve → outcome → how. */}
      {isOwner && (
        <section className="rounded-xl border border-edge bg-surface-2/40 p-4">
          <h3 className="text-sm font-semibold text-zinc-200">Who served?</h3>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              aria-pressed={serve?.server === "user"}
              onClick={() => pickServer("user")}
              className={`rounded-lg border px-4 py-2 text-sm font-semibold transition-colors ${
                serve?.server === "user"
                  ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                  : "border-edge bg-ink/40 text-zinc-300 hover:border-cyan-glow/40"
              }`}
            >
              <span className="block truncate">{youLabel}</span>
            </button>
            <button
              type="button"
              aria-pressed={serve?.server === "opponent"}
              onClick={() => pickServer("opponent")}
              className={`rounded-lg border px-4 py-2 text-sm font-semibold transition-colors ${
                serve?.server === "opponent"
                  ? "border-magenta-glow/60 bg-magenta-glow/15 text-magenta-soft"
                  : "border-edge bg-ink/40 text-zinc-300 hover:border-magenta-glow/40"
              }`}
            >
              <span className="block truncate">{themLabel}</span>
            </button>
          </div>

          <h3 className="mt-5 text-sm font-semibold text-zinc-200">
            Who won this point?
          </h3>

          <div className="mt-3 grid grid-cols-3 gap-2">
            {(
              [
                { value: "user", label: youLabel },
                { value: "opponent", label: themLabel },
                { value: "skip", label: "Skip" },
              ] as const
            ).map((o) => (
              <button
                key={o.value}
                type="button"
                aria-pressed={outcome === o.value}
                onClick={() => pickOutcome(o.value)}
                className={`min-w-0 rounded-lg border px-4 py-2.5 text-sm font-semibold transition-colors ${
                  outcome === o.value
                    ? o.value === "skip"
                      ? "border-amber-400/60 bg-amber-400/10 text-amber-300"
                      : "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                    : "border-edge bg-ink/40 text-zinc-300 hover:border-cyan-glow/40"
                }`}
              >
                <span className="block truncate">{o.label}</span>
              </button>
            ))}
          </div>

          {/* Skip keeps a flat one-tap reason list — no placement, no flow.
              A skipped ball never scored, so "where did it go" is moot. */}
          {outcome === "skip" && (
            <div className="mt-5">
              <span className="text-sm font-semibold text-zinc-200">
                Why skip it?
              </span>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {SKIP_REASONS.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => pickHow(how === r.value ? "" : r.value)}
                    aria-pressed={how === r.value}
                    className={`rounded-full border px-3.5 py-2 text-xs font-medium transition-colors ${
                      how === r.value
                        ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                        : "border-edge bg-ink/40 text-zinc-300 hover:border-cyan-glow/40"
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Winner points: a small in-place wizard. HOW it ended → (only when
              placement is a real tactical signal) WHERE the ball went → an
              editable SUMMARY. One question owns the spot at a time; steps
              cross-fade so it never feels like stacked forms. */}
          {(outcome === "user" || outcome === "opponent") && (
            <div className="mt-5">
              <AnimatePresence mode="wait" initial={false}>
                {flowStep === "how" && (
                  <motion.div key="how" {...stepMotion}>
                    <span className="text-sm font-semibold text-zinc-200">
                      How did it end?
                    </span>
                    <div className="mt-2.5 space-y-3">
                      {HOW_GROUPS.map((g) => (
                        <div key={g.id}>
                          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                            {groupLabel(g)}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {g.options.map((o) => (
                              <button
                                key={o.value}
                                type="button"
                                onClick={() => pickHow(o.value)}
                                aria-pressed={how === o.value}
                                className={`rounded-full border px-3.5 py-2 text-xs font-medium transition-colors ${
                                  how === o.value
                                    ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                                    : "border-edge bg-ink/40 text-zinc-300 hover:border-cyan-glow/40"
                                }`}
                              >
                                {o.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}

                {flowStep === "placement" && (
                  <motion.div key="placement" {...stepMotion}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-semibold text-zinc-200">
                        {placementPrompt}
                      </span>
                      <button
                        type="button"
                        onClick={() => setFlowStep("how")}
                        className="shrink-0 text-xs text-zinc-500 transition-colors hover:text-zinc-300"
                      >
                        Back
                      </button>
                    </div>
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      {DIRECTIONS.map((d) => (
                        <button
                          key={d.value}
                          type="button"
                          onClick={() => void pickPlacement(d.value)}
                          aria-pressed={direction === d.value}
                          className={`rounded-full border px-3.5 py-2 text-xs font-medium transition-colors ${
                            direction === d.value
                              ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                              : "border-edge bg-ink/40 text-zinc-300 hover:border-cyan-glow/40"
                          }`}
                        >
                          {d.label}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => void pickPlacement("na")}
                        className="rounded-full border border-dashed border-edge bg-transparent px-3.5 py-2 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-300"
                      >
                        Not applicable
                      </button>
                    </div>
                  </motion.div>
                )}

                {flowStep === "summary" && (
                  <motion.div key="summary" {...stepMotion} className="space-y-2">
                    <button
                      type="button"
                      onClick={() => setFlowStep("how")}
                      className="flex w-full items-center justify-between gap-3 rounded-lg border border-edge bg-ink/40 px-3.5 py-2.5 text-left transition-colors hover:border-cyan-glow/40"
                    >
                      <span className="min-w-0">
                        <span className="block text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                          How it ended
                        </span>
                        <span className="mt-0.5 block truncate text-sm font-medium text-zinc-100">
                          {howLabel(how) ?? "Not sure yet"}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs font-medium text-cyan-glow">
                        Edit
                      </span>
                    </button>

                    {placementRelevant && (
                      <button
                        type="button"
                        onClick={() => setFlowStep("placement")}
                        className="flex w-full items-center justify-between gap-3 rounded-lg border border-edge bg-ink/40 px-3.5 py-2.5 text-left transition-colors hover:border-cyan-glow/40"
                      >
                        <span className="min-w-0">
                          <span className="block text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                            Placement
                          </span>
                          <span
                            className={`mt-0.5 block truncate text-sm font-medium ${
                              placementValueLabel
                                ? "text-zinc-100"
                                : "text-zinc-500"
                            }`}
                          >
                            {placementValueLabel ?? "Not recorded"}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs font-medium text-cyan-glow">
                          {placementValueLabel ? "Edit" : "Add"}
                        </span>
                      </button>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          <div className="mt-3 flex h-4 items-center gap-3 text-xs">
            {savedFlash && <span className="text-emerald-400">Saved</span>}
            {saveError && <span className="text-red-400">{saveError}</span>}
            {/* the always-available inverse fix, deliberately tiny: any
                visible point with no override and no boundary context can
                be pinned as a game's last point (the game was over before
                the auto rule would fire) — the walk honors overrides
                positionally even on unscored/skipped points. The richer
                contextual line below replaces this in its cases. */}
            {point.game_end_override === null &&
              !gameEnd.endsHere &&
              !gameEnd.openHere && (
                <button
                  type="button"
                  onClick={() => void pickGameEnd("end")}
                  className="ml-auto text-xs text-zinc-600 transition-colors hover:text-zinc-400"
                >
                  End game here
                </button>
              )}
          </div>

          {/* game boundary, the quiet contextual line. The walk
              (gameScore.ts) is the authority; this only narrates it for
              THIS point and offers the one correction that makes sense:
              - auto boundary → "Game ends here · It didn't" (holds the
                game open with 'continue');
              - 'continue' here → "Game continues · Undo";
              - game held open by an earlier 'continue' → a quiet
                "Game ended here?" (pins 'end' on this point);
              - explicit 'end' here → "Game ends here · Undo".
              Taps auto-save (Saved flash above). Overrides are
              positional — they narrate on unscored/skipped points too. */}
          {(point.game_end_override !== null ||
            gameEnd.endsHere ||
            gameEnd.openHere) && (
              <div className="mt-2 flex h-4 items-center gap-2 text-xs">
                {point.game_end_override === "continue" ? (
                  <>
                    <span className="text-zinc-500">Game continues</span>
                    <button
                      type="button"
                      onClick={() => void pickGameEnd(null)}
                      className="text-zinc-600 underline underline-offset-2 transition-colors hover:text-zinc-400"
                    >
                      Undo
                    </button>
                  </>
                ) : point.game_end_override === "end" ? (
                  <>
                    <span className="text-zinc-500">Game ends here</span>
                    <button
                      type="button"
                      onClick={() => void pickGameEnd(null)}
                      className="text-zinc-600 underline underline-offset-2 transition-colors hover:text-zinc-400"
                    >
                      Undo
                    </button>
                  </>
                ) : gameEnd.endsHere ? (
                  <>
                    <span className="text-zinc-500">Game ends here</span>
                    <button
                      type="button"
                      onClick={() => void pickGameEnd("continue")}
                      className="text-zinc-600 underline underline-offset-2 transition-colors hover:text-zinc-400"
                    >
                      It didn&apos;t
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => void pickGameEnd("end")}
                    className="text-zinc-600 underline underline-offset-2 transition-colors hover:text-zinc-400"
                  >
                    Game ended here?
                  </button>
                )}
              </div>
            )}
        </section>
      )}

      {/* placement — below the scorecard so the score controls are reachable
          the moment the point opens, without scrolling past the map */}
      {hasPlacementBounces(point.placement) && (
        <section>
          <h3 className="text-sm font-semibold text-zinc-200">
            Where the ball landed
          </h3>
          <div className="mt-3 rounded-xl border border-edge bg-surface-2/40 p-4">
            <PlacementMap
              placement={point.placement!}
              serverPhysicalSide={
                serve?.server && userSide
                  ? serve.server === "user"
                    ? physicalSideForGame(userSide, gameIndex)
                    : otherSide(physicalSideForGame(userSide, gameIndex))
                  : null
              }
              userSide={userSide}
              gameIndex={gameIndex}
              labels={mapLabels}
              onSetUserSide={onSetUserSide}
            />
          </div>
        </section>
      )}

      {/* notes */}
      <section>
        <h3 className="text-sm font-semibold text-zinc-200">Notes</h3>
        {notes.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">
            No notes on this point yet.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {notes.map((n) => (
              <NoteItem
                key={n.id}
                note={n}
                matchId={matchId}
                ownerId={ownerId}
                viewerId={userId}
              />
            ))}
          </ul>
        )}

        <div className="mt-3">
          <NoteComposer
            matchId={matchId}
            pointId={point.id}
            userId={userId}
            placeholder="Add a note about this point"
            onNoteAdded={onNoteAdded}
          />
        </div>
      </section>
    </div>
  );
}
