"use client";

import { useCallback, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * The spoken score: one slot, two weights.
 *
 * The scored result (Keep score) is the record — it feeds the analysis
 * and keeps the solid games total it has always had. The spoken score is
 * testimony from the table: always muted, always labelled Spoken, shown
 * in the score slot only while no scored result exists, and one quiet
 * row inside the score disclosure once one does. It never feeds the
 * scorekeeper.
 */

export type SpokenGame = { game: number; you: number; them: number };

export function cleanSpoken(raw: unknown): SpokenGame[] {
  if (!Array.isArray(raw)) return [];
  return (raw as SpokenGame[])
    .filter(
      (r) =>
        Number.isFinite(r?.game) &&
        Number.isFinite(r?.you) &&
        Number.isFinite(r?.them)
    )
    .sort((a, b) => a.game - b.game);
}

export function spokenTally(rows: SpokenGame[]): { you: number; them: number } {
  let you = 0;
  let them = 0;
  for (const r of rows) {
    if (r.you > r.them) you += 1;
    else if (r.them > r.you) them += 1;
  }
  return { you, them };
}

/** The muted per-game line: "12-10 · 7-11 · …". */
export function SpokenLine({
  rows,
  className,
}: {
  rows: SpokenGame[];
  className?: string;
}) {
  return (
    <p className={`tabular-nums ${className ?? ""}`}>
      {rows.map((g, i) => (
        <span key={g.game} className="whitespace-nowrap">
          {i > 0 && <span className="mx-1 text-zinc-700">·</span>}
          <span className="text-cyan-glow/60">{g.you}</span>
          <span className="text-zinc-600">-</span>
          <span className="text-magenta-soft/60">{g.them}</span>
        </span>
      ))}
    </p>
  );
}

/**
 * The muted "Spoken 3 - 2" toggle standing in the score slot while no
 * scored result exists. Quieter than the scored total on purpose: which
 * number is the record is answered by weight before the label.
 */
export function SpokenGamesToggle({
  rows,
  open,
  onToggle,
  className,
}: {
  rows: SpokenGame[];
  open: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const tally = spokenTally(rows);
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`inline-flex shrink-0 items-baseline gap-1.5 ${className ?? ""}`}
      aria-expanded={open}
      aria-label={`Spoken score, ${tally.you} games to ${tally.them}`}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        Spoken
      </span>
      <span className="font-bold tabular-nums">
        <span className="text-cyan-glow/60">{tally.you}</span>
        <span className="text-zinc-600"> - </span>
        <span className="text-magenta-soft/60">{tally.them}</span>
      </span>
      <span
        className={`text-[10px] text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`}
      >
        ⌄
      </span>
    </button>
  );
}

/**
 * The owner's editor, opened from any spoken display after upload. Each
 * game is a row; who won plus the loser's points is the whole entry,
 * because that is how players say scores — deuce derives itself. Games
 * can be added anywhere in the order, including a missing one in the
 * middle, and removed.
 */
export function SpokenScoreEditor({
  matchId,
  initial,
  youLabel,
  themLabel,
  onClose,
  onSaved,
}: {
  matchId: string;
  initial: SpokenGame[];
  youLabel: string;
  themLabel: string;
  onClose: () => void;
  onSaved: (rows: SpokenGame[]) => void;
}) {
  const [rows, setRows] = useState<SpokenGame[]>(initial);
  const [saving, setSaving] = useState(false);

  const freeGames = useMemo(
    () =>
      [1, 2, 3, 4, 5, 6, 7].filter(
        (n) => !rows.some((r) => r.game === n)
      ),
    [rows]
  );

  const setGame = useCallback((game: number, you: number, them: number) => {
    setRows((prev) =>
      [...prev.filter((r) => r.game !== game), { game, you, them }].sort(
        (a, b) => a.game - b.game
      )
    );
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    const supabase = createClient();
    const value = rows.length > 0 ? rows : null;
    await supabase
      .from("matches")
      .update({ spoken_scores: value })
      .eq("id", matchId);
    setSaving(false);
    onSaved(rows);
    onClose();
  }, [rows, matchId, onSaved, onClose]);

  return (
    <div className="mt-3 max-w-sm rounded-2xl border border-edge bg-surface p-4">
      <div className="space-y-2">
        {rows.map((row) => (
          <SpokenGameRow
            key={row.game}
            row={row}
            youLabel={youLabel}
            themLabel={themLabel}
            onChange={(you, them) => setGame(row.game, you, them)}
            onRemove={() =>
              setRows((prev) => prev.filter((r) => r.game !== row.game))
            }
          />
        ))}
        {rows.length === 0 && (
          <p className="text-sm text-zinc-500">No games yet.</p>
        )}
      </div>
      {freeGames.length > 0 && (
        <button
          type="button"
          onClick={() => {
            // The first missing number, so a game skipped in the middle
            // slots straight back into place.
            const next = freeGames[0];
            setGame(next, 11, 0);
          }}
          className="mt-3 text-sm font-semibold text-cyan-glow"
        >
          Add game {freeGames[0]}
        </button>
      )}
      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-full bg-cyan-glow px-4 py-1.5 text-sm font-semibold text-ink disabled:opacity-50"
        >
          {saving ? "Saving" : "Save"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-edge px-4 py-1.5 text-sm font-semibold text-zinc-300"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/** One game's controls: winner select plus the loser's points. */
function SpokenGameRow({
  row,
  youLabel,
  themLabel,
  onChange,
  onRemove,
}: {
  row: SpokenGame;
  youLabel: string;
  themLabel: string;
  onChange: (you: number, them: number) => void;
  onRemove: () => void;
}) {
  const youWon = row.you >= row.them;
  const loser = Math.min(row.you, row.them);

  const apply = (won: boolean, loserPoints: number) => {
    // Standard game: eleven, unless the loser reached ten — then deuce
    // ran and the winner finished two clear.
    const clean = Math.max(0, Math.min(40, loserPoints));
    const winner = Math.max(11, clean + 2);
    onChange(won ? winner : clean, won ? clean : winner);
  };

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-14 shrink-0 text-xs font-semibold text-zinc-500">
        Game {row.game}
      </span>
      <select
        value={youWon ? "you" : "them"}
        onChange={(e) => apply(e.target.value === "you", loser)}
        className="rounded-lg border border-edge bg-ink px-2 py-1 text-sm text-zinc-200"
        aria-label={`Game ${row.game} winner`}
      >
        <option value="you">{youLabel} won</option>
        <option value="them">{themLabel} won</option>
      </select>
      <input
        type="number"
        min={0}
        max={40}
        value={loser}
        onChange={(e) => apply(youWon, Number(e.target.value))}
        className="w-16 rounded-lg border border-edge bg-ink px-2 py-1 text-sm tabular-nums text-zinc-200"
        aria-label={`Game ${row.game} loser's points`}
      />
      <span className="tabular-nums font-semibold">
        <span className="text-cyan-glow">{row.you}</span>
        <span className="text-zinc-600">-</span>
        <span className="text-magenta-soft">{row.them}</span>
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="ml-auto text-sm text-zinc-400 hover:text-amber-300"
        aria-label={`Remove game ${row.game}`}
      >
        Remove
      </button>
    </div>
  );
}
