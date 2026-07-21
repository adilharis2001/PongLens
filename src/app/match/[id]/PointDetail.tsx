"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Note, Point } from "@/lib/types";
import { PlacementMap } from "./PlacementMap";
import { NoteComposer, NoteItem } from "./Notes";
import {
  HOW_GROUPS,
  canonicalHow,
  howLabel,
  suggestionHowValue,
} from "./scorecard";
import {
  CHIP_TONE,
  serverChip,
  suggestedWinnerFor,
  type Side,
} from "./sides";

/**
 * The point detail body: clip, server line, placement, scorecard, notes.
 * Rendered inside the mobile sheet and the desktop split-view pane.
 * Mount with key={point.id} so scorecard state resets per point.
 */
export function PointDetail({
  matchId,
  ownerId,
  point,
  notes,
  userId,
  userSide,
  onPointUpdate,
  onNoteAdded,
}: {
  matchId: string;
  ownerId: string;
  point: Point;
  notes: Note[];
  userId: string;
  userSide: Side | null;
  onPointUpdate: (patch: Partial<Point>) => void;
  onNoteAdded: (note: Note) => void;
}) {
  const isOwner = ownerId === userId;
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);

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
  const [flipping, setFlipping] = useState(false);

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

  const flipServer = useCallback(async () => {
    if (!point.server || flipping) return;
    const prev = point.server;
    const next = prev === "user" ? "opponent" : "user";
    setFlipping(true);
    onPointUpdate({ server: next });
    const supabase = createClient();
    const { error } = await supabase
      .from("points")
      .update({ server: next })
      .eq("id", point.id);
    setFlipping(false);
    if (error) onPointUpdate({ server: prev });
  }, [point.server, point.id, flipping, onPointUpdate]);

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

  const chip = point.server ? serverChip(point.server, userSide, isOwner) : null;

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
      <div className="overflow-hidden rounded-xl border border-edge bg-ink">
        {videoUrl ? (
          <video
            src={videoUrl}
            controls
            playsInline
            autoPlay
            preload="metadata"
            className="max-h-[45vh] w-full bg-black lg:max-h-[52vh]"
          />
        ) : videoError ? (
          <p className="p-6 text-center text-sm text-red-300">{videoError}</p>
        ) : (
          <div className="flex aspect-video items-center justify-center">
            <p className="text-sm text-zinc-500">Loading clip…</p>
          </div>
        )}
      </div>

      {/* server line */}
      {(chip || duration !== null) && (
        <div className="flex flex-wrap items-center gap-3">
          {chip &&
            (isOwner ? (
              <button
                type="button"
                onClick={() => void flipServer()}
                disabled={flipping}
                title="Wrong call? Tap to flip the server."
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-opacity disabled:opacity-60 ${CHIP_TONE[chip.tone]}`}
              >
                {chip.label}
                <svg
                  viewBox="0 0 24 24"
                  className="h-3 w-3 opacity-70"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M7 16V4m0 0L3 8m4-4 4 4m6 4v12m0 0 4-4m-4 4-4-4"
                  />
                </svg>
              </button>
            ) : (
              <span
                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${CHIP_TONE[chip.tone]}`}
              >
                {chip.label}
              </span>
            ))}
          {isOwner && chip && (
            <span className="text-[11px] text-zinc-600">Tap to flip</span>
          )}
          {duration !== null && (
            <span className="text-xs text-zinc-500">
              {duration.toFixed(1)}s
            </span>
          )}
        </div>
      )}

      {/* placement */}
      {point.placement?.bounces && point.placement.bounces.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-zinc-200">
            Where the ball landed
          </h3>
          <div className="mt-3 rounded-xl border border-edge bg-surface-2/40 p-4">
            <PlacementMap bounces={point.placement.bounces} />
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
