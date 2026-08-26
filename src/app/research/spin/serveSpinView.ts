// Pure view logic for /research/spin — vocabularies, the blind holdout,
// queue filtering and the agreement summary. No React, no Supabase, so
// all of it is testable (npm run test:research).

export interface SpinPrediction {
  point_id: string;
  algo: string;
  predicted_spin: "top" | "back" | "none" | "unmeasurable";
  confidence: number | null;
  ratio1: number | null;
  kick1_deg: number | null;
  hop_t: number | null;
  hop_speed: number | null;
  pre_speed: number | null;
  post_speed: number | null;
  serve_cut_s: number | null;
  quality: Record<string, unknown>;
}

export interface SpinNote {
  point_id: string;
  spin: "top" | "back" | "none" | "cant_tell" | null;
  side: "left" | "right" | "none" | "cant_tell" | null;
  strength: "light" | "heavy" | "cant_tell" | null;
  note: string | null;
  predicted_spin: string | null;
  predicted_confidence: number | null;
  algo: string | null;
  blind: boolean;
}

export interface SpinPointRow {
  pointId: string;
  matchId: string;
  idx: number;
  cutT0: number;
  serveSpin: "back" | "top" | "none" | null; // product label from review
  serveSidespin: boolean | null;
}

export interface SpinMatchRow {
  matchId: string;
  name: string;
  venue: string | null;
  points: SpinPointRow[];
}

export const SPIN_CHOICES = [
  { key: "top", label: "Topspin", key_hint: "t" },
  { key: "back", label: "Backspin", key_hint: "b" },
  { key: "none", label: "Flat", key_hint: "f" },
  { key: "cant_tell", label: "Can't tell", key_hint: "u" },
] as const;

export const SIDE_CHOICES = [
  { key: "left", label: "Left side", key_hint: "a" },
  { key: "none", label: "No side", key_hint: "s" },
  { key: "right", label: "Right side", key_hint: "d" },
  { key: "cant_tell", label: "Can't tell", key_hint: "w" },
] as const;

export const STRENGTH_CHOICES = [
  { key: "light", label: "Light", key_hint: "1" },
  { key: "heavy", label: "Heavy", key_hint: "2" },
] as const;

// A fixed fifth of points hide the prediction until the label is saved.
// Deterministic from the point id so the slice never drifts between
// sessions: hash the uuid, keep ids whose hash lands on 0 mod 5.
export function isBlind(pointId: string): boolean {
  let h = 0;
  for (let i = 0; i < pointId.length; i++) {
    h = (h * 31 + pointId.charCodeAt(i)) | 0;
  }
  return ((h % 5) + 5) % 5 === 0;
}

/** Whether to hide the estimator's call until this point is answered.
 * Only points the estimator actually measured are ever blinded: a
 * refusal carries no call to anchor on, and hiding it would withhold the
 * refusal reason — the one thing that makes a refused serve worth
 * labeling, since those labels are how the gates get fixed. */
export function shouldBlind(
  pointId: string,
  prediction: SpinPrediction | undefined,
): boolean {
  if (!prediction || prediction.predicted_spin === "unmeasurable") return false;
  return isBlind(pointId);
}

export type QueueFilter =
  | "unlabeled"
  | "all"
  | "predicted"
  | "disagree"
  | "cant_tell";

export function labeled(note: SpinNote | undefined): boolean {
  return Boolean(note && note.spin !== null);
}

export function disagrees(
  note: SpinNote | undefined,
  prediction: SpinPrediction | undefined,
): boolean {
  if (!note || note.spin === null || note.spin === "cant_tell") return false;
  if (!prediction || prediction.predicted_spin === "unmeasurable") return false;
  return note.spin !== prediction.predicted_spin;
}

export function filterPoints(
  points: readonly SpinPointRow[],
  notes: ReadonlyMap<string, SpinNote>,
  predictions: ReadonlyMap<string, SpinPrediction>,
  filter: QueueFilter,
  predictedClass: "any" | "top" | "back" | "none" | "unmeasurable",
): SpinPointRow[] {
  return points.filter((p) => {
    const note = notes.get(p.pointId);
    const pred = predictions.get(p.pointId);
    if (predictedClass !== "any") {
      if (!pred || pred.predicted_spin !== predictedClass) return false;
    }
    switch (filter) {
      case "unlabeled":
        return !labeled(note);
      case "predicted":
        return Boolean(pred && pred.predicted_spin !== "unmeasurable");
      case "disagree":
        return disagrees(note, pred);
      case "cant_tell":
        return note?.spin === "cant_tell";
      case "all":
        return true;
    }
  });
}

export interface SpinSummary {
  total: number;
  labeledCount: number;
  measured: number;
  agreeOpen: number;
  totalOpen: number;
  agreeBlind: number;
  totalBlind: number;
  /** confusion[human][predicted], classes top/back/none */
  confusion: Record<string, Record<string, number>>;
}

const CLASSES = ["top", "back", "none"] as const;

export function summarize(
  points: readonly SpinPointRow[],
  notes: ReadonlyMap<string, SpinNote>,
  predictions: ReadonlyMap<string, SpinPrediction>,
): SpinSummary {
  const confusion: Record<string, Record<string, number>> = {};
  for (const h of CLASSES) {
    confusion[h] = { top: 0, back: 0, none: 0 };
  }
  let labeledCount = 0;
  let measured = 0;
  let agreeOpen = 0;
  let totalOpen = 0;
  let agreeBlind = 0;
  let totalBlind = 0;
  for (const p of points) {
    const note = notes.get(p.pointId);
    const pred = predictions.get(p.pointId);
    if (pred && pred.predicted_spin !== "unmeasurable") measured += 1;
    if (labeled(note)) labeledCount += 1;
    if (
      note &&
      note.spin !== null &&
      note.spin !== "cant_tell" &&
      pred &&
      pred.predicted_spin !== "unmeasurable"
    ) {
      confusion[note.spin][pred.predicted_spin] += 1;
      const agree = note.spin === pred.predicted_spin;
      if (note.blind) {
        totalBlind += 1;
        if (agree) agreeBlind += 1;
      } else {
        totalOpen += 1;
        if (agree) agreeOpen += 1;
      }
    }
  }
  return {
    total: points.length,
    labeledCount,
    measured,
    agreeOpen,
    totalOpen,
    agreeBlind,
    totalBlind,
    confusion,
  };
}

/** Where the serve sits on the cut video's clock, with a safe fallback
 * when the estimator has no row or no bounce (the clip head). */
export function serveWindow(
  point: SpinPointRow,
  prediction: SpinPrediction | undefined,
): { start: number; end: number } {
  const anchor =
    prediction?.serve_cut_s != null ? prediction.serve_cut_s : point.cutT0;
  return { start: Math.max(0, anchor - 0.9), end: anchor + 2.6 };
}

/** The product's review-flow label, as prefill text. Direction is not
 * recoverable from the boolean, so sidespin arrives as a hint only. */
export function productPrefill(point: SpinPointRow): string | null {
  if (point.serveSpin === null && point.serveSidespin === null) return null;
  const parts: string[] = [];
  if (point.serveSpin === "back") parts.push("backspin");
  if (point.serveSpin === "top") parts.push("topspin");
  if (point.serveSpin === "none") parts.push("flat");
  if (point.serveSidespin === true) parts.push("sidespin");
  if (point.serveSidespin === false && parts.length) parts.push("no sidespin");
  return parts.length ? parts.join(" + ") : null;
}

export function refusalText(pred: SpinPrediction | undefined): string | null {
  if (!pred || pred.predicted_spin !== "unmeasurable") return null;
  const reason = String(pred.quality?.reason ?? "unmeasurable");
  const names: Record<string, string> = {
    no_candidates: "no ball events on this point",
    no_serve_pair: "no serve bounce pair found",
    no_time_anchor: "track could not be aligned",
    anchor_mismatch: "track alignment failed its check",
    hop_time_implausible: "bounce pair timing implausible",
    hop_speed_implausible: "bounce pair spacing implausible",
    pair_same_half: "bounce pair does not cross the net",
    fake_serve_reversal: "looks like pre-serve ball bouncing",
    window_unfit: "too few clean track points at the bounce",
    window_noisy: "track too noisy at the bounce",
    speed_implausible: "measured speeds implausible",
    track_sparse: "too few detections near the serve",
    no_cut_t0: "point has no cut position",
  };
  return names[reason] ?? reason;
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
