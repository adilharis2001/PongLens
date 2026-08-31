import assert from "node:assert/strict";
import test from "node:test";
import * as serveMiss from "./serveMiss.ts";

function closeTo(actual: number, expected: number) {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `expected ${actual} to be close to ${expected}`
  );
}

test("projects raw BlurBall detections from frame space onto the table", () => {
  const projectTrackToTable = (
    serveMiss as typeof serveMiss & {
      projectTrackToTable?: (
        track: [number, number, number][],
        quad: number[][],
        sourceWidth: number,
        sourceHeight: number
      ) => unknown;
    }
  ).projectTrackToTable;

  const projected = projectTrackToTable?.(
    [
      [0, 0.25, 0.25],
      [0.1, 0.5, 0.5],
      [0.2, 0.75, 0.75],
    ],
    [
      [100, 200],
      [300, 200],
      [300, 600],
      [100, 600],
    ],
    400,
    800
  );

  assert.deepEqual(projected, [
    { t: 0, u: 0, v: 0, startsSegment: true },
    {
      t: 0.1,
      u: serveMiss.TABLE_W_M / 2,
      v: serveMiss.TABLE_L_M / 2,
      startsSegment: false,
    },
    {
      t: 0.2,
      u: serveMiss.TABLE_W_M,
      v: serveMiss.TABLE_L_M,
      startsSegment: false,
    },
  ]);
});

test("the live trail fades over 0.8 seconds and does not bridge detector gaps", () => {
  const tableTrailAt = (
    serveMiss as typeof serveMiss & {
      tableTrailAt?: (
        points: Array<{
          t: number;
          u: number;
          v: number;
          startsSegment: boolean;
        }>,
        now: number
      ) => unknown;
    }
  ).tableTrailAt;

  const trail = tableTrailAt?.(
    [
      { t: 1, u: 0, v: 0, startsSegment: true },
      { t: 1.3, u: 0.3, v: 0.4, startsSegment: false },
      { t: 1.5, u: 0.7, v: 1.1, startsSegment: true },
      { t: 1.9, u: 1, v: 1.8, startsSegment: false },
      { t: 2.1, u: 1.2, v: 2.2, startsSegment: false },
    ],
    2
  );

  assert.deepEqual(trail, [
    {
      t: 1.3,
      u: 0.3,
      v: 0.4,
      startsSegment: false,
      opacity: 0.125,
      connectsFromPrevious: false,
    },
    {
      t: 1.5,
      u: 0.7,
      v: 1.1,
      startsSegment: true,
      opacity: 0.375,
      connectsFromPrevious: false,
    },
    {
      t: 1.9,
      u: 1,
      v: 1.8,
      startsSegment: false,
      opacity: 0.875,
      connectsFromPrevious: true,
    },
  ]);
});

test("perspective calibration maps all four detected corners to table corners", () => {
  const quad = [
    [120, 610],
    [870, 655],
    [690, 270],
    [280, 250],
  ];
  const track = quad.map(
    ([x, y], index) => [index / 10, x / 1000, y / 800] as [number, number, number]
  );
  const projected = serveMiss.projectTrackToTable(track, quad, 1000, 800);
  const expected = [
    [0, 0],
    [serveMiss.TABLE_W_M, 0],
    [serveMiss.TABLE_W_M, serveMiss.TABLE_L_M],
    [0, serveMiss.TABLE_L_M],
  ];

  assert.equal(projected.length, 4);
  projected.forEach((point, index) => {
    closeTo(point.u, expected[index][0]);
    closeTo(point.v, expected[index][1]);
  });
});

test("full-rate seen spans break the projected trail at a missed-ball interval", () => {
  const projected = serveMiss.projectTrackToTable(
    [
      [1, 0.25, 0.25],
      [1.1, 0.4, 0.4],
      [1.2, 0.55, 0.55],
    ],
    [
      [100, 200],
      [300, 200],
      [300, 600],
      [100, 600],
    ],
    400,
    800,
    [
      [1, 1.1],
      [1.2, 1.4],
    ]
  );

  assert.deepEqual(
    projected.map((point) => point.startsSegment),
    [true, false, true]
  );
});

test("a degenerate table calibration produces no invented trail", () => {
  assert.deepEqual(
    serveMiss.projectTrackToTable(
      [[0, 0.5, 0.5]],
      [
        [1, 1],
        [1, 1],
        [1, 1],
        [1, 1],
      ],
      100,
      100
    ),
    []
  );
});

test("legacy gap detection follows the worker's four-frame rule at each fps", () => {
  const quad = [
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
  ];
  for (const fps of [24, 30, 60]) {
    const normalStep = 3 / fps;
    const projected = serveMiss.projectTrackToTable(
      [
        [0, 0.2, 0.2],
        [normalStep, 0.3, 0.3],
        [normalStep * 3, 0.4, 0.4],
      ],
      quad,
      100,
      100,
      undefined,
      fps
    );

    assert.deepEqual(
      projected.map((point) => point.startsSegment),
      [true, false, true],
      `${fps} fps should preserve one sampled step and break at two`
    );
  }
});

test("the browser payload prefers full-rate BlurBall rows without confidence", () => {
  const hydrateServeMissData = (
    serveMiss as typeof serveMiss & {
      hydrateServeMissData?: (
        data: serveMiss.ServeMissData,
        tracks: { cards: { t0: number; track: number[][] }[] } | null,
        fps?: number
      ) => serveMiss.ServeMissData;
    }
  ).hydrateServeMissData;
  const originalTrack: [number, number, number][] = [[10, 0.1, 0.2]];
  const data = {
    cards: [
      { t0: 10, track: originalTrack },
      { t0: 20, track: [[20, 0.7, 0.8]] },
    ],
  } as unknown as serveMiss.ServeMissData;

  const hydrated = hydrateServeMissData?.(
    data,
    {
      cards: [
        {
          t0: 10.04,
          track: [
            [10, 0.11, 0.21, 17.2],
            [10.033, 0.12, 0.22, 15.7],
          ],
        },
      ],
    },
    60
  );

  assert.deepEqual(hydrated?.cards[0].track, [
    [10, 0.11, 0.21],
    [10.033, 0.12, 0.22],
  ]);
  assert.deepEqual(hydrated?.cards[1].track, [[20, 0.7, 0.8]]);
  assert.equal(hydrated?.fps, 60);
  assert.equal(data.cards[0].track, originalTrack, "input artifact stays unchanged");
});
