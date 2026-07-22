"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import type {
  Placement,
  PlacementBounce,
  PlacementBounceV2,
} from "@/lib/types";
import { physicalSideForGame, type Side } from "./sides";

// Table dimensions in meters (u across the width, v along the length).
const W_M = 1.525;
const L_M = 2.74;

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
 */

// SVG layout: table rect with margins for out-of-table markers and labels.
const TX = 35;
const TY = 40;
const TW = 160;
const TH = 280;
const VIEW_W = 230;
const VIEW_H = 356;
const NET_Y = TY + TH / 2;

function makeMapXY(bottom: Side) {
  return (u: number, v: number) => {
    const fu = bottom === "near" ? 1 - u / W_M : u / W_M;
    const fv = bottom === "near" ? 1 - v / L_M : v / L_M;
    return {
      x: Math.min(Math.max(TX + TW * fu, TX - 12), TX + TW + 12),
      y: Math.min(Math.max(TY + TH * fv, TY - 14), TY + TH + 14),
    };
  };
}

function isV2(p: Placement): p is { v: 2; bounces: PlacementBounceV2[] } {
  return "v" in p && p.v === 2;
}

export function hasPlacementBounces(p: Placement | null): boolean {
  return !!p && Array.isArray(p.bounces) && p.bounces.length > 0;
}

// Shot colors follow the hitter: the user (bottom player) cyan, the
// opponent amber. Untagged: near amber, far cyan (legacy neutral colors).
const YOU_COLOR = "#22d3ee";
const THEM_COLOR = "#f59e0b";

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

function Table({
  topLabel,
  bottomLabel,
  children,
}: {
  topLabel: string;
  bottomLabel: string;
  children: React.ReactNode;
}) {
  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="mx-auto w-full"
      style={{ maxWidth: 240 }}
      role="img"
      aria-label={`Placement map, ${bottomLabel} at the bottom, ${topLabel} at the top`}
    >
      <text
        x={TX + TW / 2}
        y={TY - 18}
        textAnchor="middle"
        fontSize="11"
        fill="#a1a1aa"
        fontWeight="600"
      >
        {topLabel}
      </text>
      <rect
        x={TX}
        y={TY}
        width={TW}
        height={TH}
        rx="5"
        fill="#0f2557"
        stroke="#cbd5e1"
        strokeWidth="2"
      />
      {/* net */}
      <line
        x1={TX}
        y1={NET_Y}
        x2={TX + TW}
        y2={NET_Y}
        stroke="#f8fafc"
        strokeWidth="2.5"
        strokeDasharray="5 3"
      />
      {/* center line */}
      <line
        x1={TX + TW / 2}
        y1={TY}
        x2={TX + TW / 2}
        y2={TY + TH}
        stroke="#64748b"
        strokeWidth="1"
      />
      {children}
      <text
        x={TX + TW / 2}
        y={TY + TH + 26}
        textAnchor="middle"
        fontSize="11"
        fill="#a1a1aa"
        fontWeight="600"
      >
        {bottomLabel}
      </text>
    </svg>
  );
}

/** v1 fallback: the original dot map for old rows, orientation fixed. */
function PlacementMapV1({
  bounces,
  bottom,
  tagged,
  topLabel,
  bottomLabel,
}: {
  bounces: PlacementBounce[];
  bottom: Side;
  tagged: boolean;
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
      <p className="mt-1 text-center text-[10px] text-zinc-500">
        S = serve bounce, then in order
      </p>
    </div>
  );
}

// Filters. who: "you" = the bottom player's shots ("Near" when untagged).
type WhoFilter = "both" | "you" | "them";
type Filters = { who: WhoFilter; serve: boolean; rally: boolean; final: boolean };
const DEFAULT_FILTERS: Filters = {
  who: "both",
  serve: true,
  rally: true,
  final: true,
};
const FILTERS_KEY = "ponglens.placement.v3";

/** v2: arrows from landing to landing, colored by hitter. */
function PlacementMapV2({
  bounces,
  bottom,
  tagged,
  labels,
}: {
  bounces: PlacementBounceV2[];
  bottom: Side;
  tagged: boolean;
  labels: MapLabels;
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

  const serverSide: Side = chain[0].hitter_side;
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
  const fade = (i: number) =>
    n <= 3 ? 1 : 0.35 + 0.65 * (i / (n - 1));

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
      color: colorFor(b.hitter_side),
      opacity: fade(i),
      visible: hitterVisible(b.hitter_side) && roleVisible(b.role),
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

  const whoChips: { key: WhoFilter; label: string }[] = [
    { key: "you", label: tagged ? labels.you : labels.near },
    { key: "them", label: tagged ? labels.them : labels.far },
    { key: "both", label: "Both" },
  ];
  const roleChips: { key: "serve" | "rally" | "final"; label: string }[] = [
    { key: "serve", label: "Serve" },
    { key: "rally", label: "Rally" },
    { key: "final", label: "Final" },
  ];

  const chipClass = (active: boolean) =>
    `max-w-[9rem] truncate rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
      active
        ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
        : "border-edge bg-ink/40 text-zinc-500 hover:border-cyan-glow/40"
    }`;

  return (
    <div>
      {/* two chip rows max, also on 375px screens */}
      <div className="mb-1.5 flex flex-wrap items-center justify-center gap-1.5">
        {whoChips.map((c) => (
          <button
            key={c.key}
            type="button"
            aria-pressed={filters.who === c.key}
            onClick={() => apply({ ...filters, who: c.key })}
            className={chipClass(filters.who === c.key)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="mb-2 flex flex-wrap items-center justify-center gap-1.5">
        {roleChips.map((c) => (
          <button
            key={c.key}
            type="button"
            aria-pressed={filters[c.key]}
            onClick={() => apply({ ...filters, [c.key]: !filters[c.key] })}
            className={chipClass(filters[c.key])}
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
              r="7.5"
              fill="none"
              stroke={FINAL_RING[finalKind]}
              strokeWidth="2.5"
            />
            {missEnd && (
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
      <p className="mt-1 text-center text-[10px] text-zinc-500">
        Arrows follow the ball. S serve. Ring last bounce: green won, red
        net or out.
      </p>
    </div>
  );
}

/**
 * Top-down table mini-map for a point, drawn from above and behind the
 * user (user at the bottom, user's left = map left). gameIndex handles
 * end changes between games; userSide null renders the neutral camera
 * view with Near/Far labels.
 */
export function PlacementMap({
  placement,
  userSide = null,
  gameIndex = 0,
  labels = DEFAULT_LABELS,
}: {
  placement: Placement;
  userSide?: Side | null;
  gameIndex?: number;
  labels?: MapLabels;
}) {
  const tagged = userSide !== null;
  const bottom: Side = tagged
    ? physicalSideForGame(userSide, gameIndex)
    : "near";
  if (isV2(placement)) {
    return (
      <PlacementMapV2
        bounces={placement.bounces}
        bottom={bottom}
        tagged={tagged}
        labels={labels}
      />
    );
  }
  return (
    <PlacementMapV1
      bounces={placement.bounces}
      bottom={bottom}
      tagged={tagged}
      topLabel={tagged ? labels.them : labels.far}
      bottomLabel={tagged ? labels.you : labels.near}
    />
  );
}
