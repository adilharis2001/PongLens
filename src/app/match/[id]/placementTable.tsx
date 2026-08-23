import {
  TABLE_LENGTH_M,
  TABLE_WIDTH_M,
  type TrustedPlacementObservation,
} from "@/lib/placement/placementAggregate";
import type { Side } from "./sides";

/*
 * Shared top-down table primitive for the placement views.
 *
 * One definition of the SVG court + the meters→pixels mapping, used by the
 * per-point PlacementMap and the match-level PlacementAggregate so the two
 * can never drift apart.
 *
 * THE ORIENTATION INVARIANT (see PlacementMap for the full worker-frame
 * derivation): the map is drawn from above and behind the bottom player —
 * bottom player at the bottom edge, their left = map left. `makeMapXY` takes
 * the physical camera-frame side that sits at the bottom for the point being
 * drawn; callers pass physicalSideForGame(userSide, gameIndex) so ends
 * swapping between games never smears bounces across both halves.
 */

// Table dimensions in meters (u across the width, v along the length).
export const W_M = 1.525;
export const L_M = 2.74;

// SVG layout: table rect with margins for out-of-table markers and labels.
export const TX = 35;
export const TY = 40;
export const TW = 160;
export const TH = 280;
export const VIEW_W = 230;
export const VIEW_H = 356;
export const NET_Y = TY + TH / 2;

// Shot colors follow the hitter: the bottom player (you) cyan, the other
// player amber.
export const YOU_COLOR = "#22d3ee";
export const THEM_COLOR = "#f59e0b";

/** Meters (u, v) → clamped SVG pixels, oriented so `bottom` is at the bottom. */
export function makeMapXY(bottom: Side) {
  return (u: number, v: number) => {
    const fu = bottom === "near" ? 1 - u / W_M : u / W_M;
    const fv = bottom === "near" ? 1 - v / L_M : v / L_M;
    return {
      x: Math.min(Math.max(TX + TW * fu, TX - 12), TX + TW + 12),
      y: Math.min(Math.max(TY + TH * fv, TY - 14), TY + TH + 14),
    };
  };
}

/**
 * Compact single-select segmented control, cyan theme. Shared by the
 * per-point map (view + whose-shots) and the aggregate (whose shots,
 * which shots, and the game scope).
 *
 * `srLabel` is for options whose visible label is deliberately terse —
 * the game scope shows "1" to stay on one line with the section title,
 * and announces "Game 1".
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { key: T; label: string; srLabel?: string }[];
  value: T;
  onChange: (key: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex rounded-full border border-edge bg-ink/40 p-0.5"
    >
      {options.map((o) => {
        const active = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={o.srLabel}
            onClick={() => onChange(o.key)}
            className={`max-w-[7rem] truncate rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
              active
                ? "bg-cyan-glow/15 text-cyan-glow"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Every trusted landing as a dot on the table — the exact half of the
 * placement deck, beside the heat map's density.
 *
 * Lifted out of PlacementAggregate so the public share page can draw the
 * same picture without also inheriting the owner's controls (per-point
 * flagging, the whole-match "this is wrong" escape hatch, the game
 * scope). One definition, so the two surfaces cannot drift.
 */
export function PlacementLandings({
  observations,
  tone,
  topLabel,
  bottomLabel,
  /** Forehand/backhand hints along the far edge, on THEIR half only —
   *  which corner is which depends on the owner's playing hand. */
  ownerHandedness = null,
  showHands = false,
}: {
  observations: readonly TrustedPlacementObservation[];
  tone: string;
  topLabel: string;
  bottomLabel: string;
  ownerHandedness?: "right" | "left" | null;
  showHands?: boolean;
}) {
  return (
    <Table topLabel={topLabel} bottomLabel={bottomLabel}>
      {showHands && ownerHandedness && (
        <>
          <text x={TX + 6} y={TY + TH - 7} fontSize="8" fill="#71717a">
            {ownerHandedness === "right" ? "BH" : "FH"}
          </text>
          <text
            x={TX + TW - 6}
            y={TY + TH - 7}
            fontSize="8"
            fill="#71717a"
            textAnchor="end"
          >
            {ownerHandedness === "right" ? "FH" : "BH"}
          </text>
        </>
      )}
      {observations.map((observation) => (
        <circle
          key={`${observation.pointId}-${observation.shotSeq}`}
          cx={TX + (TW * observation.u) / TABLE_WIDTH_M}
          cy={TY + TH * (1 - observation.v / TABLE_LENGTH_M)}
          r="5"
          fill={tone}
          fillOpacity="0.52"
          stroke="#0c1222"
          strokeWidth="0.75"
        />
      ))}
    </Table>
  );
}

export function Table({
  topLabel,
  bottomLabel,
  ariaLabel,
  children,
}: {
  topLabel: string;
  bottomLabel: string;
  ariaLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="mx-auto w-full"
      style={{ maxWidth: 240 }}
      role="img"
      aria-label={
        ariaLabel
        ?? `Placement map, ${bottomLabel} at the bottom, ${topLabel} at the top`
      }
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
