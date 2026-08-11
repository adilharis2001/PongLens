/**
 * Processing-minute arithmetic, mirrored from claim_processing (096). The
 * database computes the real charge at claim time inside the RPC; this
 * exists so the Process sheet can quote the exact number the claim will
 * take, and so the two can be tested against each other.
 */

/** Whole minutes for a processing window: rounded up, minimum one. */
export function chargeMinutes(durationS: number): number {
  if (!Number.isFinite(durationS) || durationS <= 0) return 0;
  return Math.max(1, Math.ceil(durationS / 60));
}

/** "250 minutes", "1 minute". Balances and quotes read as words. */
export function formatMinutes(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  return m === 1 ? "1 minute" : `${m} minutes`;
}

/** "1:07:24" / "7:24" — video durations shown next to the player. */
export function formatClock(durationS: number): string {
  if (!Number.isFinite(durationS) || durationS < 0) return "0:00";
  const total = Math.round(durationS);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** "10 GB", "1.5 GB" — storage amounts in the units people buy them in. */
export function formatGb(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 GB";
  const gb = bytes / 1073741824;
  const rounded = gb >= 10 ? Math.round(gb) : Math.round(gb * 10) / 10;
  return `${rounded} GB`;
}
