"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Note, Point } from "@/lib/types";
import { clipPad } from "./clipEdit";
import {
  PlacementMap,
  hasPlacementBounces,
  type MapLabels,
} from "./PlacementMap";
import { NoteComposer, NoteItem } from "./Notes";
import {
  HOW_GROUPS,
  canonicalHow,
  howLabel,
  suggestionHowValue,
} from "./scorecard";
import { ServerChipMenu } from "./ServerChipMenu";
import type { ServeInfo } from "./serving";
import { otherSide, physicalSideForGame } from "./sides";
import { suggestedWinnerFor, type Side } from "./sides";

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
  mapLabels,
  strictness,
  onPointUpdate,
  onNoteAdded,
  onDelete,
  onSplit,
  onClipEdited,
  onWatchInFull,
  onShare,
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
  mapLabels: MapLabels;
  strictness: string;
  onPointUpdate: (patch: Partial<Point>) => void;
  onNoteAdded: (note: Note) => void;
  onDelete: (point: Point) => void;
  onSplit: (newPoint: Point) => void;
  onClipEdited: () => void;
  /** Seek the full-video preview to this point. Present only when the
   * point has a cut-video offset (cut_t0); older matches hide the action. */
  onWatchInFull?: () => void;
  /** Open the public-link ShareSheet for this point (owner only). */
  onShare?: () => void;
}) {
  const isOwner = ownerId === userId;
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Clip edit mode: draft t0/t1 on the SOURCE-VIDEO timeline. The clip file
  // spans [max(0, t0 - pre), t1 + post] (context padding by strictness), so
  // clipBase maps <video> playhead seconds back onto source seconds. If a
  // reclip is still pending the clip on screen was cut with the previous
  // t0/t1 and the mapping is approximate until the worker catches up.
  const pad = clipPad(strictness);
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

  // Scorecard state. Prefilled from the AI suggestion when nothing is
  // confirmed yet; the "Suggestion" tag marks unconfirmed prefills. The
  // suggestion's winner is only trusted once sides are confirmed.
  const suggestedHow = suggestionHowValue(point.suggestion);
  const suggestedWinner = suggestedWinnerFor(
    point.suggestion?.winner,
    userSide
  );
  const [winner, setWinner] = useState<"user" | "opponent" | null>(
    point.confirmed_winner ?? suggestedWinner
  );
  const [how, setHow] = useState<string>(
    point.confirmed_how ? canonicalHow(point.confirmed_how) : suggestedHow ?? ""
  );
  const [scorecardHidden, setScorecardHidden] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const confirmed = point.confirmed_winner !== null;
  const showSuggestionTag =
    !confirmed && (suggestedWinner !== null || suggestedHow !== null);

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
    setClipBase(Math.max(0, t0 - pad.pre));
    setEditError(null);
    setEditing(true);
  }, [hasTiming, point.t0, point.t1, pad.pre]);

  // Keep playback inside the window the NEW clip will cover, so nudges
  // preview live. Footage outside the current clip file can't preview until
  // the reclip lands; we clamp to what exists.
  const previewClamp = useCallback(
    (v: HTMLVideoElement) => {
      if (!editing) return;
      const lo = Math.max(0, t0d - pad.pre - clipBase);
      const hi = Math.max(lo + 0.2, t1d + pad.post - clipBase);
      if (v.currentTime < lo - 0.1) v.currentTime = lo;
      if (v.currentTime > hi) {
        v.pause();
        v.currentTime = hi;
      }
    },
    [editing, t0d, t1d, clipBase, pad.pre, pad.post]
  );

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
    const supabase = createClient();
    const { error } = await supabase
      .from("points")
      .update({ t0: t0d, t1: t1d })
      .eq("id", point.id);
    setSavingEdit(false);
    if (error) {
      setEditError("Couldn't save the timing. Try again.");
      return false;
    }
    // a DB trigger marks the point edited on any t0/t1 change
    onPointUpdate({ t0: t0d, t1: t1d, edited: true });
    onClipEdited();
    return true;
  }, [t0d, t1d, point.id, onPointUpdate, onClipEdited]);

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
    const supabase = createClient();
    const { data, error } = await supabase.rpc("split_point", {
      p_id: point.id,
      at_t: at,
    });
    setSplitting(false);
    if (error || !data) {
      setEditError("Couldn't split the point. Try again.");
      return;
    }
    setT1d(at);
    onPointUpdate({ t1: at, edited: true });
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
    onPointUpdate,
    onSplit,
    onClipEdited,
  ]);

  const saveScorecard = useCallback(async () => {
    if (!winner) return;
    setSaving(true);
    setSaveError(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("points")
      .update({ confirmed_winner: winner, confirmed_how: how || null })
      .eq("id", point.id);
    setSaving(false);
    if (error) {
      setSaveError("Couldn't save. Try again.");
      return;
    }
    onPointUpdate({ confirmed_winner: winner, confirmed_how: how || null });
  }, [winner, how, point.id, onPointUpdate]);

  const duration =
    point.t0 !== null && point.t1 !== null
      ? Math.max(0, Number(point.t1) - Number(point.t0))
      : null;

  const hasServerChip =
    serve?.server != null || point.server !== null || isOwner;

  // Group labels follow the selected winner so "They missed" reads right.
  const groupLabel = (g: (typeof HOW_GROUPS)[number]) => {
    if (g.id === "miss")
      return winner === "opponent" ? "You missed" : "They missed";
    if (g.id === "won")
      return winner === "opponent" ? "They won it" : winner === "user" ? "You won it" : "Won it";
    return g.label;
  };

  return (
    <div className="space-y-6">
      {/* clip */}
      <div className="relative overflow-hidden rounded-xl border border-edge bg-ink">
        {videoUrl ? (
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
      </div>

      {/* server line + clip tools */}
      {(hasServerChip || duration !== null || onWatchInFull) && (
        <div className="flex flex-wrap items-center gap-3">
          <ServerChipMenu
            point={point}
            serve={serve}
            userSide={userSide}
            isOwner={isOwner}
            onPointUpdate={(_id, patch) => onPointUpdate(patch)}
          />
          {isOwner && (
            <span className="text-[11px] text-zinc-600">Tap to fix</span>
          )}
          {duration !== null && (
            <span className="text-xs text-zinc-500">
              {duration.toFixed(1)}s
            </span>
          )}
          {onWatchInFull && (
            <button
              type="button"
              onClick={onWatchInFull}
              className="inline-flex items-center gap-1 text-xs font-medium text-zinc-400 underline decoration-zinc-600 underline-offset-2 transition-colors hover:text-cyan-glow"
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
                  d="M8 6.5v11l9-5.5-9-5.5Z"
                />
              </svg>
              Watch in full video
            </button>
          )}
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
                  className="rounded-full border border-edge px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white"
                >
                  Edit clip
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
                  className="rounded-lg border border-edge bg-ink/40 px-3.5 py-2 text-sm font-semibold text-zinc-200 transition-colors hover:border-cyan-glow/40"
                >
                  -1s
                </button>
                <button
                  type="button"
                  onClick={() => nudge(which, 1)}
                  className="rounded-lg border border-edge bg-ink/40 px-3.5 py-2 text-sm font-semibold text-zinc-200 transition-colors hover:border-cyan-glow/40"
                >
                  +1s
                </button>
              </div>
            </div>
          ))}

          {t0d - pad.pre < clipBase - 0.05 && (
            <p className="mt-2 text-[11px] text-zinc-500">
              The earlier footage isn&apos;t in the current clip — it shows
              once the clip updates.
            </p>
          )}

          <button
            type="button"
            onClick={() => void splitHere()}
            disabled={splitting}
            className="mt-4 w-full rounded-lg border border-edge bg-ink/40 px-4 py-2.5 text-sm font-semibold text-zinc-200 transition-colors hover:border-cyan-glow/40 disabled:opacity-50"
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
              disabled={savingEdit || !editDirty}
              onClick={() => {
                void saveTiming().then((ok) => {
                  if (ok) setEditing(false);
                });
              }}
              className="rounded-full bg-cyan-glow px-5 py-2 text-sm font-semibold text-ink disabled:opacity-50"
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

      {/* placement */}
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
            />
          </div>
        </section>
      )}

      {/* scorecard: the owner's call, hidden for coach viewers */}
      {isOwner && !scorecardHidden && (
        <section className="rounded-xl border border-edge bg-surface-2/40 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-zinc-200">
                Who won this point?
              </h3>
              <p className="mt-0.5 text-xs text-zinc-500">
                Optional. Confirmed points build the match score.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {showSuggestionTag && (
                <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
                  Suggestion
                </span>
              )}
              {!confirmed && (
                <button
                  type="button"
                  onClick={() => setScorecardHidden(true)}
                  aria-label="Dismiss scorecard"
                  className="text-zinc-500 transition-colors hover:text-zinc-300"
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
              )}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            {(
              [
                { value: "user", label: "You" },
                { value: "opponent", label: "Them" },
              ] as const
            ).map((o) => (
              <button
                key={o.value}
                type="button"
                aria-pressed={winner === o.value}
                onClick={() => setWinner(o.value)}
                className={`rounded-lg border px-4 py-2.5 text-sm font-semibold transition-colors ${
                  winner === o.value
                    ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                    : "border-edge bg-ink/40 text-zinc-300 hover:border-cyan-glow/40"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>

          <label className="mt-4 block">
            <span className="text-xs font-medium text-zinc-400">
              How did it end?
            </span>
            <select
              value={how}
              onChange={(e) => setHow(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-edge bg-ink/60 px-3 py-2.5 text-sm text-zinc-200"
            >
              <option value="">Not sure</option>
              {HOW_GROUPS.map((g) => (
                <optgroup key={g.id} label={groupLabel(g)}>
                  {g.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              disabled={!winner || saving}
              onClick={() => void saveScorecard()}
              className="rounded-full bg-cyan-glow px-5 py-2 text-sm font-semibold text-ink disabled:opacity-50"
            >
              {saving ? "Saving…" : confirmed ? "Update" : "Confirm"}
            </button>
            {confirmed && (
              <span className="text-xs text-emerald-400">
                Confirmed: {point.confirmed_winner === "user" ? "you" : "them"}
                {point.confirmed_how
                  ? `, ${howLabel(point.confirmed_how)?.toLowerCase()}`
                  : ""}
              </span>
            )}
          </div>
          {saveError && <p className="mt-2 text-xs text-red-400">{saveError}</p>}
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
