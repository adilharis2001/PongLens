/**
 * Deterministic quality gates on delivering a review. A student paid for
 * this; the floor is low but real. Used by the coach workspace (the
 * Deliver button and its explanation) and re-checked by the transition
 * API, so devtools can't ship what the button won't.
 */

export interface GateFinding {
  title: string;
  body: string;
  audio_path: string | null;
  pointCount: number;
}

export interface GateSection {
  body: string;
}

/** null = good to ship; otherwise the human sentence explaining why not. */
export function deliveryBlocker(
  findings: GateFinding[],
  sections: GateSection[],
): string | null {
  if (findings.length === 0) {
    return "Add at least one pattern before you deliver.";
  }
  if (!findings.some((f) => f.pointCount > 0)) {
    return "Link at least one point to a pattern. The clips are what they paid for.";
  }
  const empty = findings.find(
    (f) => !f.title.trim() && !f.body.trim() && !f.audio_path,
  );
  if (empty) {
    return "One of your patterns is still empty. Write a line in it or delete it.";
  }
  const words = [
    ...sections.map((s) => s.body),
    ...findings.map((f) => `${f.title} ${f.body}`),
  ]
    .join(" ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  const hasVoice = findings.some((f) => f.audio_path);
  if (words < 50 && !hasVoice) {
    return "Write a little more first. A review this short would not feel worth what they paid.";
  }
  return null;
}
