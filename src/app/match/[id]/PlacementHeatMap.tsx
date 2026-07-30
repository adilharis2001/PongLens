"use client";

import {
  placementZoneCounts,
  TABLE_LENGTH_M,
  TABLE_WIDTH_M,
  type PlacementAggregateFilter,
  type TrustedPlacementObservation,
} from "@/lib/placement/placementAggregate";
import {
  buildPlacementHeatCells,
  placementHeatTone,
} from "@/lib/placement/placementHeatMap";
import type { MapLabels } from "./PlacementMap";
import {
  Table,
  TH,
  TW,
  TX,
  TY,
} from "./placementTable";

function readableZone(zone: string) {
  const [depth, lateral] = zone.split("_");
  return `${depth} ${lateral}`;
}

export function PlacementHeatMap({
  observations,
  filter,
  labels,
}: {
  observations: readonly TrustedPlacementObservation[];
  filter: PlacementAggregateFilter;
  labels: MapLabels;
}) {
  const counts = placementZoneCounts(observations, filter);
  const cells = buildPlacementHeatCells(counts, filter);
  const tone = placementHeatTone(filter);

  return (
    <div>
      <Table
        topLabel={labels.them}
        bottomLabel={labels.you}
        ariaLabel={`Placement heat map, ${labels.you} at the bottom, ${labels.them} at the top`}
      >
        {cells.map((cell) => {
          const x = TX + (TW * cell.bounds.u0) / TABLE_WIDTH_M;
          const y =
            TY
            + TH * (1 - cell.bounds.v1 / TABLE_LENGTH_M);
          const width =
            (TW * (cell.bounds.u1 - cell.bounds.u0))
            / TABLE_WIDTH_M;
          const height =
            (TH * (cell.bounds.v1 - cell.bounds.v0))
            / TABLE_LENGTH_M;
          return (
            <g key={cell.zone}>
              <title>
                {readableZone(cell.zone)}: {cell.count} trusted
                {cell.count === 1 ? " landing" : " landings"}
              </title>
              <rect
                x={x}
                y={y}
                width={width}
                height={height}
                fill={tone}
                fillOpacity={cell.opacity}
                stroke="#94a3b8"
                strokeOpacity="0.32"
                strokeWidth="0.75"
              />
              {cell.count > 0 && (
                <text
                  x={x + width / 2}
                  y={y + height / 2 + 4}
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight="700"
                  fill="#f8fafc"
                >
                  {cell.count}
                </text>
              )}
            </g>
          );
        })}
      </Table>
      <div className="-mt-1 flex justify-between px-6 text-[10px] text-zinc-500">
        <span>Your left</span>
        <span>Your right</span>
      </div>
    </div>
  );
}
