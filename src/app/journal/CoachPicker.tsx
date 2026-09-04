"use client";

import { useState } from "react";
import {
  canReceiveEntries,
  findCoachByName,
  normalizeCoachName,
  shareHint,
  sortCoaches,
  type PlayerCoach,
} from "@/lib/coaches/playerCoaches";

/**
 * "Who taught it?" — a pick from the player's own coaches (164), with a
 * door to name a new one.
 *
 * It replaces a free-text box. That box is why Adil's journal holds
 * "Jonathan" and "Jonotan" for one person, and why nothing that reads the
 * journal could tell they were the same man or connect either to his
 * account on PongLens. Typing still works; it creates a coach the second
 * lesson can tap.
 *
 * The share answer lives HERE rather than in a step of its own, because
 * that was Adil's call (2026-09-04): attributing and sharing are one
 * moment, with the answer stated rather than assumed. It defaults to off,
 * because a default is what gets accepted when nobody is reading.
 *
 * Shared by the composer (JournalEditor) and the entry editor
 * (NoteEditor). One control, so the two cannot drift.
 */
export function CoachPicker({
  coaches,
  value,
  share,
  onChange,
  onCreate,
  disabled = false,
  title = "Who taught it?",
  shareNoun = "this entry",
}: {
  coaches: PlayerCoach[];
  /** The chosen player_coaches row, or null for "not saying". */
  value: string | null;
  share: boolean;
  onChange: (coachRefId: string | null, share: boolean) => void;
  /** Find-or-create by name; returns the row, or null if it failed. */
  onCreate: (name: string) => Promise<PlayerCoach | null>;
  disabled?: boolean;
  /** The heading. "Move to" when a batch is being moved rather than one
   *  entry being written. */
  title?: string;
  /** What the share line calls what is being shared, so a bulk move does
   *  not offer to share "this entry" when it means twelve of them. */
  shareNoun?: string;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sorted = sortCoaches(coaches);
  const chosen = coaches.find((c) => c.id === value) ?? null;
  const hint = chosen ? shareHint(chosen.status) : null;

  const add = async () => {
    const name = normalizeCoachName(draft);
    if (!name || busy) return;
    // An existing coach under this name is that coach, not a new one.
    const existing = findCoachByName(coaches, name);
    if (existing) {
      onChange(existing.id, share && canReceiveEntries(existing.status));
      setAdding(false);
      setDraft("");
      return;
    }
    setBusy(true);
    setError(null);
    const created = await onCreate(name);
    setBusy(false);
    if (!created) {
      setError("Couldn't add them. Try again.");
      return;
    }
    onChange(created.id, false);
    setAdding(false);
    setDraft("");
  };

  const pick = (coach: PlayerCoach) => {
    if (coach.id === value) {
      // Tapping the chosen coach clears it. Sharing goes with it: there is
      // nobody to share with any more.
      onChange(null, false);
      return;
    }
    onChange(coach.id, share && canReceiveEntries(coach.status));
  };

  return (
    <div className="mt-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
        {title}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {sorted.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => pick(c)}
            aria-pressed={c.id === value}
            disabled={disabled}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-60 ${
              c.id === value
                ? "border-cyan-glow/60 bg-cyan-glow/10 text-cyan-glow"
                : "border-edge text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {c.display_name}
          </button>
        ))}
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            disabled={disabled}
            className="rounded-full border border-dashed border-edge px-3.5 py-1.5 text-xs font-medium text-zinc-500 transition-colors hover:border-cyan-glow/40 hover:text-zinc-300 disabled:opacity-60"
          >
            {coaches.length === 0 ? "Add your coach" : "Add a coach"}
          </button>
        )}
      </div>

      {adding && (
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, 80))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void add();
              }
              if (e.key === "Escape") {
                setAdding(false);
                setDraft("");
              }
            }}
            maxLength={80}
            autoFocus
            placeholder="Their name"
            aria-label="Coach name"
            autoComplete="off"
            className="min-w-0 flex-1 rounded-xl border border-edge bg-surface-2/40 px-3.5 py-2 text-[15px] text-zinc-100 placeholder:text-zinc-500 focus:border-cyan-glow/60 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void add()}
            disabled={busy || normalizeCoachName(draft) === ""}
            className="shrink-0 rounded-full border border-edge bg-surface-2 px-4 py-1.5 text-sm font-semibold text-zinc-200 transition-colors hover:border-cyan-glow/50 disabled:opacity-60"
          >
            {busy ? "Adding…" : "Add"}
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

      {chosen && canReceiveEntries(chosen.status) && (
        <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={share}
            onChange={(e) => onChange(chosen.id, e.target.checked)}
            disabled={disabled}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-cyan-glow,#22d3ee)]"
          />
          <span>
            Share {shareNoun} with {chosen.display_name}
            {hint && (
              <span className="mt-0.5 block text-xs text-zinc-500">{hint}</span>
            )}
          </span>
        </label>
      )}
    </div>
  );
}
