"use client";

/**
 * Pack tiles (096): the one way packs are presented anywhere in the app.
 * A tile leads with the quantity, carries the price, and closes with one
 * quiet factual line (per-unit cost, or the term). Tapping a tile starts
 * checkout — the tile IS the buy button, so there is no second control.
 */

export interface PackTile {
  key: string;
  /** The big number: "60", "100". */
  amount: string;
  /** Its unit, under the number: "minutes", "GB". */
  unit: string;
  /** "$5", "$20". */
  price: string;
  /** One factual line: "8.3¢ a minute", "for 12 months". */
  note: string;
}

export function PackTiles({
  tiles,
  busy,
  onPick,
}: {
  tiles: PackTile[];
  busy: boolean;
  onPick: (key: string) => void;
}) {
  if (tiles.length === 0) return null;
  return (
    <div
      className={`grid gap-2 ${
        tiles.length >= 3 ? "grid-cols-3" : "grid-cols-2"
      }`}
    >
      {tiles.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onPick(t.key)}
          disabled={busy}
          className="group rounded-2xl border border-edge bg-surface-2/40 p-4 text-left transition-colors hover:border-cyan-glow/50 disabled:opacity-60"
        >
          <p className="text-2xl font-semibold tabular-nums text-zinc-100">
            {t.amount}
          </p>
          <p className="text-xs text-zinc-500">{t.unit}</p>
          <p className="mt-3 text-sm font-semibold text-zinc-100 transition-colors group-hover:text-cyan-glow">
            {t.price}
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">{t.note}</p>
        </button>
      ))}
    </div>
  );
}

/** "8.3¢ a minute" — the quiet per-unit line on minute tiles. */
export function perMinuteNote(minutes: number, priceCents: number): string {
  const cents = priceCents / minutes;
  const rounded = Math.round(cents * 10) / 10;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}¢ a minute`;
}
