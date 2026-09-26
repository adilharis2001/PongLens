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

/**
 * The window a Process request covers, and its charge, the way
 * claim_processing computes them: the STORED length is the whole video,
 * and a trim end past it counts as the whole video.
 *
 * The trim bar is drawn on `videoS`, the length the player itself read,
 * once it has read one: the stored duration_s is not the file's (729
 * against a 728.99 s file), and the bar sits one line under the player's
 * own clock. An end handle at the picture's end is still no trim: the
 * request leaves the end off and the charge is the stored length's,
 * exactly what the claim will take.
 */
export function processWindow({
  storedS,
  videoS,
  trimStartS,
  trimEndS,
}: {
  /** matches.duration_s, or the player's reading when the row has none. */
  storedS: number | null;
  /** What the player read, or null before its metadata arrives. */
  videoS: number | null;
  trimStartS: number;
  /** Where the end handle was put; null while it has not been moved. */
  trimEndS: number | null;
}): {
  /** The trim bar's length and its end handle. */
  barS: number | null;
  barEndS: number | null;
  trimmed: boolean;
  /** The body /api/process takes: null for an untrimmed side. */
  requestStartS: number | null;
  requestEndS: number | null;
  charge: number | null;
} {
  const barS = videoS ?? storedS;
  if (storedS == null || barS == null) {
    return { barS, barEndS: barS, trimmed: false, requestStartS: null, requestEndS: null, charge: null };
  }
  const barEndS = Math.min(trimEndS ?? barS, barS);
  const endAtFull = barEndS >= barS - 0.5;
  const endS = endAtFull ? storedS : Math.min(barEndS, storedS);
  const trimmed = trimStartS > 0.5 || !endAtFull;
  return {
    barS,
    barEndS,
    trimmed,
    requestStartS: trimmed ? trimStartS : null,
    requestEndS: trimmed ? endS : null,
    charge: chargeMinutes(Math.max(0, endS - trimStartS)),
  };
}

/** "250 minutes", "1 minute". Balances and quotes read as words. */
export function formatMinutes(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  return m === 1 ? "1 minute" : `${m} minutes`;
}

/**
 * The line under an automatic run's button (or under the trim, on the
 * upload card), following the trim as it moves: what the run costs, out of
 * what the player has. Minutes are the cost, so they are said here once
 * rather than on the button and again beside the row (Adil, 2026-09-25).
 * An unknown balance says the cost alone. A balance that will not cover
 * it, or a claim refused for it, keeps the out-of-minutes sentence the
 * unprocessed page has always shown, in amber.
 */
export function minutesUseLine(
  charge: number | null,
  balance: number | null,
  refused = false,
): { text: string; short: boolean } | null {
  if (charge == null) return null;
  if (balance == null) return { text: `Uses ${formatMinutes(charge)}.`, short: false };
  if (refused || balance < charge) {
    return { text: `Not enough minutes. You have ${formatMinutes(balance)}.`, short: true };
  }
  return { text: `Uses ${charge} of your ${formatMinutes(balance)}.`, short: false };
}

/**
 * Whether the automatic run's button can be pressed: there is a charge to
 * pay, the server has not just refused it, and the balance covers it or is
 * not known. An unknown balance used to disable the button on the web
 * while the iPhone left it on (post-rollout audit S4, 2026-09-26); the
 * claim checks the balance itself and refuses when it is short, so both
 * now let the press through, with "Uses N minutes." under it.
 */
export function processAllowed(
  charge: number | null,
  balance: number | null,
  refused = false,
): boolean {
  if (charge == null || refused) return false;
  return balance == null || balance >= charge;
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
