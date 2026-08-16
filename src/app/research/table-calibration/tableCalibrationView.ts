import type { CalibrationRow, Corner, ProposalBlock, Quad } from "./types";

/** The frame is served at its stored size; every quad is in SOURCE pixels.
 *  One scale converts between them, and getting it wrong silently offsets
 *  every overlay by 20%, which is exactly the kind of error this page
 *  exists to catch. */
export function sourceToFrame(
  corner: Corner,
  row: Pick<
    CalibrationRow,
    "frameWidth" | "frameHeight" | "sourceWidth" | "sourceHeight"
  >,
): Corner {
  return [
    (corner[0] * row.frameWidth) / row.sourceWidth,
    (corner[1] * row.frameHeight) / row.sourceHeight,
  ];
}

export function frameToSource(
  corner: Corner,
  row: Pick<
    CalibrationRow,
    "frameWidth" | "frameHeight" | "sourceWidth" | "sourceHeight"
  >,
): Corner {
  return [
    (corner[0] * row.sourceWidth) / row.frameWidth,
    (corner[1] * row.sourceHeight) / row.frameHeight,
  ];
}

export function isQuad(value: unknown): value is Quad {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every(
      (point) =>
        Array.isArray(point) &&
        point.length === 2 &&
        point.every((n) => typeof n === "number" && Number.isFinite(n)),
    )
  );
}

export function polygonPoints(corners: readonly Corner[]): string {
  return corners.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
}

/** Corner-for-corner distance as a fraction of the frame diagonal, the same
 *  normalisation select_consensus uses, so drift numbers here and in the
 *  worker mean the same thing. */
export function cornerErrors(
  a: readonly Corner[],
  b: readonly Corner[],
  width: number,
  height: number,
): { median: number; max: number } | null {
  if (a.length !== 4 || b.length !== 4) return null;
  const diagonal = Math.hypot(width, height);
  if (!(diagonal > 0)) return null;
  const distances = a
    .map((point, index) =>
      Math.hypot(point[0] - b[index][0], point[1] - b[index][1]),
    )
    .sort((x, y) => x - y);
  return {
    median: (distances[1] + distances[2]) / 2,
    max: distances[3],
  };
}

/** A quad centred on the frame, used to seed a correction when no proposal
 *  is worth starting from. Deliberately obvious rather than plausible: a
 *  reviewer must move every corner, so nothing accidental gets saved. */
export function seedQuad(width: number, height: number): Quad {
  const x0 = width * 0.25;
  const x1 = width * 0.75;
  const y0 = height * 0.45;
  const y1 = height * 0.7;
  return [
    [x0, y1],
    [x1, y1],
    [x1 * 0.92, y0],
    [x0 * 1.08, y0],
  ];
}

export interface Summary {
  total: number;
  reviewed: number;
  lunaAgreed: number;
  solRun: number;
  solAgreed: number;
  duplicates: number;
  noProposal: number;
}

export function summarise(rows: readonly CalibrationRow[]): Summary {
  let reviewed = 0;
  let lunaAgreed = 0;
  let solRun = 0;
  let solAgreed = 0;
  let duplicates = 0;
  let noProposal = 0;
  for (const row of rows) {
    if (row.verdict) reviewed += 1;
    if (row.duplicateOf) duplicates += 1;
    const luna = row.proposals.luna;
    const sol = row.proposals.sol;
    if (luna?.accepted) lunaAgreed += 1;
    if (sol) {
      solRun += 1;
      if (sol.accepted) solAgreed += 1;
    }
    if (!luna?.accepted && !sol?.accepted) noProposal += 1;
  }
  return {
    total: rows.length,
    reviewed,
    lunaAgreed,
    solRun,
    solAgreed,
    duplicates,
    noProposal,
  };
}

/** What the pipeline would ship for this match today: Luna if it agreed,
 *  otherwise Sol, otherwise nothing. Mirrors the ladder in
 *  points_pipeline.vision_calibrate. */
export function shippedProposal(
  proposals: CalibrationRow["proposals"],
): { model: "luna" | "sol"; block: ProposalBlock } | null {
  if (proposals.luna?.accepted) {
    return { model: "luna", block: proposals.luna };
  }
  if (proposals.sol?.accepted) return { model: "sol", block: proposals.sol };
  return null;
}
