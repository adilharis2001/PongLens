import assert from "node:assert/strict";
import test from "node:test";
import * as serveMiss from "./serveMiss.ts";

function closeTo(actual: number, expected: number) {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `expected ${actual} to be close to ${expected}`
  );
}

test("the court draws only a reconstructed trajectory, never raw airborne plane projection", () => {
  const estimate = [
    { t: 1, u: 0.3, v: -0.2, z: 0.4 },
    { t: 1.1, u: 0.5, v: 0.6, z: 0.2 },
  ];
  const card = { trajectory: estimate } as unknown as serveMiss.MissCard;

  assert.deepEqual(serveMiss.courtTrajectory(card), estimate);
  assert.deepEqual(
    serveMiss.courtTrajectory({ ...card, trajectory: undefined }),
    []
  );
});

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

test("server hydration reconstructs a trajectory from ready placement evidence before stripping confidence", () => {
  const data = {
    w: 1920,
    h: 1080,
    quad: [
      [971.272757, 572.372823],
      [1155.976869, 554.58357],
      [951.463257, 515.484394],
      [788.748549, 527.256365],
    ],
    cards: [
      {
        t0: 341.03,
        t1: 344,
        serve_s: 342.63,
        track: [[342.63, 0.45, 0.48]],
        bounces: [],
        crossings: [343.08],
        seen: [[342.63, 343.53]],
      },
    ],
  } as unknown as serveMiss.ServeMissData;
  const measuredTrack = [
    [342.63, 0.449272676, 0.482330011, 11.1],
    [342.73, 0.455971548, 0.484924834, 12.2],
    [342.83, 0.462878859, 0.487600395, 13.3],
    [342.93, 0.470004491, 0.490360525, 14.4],
    [343.03, 0.477358961, 0.493209295, 15.5],
    [343.13, 0.484953473, 0.496151045, 16.6],
    [343.23, 0.492799973, 0.499190404, 17.7],
    [343.33, 0.500911215, 0.502332311, 18.8],
    [343.43, 0.509300827, 0.505582046, 19.9],
    [343.53, 0.51798339, 0.508945256, 20.1],
  ];
  const matchJson = {
    source: { fps: 30, width: 1920, height: 1080 },
    points: [
      {
        idx: 25,
        t0: 341.03,
        t1: 344,
        serve_s: 342.63,
        placement: {
          status: "ready",
          candidates: [
            { id: "c1", kind: "contact", t: 342.63 },
            { id: "b1", kind: "bounce", t: 342.93, u: 0.45, v: 2.3 },
            { id: "b2", kind: "bounce", t: 343.23, u: 0.7, v: 0.5 },
            { id: "c2", kind: "contact", t: 343.33 },
            { id: "b3", kind: "bounce", t: 343.53, u: 0.8, v: 2 },
          ],
          hypotheses: {
            near: {
              status: "ready",
              confidence: 0.2,
              shots: [
                {
                  seq: 1,
                  contact: { t: 342.7 },
                  serve_first_bounce: { t: 342.95, u: 0.9, v: 0.4 },
                  landing: { t: 343.25, u: 0.8, v: 2.2 },
                },
              ],
            },
            far: {
              status: "ready",
              confidence: 0.91,
              shots: [
                {
                  seq: 1,
                  contact_t: 342.63,
                  contact: { event_id: "c1" },
                  serve_first_bounce: { event_id: "b1" },
                  landing: { event_id: "b2" },
                },
                {
                  seq: 2,
                  contact_t: 343.33,
                  contact: { event_id: "c2" },
                  serve_first_bounce: null,
                  landing: { event_id: "b3" },
                },
              ],
            },
          },
        },
      },
    ],
  };

  const hydrated = (
    serveMiss.hydrateServeMissData as (
      data: serveMiss.ServeMissData,
      tracks: { cards: { t0: number; track: number[][] }[] } | null,
      fps?: number,
      matchJson?: unknown
    ) => serveMiss.ServeMissData
  )(
    data,
    { cards: [{ t0: 341.04, track: measuredTrack }] },
    30,
    matchJson
  );

  const trajectory = (
    hydrated.cards[0] as serveMiss.MissCard & {
      trajectory?: Array<{ t: number; u: number; v: number; z: number }>;
    }
  ).trajectory;
  assert.ok(trajectory?.length);
  assert.equal(trajectory[0].t, 342.63);
  assert.equal(trajectory.some((point) => point.t === 343.33), true);
  assert.deepEqual(
    trajectory.find((point) => point.t === 342.93),
    { t: 342.93, u: 0.45, v: 2.3, z: 0 }
  );
  assert.equal(hydrated.cards[0].track[0].length, 3);
  assert.deepEqual(hydrated.cards[0].track[0], measuredTrack[0].slice(0, 3));
});

test("the resting table path includes every observed segment without bridging gaps", () => {
  const tablePathSegments = (
    serveMiss as typeof serveMiss & {
      tablePathSegments?: (
        points: serveMiss.TableTrackPoint[]
      ) => unknown;
    }
  ).tablePathSegments;
  const a = { t: 1, u: 0.1, v: 0.2, startsSegment: true };
  const b = { t: 1.1, u: 0.2, v: 0.4, startsSegment: false };
  const c = { t: 1.4, u: 0.8, v: 1.4, startsSegment: true };
  const d = { t: 1.5, u: 0.9, v: 1.7, startsSegment: false };

  assert.deepEqual(tablePathSegments?.([a, b, c, d]), [
    { from: a, to: b },
    { from: c, to: d },
  ]);
});
