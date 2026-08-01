"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import type {
  Placement,
  PlacementBounce,
  PlacementBounceV2,
  PlacementV3,
} from "@/lib/types";
import {
  buildPlacementRenderModel,
  placementNotice,
  selectPlacementHypothesis,
} from "@/lib/placement/placementModel";
import { physicalSideForGame, type Side } from "./sides";
import {
  L_M,
  makeMapXY,
  NET_Y,
  Segmented,
  Table,
  THEM_COLOR,
  W_M,
  YOU_COLOR,
} from "./placementTable";

/*
 * THE ORIENTATION INVARIANT
 * The map is always rendered as seen from above and behind the user:
 * user at bottom edge, user's left = map left.
 *
 * Worker data frame (points_pipeline.py calibrate()):
 *   v = 0   the end line nearest the camera ("near"); v = 2.74 the far end.
 *   u = 0   the sideline on the NEAR player's RIGHT (image-right).
 * The u orientation is fixed by the calibration quad's cyclic hull order:
 * corner A (u=0, v=0) is always the near end's image-right corner
 * (cv2.convexHull's orientation is deterministic; verified against real
 * match calibrations, e.g. A=(1171,600) right of B=(900,526)).
 *
 * Therefore:
 *   user near  ->  user's left is u = W_M  ->  mirror u, near end at bottom.
 *   user far   ->  the whole view rotates 180 degrees: keep u, flip v.
 * Untagged matches render the camera's own view (same geometry as the near
 * view) with neutral Near/Far labels; there is no user to orient for, so we
 * skip the user mirroring and simply match what the video shows: a ball
 * that lands on the left of the video lands on the left of the map.
 *
 * Players change ends every game, so the side at the bottom for a given
 * point is physicalSideForGame(userSide, gameIndex), not userSide itself.
 * The court SVG + meters→pixels mapping live in ./placementTable so the
 * per-point map and the match aggregate share one definition.
 */

function isV2(p: Placement): p is { v: 2; bounces: PlacementBounceV2[] } {
  return "v" in p && p.v === 2;
}

function isV3(p: Placement): p is PlacementV3 {
  return "v" in p && p.v === 3;
}

export function hasPlacementBounces(p: Placement | null): boolean {
  if (!p) return false;
  if (isV3(p)) {
    return Object.values(p.hypotheses).some((hypothesis) =>
      hypothesis.shots.some(
        (shot) => shot.landing !== null || shot.terminal !== null,
      ),
    );
  }
  return Array.isArray(p.bounces) && p.bounces.length > 0;
}

const FINAL_RING: Record<string, string> = {
  winner_landing: "#34d399",
  net: "#f87171",
  out_adjacent: "#f87171",
  unknown: "#94a3b8",
};

export interface MapLabels {
  you: string; // "You" (or the player's name for coach viewers)
  them: string; // opponent name or "Them"/"Opponent"
  near: string; // neutral fallback while user_side is unset
  far: string;
}

const DEFAULT_LABELS: MapLabels = {
  you: "You",
  them: "Them",
  near: "Near player",
  far: "Far player",
};

/** A small colored swatch + label, one key row entry. */
function Key({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-zinc-400">
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}

/** Always-present key. Colors follow the hitter; the ring marks the ending. */
function Legend({
  tagged,
  labels,
  showRing,
}: {
  tagged: boolean;
  labels: MapLabels;
  showRing: boolean;
}) {
  const youLabel = tagged ? labels.you : labels.far;
  const themLabel = tagged ? labels.them : labels.near;
  return (
    <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
      <Key color={YOU_COLOR} label={`${youLabel} shots`} />
      <Key color={THEM_COLOR} label={`${themLabel} shots`} />
      <span className="inline-flex items-center gap-1 text-[10px] text-zinc-400">
        <span className="font-bold text-zinc-300">S</span> serve
      </span>
      {/* The dotted carry is the one thing on this map that was reasoned
          rather than seen, so it says so rather than leaving a mystery
          line for people to interpret however they like. */}
      {showRing && (
        <span className="inline-flex items-center gap-1.5 text-[10px] text-zinc-400">
          <svg width="14" height="4" aria-hidden="true">
            <line
              x1="0"
              y1="2"
              x2="14"
              y2="2"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeDasharray="2 3"
            />
          </svg>
          carried to the end
        </span>
      )}
      {showRing && (
        <span className="inline-flex items-center gap-1.5 text-[10px] text-zinc-400">
          <RingSwatch color="#34d399" /> won
          <RingSwatch color="#f87171" /> net / out
        </span>
      )}
    </div>
  );
}

function RingSwatch({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 10 10" className="inline-block h-2.5 w-2.5" aria-hidden>
      <circle cx="5" cy="5" r="3.5" fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

/**
 * One-tap orientation prompt, shown on the untagged map for the owner.
 * Picking an end writes matches.user_side (via the same MatchView callback
 * PlayerTagging uses) and the map re-orients you to the bottom immediately.
 */
function OrientationPrompt({
  labels,
  onSetUserSide,
}: {
  labels: MapLabels;
  onSetUserSide: (side: Side) => void;
}) {
  const btn =
    "flex-1 rounded-lg border border-edge bg-ink/40 px-4 py-2 text-sm font-semibold text-zinc-200 transition-colors hover:border-cyan-glow/50 hover:text-white";
  return (
    <div className="mb-3 rounded-lg border border-cyan-glow/30 bg-cyan-glow/[0.06] p-3">
      <p className="text-center text-xs font-medium text-zinc-200">
        Which end are you?
      </p>
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={() => onSetUserSide("near")} className={btn}>
          Near
          <span className="mt-0.5 block text-[10px] font-normal text-zinc-500">
            {labels.near} · bottom of video
          </span>
        </button>
        <button type="button" onClick={() => onSetUserSide("far")} className={btn}>
          Far
          <span className="mt-0.5 block text-[10px] font-normal text-zinc-500">
            {labels.far} · top of video
          </span>
        </button>
      </div>
      <p className="mt-2 text-center text-[10px] text-zinc-500">
        We&apos;ll orient the map so you&apos;re always at the bottom.
      </p>
    </div>
  );
}

/** v1 fallback: the original dot map for old rows, orientation fixed. */
function PlacementMapV1({
  bounces,
  bottom,
  tagged,
  labels,
  topLabel,
  bottomLabel,
}: {
  bounces: PlacementBounce[];
  bottom: Side;
  tagged: boolean;
  labels: MapLabels;
  topLabel: string;
  bottomLabel: string;
}) {
  const mapXY = makeMapXY(bottom);
  const colorFor = (side: Side) =>
    tagged
      ? side === bottom
        ? YOU_COLOR
        : THEM_COLOR
      : side === "far"
        ? YOU_COLOR
        : THEM_COLOR;
  const sorted = [...bounces].sort((a, b) => a.t - b.t);
  return (
    <div>
      <Table topLabel={topLabel} bottomLabel={bottomLabel}>
        {sorted.map((b, i) => {
          const { x, y } = mapXY(b.u, b.v);
          return (
            <g key={i}>
              <circle
                cx={x}
                cy={y}
                r="8"
                fill={colorFor(b.side)}
                stroke="white"
                strokeWidth="1.5"
              />
              <text
                x={x}
                y={y + 3}
                textAnchor="middle"
                fontSize="9"
                fill="#0c1222"
                fontWeight="700"
              >
                {i === 0 ? "S" : i + 1}
              </text>
            </g>
          );
        })}
      </Table>
      <Legend tagged={tagged} labels={labels} showRing={false} />
    </div>
  );
}

// WHOSE shots (segmented) and which PHASE of the point (independent toggles).
type WhoFilter = "both" | "you" | "them";
type ViewMode = "trajectory" | "landing";
type Filters = {
  view: ViewMode;
  who: WhoFilter;
  serve: boolean;
  rally: boolean;
  final: boolean;
};
const DEFAULT_FILTERS: Filters = {
  view: "trajectory",
  who: "both",
  serve: true,
  rally: true,
  final: true,
};
const FILTERS_KEY = "ponglens.placement.v4";

/** v2: role-tagged landings — trajectory arrows or bare landing dots. */
function PlacementMapV2({
  bounces,
  bottom,
  tagged,
  labels,
  serverPhysicalSide = null,
}: {
  bounces: PlacementBounceV2[];
  bottom: Side;
  tagged: boolean;
  labels: MapLabels;
  serverPhysicalSide?: Side | null;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);

  // Remembered across sessions (localStorage); read after mount so the
  // server-rendered HTML always matches the first client render.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(FILTERS_KEY);
      if (raw) setFilters({ ...DEFAULT_FILTERS, ...JSON.parse(raw) });
    } catch {
      // Ignore: defaults are fine.
    }
  }, []);

  const apply = useCallback((next: Filters) => {
    setFilters(next);
    try {
      window.localStorage.setItem(FILTERS_KEY, JSON.stringify(next));
    } catch {
      // Ignore: the toggle still works for this view.
    }
  }, []);

  const mapXY = useMemo(() => makeMapXY(bottom), [bottom]);

  // The shot chain: every landing except serve_1 (the server's own-half
  // serve bounce, which belongs to the same shot as serve_2 and is noise
  // on an arrow map). Landings are seq-ordered; each shot's arrow runs
  // from the previous landing to its own. The serve arrow originates at
  // the center of the server's end line.
  const chain = useMemo(() => {
    const sorted = [...bounces].sort((a, b) => a.seq - b.seq);
    return sorted.filter((b) => b.role !== "serve_1");
  }, [bounces]);

  if (chain.length === 0) return null;

  const isLanding = filters.view === "landing";
  const serverSide: Side = serverPhysicalSide ?? chain[0].hitter_side;
  // Shot ownership: with a rotation-derived server, landings alternate
  // deterministically (serve, return, serve side, ...). Otherwise trust
  // the engine's guess per bounce.
  const ownerOf = (i: number, b: PlacementBounceV2): Side =>
    serverPhysicalSide
      ? i % 2 === 0
        ? serverSide
        : serverSide === "near"
          ? "far"
          : "near"
      : b.hitter_side;
  const origin = mapXY(W_M / 2, serverSide === "near" ? 0 : L_M);

  const colorFor = (hitter: Side) =>
    tagged
      ? hitter === bottom
        ? YOU_COLOR
        : THEM_COLOR
      : hitter === "far"
        ? YOU_COLOR
        : THEM_COLOR;

  const hitterVisible = (hitter: Side) => {
    if (filters.who === "both") return true;
    const isBottom = tagged ? hitter === bottom : hitter === "near";
    return filters.who === "you" ? isBottom : !isBottom;
  };
  const roleVisible = (role: PlacementBounceV2["role"]) => {
    if (role === "serve_2") return filters.serve;
    if (role === "rally") return filters.rally;
    return filters.final;
  };

  const n = chain.length;
  // Older shots fade so the deciding exchanges stay the most visible.
  const fade = (i: number) => (n <= 3 ? 1 : 0.35 + 0.65 * (i / (n - 1)));

  const pts = chain.map((b) => mapXY(b.u, b.v));

  const segments = chain.map((b, i) => {
    const from = i === 0 ? origin : pts[i - 1];
    const to = pts[i];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    // Stop the line short of the tip so the arrowhead points at the spot.
    const t = Math.max(0, (len - 5) / len);
    return {
      b,
      from,
      to,
      tip: { x: from.x + dx * t, y: from.y + dy * t },
      dir: { x: dx / len, y: dy / len },
      // Number sits beside the tip, off the line of travel.
      label: { x: to.x - (dy / len) * 9, y: to.y + (dx / len) * 9 },
      color: colorFor(ownerOf(i, b)),
      opacity: fade(i),
      visible: hitterVisible(ownerOf(i, b)) && roleVisible(b.role),
      isServe: b.role === "serve_2",
    };
  });

  const last = segments[n - 1];
  const finalKind =
    last.b.role === "final" ? (last.b.final_kind ?? "unknown") : null;
  // Net and out endings are honest about leaving the table: a faded dashed
  // continuation from the last landing to an X where the ball actually
  // died (the net line, or just past the end line it was heading for).
  let missEnd: { x: number; y: number } | null = null;
  if (finalKind === "net") {
    const towardNet = last.to.y > NET_Y ? NET_Y + 2 : NET_Y - 2;
    missEnd = { x: last.to.x, y: towardNet };
  } else if (finalKind === "out_adjacent") {
    const d =
      Math.abs(last.dir.x) + Math.abs(last.dir.y) > 0.01
        ? last.dir
        : { x: 0, y: last.to.y > NET_Y ? 1 : -1 };
    missEnd = { x: last.to.x + d.x * 24, y: last.to.y + d.y * 24 };
  }

  const whoOptions: { key: WhoFilter; label: string }[] = [
    { key: "you", label: tagged ? labels.you : labels.near },
    { key: "them", label: tagged ? labels.them : labels.far },
    { key: "both", label: "Both" },
  ];
  const phaseChips: { key: "serve" | "rally" | "final"; label: string }[] = [
    { key: "serve", label: "Serve" },
    { key: "rally", label: "Rally" },
    { key: "final", label: "Final" },
  ];

  const phaseClass = (active: boolean) =>
    `rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
      active
        ? "border-cyan-glow/50 bg-cyan-glow/10 text-cyan-glow"
        : "border-edge bg-ink/40 text-zinc-500 hover:text-zinc-300"
    }`;

  return (
    <div>
      {/* controls: view + whose shots (segmented), then phase toggles */}
      <div className="mb-2 flex flex-wrap items-center justify-center gap-2">
        <Segmented
          ariaLabel="Map style"
          value={filters.view}
          onChange={(v) => apply({ ...filters, view: v })}
          options={[
            { key: "trajectory", label: "Trajectory" },
            { key: "landing", label: "Landing" },
          ]}
        />
        <Segmented
          ariaLabel="Whose shots"
          value={filters.who}
          onChange={(v) => apply({ ...filters, who: v })}
          options={whoOptions}
        />
      </div>
      <div className="mb-2 flex flex-wrap items-center justify-center gap-1.5">
        {phaseChips.map((c) => (
          <button
            key={c.key}
            type="button"
            aria-pressed={filters[c.key]}
            onClick={() => apply({ ...filters, [c.key]: !filters[c.key] })}
            className={phaseClass(filters[c.key])}
          >
            {c.label}
          </button>
        ))}
      </div>

      <Table
        topLabel={tagged ? labels.them : labels.far}
        bottomLabel={tagged ? labels.you : labels.near}
      >
        <defs>
          <marker
            id={`ah-you-${uid}`}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M0 0 L10 5 L0 10 z" fill={YOU_COLOR} />
          </marker>
          <marker
            id={`ah-them-${uid}`}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M0 0 L10 5 L0 10 z" fill={THEM_COLOR} />
          </marker>
        </defs>

        {segments.map((s, i) => {
          if (!s.visible) return null;
          if (isLanding) {
            // "Where did it land": bare dots, colored by hitter. The serve
            // keeps its S so the key reads on this view too.
            return (
              <g key={s.b.seq} opacity={s.opacity}>
                <circle
                  cx={s.to.x}
                  cy={s.to.y}
                  r={s.isServe ? 6 : 5}
                  fill={s.color}
                  stroke="#0c1222"
                  strokeWidth="1"
                />
                {s.isServe && (
                  <text
                    x={s.to.x}
                    y={s.to.y + 2.7}
                    textAnchor="middle"
                    fontSize="8"
                    fill="#0c1222"
                    fontWeight="800"
                  >
                    S
                  </text>
                )}
              </g>
            );
          }
          const markerId =
            s.color === YOU_COLOR ? `ah-you-${uid}` : `ah-them-${uid}`;
          return (
            <g key={s.b.seq} opacity={s.opacity}>
              <line
                x1={s.from.x}
                y1={s.from.y}
                x2={s.tip.x}
                y2={s.tip.y}
                stroke={s.color}
                strokeWidth="2"
                strokeLinecap="round"
                markerEnd={`url(#${markerId})`}
              />
              <circle cx={s.to.x} cy={s.to.y} r="2.2" fill={s.color} />
              <text
                x={s.label.x}
                y={s.label.y + 2.5}
                textAnchor="middle"
                fontSize="8"
                fill={s.color}
                fontWeight="700"
              >
                {i === 0 ? "S" : i + 1}
              </text>
            </g>
          );
        })}

        {/* final landing ring + off-table ending */}
        {finalKind !== null && last.visible && (
          <g>
            <circle
              cx={last.to.x}
              cy={last.to.y}
              r={isLanding ? "8.5" : "7.5"}
              fill="none"
              stroke={FINAL_RING[finalKind]}
              strokeWidth="2.5"
            />
            {missEnd && !isLanding && (
              <g opacity="0.55">
                <line
                  x1={last.to.x}
                  y1={last.to.y}
                  x2={missEnd.x}
                  y2={missEnd.y}
                  stroke={FINAL_RING[finalKind]}
                  strokeWidth="1.5"
                  strokeDasharray="3 2.5"
                />
                <path
                  d={`M${missEnd.x - 3.5} ${missEnd.y - 3.5} L${missEnd.x + 3.5} ${missEnd.y + 3.5} M${missEnd.x - 3.5} ${missEnd.y + 3.5} L${missEnd.x + 3.5} ${missEnd.y - 3.5}`}
                  stroke={FINAL_RING[finalKind]}
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </g>
            )}
          </g>
        )}
      </Table>
      <Legend tagged={tagged} labels={labels} showRing />
    </div>
  );
}

/**
 * The shot strip: walk the rally forward one shot at a time.
 *
 * VERTICAL, beside the table, because it is a list that grows with the
 * rally — a horizontal row of nine chips wraps and pushes the map down the
 * screen, while a column beside a 356-tall map holds about ten before it
 * has to scroll. Rally length in real matches: median 4, ninth decile 9,
 * longest seen 27. So ten slots cover ninety percent of points without
 * moving, and the tail scrolls rather than collapsing into an ellipsis
 * nobody can aim at.
 *
 * CUMULATIVE: "3" means shots one through three, not shot three alone. A
 * single segment floating on the table has no context; the rally building
 * up is the thing you can actually read.
 *
 * Labels are SHOT NUMBERS, not rally numbers — shot 3 is the third ball,
 * which is what the sport calls it and what a coach would ask about.
 */
function ShotStrip({
  total,
  through,
  onChange,
}: {
  total: number;
  through: number | null;
  onChange: (through: number | null) => void;
}) {
  if (total < 2) return null;
  const steps: { key: string; label: string; value: number | null; said: string }[] = [
    { key: "all", label: "All", value: null, said: "Show the whole rally" },
    ...Array.from({ length: total }, (_, i) => {
      const n = i + 1;
      const last = n === total;
      return {
        key: String(n),
        label: n === 1 ? "S" : last ? "F" : String(n),
        value: n,
        said:
          n === 1
            ? "Show the serve only"
            : last
              ? "Show the whole rally to the final shot"
              : `Show shots 1 to ${n}`,
      };
    }),
  ];
  return (
    <div
      role="radiogroup"
      aria-label="How much of the rally to show"
      /* Scrolls past ~10 chips; the map keeps its height either way. */
      className="flex max-h-[356px] shrink-0 flex-col gap-1 overflow-y-auto pr-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {steps.map((step) => {
        const active = through === step.value;
        return (
          <button
            key={step.key}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={step.said}
            onClick={() => onChange(step.value)}
            className={`w-9 shrink-0 rounded-full border py-1 text-[11px] font-semibold tabular-nums transition-colors ${
              active
                ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                : "border-edge bg-ink/40 text-zinc-500 hover:border-cyan-glow/40 hover:text-zinc-300"
            }`}
          >
            {step.label}
          </button>
        );
      })}
    </div>
  );
}

function PlacementMapV3({
  placement,
  bottom,
  tagged,
  labels,
  serverPhysicalSide,
}: {
  placement: PlacementV3;
  bottom: Side;
  tagged: boolean;
  labels: MapLabels;
  serverPhysicalSide: Side | null;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  /**
   * How far into the rally to draw. Deliberately NOT persisted with the
   * other filters: "through shot 3" means a different thing on a 4-shot
   * point than on a 20-shot one, so carrying it between points would show
   * you a cutoff you never chose. Resets whenever the rally changes.
   */
  const [through, setThrough] = useState<number | null>(null);
  const hypothesis = useMemo(
    () => selectPlacementHypothesis(placement, serverPhysicalSide),
    [placement, serverPhysicalSide],
  );
  useEffect(() => setThrough(null), [hypothesis]);
  const model = useMemo(
    () => (hypothesis ? buildPlacementRenderModel(hypothesis, { through }) : null),
    [hypothesis, through],
  );
  const notice = hypothesis ? placementNotice(hypothesis) : null;
  const mapXY = useMemo(() => makeMapXY(bottom), [bottom]);

  if (!hypothesis || !model) {
    return (
      <div className="rounded-lg border border-cyan-glow/25 bg-cyan-glow/[0.05] px-4 py-6 text-center">
        <p className="text-sm font-medium text-zinc-200">
          Confirm who served to unlock this map
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          The two camera-side reconstructions are too close to choose safely.
        </p>
      </div>
    );
  }

  if (notice?.mode === "hidden") {
    return (
      <p className="px-2 py-3 text-center text-xs leading-relaxed text-zinc-500">
        {notice.message}
      </p>
    );
  }

  const isLanding = filters.view === "landing";
  const colorFor = (hitter: Side) =>
    tagged
      ? hitter === bottom
        ? YOU_COLOR
        : THEM_COLOR
      : hitter === "far"
        ? YOU_COLOR
        : THEM_COLOR;
  const hitterVisible = (hitter: Side) => {
    if (filters.who === "both") return true;
    const isYou = tagged ? hitter === bottom : hitter === "near";
    return filters.who === "you" ? isYou : !isYou;
  };
  const visibleSegments = model.segments.filter((segment) =>
    hitterVisible(segment.hitterSide),
  );
  const whoOptions: { key: WhoFilter; label: string }[] = [
    { key: "you", label: tagged ? labels.you : labels.near },
    { key: "them", label: tagged ? labels.them : labels.far },
    { key: "both", label: "Both" },
  ];
  return (
    <div>
      {notice?.mode === "review" && (
        <p className="mb-3 px-2 text-center text-[11px] leading-relaxed text-zinc-500">
          {notice.message}
        </p>
      )}

      <div className="mb-2 flex flex-wrap items-center justify-center gap-2">
        <Segmented
          ariaLabel="Map style"
          value={filters.view}
          onChange={(view) => setFilters((current) => ({ ...current, view }))}
          options={[
            { key: "trajectory", label: "Trajectory" },
            { key: "landing", label: "Landing" },
          ]}
        />
        <Segmented
          ariaLabel="Whose shots"
          value={filters.who}
          onChange={(who) => setFilters((current) => ({ ...current, who }))}
          options={whoOptions}
        />
      </div>
      {/* The map and the strip are one row: the strip is a control ON the
          map, and putting it underneath would push a 356-tall figure
          further down a phone screen for no reason. */}
      <div className="flex items-start justify-center gap-2">
      <Table
        topLabel={tagged ? labels.them : labels.far}
        bottomLabel={tagged ? labels.you : labels.near}
      >
        <defs>
          <marker
            id={`v3-you-${uid}`}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M0 0 L10 5 L0 10 z" fill={YOU_COLOR} />
          </marker>
          <marker
            id={`v3-them-${uid}`}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M0 0 L10 5 L0 10 z" fill={THEM_COLOR} />
          </marker>
        </defs>

        {visibleSegments.map((segment) => {
          const from = segment.from
            ? mapXY(segment.from.u, segment.from.v)
            : null;
          const to = segment.to ? mapXY(segment.to.u, segment.to.v) : null;
          // Where the ball carried on to after bouncing — the point the
          // NEXT shot is struck from. Suppressed on a terminal shot: the
          // point ended at that bounce, nothing carried anywhere.
          const carry =
            segment.carryTo && !segment.terminal
              ? mapXY(segment.carryTo.u, segment.carryTo.v)
              : null;
          const color = colorFor(segment.hitterSide);
          const marker =
            color === YOU_COLOR ? `v3-you-${uid}` : `v3-them-${uid}`;
          const opacity =
            hypothesis.status === "review"
              ? Math.max(0.42, segment.confidence * 0.78)
              : Math.max(0.55, segment.confidence);
          const anchor = to ?? from;
          let terminalEnd: { x: number; y: number } | null = null;
          if (segment.terminal && anchor) {
            if (segment.terminal.kind === "net") {
              terminalEnd = { x: anchor.x, y: NET_Y };
            } else if (segment.terminal.kind === "out") {
              const receiver: Side =
                segment.hitterSide === "near" ? "far" : "near";
              const edge = mapXY(
                segment.to?.u ?? segment.from?.u ?? W_M / 2,
                receiver === "near" ? 0 : L_M,
              );
              terminalEnd = {
                x: edge.x,
                y: edge.y < NET_Y ? edge.y - 11 : edge.y + 11,
              };
            }
          }

          return (
            <g key={segment.shotId} opacity={opacity}>
              {!isLanding && from && to && (
                <line
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={color}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeDasharray={segment.fromContext ? "3 3" : undefined}
                  markerEnd={`url(#${marker})`}
                />
              )}
              {/* The carry: measured bounce, then the same heading run on
                  to the baseline. DOTTED and thinner than the flight,
                  because it is derived rather than seen — and because it
                  marks where the ball crossed the line, not where the
                  player was standing when they met it. */}
              {!isLanding && to && carry && (
                <line
                  x1={to.x}
                  y1={to.y}
                  x2={carry.x}
                  y2={carry.y}
                  stroke={color}
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeDasharray="2 3"
                  opacity="0.75"
                />
              )}
              {segment.fromContext && from && !isLanding && (
                <circle
                  cx={from.x}
                  cy={from.y}
                  r="3"
                  fill={color}
                  fillOpacity="0.28"
                />
              )}
              {to && (
                <g>
                  <circle
                    cx={to.x}
                    cy={to.y}
                    r={segment.phase === "serve" ? 6 : 4.5}
                    fill={color}
                    stroke="#0c1222"
                    strokeWidth="1"
                  />
                  <text
                    x={to.x}
                    y={to.y + 2.7}
                    textAnchor="middle"
                    fontSize="7.5"
                    fill="#0c1222"
                    fontWeight="800"
                  >
                    {segment.phase === "serve" ? "S" : segment.shotNumber}
                  </text>
                </g>
              )}
              {segment.phase === "final" && to && !segment.terminal && (
                <circle
                  cx={to.x}
                  cy={to.y}
                  r="8"
                  fill="none"
                  stroke="#34d399"
                  strokeWidth="2.4"
                />
              )}
              {segment.terminal && anchor && terminalEnd && (
                <g opacity="0.85">
                  {!isLanding && (
                    <line
                      x1={anchor.x}
                      y1={anchor.y}
                      x2={terminalEnd.x}
                      y2={terminalEnd.y}
                      stroke="#f87171"
                      strokeWidth="1.7"
                      strokeDasharray="3 2.5"
                    />
                  )}
                  <path
                    d={`M${terminalEnd.x - 3.5} ${terminalEnd.y - 3.5} L${terminalEnd.x + 3.5} ${terminalEnd.y + 3.5} M${terminalEnd.x - 3.5} ${terminalEnd.y + 3.5} L${terminalEnd.x + 3.5} ${terminalEnd.y - 3.5}`}
                    stroke="#f87171"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </g>
              )}
            </g>
          );
        })}
      </Table>
        <ShotStrip
          total={model.totalCount}
          through={through}
          onChange={setThrough}
        />
      </div>

      {model.shownCount < model.totalCount && (
        <p className="mt-1 text-center text-[10px] text-zinc-500">
          Showing {model.shownCount} of {model.totalCount} shots.
        </p>
      )}
      <Legend tagged={tagged} labels={labels} showRing />
    </div>
  );
}

/**
 * Top-down table mini-map for a point, drawn from above and behind the
 * user (user at the bottom, user's left = map left). gameIndex handles
 * end changes between games; userSide null renders the neutral camera
 * view with Near/Far labels and, for owners, a one-tap orientation prompt.
 */
export function PlacementMap({
  placement,
  serverPhysicalSide = null,
  userSide = null,
  gameIndex = 0,
  labels = DEFAULT_LABELS,
  onSetUserSide,
}: {
  placement: Placement;
  userSide?: Side | null;
  /** Rotation-derived physical side of the server; when set it overrides
      the engine's per-bounce hitter guess (ownership alternates from the
      server, which is more reliable than vision post pose-removal). */
  serverPhysicalSide?: Side | null;
  gameIndex?: number;
  labels?: MapLabels;
  /** Owner-only: write matches.user_side from the map's orientation prompt
      while untagged. Absent for coach viewers (they can't tag). */
  onSetUserSide?: (side: Side) => void;
}) {
  const tagged = userSide !== null;
  const bottom: Side = tagged
    ? physicalSideForGame(userSide, gameIndex)
    : "near";
  return (
    <div>
      {!tagged && (
        <div className="mb-2 text-center text-[10px] font-medium uppercase tracking-wide text-zinc-500">
          Camera view — near player at the bottom
        </div>
      )}
      {!tagged && onSetUserSide && (
        <OrientationPrompt labels={labels} onSetUserSide={onSetUserSide} />
      )}
      {isV3(placement) ? (
        <PlacementMapV3
          placement={placement}
          serverPhysicalSide={serverPhysicalSide}
          bottom={bottom}
          tagged={tagged}
          labels={labels}
        />
      ) : isV2(placement) ? (
        <PlacementMapV2
          serverPhysicalSide={serverPhysicalSide}
          bounces={placement.bounces}
          bottom={bottom}
          tagged={tagged}
          labels={labels}
        />
      ) : (
        <PlacementMapV1
          bounces={placement.bounces}
          bottom={bottom}
          tagged={tagged}
          labels={labels}
          topLabel={tagged ? labels.them : labels.far}
          bottomLabel={tagged ? labels.you : labels.near}
        />
      )}
    </div>
  );
}
