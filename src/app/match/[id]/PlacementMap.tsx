"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  Placement,
  PlacementBounce,
  PlacementBounceV2,
} from "@/lib/types";

// Table dimensions in meters (u across the width, v along the length).
const W_M = 1.525;
const L_M = 2.74;

// Bounces only, never racket contacts: the pipeline's homography maps the
// table plane, and contacts happen off that plane, so their projected u/v
// would be meaningless. The engine never puts them in placement.

function mapXY(u: number, v: number) {
  const x = 15 + 160 * (u / W_M);
  const y = 15 + 280 * (1 - v / L_M);
  return {
    x: Math.round(Math.min(Math.max(x, 8), 182)),
    y: Math.round(Math.min(Math.max(y, 4), 306)),
  };
}

function isV2(p: Placement): p is { v: 2; bounces: PlacementBounceV2[] } {
  return "v" in p && p.v === 2;
}

export function hasPlacementBounces(p: Placement | null): boolean {
  return !!p && Array.isArray(p.bounces) && p.bounces.length > 0;
}

// Dot colors follow the hitter: far player cyan, near player amber.
const DOT_FILL = { far: "#22d3ee", near: "#f59e0b" } as const;
const DOT_TEXT = { far: "#083344", near: "#451a03" } as const;

function Table({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 190 310"
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
      {children}
    </svg>
  );
}

/** v1 fallback: the original flat dot map for old rows. */
function PlacementMapV1({ bounces }: { bounces: PlacementBounce[] }) {
  const sorted = [...bounces].sort((a, b) => a.t - b.t);
  return (
    <div>
      <Table>
        {sorted.map((b, i) => {
          const { x, y } = mapXY(b.u, b.v);
          return (
            <g key={i}>
              <circle
                cx={x}
                cy={y}
                r="8"
                fill={DOT_FILL[b.side]}
                stroke="white"
                strokeWidth="1.5"
              />
              <text
                x={x}
                y={y + 3}
                textAnchor="middle"
                fontSize="9"
                fill={DOT_TEXT[b.side]}
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

// Which bounce groups are visible. "all" adds the server's own-half serve
// bounce (serve_1), which is noise for most reviews and hidden by default.
type Layers = { serve: boolean; rally: boolean; final: boolean; all: boolean };
const DEFAULT_LAYERS: Layers = {
  serve: true,
  rally: true,
  final: true,
  all: false,
};
const LAYERS_KEY = "ponglens.placement.layers";

const FINAL_RING: Record<string, string> = {
  winner_landing: "#34d399",
  net: "#f87171",
  out_adjacent: "#f87171",
  unknown: "#94a3b8",
};

/** v2: role-tagged map with a layer-toggle chip row. */
function PlacementMapV2({ bounces }: { bounces: PlacementBounceV2[] }) {
  const [layers, setLayers] = useState<Layers>(DEFAULT_LAYERS);

  // Remembered across the session (localStorage); read after mount so the
  // server-rendered HTML always matches the first client render.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LAYERS_KEY);
      if (raw) setLayers({ ...DEFAULT_LAYERS, ...JSON.parse(raw) });
    } catch {
      // Ignore: defaults are fine.
    }
  }, []);

  const apply = useCallback((next: Layers) => {
    setLayers(next);
    try {
      window.localStorage.setItem(LAYERS_KEY, JSON.stringify(next));
    } catch {
      // Ignore: the toggle still works for this view.
    }
  }, []);

  const toggle = useCallback(
    (key: "serve" | "rally" | "final") => {
      apply({ ...layers, [key]: !layers[key], all: false });
    },
    [layers, apply]
  );
  const toggleAll = useCallback(() => {
    apply(
      layers.all
        ? DEFAULT_LAYERS
        : { serve: true, rally: true, final: true, all: true }
    );
  }, [layers, apply]);

  const visible = (b: PlacementBounceV2) => {
    if (layers.all) return true;
    if (b.role === "serve_1") return false;
    if (b.role === "serve_2") return layers.serve;
    if (b.role === "rally") return layers.rally;
    return layers.final;
  };

  const sorted = [...bounces].sort((a, b) => a.seq - b.seq);
  const shown = sorted.filter(visible);

  const chips: { key: "serve" | "rally" | "final" | "all"; label: string }[] = [
    { key: "serve", label: "Serve" },
    { key: "rally", label: "Rally" },
    { key: "final", label: "Final" },
    { key: "all", label: "All" },
  ];

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-center gap-1.5">
        {chips.map((c) => {
          const active = c.key === "all" ? layers.all : layers[c.key];
          return (
            <button
              key={c.key}
              type="button"
              aria-pressed={active}
              onClick={() =>
                c.key === "all" ? toggleAll() : toggle(c.key)
              }
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                active
                  ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                  : "border-edge bg-ink/40 text-zinc-500 hover:border-cyan-glow/40"
              }`}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      <Table>
        {shown.map((b) => {
          const { x, y } = mapXY(b.u, b.v);
          const fill = DOT_FILL[b.hitter_side];
          const text = DOT_TEXT[b.hitter_side];
          if (b.role === "final") {
            const ring = FINAL_RING[b.final_kind ?? "unknown"];
            return (
              <g key={b.seq}>
                <circle
                  cx={x}
                  cy={y}
                  r="11"
                  fill="none"
                  stroke={ring}
                  strokeWidth="2.5"
                />
                <circle
                  cx={x}
                  cy={y}
                  r="6.5"
                  fill={fill}
                  stroke="white"
                  strokeWidth="1.5"
                />
              </g>
            );
          }
          if (b.role === "serve_2") {
            return (
              <g key={b.seq}>
                <circle
                  cx={x}
                  cy={y}
                  r="9"
                  fill={fill}
                  stroke="white"
                  strokeWidth="2"
                />
                <text
                  x={x}
                  y={y + 3.5}
                  textAnchor="middle"
                  fontSize="10"
                  fill={text}
                  fontWeight="700"
                >
                  S
                </text>
              </g>
            );
          }
          if (b.role === "serve_1") {
            return (
              <circle
                key={b.seq}
                cx={x}
                cy={y}
                r="4.5"
                fill={fill}
                opacity="0.45"
                stroke="white"
                strokeWidth="1"
              />
            );
          }
          return (
            <g key={b.seq}>
              <circle
                cx={x}
                cy={y}
                r="6"
                fill={fill}
                stroke="white"
                strokeWidth="1.2"
              />
              <text
                x={x}
                y={y + 2.5}
                textAnchor="middle"
                fontSize="7.5"
                fill={text}
                fontWeight="700"
              >
                {b.rally_n ?? ""}
              </text>
            </g>
          );
        })}
      </Table>
      <p className="mt-1 text-center text-[10px] text-zinc-500">
        S serve · numbers rally · ring last bounce: green winner, red net/out
      </p>
    </div>
  );
}

/** Top-down table mini-map for a point. v2 = role-tagged with toggles. */
export function PlacementMap({ placement }: { placement: Placement }) {
  if (isV2(placement)) return <PlacementMapV2 bounces={placement.bounces} />;
  return <PlacementMapV1 bounces={placement.bounces} />;
}
