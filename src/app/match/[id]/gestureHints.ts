/**
 * First-time gesture hints for the player, per device (localStorage).
 *
 * The contract, following the swipe-nudge philosophy and the research
 * behind it: a hint appears at most twice, one hint at a time, and dies
 * forever the first time its gesture is actually used — feedback does
 * the long-term teaching, hints only cover discovery. The gestures
 * sheet (GesturesSheet.tsx) is the replay path, so nothing ever needs
 * to nag.
 */

export type HintName = "dtap" | "hold" | "score" | "notebubble";

const KEY = "ponglens:gesture-hints";
const MAX_SHOWS = 2;

interface HintState {
  shown: Partial<Record<HintName, number>>;
  done: Partial<Record<HintName, boolean>>;
}

function read(): HintState {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as HintState;
  } catch {
    // treat as fresh
  }
  return { shown: {}, done: {} };
}

function write(s: HintState) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // private mode: hints just repeat, which is harmless
  }
}

export function hintEligible(name: HintName): boolean {
  const s = read();
  return !s.done[name] && (s.shown[name] ?? 0) < MAX_SHOWS;
}

export function markHintShown(name: HintName) {
  const s = read();
  s.shown[name] = (s.shown[name] ?? 0) + 1;
  write(s);
}

/** The gesture was used for real: its hint never shows again. */
export function markHintDone(name: HintName) {
  const s = read();
  if (s.done[name]) return;
  s.done[name] = true;
  write(s);
}
