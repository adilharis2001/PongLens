/**
 * Why a card was built without a serve.
 *
 * The serve detector does not score a serve, it accepts a PAIR of bounces.
 * Six rules stand between a pair and acceptance, so the only honest account
 * of a card with no serve is which rule turned each pair away. Guessing
 * from the outside — "the camera is flat", "the ball was occluded" — is how
 * a morning gets spent on the wrong rule.
 *
 * The diagnosis itself is computed in the worker (worker/serve_miss_
 * diagnosis.py) against the detector's own constants, imported rather than
 * copied, so this page cannot drift from what actually shipped. Everything
 * here is presentation and the two clock conversions.
 *
 * Shape note: `t0`/`t1` and every time inside `track`, `bounces` and
 * `crossings` are SOURCE seconds — the clock the assembler worked in. The
 * admin page plays the CUT video. Nothing may be drawn before those are
 * converted, which `cutOffsetFor` below is the single place to do.
 */

export interface MissBounce {
  t: number;
  /** fractions of the frame, so an overlay survives any display size */
  x: number;
  y: number;
  /** metres across / along the table, null when it did not project */
  u: number | null;
  v: number | null;
  onTable: boolean;
  onSurface: boolean;
}

export interface MissWhy {
  bounces: number;
  on_surface: number;
  pairs: number;
  rejects: Record<string, number>;
  reason: string;
  /** [first bounce, second bounce, the rule that turned the pair away] */
  detail: [number, number, string][];
}

/**
 * What the microphone heard across one card.
 *
 * The same 10 kHz-high-pass detector the research pilot runs, measured on
 * the file the ASSEMBLER saw — so these times are on the same clock as the
 * ball track beside them and need the same one conversion to reach the
 * video. It hears the room as well as the table: three to five impacts a
 * second while a rally is running and barely fewer between points, which
 * is why this is drawn rather than believed.
 */
export interface MissAudio {
  /** Source seconds at the FIRST bin. The bins are on the file's own grid
   *  and a card does not start on one, so this is not the card's start. */
  t0: number;
  /** Seconds per bin. */
  bin: number;
  /** Loudness per bin, 0-100, against the match's 99.5th percentile. */
  wave: number[];
  /** [source seconds, how far over the adaptive threshold it peaked] */
  impacts: [number, number][];
}

export interface MissCard {
  t0: number;
  t1: number;
  dur: number;
  /** Where the detector put bat on ball, or null when it found none.
   *  Null on every card the research page publishes; set on the anchored
   *  cards the admin portal additionally carries. */
  serve_s?: number | null;
  /**
   * The two bounces the serve rule actually accepted, in source seconds.
   *
   * A card carries every bounce the detector saw and they all look alike,
   * so which two of them made the serve is the one thing a picture of ten
   * identical rings cannot tell you. Null on a card with no serve, and on
   * any diagnosis published before the pair was recorded.
   */
  serve_bounces?: [number, number] | null;
  track: [number, number, number][];
  bounces: MissBounce[];
  crossings: number[];
  /**
   * Stretches where the ball detector was actually holding the ball, as
   * [start, end] pairs in source seconds.
   *
   * Not derivable from `track`, which is thinned to every third frame on
   * the way out — counting its points would report a break every tenth of
   * a second that is not there. Computed in the worker from the full-rate
   * track, breaking on a gap of more than four frames.
   *
   * Absent on any match diagnosed before the worker started recording it.
   */
  seen?: [number, number][];
  /** Absent, or null, on any match processed before the worker listened. */
  audio?: MissAudio | null;
  why: MissWhy;
}

export interface ServeMissData {
  key: string;
  w: number;
  h: number;
  /** Source frame rate, attached by the portal for legacy gap detection. */
  fps?: number;
  duration: number;
  quad: number[][];
  net: number[][];
  prism: number[][];
  cards: MissCard[];
  total_cards: number;
  reasons: Record<string, string>;
}

export const TABLE_W_M = 1.525;
export const TABLE_L_M = 2.74;

interface FullRateTrackSource {
  cards: { t0: number; track: number[][] }[];
}

/**
 * Attach the server-only full-rate track to the browser diagnosis payload.
 *
 * tracks.json includes BlurBall confidence as a fourth value for winner
 * rules. The table trail needs only time/x/y, so confidence is deliberately
 * removed before the admin page is serialized. Older matches without that
 * artifact retain the thinned serves.json track as a visual fallback.
 */
export function hydrateServeMissData(
  data: ServeMissData,
  tracks: FullRateTrackSource | null,
  fps?: number
): ServeMissData {
  const sourceFps = Number(fps);
  const cards = data.cards.map((card) => {
    const source = tracks?.cards.find(
      (candidate) => Math.abs(Number(candidate.t0) - card.t0) < 0.1
    );
    const fullRate = (source?.track ?? []).flatMap((row) => {
      const [t, x, y] = row.map(Number);
      return [t, x, y].every(Number.isFinite)
        ? ([[t, x, y]] as MissCard["track"])
        : [];
    });
    return fullRate.length > 0 ? { ...card, track: fullRate } : card;
  });
  return {
    ...data,
    ...(Number.isFinite(sourceFps) && sourceFps > 0 ? { fps: sourceFps } : {}),
    cards,
  };
}

export interface TableTrackPoint {
  /** Source-clock seconds. */
  t: number;
  /** Metres across and along the table plane. */
  u: number;
  v: number;
  /** True when the detector lost the ball before this observation. */
  startsSegment: boolean;
}

export interface LiveTableTrackPoint extends TableTrackPoint {
  opacity: number;
  connectsFromPrevious: boolean;
}

export const TABLE_TRAIL_SECONDS = 0.8;

/** The raw observations that should be visible at this playhead position. */
export function tableTrailAt(
  points: TableTrackPoint[],
  now: number,
  windowSeconds = TABLE_TRAIL_SECONDS
): LiveTableTrackPoint[] {
  if (!Number.isFinite(now) || windowSeconds <= 0) return [];
  const visible: LiveTableTrackPoint[] = [];
  let previousIndex: number | null = null;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const age = now - point.t;
    if (age < 0 || age > windowSeconds) continue;
    visible.push({
      ...point,
      opacity: Number((1 - age / windowSeconds).toFixed(6)),
      connectsFromPrevious:
        !point.startsSegment && previousIndex === index - 1,
    });
    previousIndex = index;
  }
  return visible;
}

/**
 * Project BlurBall's raw frame detections onto the physical table plane.
 *
 * Four point correspondences determine the perspective transform. The
 * calibration quad is A/B/C/D: near-left, near-right, far-right, far-left.
 * We deliberately return the individual observations, rather than fitting a
 * curve through bounces, so missed detections remain visible as broken trails.
 */
export function projectTrackToTable(
  track: MissCard["track"],
  quad: number[][],
  sourceWidth: number,
  sourceHeight: number,
  seen?: MissCard["seen"],
  fps?: number
): TableTrackPoint[] {
  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    quad.length !== 4 ||
    quad.some(
      (point) =>
        point.length < 2 ||
        !Number.isFinite(point[0]) ||
        !Number.isFinite(point[1])
    )
  ) {
    return [];
  }

  const destinations = [
    [0, 0],
    [TABLE_W_M, 0],
    [TABLE_W_M, TABLE_L_M],
    [0, TABLE_L_M],
  ];
  const equations: number[][] = [];
  const answers: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const [x, y] = quad[i];
    const [u, v] = destinations[i];
    equations.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    answers.push(u);
    equations.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    answers.push(v);
  }
  const h = solveLinearSystem(equations, answers);
  if (!h) return [];

  const validSeen = seen?.filter(
    (span) =>
      span.length >= 2 &&
      Number.isFinite(span[0]) &&
      Number.isFinite(span[1]) &&
      span[1] >= span[0]
  );
  const positiveSteps = track
    .slice(1)
    .map((row, index) => row[0] - track[index][0])
    .filter((step) => Number.isFinite(step) && step > 0)
    .sort((a, b) => a - b);
  const medianStep = positiveSteps.length
    ? positiveSteps[Math.floor(positiveSteps.length / 2)]
    : 0.1;
  // The worker ends a seen run after more than four missing-frame periods.
  // Older serves.json payloads omit `seen` and thin the track to every third
  // frame, so the same rule must be reconstructed from the source fps.
  const maxGap =
    Number.isFinite(fps) && Number(fps) > 0
      ? 4 / Number(fps) + 1e-6
      : medianStep * (4 / 3) + 0.005;
  const output: TableTrackPoint[] = [];
  let previousT: number | null = null;
  for (const observation of track) {
    const [t, frameX, frameY] = observation;
    if (![t, frameX, frameY].every(Number.isFinite)) continue;
    const x = frameX * sourceWidth;
    const y = frameY * sourceHeight;
    const denominator = h[6] * x + h[7] * y + 1;
    if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-10) {
      previousT = null;
      continue;
    }
    const u = (h[0] * x + h[1] * y + h[2]) / denominator;
    const v = (h[3] * x + h[4] * y + h[5]) / denominator;
    if (!Number.isFinite(u) || !Number.isFinite(v)) {
      previousT = null;
      continue;
    }

    let continuous = previousT !== null && t - previousT <= maxGap;
    if (continuous && validSeen?.length) {
      continuous = validSeen.some(
        ([start, end]) => previousT! >= start && t <= end
      );
    }
    output.push({ t, u, v, startsSegment: !continuous });
    previousT = t;
  }
  return output;
}

/** Gaussian elimination with partial pivoting for the eight homography terms. */
function solveLinearSystem(matrix: number[][], values: number[]): number[] | null {
  const n = values.length;
  const rows = matrix.map((row, index) => [...row, values[index]]);
  for (let column = 0; column < n; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < n; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) {
        pivot = row;
      }
    }
    if (Math.abs(rows[pivot][column]) < 1e-10) return null;
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];

    const divisor = rows[column][column];
    for (let item = column; item <= n; item += 1) {
      rows[column][item] /= divisor;
    }
    for (let row = 0; row < n; row += 1) {
      if (row === column) continue;
      const factor = rows[row][column];
      for (let item = column; item <= n; item += 1) {
        rows[row][item] -= factor * rows[column][item];
      }
    }
  }
  return rows.map((row) => row[n]);
}

/**
 * One colour per rule, held steady between the chips, the picture and the
 * table map, so a card can be read in any of the three.
 */
export const REASON_TONE: Record<string, string> = {
  same_side: "#ff6b6b",
  too_far_apart: "#f59e0b",
  on_the_net_line: "#c084fc",
  off_surface: "#38bdf8",
  no_apex: "#34d399",
  backtracked: "#fb7185",
  rally_running: "#94a3b8",
  no_pair: "#64748b",
  would_have_passed: "#facc15",
};

export function reasonTone(reason: string): string {
  return REASON_TONE[reason] ?? "#a1a1aa";
}

/** A short label for a chip, where the worker's sentence is too long. */
export const REASON_SHORT: Record<string, string> = {
  no_pair: "too few bounces",
  off_surface: "not on the table",
  same_side: "same half",
  too_far_apart: "too far apart",
  on_the_net_line: "on the net line",
  no_apex: "no bounce arc",
  backtracked: "ball went backwards",
  rally_running: "rally already running",
  would_have_passed: "would have passed",
};

export function reasonShort(reason: string): string {
  return REASON_SHORT[reason] ?? reason.replace(/_/g, " ");
}

/**
 * Seconds to ADD to a source-clock time to land on the cut video.
 *
 * The card's own point row is the bridge: `cut_t0` is where its PADDED clip
 * starts in cut seconds, and that padding begins at source `t0 - pre`. So
 * source `t0 - pre` and cut `cut_t0` are the same instant, and everything
 * else follows from the difference.
 *
 * Returns null when the point has no place in the cut file at all, which is
 * every pre-011 match — there is no offset to compute and drawing anyway
 * would put the overlay somewhere arbitrary.
 */
export function cutOffsetFor(
  point: { t0: number; cut_t0: number | null },
  effectivePre: number
): number | null {
  if (point.cut_t0 === null || !Number.isFinite(Number(point.cut_t0))) {
    return null;
  }
  return Number(point.cut_t0) + effectivePre - Number(point.t0);
}

/**
 * The cards with no serve.
 *
 * The portal's artifact carries EVERY card so the placement and the first
 * bounce can be judged on an anchored one too, so "how many did the
 * detector refuse" is now a filter rather than a length. Reading
 * `cards.length` as the refusal count is the mistake this exists to stop.
 */
export function refusedCards(data: ServeMissData | null): MissCard[] {
  if (!data) return [];
  return data.cards.filter((c) => c.serve_s === null || c.serve_s === undefined);
}

/** The cards the detector anchored on a serve it found. */
export function anchoredCards(data: ServeMissData | null): MissCard[] {
  if (!data) return [];
  return data.cards.filter((c) => typeof c.serve_s === "number");
}

/** How many cards each rule accounts for, commonest first. */
export function reasonTally(
  cards: MissCard[]
): { reason: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const c of cards) {
    counts.set(c.why.reason, (counts.get(c.why.reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

/**
 * The diagnosis for one point, matched on its start.
 *
 * Matched by TIME rather than by index: the diagnostic lists only the cards
 * that lack a serve, so its list is shorter than the match's and the two
 * indices mean different things. A tenth of a second of slack covers the
 * rounding the worker applies on the way out; the assembler's card and the
 * points row are otherwise the same number.
 */
export function missForPoint(
  data: ServeMissData | null,
  point: { t0: number }
): MissCard | null {
  if (!data) return null;
  const t0 = Number(point.t0);
  return (
    data.cards.find((c) => Math.abs(c.t0 - t0) < 0.1) ?? null
  );
}
