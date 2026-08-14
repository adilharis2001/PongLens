import type { ServeMatch, ServePoint } from "./data";

export type Outcome = "all" | "found" | "missed";

export const VERDICTS = [
  { value: "right", label: "Right" },
  { value: "too_early", label: "Too early" },
  { value: "too_late", label: "Too late" },
  { value: "no_serve", label: "No serve in this point" },
  { value: "missed", label: "Serve is there, it missed it" },
] as const;

export type Verdict = (typeof VERDICTS)[number]["value"];

/**
 * Every cause names a different fix, which is the point of collecting them.
 * Grouped the way the pipeline fails: can you see the ball, did the tracker
 * follow the right one, is the table where we think it is, and is there a
 * serve in the picture at all.
 */
export const CAUSE_GROUPS = [
  {
    group: "The ball is hard to see",
    causes: [
      { value: "ball_hidden_body", label: "Hidden behind a player" },
      { value: "ball_hidden_hand", label: "Hidden by hand or bat" },
      { value: "ball_out_of_frame", label: "Leaves the picture" },
      { value: "ball_too_small", label: "Too far, dark or low contrast" },
      { value: "motion_blur", label: "Smeared by motion blur" },
      { value: "toss_too_small", label: "Toss too low to read" },
    ],
  },
  {
    group: "The tracker follows the wrong thing",
    causes: [
      { value: "tracker_other_table", label: "Another table's ball" },
      { value: "tracker_stationary", label: "A ball at rest, or a hand" },
      { value: "tracker_lost", label: "Nothing, while the ball is obvious" },
    ],
  },
  {
    group: "The table is in the wrong place",
    causes: [
      { value: "table_wrong", label: "Outline on the wrong table" },
      { value: "table_skewed", label: "Right table, corners off" },
      { value: "net_wrong", label: "Net line misplaced" },
      { value: "camera_low", label: "Camera too low or too side-on" },
    ],
  },
  {
    group: "There is no serve to find",
    causes: [
      { value: "serve_off_camera", label: "Serve happens off camera" },
      { value: "no_serve_in_point", label: "Junk or mid-rally fragment" },
      { value: "other", label: "Something else, see the note" },
    ],
  },
] as const;

export const ALL_CAUSES = CAUSE_GROUPS.flatMap((g) =>
  g.causes.map((c) => c.value),
);

export type Cause = (typeof ALL_CAUSES)[number];

export function causeLabel(value: string): string {
  for (const group of CAUSE_GROUPS) {
    for (const cause of group.causes) {
      if (cause.value === value) return cause.label;
    }
  }
  return value;
}

/**
 * Which stage is failing on a match. The three rates come from different
 * places in the pipeline, so the first one that looks wrong is the one
 * worth looking at: a table fix cannot help a match where the ball is
 * never found, and a tracker fix cannot help one where it is found and
 * lands nowhere near the table.
 */
export type Stage = "ball" | "table" | "motif" | "ok";

export const STAGE_LABEL: Record<Stage, string> = {
  ball: "Ball rarely found",
  table: "Ball found, rarely on the table",
  motif: "Ball and table look fine, no serve pattern",
  ok: "Working",
};

export function stageOf(m: ServeMatch): Stage {
  const found = m.points > 0 ? m.found / m.points : 0;
  if (found >= 0.55) return "ok";
  if (m.detRate < 0.65) return "ball";
  if (m.onTable < 0.25) return "table";
  return "motif";
}

export function foundPct(m: ServeMatch): number {
  return m.points > 0 ? (100 * m.found) / m.points : 0;
}

export function filterPoints(
  points: readonly ServePoint[],
  opts: { match: string; outcome: Outcome; onlyTracked: boolean },
): ServePoint[] {
  return points.filter((p) => {
    if (opts.match !== "all" && p.skey !== opts.match) return false;
    if (opts.outcome === "found" && p.serve === null) return false;
    if (opts.outcome === "missed" && p.serve !== null) return false;
    if (opts.onlyTracked && !p.hasTrack) return false;
    return true;
  });
}

export function summarise(points: readonly ServePoint[]) {
  const found = points.filter((p) => p.serve !== null);
  const errs = found
    .filter((p) => p.label !== null)
    .map((p) => Math.abs((p.serve as number) - (p.label as number)))
    .sort((a, b) => a - b);
  return {
    points: points.length,
    found: found.length,
    foundPct: points.length ? (100 * found.length) / points.length : 0,
    saved: points.reduce((sum, p) => sum + p.saved, 0),
    labels: errs.length,
    medErr: errs.length ? errs[Math.floor(errs.length / 2)] : null,
  };
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
