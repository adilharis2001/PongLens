"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BetaPill } from "@/components/BetaPill";
import { createClient } from "@/lib/supabase/client";
import type { Note, Point, Tag } from "@/lib/types";
import { Annotator } from "./Annotator";
import { clipPad } from "./clipEdit";
import { ClipPlayer } from "./ClipPlayer";
import { ModifyClip } from "./ModifyClip";
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
  scored = true,
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
  points,
  onModifySplit,
  onModifyJoin,
  onAdjustTiming,
  onShare,
  onOpenInPlayer,
  tags,
  tagVocab,
  onToggleTag,
  onCreateTag,
  onToggleStar,
  startPaused = false,
}: {
  matchId: string;
  ownerId: string;
  point: Point;
  /** True when this point is on screen only because the page opened —
   *  nobody chose it, so its clip should not start playing by itself. */
  startPaused?: boolean;
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
  /** tracksServe on the live match type. False (practice/drills) drops the
   * scorecard — no server, no winner, no loss reasons to collect. */
  scored?: boolean;
  /** Owner-only: set matches.user_side from the map's orientation prompt
   * while untagged (same write PlayerTagging uses). Absent for coaches. */
  onSetUserSide?: (side: Side) => void;
  strictness: string;
  /** Informational match-level lifecycle copy when this point has no map. */
  placementNotice?: string | null;
  /** Pads this match's clips were actually cut with (matches.clip_pads,
   * 048); null/absent falls back to the per-strictness table. */
  clipPads?: { pre: number; post: number } | null;
  /** Prev/next point navigation, rendered as chevrons flanking the clip. */
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
  /** All visible points, in timeline order — the Modify modal's Join needs
   *  this point's neighbours. */
  points: Point[];
  /** The Modify modal's three actions. All owned by MatchView (the same
   *  machinery the Keep-score pad drives — modifyOps.ts); each resolves
   *  false on failure so the modal can stay open. Owner-only. */
  onModifySplit?: (
    point: Point,
    cutTimes: number[],
    segments: ("user" | "opponent" | "skip")[]
  ) => Promise<boolean>;
  onModifyJoin?: (
    point: Point,
    count: number,
    winner: "user" | "opponent" | "skip"
  ) => Promise<boolean>;
  onAdjustTiming?: (point: Point, t0: number, t1: number) => Promise<boolean>;
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

  const pad = clipPad(strictness, clipPads);
  const hasTiming = point.t0 !== null && point.t1 !== null;
  // A reclip is in flight for this point: the clip on screen no longer
  // matches t0/t1, so stacking further timing edits on it would be editing
  // blind. The Modify modal's Adjust locks (its own copy explains why)
  // until the worker clears `edited`; MatchView's pending-clips poll
  // refreshes the flag every ~8s, so the lock releases on its own.
  const clipLocked = point.edited;

  // The Modify modal — the SAME component the Keep-score pad opens, so
  // split/join/adjust behave identically from either surface. It plays the
  // CUT video (a point's context extends past its own clip file), fetched
  // lazily on first open and kept for the sheet's lifetime.
  const [modifyOpen, setModifyOpen] = useState(false);
  const [modifyBusy, setModifyBusy] = useState(false);
  const [cutUrl, setCutUrl] = useState<string | null>(null);
  const openModify = useCallback(() => {
    setModifyOpen(true);
    if (cutUrl) return;
    void (async () => {
      try {
        const res = await fetch("/api/media-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ matchId, preview: true }),
        });
        const data = res.ok ? await res.json() : null;
        if (data?.url) setCutUrl(data.url);
      } catch {
        // The modal shows its own Loading state until a retry.
      }
    })();
  }, [cutUrl, matchId]);

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
  if (hasTiming && onModifySplit) {
    actions.push(
      // The same Modify the Keep-score pad opens: Split · Join · Adjust.
      <ActionSegment key="modify" label="Modify" onClick={openModify}>
        <svg {...ICON} aria-hidden="true">
          <circle cx="6" cy="6" r="2.5" />
          <circle cx="6" cy="18" r="2.5" />
          <path strokeLinecap="round" d="M8.2 7.4 20 18M8.2 16.6 20 6" />
        </svg>
      </ActionSegment>
    );
  }
  // "Game ends here" is a score boundary; practice has no games to bound.
  if (scored) {
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
  }
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
          <ClipPlayer
            src={videoUrl}
            videoElRef={clipVideoRef}
            startPaused={startPaused}
          />
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
        {videoUrl && (
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
            ClipPlayer's tap-to-play. */}
        {nav && nav.hasPrev && (
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
        {nav && nav.hasNext && (
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
      {isOwner && (
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


      {/* scorecard: the owner's call, hidden for coach viewers. Its own
          component, because the Keep-score pad asks the same questions.
          Scored types only — a practice point has no server and no winner
          to collect, so the sheet is the clip, the map, and the notes. */}
      {isOwner && scored && (
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

      {/* Modify: the same Split · Join · Adjust modal the Keep-score pad
          opens. Portaled to <body> for the same reason the Annotator is —
          the sheet's transform would swallow a fixed overlay — and it plays
          the CUT video, since a point's real start/end can live outside its
          own clip file. */}
      {modifyOpen &&
        onModifySplit &&
        onModifyJoin &&
        onAdjustTiming &&
        createPortal(
          <div className="fixed inset-0 z-[80]">
            <ModifyClip
              point={point}
              points={points}
              videoUrl={cutUrl}
              pad={pad}
              youLabel={mapLabels.you}
              themLabel={mapLabels.them}
              busy={modifyBusy}
              onClose={() => !modifyBusy && setModifyOpen(false)}
              onSplit={(cutTimes, segments) => {
                setModifyBusy(true);
                void onModifySplit(point, cutTimes, segments).then(() => {
                  setModifyBusy(false);
                  setModifyOpen(false);
                });
              }}
              onJoin={(count, winner) => {
                setModifyBusy(true);
                void onModifyJoin(point, count, winner).then(() => {
                  setModifyBusy(false);
                  setModifyOpen(false);
                });
              }}
              onAdjust={(t0, t1) => {
                setModifyBusy(true);
                void onAdjustTiming(point, t0, t1).then(() => {
                  setModifyBusy(false);
                  setModifyOpen(false);
                });
              }}
              adjustLocked={clipLocked}
            />
          </div>,
          document.body
        )}
    </div>
  );
}
