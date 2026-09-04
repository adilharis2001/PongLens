"use client";

import { useEffect, useState } from "react";
import { CoachPicker } from "./CoachPicker";
import { moveSummary, type PlayerCoach } from "@/lib/coaches/playerCoaches";

/**
 * Move several journal entries onto one coach at once (164).
 *
 * This is the path a real journal needs first. Adil's own has "Jonathan"
 * on one entry and "Jonotan" on another, and every player who has been
 * writing for a season has some version of that: the feature is not worth
 * much if putting it right means opening forty entries.
 *
 * It asks about sharing ONCE, for the whole batch. Adil's call was that
 * attributing and sharing happen together with the answer stated rather
 * than assumed — but forty entries is one decision about forty entries,
 * not forty decisions, and a control that asked forty times would teach
 * people to stop reading it.
 */
export function MoveToCoach({
  open,
  count,
  coaches,
  onCreate,
  onClose,
  onMove,
}: {
  open: boolean;
  count: number;
  coaches: PlayerCoach[];
  onCreate: (name: string) => Promise<PlayerCoach | null>;
  onClose: () => void;
  /** Returns false if the write failed, so the sheet can stay open. */
  onMove: (coachRefId: string, share: boolean) => Promise<boolean>;
}) {
  const [coachRefId, setCoachRefId] = useState<string | null>(null);
  const [share, setShare] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCoachRefId(null);
    setShare(false);
    setError(null);
  }, [open]);

  if (!open) return null;

  const chosen = coaches.find((c) => c.id === coachRefId) ?? null;

  const move = async () => {
    if (!coachRefId || busy) return;
    setBusy(true);
    setError(null);
    const ok = await onMove(coachRefId, share);
    setBusy(false);
    if (!ok) {
      setError("Couldn't move them. Try again.");
      return;
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-ink/70 backdrop-blur-sm"
      />
      <div className="absolute inset-x-0 bottom-0 max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-t-2xl border border-edge bg-surface p-5 pb-[max(2rem,env(safe-area-inset-bottom))] shadow-2xl sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:pb-5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold">
            Move {count} {count === 1 ? "entry" : "entries"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full border border-edge p-1.5 text-zinc-400 transition-colors hover:border-cyan-glow/50 hover:text-white"
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

        <CoachPicker
          coaches={coaches}
          value={coachRefId}
          share={share}
          disabled={busy}
          title="Move to"
          shareNoun={count === 1 ? "this entry" : `these ${count} entries`}
          onChange={(id, next) => {
            setCoachRefId(id);
            setShare(next);
          }}
          onCreate={onCreate}
        />

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        <button
          type="button"
          onClick={() => void move()}
          disabled={busy || !chosen}
          className="glow-cta mt-4 block w-full rounded-full bg-cyan-glow px-5 py-3 text-center text-sm font-semibold text-ink disabled:opacity-60"
        >
          {busy
            ? "Moving…"
            : chosen
              ? moveSummary(count, chosen.display_name, share)
              : "Pick a coach"}
        </button>
      </div>
    </div>
  );
}
