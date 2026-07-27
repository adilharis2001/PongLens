"use client";

import type { HumanEventLabel } from "@/lib/research/labeling";

type Bounce = NonNullable<HumanEventLabel["table_bounce"]>;

export function TablePlacementEditor({
  value,
  onChange,
}: {
  value: Bounce;
  onChange: (value: Bounce) => void;
}) {
  const dotX = value.table_u === null ? null : 35 + value.table_u * 180;
  const dotY = value.table_v === null ? null : 25 + value.table_v * 300;

  return (
    <div className="rounded-xl border border-edge bg-ink/35 p-3">
      <p className="text-sm font-semibold">Where did this table bounce land?</p>
      <p className="mt-1 text-xs text-zinc-400">
        Click the table only when the location is visible or can be estimated from the trail.
      </p>
      <svg
        viewBox="0 0 250 350"
        className="mx-auto mt-2 w-full max-w-[220px]"
        role="img"
        aria-label="Top-down table placement input"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const viewX = ((event.clientX - rect.left) / rect.width) * 250;
          const viewY = ((event.clientY - rect.top) / rect.height) * 350;
          if (viewX < 35 || viewX > 215 || viewY < 25 || viewY > 325) return;
          onChange({
            ...value,
            table_u: Number(((viewX - 35) / 180).toFixed(4)),
            table_v: Number(((viewY - 25) / 300).toFixed(4)),
            screen_x: Number(viewX.toFixed(2)),
            screen_y: Number(viewY.toFixed(2)),
            homography_version: "research-table-v1",
          });
        }}
      >
        <text x="125" y="15" fill="#94a3b8" textAnchor="middle" fontSize="11">
          FAR PLAYER
        </text>
        <rect x="35" y="25" width="180" height="300" rx="5" fill="#0f2557" stroke="#cbd5e1" strokeWidth="2" />
        <line x1="35" x2="215" y1="175" y2="175" stroke="#f8fafc" strokeWidth="3" strokeDasharray="6 4" />
        <line x1="125" x2="125" y1="25" y2="325" stroke="#64748b" />
        <text x="125" y="345" fill="#94a3b8" textAnchor="middle" fontSize="11">
          NEAR PLAYER
        </text>
        {dotX !== null && dotY !== null && (
          <circle cx={dotX} cy={dotY} r="8" fill="#22d3ee" stroke="#fff" strokeWidth="2" />
        )}
      </svg>
      <button
        type="button"
        onClick={() =>
          onChange({ ...value, table_u: null, table_v: null, screen_x: null, screen_y: null })
        }
        className="w-full rounded-lg border border-edge px-3 py-2 text-xs text-zinc-300 hover:border-zinc-500"
      >
        Clear location
      </button>
    </div>
  );
}
