import type { PlacementBounce } from "@/lib/types";

// Table dimensions in meters (u across the width, v along the length).
const W_M = 1.525;
const L_M = 2.74;

function mapXY(u: number, v: number) {
  const x = 15 + 160 * (u / W_M);
  const y = 15 + 280 * (1 - v / L_M);
  return {
    x: Math.round(Math.min(Math.max(x, 8), 182)),
    y: Math.round(Math.min(Math.max(y, 4), 306)),
  };
}

/**
 * Top-down table mini-map for a point. Same styling as the proven poc
 * review pages: #0f2557 table, dashed net line, cyan/amber bounce dots,
 * S marker on the serve bounce.
 */
export function PlacementMap({ bounces }: { bounces: PlacementBounce[] }) {
  const sorted = [...bounces].sort((a, b) => a.t - b.t);
  return (
    <div>
      <svg
        viewBox="0 0 190 322"
        className="mx-auto w-40"
        role="img"
        aria-label="Placement map of ball bounces on the table"
      >
        <rect
          x="15"
          y="15"
          width="160"
          height="280"
          rx="5"
          fill="#0f2557"
          stroke="#cbd5e1"
          strokeWidth="2"
        />
        {/* net */}
        <line
          x1="15"
          y1="155"
          x2="175"
          y2="155"
          stroke="#f8fafc"
          strokeWidth="2.5"
          strokeDasharray="5 3"
        />
        {/* center line */}
        <line x1="95" y1="15" x2="95" y2="295" stroke="#64748b" strokeWidth="1" />
        {sorted.map((b, i) => {
          const { x, y } = mapXY(b.u, b.v);
          const fill = b.side === "far" ? "#22d3ee" : "#f59e0b";
          return (
            <g key={i}>
              <circle cx={x} cy={y} r="8" fill={fill} stroke="white" strokeWidth="1.5" />
              <text
                x={x}
                y={y + 3}
                textAnchor="middle"
                fontSize="9"
                fill={b.side === "far" ? "#083344" : "#451a03"}
                fontWeight="700"
              >
                {i === 0 ? "S" : i + 1}
              </text>
            </g>
          );
        })}
        <text x="95" y="314" textAnchor="middle" fontSize="9" fill="#64748b">
          S = serve bounce, then in order
        </text>
      </svg>
    </div>
  );
}
