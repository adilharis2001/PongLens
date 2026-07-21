"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Note, Point } from "@/lib/types";
import { PlacementMap } from "./PlacementMap";
import { NoteComposer, NoteItem } from "./Notes";
import { HOW_OPTIONS, howLabel, suggestionHowValue } from "./scorecard";

export function PointSheet({
  matchId,
  ownerId,
  point,
  notes,
  userId,
  onClose,
  onPointUpdate,
  onNoteAdded,
}: {
  matchId: string;
  ownerId: string;
  point: Point;
  notes: Note[];
  userId: string;
  onClose: () => void;
  onPointUpdate: (patch: Partial<Point>) => void;
  onNoteAdded: (note: Note) => void;
}) {
  const isOwner = ownerId === userId;
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);

  // Scorecard state. Prefilled from the AI suggestion when nothing is
  // confirmed yet; the "Suggestion" tag marks unconfirmed prefills.
  const suggestedHow = suggestionHowValue(point.suggestion);
  const suggestedWinner = point.suggestion?.winner ?? null;
  const [winner, setWinner] = useState<"user" | "opponent" | null>(
    point.confirmed_winner ?? suggestedWinner
  );
  const [how, setHow] = useState<string>(
    point.confirmed_how ?? suggestedHow ?? ""
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
        if (!cancelled)
          setVideoError("Couldn't load the clip. Close and try again.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [matchId, point.id, point.clip_path]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true">
      {/* backdrop */}
      <button
        type="button"
        aria-label="Close point view"
        onClick={onClose}
        className="absolute inset-0 bg-ink/70 backdrop-blur-sm"
      />
      {/* panel: full-screen sheet on mobile, right panel on sm+ */}
      <div className="absolute inset-x-0 bottom-0 top-10 overflow-y-auto rounded-t-2xl border border-edge bg-surface shadow-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:top-0 sm:w-[430px] sm:rounded-none sm:border-y-0 sm:border-r-0">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-edge/70 bg-surface/95 px-4 py-3 backdrop-blur">
          <div className="flex items-center gap-3">
            <p className="text-sm font-semibold">Point {point.idx}</p>
            {point.server && (
              <span
                className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                  point.server === "user"
                    ? "border-cyan-glow/40 bg-cyan-glow/10 text-cyan-glow"
                    : "border-magenta-glow/40 bg-magenta-glow/10 text-magenta-soft"
                }`}
              >
                {point.server === "user"
                ? isOwner
                  ? "You served"
                  : "Player served"
                : isOwner
                  ? "They served"
                  : "Opponent served"}
              </span>
            )}
            {duration !== null && (
              <span className="text-xs text-zinc-500">
                {duration.toFixed(1)}s
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full border border-edge p-1.5 text-zinc-400 transition-colors hover:border-cyan-glow/50 hover:text-white"
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

        <div className="space-y-6 p-4 pb-10">
          {/* clip */}
          <div className="overflow-hidden rounded-xl border border-edge bg-ink">
            {videoUrl ? (
              <video
                src={videoUrl}
                controls
                playsInline
                autoPlay
                preload="metadata"
                className="max-h-[45vh] w-full bg-black"
              />
            ) : videoError ? (
              <p className="p-6 text-center text-sm text-red-300">
                {videoError}
              </p>
            ) : (
              <div className="flex aspect-video items-center justify-center">
                <p className="text-sm text-zinc-500">Loading clip…</p>
              </div>
            )}
          </div>

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
                  {HOW_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
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
                  {saving
                    ? "Saving…"
                    : confirmed
                      ? "Update"
                      : "Confirm"}
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
              {saveError && (
                <p className="mt-2 text-xs text-red-400">{saveError}</p>
              )}
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
      </div>
    </div>
  );
}
