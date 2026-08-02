"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BetaPill } from "@/components/BetaPill";
import { createClient } from "@/lib/supabase/client";
import type { Note, Point, Tag } from "@/lib/types";
import { Annotator } from "./Annotator";
import { clipPad, effectivePad, TIGHT_PAD } from "./clipEdit";
import { ClipPlayer } from "./ClipPlayer";
import { gameBoundaryAction, type GameEndOverride } from "./gameScore";
import {
  LooksWrongButton,
  MarkedWrongNotice,
} from "./PlacementFeedback";
import {
  PlacementMap,
  hasPlacementBounces,
  type MapLabels,
} from "./PlacementMap";
import { NoteComposer, NoteItem } from "./Notes";
import { TagGlyph, TagPicker } from "./Tags";
import { PointScorecard, useSaveFlash } from "./PointScorecard";
import type { ServeInfo } from "./serving";
import { otherSide, physicalSideForGame, type Side } from "./sides";

/** Shared geometry for the action-bar glyphs. */
const ICON = {
  viewBox: "0 0 24 24",
  className: "h-[18px] w-[18px]",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
} as const;

/**
 * One action in the point's action bar.
 *
 * Icon over a label, in an equal segment — the same shape as every other
 * control in this view. The old row mixed a filled pill, two outlined pills
 * of different widths and two bare circles, floating with no container while
 * everything around it sat in a card, which is why it read as foreign. The
 * label also means no action depends on reading an icon correctly.
 */
function ActionSegment({
  label,
  tone = "normal",
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  /** primary = the one action worth reaching for; danger = destructive. */
  tone?: "normal" | "primary" | "danger";
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const tint =
    tone === "primary"
      ? "text-cyan-glow"
      : tone === "danger"
        ? "text-red-300"
        : "text-zinc-300";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-center justify-center gap-1 py-2.5 transition-colors hover:bg-ink/40 disabled:pointer-events-none disabled:opacity-40 ${tint}`}
    >
      {children}
      <span className="text-[10px] font-medium leading-none">{label}</span>
    </button>
  );
}


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
  authorNames,
  userId,
  userSide,
  gameIndex,
  gameEnd,
  onSetGameOverride,
  mapLabels,
  neutral = false,
  onSetUserSide,
  strictness,
  placementNotice,
  clipPads,
  nav,
  onPointUpdate,
  customReasons = [],
  onCreateCustomReason,
  onNoteAdded,
  onDelete,
  deleteBefore,
  onSplit,
  onClipEdited,
  onShare,
  onOpenInPlayer,
  tags,
  tagVocab,
  onToggleTag,
  onCreateTag,
  onToggleStar,
}: {
  matchId: string;
  ownerId: string;
  point: Point;
  serve: ServeInfo | undefined;
  notes: Note[];
  /** author_id -> display name for this match's note authors. */
  authorNames: Map<string, string>;
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
  /** Informational match-level lifecycle copy when this point has no map. */
  placementNotice?: string | null;
  /** Pads this match's clips were actually cut with (matches.clip_pads,
   * 048); null/absent falls back to the per-strictness table. */
  clipPads?: { pre: number; post: number } | null;
  /** Prev/next point navigation, rendered as chevrons flanking the clip.
   * Hidden while editing timing (the native scrubber needs the space). */
  nav?: {
    hasPrev: boolean;
    hasNext: boolean;
    onPrev: () => void;
    onNext: () => void;
  };
  onPointUpdate: (patch: Partial<Point>) => void;
  /** The owner's own "why I lost it" pills (loss_reason_labels, 060). */
  customReasons?: { id: string; label: string }[];
  onCreateCustomReason?: (label: string) => Promise<string | null>;
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
  /** This point's tags (035), part of the Notes section. */
  tags: Tag[];
  /** The owner's vocabulary, recent-first, for the picker. */
  tagVocab: Tag[];
  onToggleTag: (tag: Tag) => void;
  onCreateTag: (label: string) => void;
  /** Star/unstar this point (owner only) — the overlay button on the clip. */
  onToggleStar?: () => void;
  /** Jump to this point's moment in the full-match Player. */
  onOpenInPlayer?: () => void;
}) {
  const isOwner = ownerId === userId;
  // The clip-overlay tag button opens the picker directly (the chip row
  // that used to live in Notes moved onto the video).
  const [tagOpen, setTagOpen] = useState(false);
  // Frame annotation on the point clip — same flow as the watch player:
  // capture the ON-SCREEN frame (WebKit black-frames hidden videos),
  // draw, and the image attaches to the note being written.
  const clipVideoRef = useRef<HTMLVideoElement | null>(null);
  const [annotateFrame, setAnnotateFrame] = useState<HTMLCanvasElement | null>(
    null
  );
  const [pendingImage, setPendingImage] = useState<{
    path: string;
    preview: string;
  } | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);

  const clearPendingImage = useCallback(() => {
    setPendingImage((cur) => {
      if (cur) URL.revokeObjectURL(cur.preview);
      return null;
    });
  }, []);

  const startDrawing = useCallback(() => {
    const v = clipVideoRef.current;
    if (!v || v.videoWidth === 0) {
      setCaptureError("The clip isn't ready yet.");
      return;
    }
    try {
      v.pause();
      const scale = Math.min(1, 1280 / v.videoWidth);
      const c = document.createElement("canvas");
      c.width = Math.round(v.videoWidth * scale);
      c.height = Math.round(v.videoHeight * scale);
      const ctx = c.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.drawImage(v, 0, 0, c.width, c.height);
      ctx.getImageData(0, 0, 1, 1); // taint probe
      setCaptureError(null);
      setAnnotateFrame(c);
    } catch {
      setCaptureError("This browser couldn't read the frame.");
    }
  }, []);

  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Clip edit mode: draft t0/t1 on the SOURCE-VIDEO timeline. The clip file
  // spans [max(0, t0 - pre), t1 + post] (context padding by strictness,
  // except split-boundary edges which are cut tight — see effectivePad), so
  // clipBase maps <video> playhead seconds back onto source seconds. If a
  // reclip is still pending the clip on screen was cut with the previous
  // t0/t1 and the mapping is approximate until the worker catches up.
  const pad = clipPad(strictness, clipPads);
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

  // Inline confirm for "Delete all before" (no browser confirm()). Keyed
  // mount (key={point.id}) resets it whenever the point changes.
  const [confirmingBefore, setConfirmingBefore] = useState(false);

  // The "Saved" line under the questions. Shared with the scorecard: the
  // game-boundary pill in the action bar writes through MatchView but
  // reports itself in the same place as every other answer.
  const flash = useSaveFlash();

  // Game-boundary override tap ("It didn't" / "Game ended here?" /
  // "End game here" / their Undos). The write lives in MatchView
  // (optimistic, shared with Keep score); here we only flash Saved or
  // surface the failure like every other scorecard tap.
  const pickGameEnd = useCallback(
    async (v: GameEndOverride) => {
      flash.markError(null);
      const ok = await onSetGameOverride(v);
      if (!ok) {
        flash.markError("Couldn't save. Tap again.");
        return;
      }
      flash.markSaved();
    },
    [onSetGameOverride, flash]
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

  /**
   * "Looks wrong" on this point's map. Optimistic, because the map has to
   * go the moment they say so — a failed write puts it straight back
   * rather than leaving them looking at a map they already dismissed.
   */
  const setPlacementFlagged = useCallback(
    (flagged: boolean) => {
      onPointUpdate({ placement_flagged: flagged });
      void createClient()
        .from("points")
        .update({ placement_flagged: flagged })
        .eq("id", point.id)
        .then(({ error }) => {
          if (error) onPointUpdate({ placement_flagged: !flagged });
        });
    },
    [onPointUpdate, point.id]
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

  // Game boundary, as ONE segment in the point's action row.
  //
  // ONE RULE: the label names what the TAP DOES, never what is true.
  //
  //   the game ends here  → "Didn't end"  (tap reopens it)
  //   it doesn't          → "Game ended"  (tap ends it here)
  //
  // Everything falls out of that. At 11-9 the app closes the game, so that
  // point offers "Didn't end" — tap it and scoring carries on in the same
  // game. Tap "Game ended" on a point and it immediately offers "Didn't
  // end", which is the undo, for free.
  //
  // What this replaces: the label used to change between DESCRIBING the
  // point ("Continues", meaning the game runs past here) and OFFERING an
  // action ("Game ended" on a point where nothing had happened). Same
  // words, two jobs, so you had to work out which one you were reading
  // before every tap — and a correction you had already made looked
  // identical to one you hadn't, which is how a game got held open by
  // twenty-two redundant taps. Boundaries are still VISIBLE, on the game
  // dividers in the timeline; this button only ever offers the change.
  //
  // No highlight, for the same reason: in a row of actions (Share, Edit
  // clip, In match, Remove) a lit segment reads as "on", and there is no
  // "on" here — only something to do.
  //
  // The rule and its inverse live in gameScore.ts, next to the walk that
  // decides where boundaries are (and under test there).
  const gamePill = gameBoundaryAction(
    point.game_end_override ?? null,
    gameEnd.endsHere
  );

  // The point's actions, as equal segments. Built as a list because which
  // ones exist varies (no share link for some points, no clip to edit
  // without timing), and the bar divides evenly over whatever is here.
  const actions: React.ReactNode[] = [];
  if (onShare) {
    actions.push(
      <ActionSegment key="share" label="Share" tone="primary" onClick={onShare}>
        <svg {...ICON} aria-hidden="true">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 16V4m0 0L8 8m4-4 4 4M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"
          />
        </svg>
      </ActionSegment>
    );
  }
  if (hasTiming) {
    actions.push(
      <ActionSegment
        key="edit"
        label="Edit clip"
        disabled={clipLocked}
        onClick={startEditing}
      >
        <svg {...ICON} aria-hidden="true">
          <circle cx="6" cy="6" r="2.5" />
          <circle cx="6" cy="18" r="2.5" />
          <path strokeLinecap="round" d="M8.2 7.4 20 18M8.2 16.6 20 6" />
        </svg>
      </ActionSegment>
    );
  }
  actions.push(
    <ActionSegment
      key="game"
      label={gamePill.label}
      onClick={() => void pickGameEnd(gamePill.next)}
    >
      <svg {...ICON} aria-hidden="true">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M6 21V4m0 0h11l-2 3.5L17 11H6"
        />
      </svg>
    </ActionSegment>
  );
  if (onOpenInPlayer) {
    actions.push(
      // "Open this moment in the full match" — an out-of-box arrow, not the
      // old play-in-a-rectangle, which read as a YouTube button.
      <ActionSegment
        key="player"
        label="In match"
        disabled={point.cut_t0 === null}
        onClick={onOpenInPlayer}
      >
        <svg {...ICON} aria-hidden="true">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M14 4h6v6M20 4l-8 8M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"
          />
        </svg>
      </ActionSegment>
    );
  }
  actions.push(
    <ActionSegment
      key="remove"
      label="Remove"
      tone="danger"
      onClick={() => onDelete(point)}
    >
      <svg {...ICON} aria-hidden="true">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m3 0-.9 13a1 1 0 0 1-1 .9H7.9a1 1 0 0 1-1-.9L6 7"
        />
      </svg>
    </ActionSegment>
  );


  return (
    <div className="space-y-6">
      {/* clip */}
      {/* data-peek: the mobile sheet measures these two to line its
          neighbour peek up with the real thing (see PointSheet). */}
      <div
        data-peek="clip"
        className="relative overflow-hidden rounded-xl border border-edge bg-ink"
      >
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
            <ClipPlayer src={videoUrl} videoElRef={clipVideoRef} />
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
        {/* Tag + star live on the clip itself: the action bar below is
            full, and the clip is where the "keep this" decision happens.
            Left of ClipPlayer's mute toggle, same glass chrome. */}
        {videoUrl && !editing && (
          <div className="absolute right-10 top-2 z-10 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setTagOpen(true)}
              aria-label="Tag this point"
              className={`rounded-full bg-ink/60 p-1.5 backdrop-blur-sm transition-colors ${
                tags.length > 0
                  ? "text-cyan-glow"
                  : "text-zinc-300 hover:text-white"
              }`}
            >
              <TagGlyph className="h-3.5 w-3.5" />
            </button>
            {onToggleStar && (
              <button
                type="button"
                onClick={onToggleStar}
                aria-pressed={point.starred}
                aria-label={point.starred ? "Remove star" : "Star this point"}
                className={`rounded-full bg-ink/60 p-1.5 backdrop-blur-sm transition-colors ${
                  point.starred
                    ? "text-amber-300"
                    : "text-zinc-300 hover:text-white"
                }`}
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-3.5 w-3.5"
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
            )}
          </div>
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
            className="absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-ink/55 text-zinc-200 backdrop-blur-sm transition-colors hover:text-white"
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
            className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-ink/55 text-zinc-200 backdrop-blur-sm transition-colors hover:text-white"
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

      {/* clip actions: ONE bordered bar of equal segments, the same shape
          language as the scorecard controls directly below it. The bulk
          cleanup is a row inside the same card rather than a stray link
          hanging off the bottom — it was the fifth different treatment in a
          cluster that already had four. */}
      {isOwner && !editing && (
        <div
          data-peek="card"
          className="overflow-hidden rounded-xl border border-edge bg-surface-2/40"
        >
          <div
            className="grid divide-x divide-edge"
            style={{
              gridTemplateColumns: `repeat(${actions.length}, minmax(0,1fr))`,
            }}
          >
            {actions}
          </div>

          {deleteBefore && (
            <div className="border-t border-edge">
              {confirmingBefore ? (
                <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                  <span className="min-w-0 truncate text-xs text-zinc-400">
                    Remove {deleteBefore.count} earlier point
                    {deleteBefore.count === 1 ? "" : "s"}?
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setConfirmingBefore(false)}
                      className="text-xs text-zinc-500 transition-colors hover:text-zinc-300"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmingBefore(false);
                        deleteBefore.onConfirm();
                      }}
                      className="text-xs font-semibold text-red-300 transition-colors hover:text-red-200"
                    >
                      Remove
                    </button>
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingBefore(true)}
                  className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-ink/40"
                >
                  <span className="min-w-0 truncate text-xs text-zinc-400">
                    Remove the {deleteBefore.count} points before this
                  </span>
                  <span className="shrink-0 text-[11px] text-zinc-600">
                    warm-up
                  </span>
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* clip edit mode: nudge start/end + split (owner only) */}
      {isOwner && editing && (
        <section
          data-peek="card"
          className="rounded-xl border border-cyan-glow/30 bg-surface-2/40 p-4"
        >
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

      {/* scorecard: the owner's call, hidden for coach viewers. Its own
          component, because the Keep-score pad asks the same questions. */}
      {isOwner && (
        <PointScorecard
          point={point}
          serve={serve}
          neutral={neutral}
          mapLabels={mapLabels}
          flash={flash}
          onPointUpdate={onPointUpdate}
          customReasons={customReasons}
          onCreateCustomReason={onCreateCustomReason}
        />
      )}

      {/* placement — below the scorecard so the score controls are reachable
          the moment the point opens, without scrolling past the map */}
      {hasPlacementBounces(point.placement) && (
        <section>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
            Where the ball landed
            <BetaPill />
          </h3>
          {point.placement_flagged ? (
            <MarkedWrongNotice
              className="mt-2"
              matchId={matchId}
              onUndo={() => setPlacementFlagged(false)}
            />
          ) : (
            <div
              data-peek="card"
              className="mt-3 rounded-xl border border-edge bg-surface-2/40 p-4"
            >
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
              {isOwner && (
                <LooksWrongButton
                  className="mt-3"
                  label="This point's placement map is wrong"
                  onFlag={() => setPlacementFlagged(true)}
                />
              )}
            </div>
          )}
        </section>
      )}
      {!hasPlacementBounces(point.placement) && placementNotice && (
        <section aria-label="Placement status">
          <h3 className="text-sm font-semibold text-zinc-200">
            Where the ball landed
          </h3>
          <p className="mt-2 text-sm text-zinc-500">
            {placementNotice}
          </p>
        </section>
      )}

      {/* notes — tagging lives on the clip overlay (the tag button up on
          the video); this section is purely the written thread now */}
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
                authorName={authorNames.get(n.author_id)}
              />
            ))}
          </ul>
        )}

        <div className="mt-3 space-y-2.5">
          {/* Drawing is part of writing the note (same flow as the watch
              player): capture the clip's paused frame, draw, attach. */}
          {pendingImage ? (
            <div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={pendingImage.preview}
                alt="Annotated frame, attached to this note"
                className="w-full max-w-md rounded-lg border border-edge"
              />
              <div className="mt-1.5 flex gap-3 text-[11px] font-medium">
                <button
                  type="button"
                  onClick={startDrawing}
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
          ) : videoUrl ? (
            <button
              type="button"
              onClick={startDrawing}
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
          ) : null}
          {captureError && (
            <p className="text-xs text-amber-300/90">{captureError}</p>
          )}
          <NoteComposer
            matchId={matchId}
            pointId={point.id}
            userId={userId}
            placeholder="Add a note about this point"
            imagePath={pendingImage?.path ?? null}
            onNoteAdded={(n) => {
              onNoteAdded(n);
              clearPendingImage();
            }}
          />
        </div>
      </section>

      {/* Annotator: portaled to <body> — the point sheet animates with a
          transform, which would swallow a fixed overlay (the TagPicker
          lesson), and z-[80] clears the sheet itself. */}
      {annotateFrame &&
        createPortal(
          <div className="fixed inset-0 z-[80]">
            <Annotator
              frame={annotateFrame}
              onCancel={() => setAnnotateFrame(null)}
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
                setAnnotateFrame(null);
              }}
            />
          </div>,
          document.body
        )}

      {tagOpen && (
        <TagPicker
          pointLabel="this point"
          vocab={tagVocab}
          appliedIds={new Set(tags.map((t) => t.id))}
          onToggle={onToggleTag}
          onCreate={onCreateTag}
          onClose={() => setTagOpen(false)}
        />
      )}
    </div>
  );
}
