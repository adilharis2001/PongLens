"use client";

import type { ReactNode } from "react";
import {
  TABLE_LENGTH_M,
  TABLE_WIDTH_M,
} from "@/lib/placement/placementAggregate";
import { buildPlacementHeatCells } from "@/lib/placement/placementHeatMap";
import {
  MIN_SAMPLES,
  type EndingsResult,
  type ScoredCardsResult,
  type ScoredTally,
  type SpeedBand,
} from "@/lib/placement/scoredCards";
import { Card, SplitBar, StatRow } from "./cards";
import type { MapLabels } from "./PlacementMap";
import { Table, TH, TW, TX, TY } from "./placementTable";

/**
 * The cards a scored match earns from the video, appended to the analysis
 * deck so they swipe like the rest. Each one is built by
 * computeScoredCards and only appears with enough behind it: the deck's
 * rule is that two data points are not a pattern, and a card saying
 * "nothing yet" reads as broken rather than empty.
 */

function Group({ title, first = false, children }: {
  title: string;
  first?: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <p
        className={`mb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500 ${
          first ? "" : "mt-4"
        }`}
      >
        {title}
      </p>
      {children}
    </>
  );
}

function withData(bands: ScoredTally[]) {
  return bands.filter((band) => band.won + band.lost > 0);
}

function count(bands: ScoredTally[]) {
  return bands.reduce((sum, band) => sum + band.won + band.lost, 0);
}

function speedLabel(band: SpeedBand) {
  const from = band.fromKmh === null ? null : Math.round(band.fromKmh);
  const to = band.toKmh === null ? null : Math.round(band.toKmh);
  if (from === null && to !== null) return `${band.label} · under ${to} km/h`;
  if (to === null && from !== null) return `${band.label} · over ${from} km/h`;
  return `${band.label} · ${from} to ${to} km/h`;
}

const WON_TONE = "#22d3ee";
const LOST_TONE = "#e879f9";

/**
 * One table, both halves: endings on the opponent's half are points the
 * uploader won, endings on their own half are points they lost. Shaded
 * against one shared maximum so the two halves read on the same scale.
 */
function EndingsMap({ endings, labels }: {
  endings: EndingsResult;
  labels: MapLabels;
}) {
  const won = buildPlacementHeatCells(endings.wonCounts, "myRally");
  const lost = buildPlacementHeatCells(endings.lostCounts, "theirRally");
  const max = Math.max(1, ...[...won, ...lost].map((cell) => cell.count));
  const cells = [
    ...won.map((cell) => ({ cell, tone: WON_TONE, key: `won-${cell.zone}` })),
    ...lost.map((cell) => ({ cell, tone: LOST_TONE, key: `lost-${cell.zone}` })),
  ];
  return (
    <Table
      topLabel={labels.them}
      bottomLabel={labels.you}
      ariaLabel={`Where points ended, ${labels.you} at the bottom, ${labels.them} at the top`}
    >
      {cells.map(({ cell, tone, key }) => {
        const x = TX + (TW * cell.bounds.u0) / TABLE_WIDTH_M;
        const y = TY + TH * (1 - cell.bounds.v1 / TABLE_LENGTH_M);
        const width = (TW * (cell.bounds.u1 - cell.bounds.u0)) / TABLE_WIDTH_M;
        const height = (TH * (cell.bounds.v1 - cell.bounds.v0)) / TABLE_LENGTH_M;
        return (
          <g key={key}>
            <title>
              {`${cell.count} ${cell.count === 1 ? "point" : "points"} ended here`}
            </title>
            <rect
              x={x}
              y={y}
              width={width}
              height={height}
              fill={tone}
              fillOpacity={cell.count === 0 ? 0.06 : 0.12 + 0.68 * (cell.count / max)}
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
  );
}

/**
 * The deck asks for these in two parts so the serve maps can sit between
 * them: the serve cards walk into the maps, and the endings card follows
 * them, which is the order a point happens in.
 */
export function buildScoredCards(
  result: ScoredCardsResult | null,
  labels: MapLabels,
  part: "serves" | "endings",
): ReactNode[] {
  if (!result) return [];
  const cards: ReactNode[] = [];
  const { pointLength, serveSpeed, endings } = result;

  if (part === "endings") {
    if (endings.shown) {
      cards.push(
        <Card key="endings" title="Where points ended" hint="The last bounce before the point was scored" beta>
          {/* A touch smaller than the placement maps so the two count rows
              fit inside the fixed desktop tile without scrolling. */}
          <div className="mx-auto max-w-[200px]">
            <EndingsMap endings={endings} labels={labels} />
          </div>
          <div className="divide-y divide-edge/60">
            <StatRow label="Points you won, on their side">
              <span className="text-cyan-glow">{endings.won}</span>
            </StatRow>
            <StatRow label="Points you lost, on your side">
              <span className="text-magenta-soft">{endings.lost}</span>
            </StatRow>
          </div>
          <p className="mt-3 text-[11px] text-zinc-600">
            Only points whose last bounce agrees with the score: {endings.agreed}{" "}
            of {endings.considered}.
          </p>
        </Card>,
      );
    }
    return cards;
  }

  if (pointLength.covered >= MIN_SAMPLES) {
    const mine = withData(pointLength.mine);
    const theirs = withData(pointLength.theirs);
    cards.push(
      <Card key="length" title="Point length" hint="Share of those points you won" beta>
        {mine.length > 0 && (
          <Group title={`My serves (${count(pointLength.mine)})`} first>
            {mine.map((row) => <SplitBar key={row.label} row={row} />)}
          </Group>
        )}
        {theirs.length > 0 && (
          <Group title={`Their serves (${count(pointLength.theirs)})`} first={mine.length === 0}>
            {theirs.map((row) => <SplitBar key={row.label} row={row} />)}
          </Group>
        )}
        <p className="mt-3 text-[11px] text-zinc-600">
          Timed from the serve&apos;s first bounce to the end of the rally, on{" "}
          {pointLength.covered} of {pointLength.considered} scored points.
        </p>
      </Card>,
    );
  }

  if (serveSpeed.mine.length > 0 || serveSpeed.theirs.length > 0) {
    cards.push(
      <Card key="speed" title="Serve speed" hint="Share of those points you won" beta>
        {serveSpeed.mine.length > 0 && (
          <Group title={`My serves (${count(serveSpeed.mine)})`} first>
            {serveSpeed.mine.map((band) => (
              <SplitBar key={band.label} row={{ ...band, label: speedLabel(band) }} />
            ))}
          </Group>
        )}
        {serveSpeed.theirs.length > 0 && (
          <Group title={`Their serves (${count(serveSpeed.theirs)})`} first={serveSpeed.mine.length === 0}>
            {serveSpeed.theirs.map((band) => (
              <SplitBar key={band.label} row={{ ...band, label: speedLabel(band) }} />
            ))}
          </Group>
        )}
        <p className="mt-3 text-[11px] text-zinc-600">
          Speed along the table between the serve&apos;s two bounces. Slow,
          medium and fast are each a third of that player&apos;s serves.
        </p>
      </Card>,
    );
  }

  return cards;
}
