"use client";

import {
  TABLE_LENGTH_M,
  type PlacementPoint,
  type PlacementPrediction,
} from "@/lib/research/placementCalibration";
import {
  describePlacementMark,
  svgPointToTable,
  tablePointToSvg,
} from "./placementCalibrationView";

interface PredictionSet {
  legacy_current: PlacementPrediction | null;
  canonical_current: PlacementPrediction | null;
  openai: PlacementPrediction | null;
}

function Marker({
  point,
  color,
  label,
  dashed = false,
}: {
  point: PlacementPoint;
  color: string;
  label: string;
  dashed?: boolean;
}) {
  const { x, y } = tablePointToSvg(point);
  return (
    <g>
      <circle
        cx={x}
        cy={y}
        r="9"
        fill="#0a0f1d"
        stroke={color}
        strokeWidth="3"
        strokeDasharray={dashed ? "3 2" : undefined}
      />
      <text
        x={x}
        y={y + 3.5}
        fill={color}
        textAnchor="middle"
        fontSize="9"
        fontWeight="800"
      >
        {label}
      </text>
    </g>
  );
}

export function PlacementTableEditor({
  nearName,
  farName,
  value,
  onChange,
  predictions,
}: {
  nearName: string;
  farName: string;
  value: PlacementPoint | null;
  onChange: (value: PlacementPoint | null) => void;
  predictions: PredictionSet | null;
}) {
  return (
    <div className="rounded-2xl border border-edge bg-ink/35 p-4">
      <div className="text-center">
        <p className="text-sm font-semibold">Where did this bounce land?</p>
        <p className="mt-1 text-xs text-zinc-400">
          Tap the physical table. Camera-left stays left; the near player stays
          at the bottom.
        </p>
      </div>
      <svg
        viewBox="0 0 250 350"
        className="mx-auto mt-2 w-full max-w-[310px] touch-manipulation"
        role="img"
        aria-label={`Top-down physical table. ${farName} is at the far end and ${nearName} is at the near end.`}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const x = ((event.clientX - rect.left) / rect.width) * 250;
          const y = ((event.clientY - rect.top) / rect.height) * 350;
          const point = svgPointToTable(x, y);
          if (point) onChange(point);
        }}
      >
        <text
          x="125"
          y="15"
          fill="#e4e4e7"
          textAnchor="middle"
          fontSize="11"
          fontWeight="700"
        >
          {farName} · FAR / TOP
        </text>
        <rect
          x="35"
          y="25"
          width="180"
          height="300"
          rx="6"
          fill="#102b63"
          stroke="#cbd5e1"
          strokeWidth="2"
        />
        <line
          x1="35"
          x2="215"
          y1="175"
          y2="175"
          stroke="#f8fafc"
          strokeWidth="3"
          strokeDasharray="6 4"
        />
        <line
          x1="125"
          x2="125"
          y1="25"
          y2="325"
          stroke="#64748b"
        />
        <text
          x="125"
          y="345"
          fill="#e4e4e7"
          textAnchor="middle"
          fontSize="11"
          fontWeight="700"
        >
          {nearName} · NEAR / BOTTOM
        </text>
        {predictions?.legacy_current && (
          <Marker
            point={predictions.legacy_current}
            color="#f472b6"
            label="L"
            dashed
          />
        )}
        {predictions?.canonical_current && (
          <Marker
            point={predictions.canonical_current}
            color="#22d3ee"
            label="C"
          />
        )}
        {predictions?.openai && (
          <Marker point={predictions.openai} color="#fb923c" label="O" />
        )}
        {value && <Marker point={value} color="#ffffff" label="YOU" />}
      </svg>
      {value && (
        <p className="mt-1 text-center text-xs font-medium text-white">
          {describePlacementMark(value, { nearName, farName })}
        </p>
      )}
      <button
        type="button"
        onClick={() => onChange(null)}
        disabled={!value}
        className="mt-3 w-full rounded-lg border border-edge px-3 py-2 text-xs text-zinc-300 disabled:opacity-30"
      >
        Clear mark
      </button>
      <span className="sr-only">
        Table length {TABLE_LENGTH_M} meters.
      </span>
    </div>
  );
}
