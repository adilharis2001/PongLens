/**
 * Reading one upload's processing record.
 *
 * Two sources, and they are not interchangeable. Postgres holds the match,
 * its job, its points and their two clocks. Everything the PIPELINE
 * decided — which assembler cut the cards, where it found the table, what
 * the camera was, how good the footage was — is in match.json in R2, and
 * there is no column for any of it. This module parses that file and
 * nothing here touches the network.
 *
 * The file has changed shape four times, so every reader below treats a
 * missing key as "not recorded" rather than as a negative. Measured across
 * the 139 processed matches in production: 10 carry `pipeline`, 7 predate
 * the key entirely, 6 have no table at all, and 4 have a quad from the
 * retired pink-rim calibrator with no `source` naming it. A page that
 * renders any of those as a defect is lying about its own history.
 */

/** A corner in SOURCE pixels — the space table_corners_px is measured in. */
export type Corner = [number, number];
export type Quad = [Corner, Corner, Corner, Corner];

export interface CalibrationAgreement {
  frames_sampled?: number;
  frames_kept?: number;
  frames_used?: number;
  agreement?: number;
  spread_px?: number;
  tables_seen?: number;
}

export interface PlacementEventJson {
  event_id?: string | null;
  t?: number;
  u?: number | null;
  v?: number | null;
  x?: number | null;
  y?: number | null;
  confidence?: number;
}

export interface PlacementCandidateJson extends PlacementEventJson {
  id?: string;
  kind?: string;
  kinds?: string[];
  visual_confidence?: number;
  audio_confidence?: number;
}

export interface PlacementShotJson {
  seq?: number;
  contact_t?: number | null;
  contact?: PlacementEventJson | null;
  serve_first_bounce?: PlacementEventJson | null;
  landing?: PlacementEventJson | null;
}

export interface PlacementHypothesisJson {
  status?: string;
  confidence?: number;
  shots?: PlacementShotJson[];
}

export interface MatchJson {
  version?: number;
  /** Which card assembly ran. Absent on matches processed before 119. */
  pipeline?: "v1" | "v2";
  source?: { duration?: number; fps?: number; width?: number; height?: number };
  options?: {
    strictness?: string;
    placement?: boolean;
    clip_pads?: { pre: number; post: number };
  };
  calibration?: {
    ok?: boolean;
    table_corners_px?: Record<string, [number, number]>;
    length_axis?: [number, number];
    orientation?: string;
    legacy_reordered?: boolean;
    source?: string;
    agreement?: CalibrationAgreement | null;
    note?: string;
  };
  story_crop?: {
    camera?: string;
    frames?: number;
    spread?: number;
  } | null;
  activity_gate?: unknown;
  dropped_micro_points?: number;
  notes?: string[];
  cut_mode?: string;
  cut_segments?: [number, number][];
  points?: Array<{
    idx?: number;
    t0?: number;
    t1?: number;
    serve_s?: number | null;
    placement?: {
      status?: string;
      candidates?: PlacementCandidateJson[];
      hypotheses?: Record<string, PlacementHypothesisJson>;
    } | null;
  }>;
  /** Phase 2 — a structured twin of the `route ...` sentence in notes[]. */
  assembly?: {
    pipeline?: string;
    route?: string;
    serves_per_min?: number;
    camera_shape?: number;
    cards?: number;
  };
}

/** One point, as admin_upload_detail (144) returns it. Deleted included. */
export interface AdminUploadPoint {
  id: string;
  idx: number;
  t0: number;
  t1: number;
  cut_t0: number | null;
  has_clip: boolean;
  server: string | null;
  server_override: string | null;
  confirmed_winner: "user" | "opponent" | null;
  confirmed_how: string | null;
  is_let: boolean;
  deleted: boolean;
  edited: boolean;
  starred: boolean;
  tight_start: boolean;
  tight_end: boolean;
  misread_kind: string | null;
  direction: string | null;
  scored_at_cut_s: number | null;
  serve_start_at_cut_s: number | null;
  rally_end_cut_s: number | null;
  game_end_override: string | null;
  game_winner_override: string | null;
  placement_status: string | null;
  placement_flagged: boolean;
  notes: number;
  /** The OPERATOR's own review (150). Distinct from `notes`, which counts
   *  the player's own notes on their point. */
  admin_note: string | null;
  admin_theme_ids: string[];
}

export interface UploadDetail {
  match: {
    id: string;
    user_id: string;
    opponent_name: string | null;
    match_type: string | null;
    venue: string | null;
    played_at: string | null;
    created_at: string;
    status: string;
    user_side: string | null;
    player_near_name: string | null;
    player_far_name: string | null;
    first_server: "user" | "opponent" | null;
    first_server_source: string | null;
    clip_pads: { pre: number; post: number } | null;
    story_crop: { camera?: string; frames?: number; spread?: number } | null;
    placement_status: string | null;
    placement_mapped_points: number | null;
    placement_failure_code: string | null;
    placement_flagged: boolean;
    content_checked_at: string | null;
    duration_s: number | null;
    original_name: string | null;
    match_json_path: string | null;
    has_cut: boolean;
    has_thumb: boolean;
    raw_available: boolean;
  };
  owner: { user_id: string; email: string; name: string | null } | null;
  job: {
    id: string;
    kind: string;
    status: string;
    progress: number | null;
    error: string | null;
    user_message: string | null;
    created_at: string;
    updated_at: string;
    original_name: string | null;
    strictness: string | null;
    placement_requested: boolean;
    trim_start_s: number | null;
    trim_end_s: number | null;
    charged_minutes: number | null;
    funding: string | null;
    linked_by: string | null;
  } | null;
  spend: { minutes: number; storage_bytes: number };
  totals: {
    points: number;
    visible: number;
    deleted: number;
    scored: number;
    unscored: number;
    skipped: number;
    starred: number;
    edited: number;
    with_clip: number;
    with_cut_t0: number;
    with_tap: number;
    with_rally_end: number;
    with_placement_ready: number;
    src_duration_s: number | null;
    cut_duration_s: number | null;
  };
  points: AdminUploadPoint[];
}

/* -------------------------------------------------------------------------
 * The table
 * ---------------------------------------------------------------------- */

/**
 * The four corners, in the fixed cyclic order A→B→C→D.
 *
 * A is near-left, B near-right, C far-right, D far-left, "near" being the
 * end closest to the camera and left/right as the camera sees them. So A→B
 * is always a 1.525 m end and B→C always a 2.740 m side. Reading them in
 * any other order rotates the table one position, which still draws a
 * plausible quad — that exact mistake put seven of the first sixty-two hand
 * marks in the wrong place.
 *
 * Two key spellings exist in the wild: the pipeline writes A_near_1 and the
 * vision schema writes A_near_left. Both are accepted; anything else is
 * refused rather than guessed at.
 */
const CORNER_KEYS: [string, string][] = [
  ["A_near_1", "A_near_left"],
  ["B_near_2", "B_near_right"],
  ["C_far_2", "C_far_right"],
  ["D_far_1", "D_far_left"],
];

export const CORNER_LABELS = ["A", "B", "C", "D"] as const;

function isCorner(v: unknown): v is Corner {
  return (
    Array.isArray(v) &&
    v.length === 2 &&
    typeof v[0] === "number" &&
    typeof v[1] === "number" &&
    Number.isFinite(v[0]) &&
    Number.isFinite(v[1])
  );
}

/** The quad in A,B,C,D order, or null when any corner is missing. */
export function quadFromCorners(
  corners: Record<string, [number, number]> | undefined | null
): Quad | null {
  if (!corners) return null;
  const out: Corner[] = [];
  for (const [primary, alias] of CORNER_KEYS) {
    const raw = corners[primary] ?? corners[alias];
    if (!isCorner(raw)) return null;
    out.push([raw[0], raw[1]]);
  }
  return out as Quad;
}

export function polygonPoints(corners: readonly Corner[]): string {
  return corners.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
}

export type TableState = "detected" | "refused" | "unknown";

export interface TableReading {
  state: TableState;
  quad: Quad | null;
  /** keypoints | vision | pink_rim | null */
  detector: string | null;
  note: string | null;
  agreement: CalibrationAgreement | null;
  /** side-on | end-on | null. From matches.story_crop, not from the quad. */
  camera: string | null;
}

/**
 * What to draw, and how sure we are of it.
 *
 * "refused" and "unknown" are deliberately different. Refused means the
 * ladder ran and declined — a real, correct outcome, since a wrong table is
 * worse than no table and every rung refuses rather than guesses. Unknown
 * means we never got to ask, because the match predates the record or its
 * file could not be read. Collapsing the two would report our own missing
 * history as a detector failure.
 */
export function readTable(
  matchJson: MatchJson | null,
  storyCrop: { camera?: string } | null | undefined
): TableReading {
  const camera = storyCrop?.camera ?? null;
  if (!matchJson) {
    return {
      state: "unknown",
      quad: null,
      detector: null,
      note: null,
      agreement: null,
      camera,
    };
  }
  const cal = matchJson.calibration;
  const quad = quadFromCorners(cal?.table_corners_px);
  if (!cal || cal.ok !== true || !quad) {
    return {
      state: "refused",
      quad: null,
      detector: cal?.source ?? null,
      note: cal?.note ?? null,
      agreement: null,
      camera,
    };
  }
  return {
    state: "detected",
    quad,
    // A quad with no `source` is from the retired pink-rim calibrator,
    // which is what the pipeline itself defaults the key to.
    detector: cal.source ?? "pink_rim",
    note: cal.note ?? null,
    agreement: cal.agreement ?? null,
    camera,
  };
}

/** Detectors whose quads should be read with suspicion, and why. */
export const DETECTOR_WARNINGS: Record<string, string> = {
  pink_rim:
    "The retired colour calibrator. Twenty-two of sixty-two matches "
    + "reviewed carried a visibly wrong table from it.",
};

/* -------------------------------------------------------------------------
 * Which assembler cut the cards
 * ---------------------------------------------------------------------- */

export type AssemblyRoute = "serve-anchored" | "end-on" | null;

export interface AssemblyReading {
  /** v1 | v2 | null when the file predates the key. */
  pipeline: string | null;
  route: AssemblyRoute;
  /** Where the route came from, so the page can say how sure it is. */
  routeFrom: "structured" | "notes" | "inferred" | null;
  servesPerMin: number | null;
  cameraShape: number | null;
  cards: number | null;
  serves: number | null;
  crossings: number | null;
  /** Cards the assembler managed to anchor on a detected serve, and the
   *  ones it could not. Counted from the cards themselves rather than from
   *  the notes line, so they are right even where the sentence is not. Null
   *  when the file predates per-card serve marks. */
  cardsWithServe: number | null;
  cardsWithoutServe: number | null;
  /** Why v2 was asked for and did not run. */
  fallbackReason: string | null;
  /** The router's own threshold, for explaining the decision. */
  threshold: number;
}

/** points_endon.SERVE_RATE_MIN. Mirrored, not imported — the worker is
 *  Python. It has moved once (2.5 → 2.1) and will move again. */
export const SERVE_RATE_MIN = 2.1;

const ROUTE_NOTE =
  /points v2:\s*(\d+)\s*cards,\s*(\d+)\s*serves,\s*(\d+)\s*crossings,\s*camera\s*([\d.]+),\s*serves\/min\s*([\d.]+),\s*route\s*([a-z-]+)/i;
const FALLBACK_NOTE = /points v2 requested but fell back to v1:\s*(.+)$/i;

/**
 * Which assembler produced this match's cards.
 *
 * The honest answer is that until phase 2 there is no field for it. The
 * worker writes the decision into match.json's `notes` array as a SENTENCE
 * — "…serves/min 1.86, route end-on" — so the primary read is a regex over
 * prose, which will break the day someone rewords that line.
 *
 * So there is a second, independent read that cannot break the same way:
 * an end-on card carries no detected serve, and points_endon writes
 * serve_s: None on every card it builds. If the file says v2 and not one
 * card has a serve, the end-on assembler ran. That agrees with the sentence
 * wherever both exist, and answers alone where the sentence has been
 * reworded.
 *
 * It is deliberately NOT inferred from app_config.points_endon_fallback:
 * that switch describes the NEXT upload, not this one.
 */
export function readAssembly(matchJson: MatchJson | null): AssemblyReading {
  const base: AssemblyReading = {
    pipeline: null,
    route: null,
    routeFrom: null,
    servesPerMin: null,
    cameraShape: null,
    cards: null,
    serves: null,
    crossings: null,
    cardsWithServe: null,
    cardsWithoutServe: null,
    fallbackReason: null,
    threshold: SERVE_RATE_MIN,
  };
  if (!matchJson) return base;
  base.pipeline = matchJson.pipeline ?? null;

  // Per-card serve coverage, straight from the cards. A v1 match has no
  // serve marks at all, so counting there would report every card as a
  // miss; only v2 files are asked.
  const cardList = matchJson.points;
  if (base.pipeline === "v2" && Array.isArray(cardList) && cardList.length) {
    const withServe = cardList.filter((c) => typeof c.serve_s === "number").length;
    base.cardsWithServe = withServe;
    base.cardsWithoutServe = cardList.length - withServe;
  }

  // 1. The structured block, once the worker writes one.
  const structured = matchJson.assembly;
  if (structured?.route === "serve-anchored" || structured?.route === "end-on") {
    return {
      ...base,
      pipeline: structured.pipeline ?? base.pipeline,
      route: structured.route,
      routeFrom: "structured",
      servesPerMin: structured.serves_per_min ?? null,
      cameraShape: structured.camera_shape ?? null,
      cards: structured.cards ?? null,
      cardsWithServe: base.cardsWithServe,
      cardsWithoutServe: base.cardsWithoutServe,
    };
  }

  // 2. The sentence.
  for (const note of matchJson.notes ?? []) {
    const m = ROUTE_NOTE.exec(note);
    if (m) {
      const route = m[6] === "end-on" ? "end-on" : "serve-anchored";
      return {
        ...base,
        route,
        routeFrom: "notes",
        cards: Number(m[1]),
        serves: Number(m[2]),
        crossings: Number(m[3]),
        cameraShape: Number(m[4]),
        servesPerMin: Number(m[5]),
      };
    }
    const f = FALLBACK_NOTE.exec(note);
    if (f) base.fallbackReason = f[1].trim();
  }

  // 3. The structural tell. Only meaningful on a v2 match: a v1 point has
  //    no serve mark either, so this would call every old match end-on.
  const points = matchJson.points;
  if (base.pipeline === "v2" && Array.isArray(points) && points.length > 0) {
    const withServe = points.filter(
      (p) => typeof p.serve_s === "number"
    ).length;
    if (withServe === 0) {
      return { ...base, route: "end-on", routeFrom: "inferred" };
    }
  }
  return base;
}

/** One line explaining the route in the router's own terms. */
export function routeExplanation(a: AssemblyReading): string | null {
  if (a.route === null) return null;
  if (a.servesPerMin === null) {
    return a.route === "end-on"
      ? "No card carries a detected serve, which is what the end-on "
        + "assembler produces."
      : "Cards are anchored on detected serves.";
  }
  const rate = a.servesPerMin.toFixed(2);
  return a.route === "end-on"
    ? `${rate} serves a minute, under the ${a.threshold} the serve-anchored `
      + "assembler needs, so the whole match was segmented on motion instead."
    : `${rate} serves a minute, over the ${a.threshold} threshold, so every `
      + "card is anchored on a detected serve.";
}

/* -------------------------------------------------------------------------
 * Clocks and counting
 * ---------------------------------------------------------------------- */

/** Seconds to a clock: 754 -> "12:34", 5025 -> "1:23:45". */
export function formatClock(seconds: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/** How much of the source survived the cut, as a whole percent. */
export function retentionPct(
  srcSeconds: number | null,
  cutSeconds: number | null
): number | null {
  if (
    srcSeconds == null ||
    cutSeconds == null ||
    !Number.isFinite(srcSeconds) ||
    !Number.isFinite(cutSeconds) ||
    srcSeconds <= 0 ||
    cutSeconds < 0
  ) {
    return null;
  }
  return Math.min(100, Math.round((cutSeconds / srcSeconds) * 100));
}

/**
 * The frame rate a phone actually recorded at, and the measured number.
 *
 * Nothing arrives at a round rate: 29.976, 29.986, 29.999 and 30.0 all
 * appear across the last twenty-five uploads and every one of them is a
 * 30 fps recording. The rate people mean is the standard one, so that is
 * what the value says, with what was measured underneath.
 *
 * Snapped to the nearest of the rates cameras actually shoot, and only
 * when it is genuinely close — anything else is reported as it was
 * measured rather than rounded into a category it does not belong to.
 *
 * Read from match.json, which the pipeline probes on the file it was
 * handed. A trim is a stream copy, so a trimmed job's rate is still the
 * uploaded one.
 */
const STANDARD_FPS = [24, 25, 30, 48, 50, 60, 120, 240];

export function fpsLabel(
  fps: number | null | undefined
): { value: string; detail: string | null } {
  if (fps == null || !Number.isFinite(fps) || fps <= 0) {
    return { value: "Not recorded", detail: null };
  }
  const near = STANDARD_FPS.find((r) => Math.abs(fps - r) <= r * 0.02);
  return {
    value: near ? `${near} fps` : `${fps.toFixed(2)} fps`,
    detail: near && Math.abs(fps - near) > 0.005 ? `${fps.toFixed(3)} measured` : null,
  };
}

export function gbLabel(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) {
    const v = gb.toFixed(1);
    return `${v.endsWith(".0") ? v.slice(0, -2) : v} GB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

export function whenLabel(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year:
      date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

/* -------------------------------------------------------------------------
 * The cards
 * ---------------------------------------------------------------------- */

export interface UploadPointRow extends AdminUploadPoint {
  lengthS: number;
  /** Dead time the cut removed before this point, on the source timeline. */
  gapBeforeS: number;
  /** 1-based number the OWNER sees, over non-deleted points only. Null on a
   *  deleted point, which has no number in the app at all. */
  displayNo: number | null;
}

/** Ordered rows with each point's length, the gap ahead of it and the
 *  number the owner sees. Deleted points stay in the list — the cut file
 *  still contains their footage — but they carry no display number, which
 *  is exactly how the match page treats them. */
export function buildPointRows(
  points: AdminUploadPoint[]
): UploadPointRow[] {
  const ordered = [...points].sort(
    (a, b) => Number(a.t0) - Number(b.t0) || a.idx - b.idx
  );
  let prevEnd = 0;
  let visibleNo = 0;
  return ordered.map((p) => {
    const t0 = Number(p.t0);
    const t1 = Number(p.t1);
    if (!p.deleted) visibleNo += 1;
    const row: UploadPointRow = {
      ...p,
      t0,
      t1,
      cut_t0: p.cut_t0 == null ? null : Number(p.cut_t0),
      lengthS: Math.max(0, t1 - t0),
      gapBeforeS: Math.max(0, t0 - prevEnd),
      displayNo: p.deleted ? null : visibleNo,
    };
    prevEnd = Math.max(prevEnd, t1);
    return row;
  });
}

export interface TimelineSegment {
  id: string;
  leftPct: number;
  widthPct: number;
  deleted: boolean;
}

/** The kept spans as percentages of the source timeline. The unpainted
 *  remainder is what the cut removed. */
export function timelineSegments(
  rows: UploadPointRow[]
): TimelineSegment[] {
  const total = rows.reduce((max, r) => Math.max(max, r.t1), 0);
  if (total <= 0) return [];
  return rows.map((r) => ({
    id: r.id,
    leftPct: (r.t0 / total) * 100,
    widthPct: Math.max(0.2, ((r.t1 - r.t0) / total) * 100),
    deleted: r.deleted,
  }));
}

export type FlagTone = "warn" | "muted";
export interface PointFlag {
  label: string;
  tone: FlagTone;
}

/**
 * What stands out about a card.
 *
 * "warn" is reserved for something a human did because the machine got it
 * wrong — an edited boundary, a flagged misread. Everything else is
 * ordinary pipeline vocabulary and stays muted, because an amber wash over
 * a normal match trains the eye to ignore amber.
 */
export function pointFlags(p: AdminUploadPoint): PointFlag[] {
  const flags: PointFlag[] = [];
  if (p.edited) flags.push({ label: "edited", tone: "warn" });
  if (p.misread_kind) flags.push({ label: "misread", tone: "warn" });
  if (p.placement_flagged) flags.push({ label: "placement flagged", tone: "warn" });
  if (p.tight_start && p.tight_end) flags.push({ label: "split both ends", tone: "muted" });
  else if (p.tight_start) flags.push({ label: "split start", tone: "muted" });
  else if (p.tight_end) flags.push({ label: "split end", tone: "muted" });
  if (p.deleted) flags.push({ label: "removed by owner", tone: "muted" });
  if (!p.has_clip) flags.push({ label: "no clip", tone: "muted" });
  if (p.server_override) flags.push({ label: "server corrected", tone: "muted" });
  return flags;
}

export function gapLabel(gapBeforeS: number): string | null {
  if (gapBeforeS < 1) return null;
  return `${Math.round(gapBeforeS)}s dead before`;
}

/** "15:04 of footage · 7:39 removed" for the strip's caption. */
export function timelineSummary(rows: UploadPointRow[]): string | null {
  if (rows.length === 0) return null;
  const total = rows.reduce((max, r) => Math.max(max, r.t1), 0);
  const played = rows.reduce((sum, r) => sum + r.lengthS, 0);
  const playedLabel = formatClock(played);
  const removedLabel = formatClock(Math.max(0, total - played));
  if (!playedLabel || !removedLabel) return null;
  return `${playedLabel} of play · ${removedLabel} removed`;
}

/* -------------------------------------------------------------------------
 * Trouble
 * ---------------------------------------------------------------------- */

export interface TroubleLine {
  tone: "amber" | "red";
  title: string;
  detail: string | null;
}

/**
 * What went wrong, in the order it would have gone wrong.
 *
 * `placement_status` is never 'failed' — the four live values are
 * not_requested, ready, retry_available and final_failed — and a page that
 * tests for 'failed' silently reports nothing on the five matches that
 * actually did fail.
 */
export function troubleLines(d: UploadDetail): TroubleLine[] {
  const out: TroubleLine[] = [];
  const m = d.match;
  const job = d.job;

  if (m.status === "uploaded") {
    out.push({
      tone: "amber",
      title: "Not processed yet",
      detail: "No cut, no points, no table. Only the original video exists.",
    });
  } else if (m.status === "failed") {
    // A gate refusal is written to the job's user_message; a stage crash
    // lands in error. The cut can have shipped before the points stage
    // died, which is why the job can read 'done' on a failed match.
    if (job?.user_message) {
      out.push({
        tone: "red",
        title: "Turned away at upload",
        detail: job.user_message,
      });
    } else if (job?.status === "done") {
      out.push({
        tone: "red",
        title: "The cut shipped, then the points stage failed",
        detail: job.error,
      });
    } else {
      out.push({
        tone: "red",
        title: "Processing failed",
        detail: job?.error ?? null,
      });
    }
  } else if (job && (job.status === "failed" || job.status === "cancelled")) {
    out.push({
      tone: "amber",
      title: `Job ${job.status}`,
      detail: job.error,
    });
  }

  if (m.placement_status === "final_failed") {
    out.push({
      tone: "amber",
      title: "Placement gave up",
      detail: m.placement_failure_code,
    });
  } else if (m.placement_status === "retry_available") {
    out.push({
      tone: "amber",
      title: "Placement can be retried",
      detail: m.placement_failure_code,
    });
  }

  return out;
}
