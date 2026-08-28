import type { Point } from "@/lib/types";
import type { ServePlacementRejection } from "@/lib/placement/placementAggregate";

export const TABLE_W_M = 1.525;
export const TABLE_L_M = 2.74;

/**
 * The matches with a re-run ball track on disk.
 *
 * One file each rather than one file for all of them: six matches is two
 * megabytes of ball positions, and the page only ever reads the open
 * match's. Adding a seventh means a track file, a slug here and a line in
 * the loader — deliberately three edits, so a match cannot be listed with
 * no track behind it.
 */
export const TRACK_SLUGS = [
  "chris",
  "julian",
  "rowel",
  "ishan",
  "prabhas",
  "anton",
] as const;
export type TrackSlug = (typeof TRACK_SLUGS)[number];

/** One detected touch, in every frame of reference we have for it. */
export interface DetectedEvent {
  id: string;
  /** "bounce" | "contact" | "impact" | "net" | "out". */
  kind: string;
  /** Seconds into the SOURCE video. */
  t: number;
  /** Seconds into this point's clip; null when the clip offset is unknown. */
  clipT: number | null;
  /** Pixels in the source frame, and the same point in table metres. */
  x: number | null;
  y: number | null;
  u: number | null;
  v: number | null;
  /** Normalized for the drawn map: you at the bottom, your left on the left. */
  nu: number | null;
  nv: number | null;
  visual: number;
  audio: number;
  /** Which part the reconstruction cast it in, when it cast it at all. */
  role: "serve_first_bounce" | "serve_landing" | "landing" | "contact" | null;
}

/** What the worker thought, independently of the pad. */
export interface ComputedCall {
  winner: "user" | "opponent" | null;
  how: string | null;
  reason: string | null;
  hits: number | null;
}

/**
 * How fast the ball crossed the table on the serve.
 *
 * Straight-line distance between the serve's two bounces divided by the
 * time between them: an average horizontal speed, not a peak, and not
 * racket speed. Nothing has validated it against a measured serve, which
 * is why it is on a research page and not in the product.
 */
export interface ServeSpeed {
  metresPerSecond: number;
  kmh: number;
  metres: number;
  seconds: number;
  frames: number;
}

/**
 * How long the rally ran, by the three counts we actually hold.
 *
 * They disagree, and the disagreement is the useful part. `hits` is the
 * worker's own count from the point assembler; `shots` is how many the
 * placement reconstruction managed to build; `contacts` is how many racket
 * touches were detected at all. On the Chris match the medians are 2, 4
 * and 3 — so none of them is "the" rally length yet, and showing one alone
 * would be picking a winner nobody has judged.
 */
export interface RallyLength {
  hits: number | null;
  shots: number;
  contacts: number;
  seconds: number | null;
}

export interface ServeAccuracyRow {
  pointId: string;
  idx: number;
  game: number;
  server: "user" | "opponent" | null;
  /** Your tap. */
  winner: "user" | "opponent" | null;
  isLet: boolean;
  /** The worker's own call, which the app ignores once you have tapped. */
  computed: ComputedCall | null;
  serve: { u: number; v: number } | null;
  final: { u: number; v: number; shotSeq: number } | null;
  rejection: ServePlacementRejection | null;
  events: DetectedEvent[];
  speed: ServeSpeed | null;
  rally: RallyLength;
  /** Which end you were on for THIS point; ends swap every game. */
  userPhysicalSide: "near" | "far" | null;
  /** Clip bounds in source seconds, so events line up with the video. */
  clipT0: number | null;
}

export interface ServeAccuracyMatch {
  matchId: string;
  /** Names the ball-track file for this match under `tracks/`. */
  slug: TrackSlug;
  label: string;
  opponent: string;
  /** Table corners in SOURCE pixels, for drawing the quad over the clip. */
  corners: Record<string, [number, number]> | null;
  source: { width: number; height: number; fps: number } | null;
  calibrationSource: string | null;
  /** Which end the uploader was on in game one, when they told us. */
  userSide: "near" | "far" | null;
  /** How many points were bounded by a real serve tap. */
  serveAnchored: number;
  /** Who served point one, and whether a person said so. The whole serve
   *  rotation is arithmetic on these two, so a match where nobody answered
   *  has a rotation built on a guess — and it is wrong for every point at
   *  once when the guess is wrong, which reads as a finding rather than a
   *  bug. */
  firstServer: "user" | "opponent" | null;
  firstServerSource: "user" | "detected" | null;
  /**
   * What is known to be untrustworthy about THIS match, in plain words.
   *
   * The page compares its own reading against the uploader's taps, and a
   * match whose ends are misread scores badly for a reason that has nothing
   * to do with the rules being tested. Saying so on the match is the only
   * thing that stops the next person reading the number as a rule failure.
   */
  caution: string | null;
  rows: ServeAccuracyRow[];
}

export const REJECTION_COPY: Record<ServePlacementRejection, string> = {
  deleted: "Point was deleted.",
  not_v3: "No ball tracking was stored for this point.",
  no_server: "The scored rotation does not say who served.",
  no_serve_shot: "No serve was reconstructed.",
  no_landing: "The serve's landing was never measured.",
  off_table: "The landing projects outside the table.",
  wrong_half: "The landing is on the server's own half.",
  first_bounce_wrong_half:
    "The serve's first bounce is on the receiver's half, so this may not be "
    + "the player the rotation says it is.",
  not_consecutive:
    "Something else touched the table between the serve's two bounces.",
  no_zone: "The landing does not fall in a zone.",
};

/**
 * A serve speed we are willing to print.
 *
 * Thrown out: a non-positive interval, two bounces closer than 30 cm, and
 * anything over a second apart. Each is a sign the pair is not one serve
 * rather than a slow one, and on the Chris match they account for 7 of 96.
 */
export function serveSpeed(
  from: { u: number | null; v: number | null; t: number },
  to: { u: number | null; v: number | null; t: number },
  fps: number,
): ServeSpeed | null {
  if (from.u === null || from.v === null || to.u === null || to.v === null) {
    return null;
  }
  const seconds = to.t - from.t;
  const metres = Math.hypot(to.u - from.u, to.v - from.v);
  if (seconds <= 0 || seconds > 1 || metres < 0.3) return null;
  const metresPerSecond = metres / seconds;
  return {
    metresPerSecond,
    kmh: metresPerSecond * 3.6,
    metres,
    seconds,
    frames: Math.round(seconds * fps),
  };
}

export function summarise(rows: readonly ServeAccuracyRow[]) {
  const byReason = new Map<ServePlacementRejection, number>();
  for (const r of rows) {
    if (r.rejection === null) continue;
    byReason.set(r.rejection, (byReason.get(r.rejection) ?? 0) + 1);
  }
  const scored = rows.filter((r) => r.winner !== null && r.computed?.winner);
  const agreed = scored.filter((r) => r.computed?.winner === r.winner).length;
  const speeds = rows
    .map((r) => r.speed?.kmh)
    .filter((k): k is number => k !== undefined)
    .sort((a, b) => a - b);
  return {
    drawn: rows.filter((r) => r.serve !== null).length,
    total: rows.length,
    withFinal: rows.filter((r) => r.final !== null).length,
    events: rows.reduce((n, r) => n + r.events.length, 0),
    reasons: [...byReason.entries()].sort((a, b) => b[1] - a[1]),
    callAgreed: agreed,
    callCompared: scored.length,
    speedCount: speeds.length,
    speedMedian: speeds.length
      ? speeds[Math.floor(speeds.length / 2)]
      : null,
  };
}

export function livePoints(points: readonly Point[]): Point[] {
  return points.filter((p) => !p.deleted);
}
