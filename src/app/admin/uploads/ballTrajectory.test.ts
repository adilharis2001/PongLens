import assert from "node:assert/strict";
import test from "node:test";
import {
  recoverCameraCandidates,
  reconstructBallTrajectory,
  type BallTrajectoryInput,
} from "./ballTrajectory.ts";

const youngServeFixture: BallTrajectoryInput = {
  sourceWidth: 1920,
  sourceHeight: 1080,
  quad: [
    [1049.6, 789.9],
    [1358.1, 703.7],
    [852.9, 601.6],
    [569.4, 632.1],
  ],
  track: [
    [342.542, 0.3731, 0.5069, 4.74],
    [342.576, 0.371, 0.4944, 6.15],
    [342.609, 0.3679, 0.4862, 13.67],
    [342.676, 0.3249, 0.5051, 7.09],
    [342.709, 0.3312, 0.504, 15.63],
    [342.742, 0.3611, 0.4772, 20.9],
    [342.776, 0.3596, 0.4791, 19.81],
    [342.809, 0.3579, 0.4842, 22.11],
    [342.843, 0.3565, 0.4913, 21.05],
    [342.876, 0.3553, 0.5007, 20.63],
    [342.909, 0.3537, 0.5112, 21.33],
    [342.943, 0.3568, 0.5244, 47.12],
    [342.976, 0.3701, 0.5353, 45.46],
    [343.009, 0.3833, 0.5462, 43.53],
    [343.043, 0.3977, 0.5613, 34.16],
    [343.076, 0.4129, 0.5858, 15.81],
    [343.109, 0.4221, 0.5969, 4.7],
    [343.143, 0.4417, 0.5634, 18.02],
    [343.176, 0.4564, 0.5586, 27.93],
    [343.21, 0.4682, 0.5566, 33.65],
    [343.243, 0.4826, 0.5562, 35.91],
    [343.276, 0.4969, 0.5591, 36.06],
    [343.31, 0.5104, 0.563, 37.1],
    [343.343, 0.5273, 0.5731, 33.72],
    [343.376, 0.5399, 0.5815, 42.35],
    [343.41, 0.553, 0.5931, 31.61],
    [343.443, 0.5696, 0.6188, 8.82],
    [343.476, 0.5882, 0.6058, 9.07],
    [343.51, 0.6013, 0.6014, 40.14],
    [343.543, 0.618, 0.5952, 41.88],
    [343.577, 0.6337, 0.5933, 41.47],
    [343.61, 0.6472, 0.5921, 22.4],
    [343.677, 0.6308, 0.573, 0.51],
    [343.71, 0.631, 0.5733, 94.86],
    [343.743, 0.5946, 0.5581, 86.9],
    [343.777, 0.561, 0.5456, 75.11],
    [343.81, 0.5298, 0.5388, 76.13],
    [343.844, 0.5008, 0.5348, 65.14],
    [343.877, 0.4759, 0.5356, 62.05],
    [343.91, 0.4526, 0.5384, 57.68],
    [343.944, 0.4297, 0.5455, 58.62],
    [343.977, 0.4115, 0.5533, 52.11],
    [344.01, 0.3956, 0.5628, 41.54],
    [344.044, 0.3747, 0.5628, 41.26],
    [344.077, 0.3656, 0.5496, 48.89],
  ],
  bounces: [
    { t: 343.109, u: 0.6614, v: 1.9205 },
    { t: 343.443, u: 1.2449, v: 0.9132 },
    { t: 344.0103, u: 1.0247, v: 2.838 },
  ],
  contacts: [{ t: 342.63 }, { t: 343.71 }],
  crossings: [343.48, 343.91],
  serveTime: 342.63,
  seen: [
    [341.11, 341.11],
    [341.24, 341.41],
    [341.64, 341.64],
    [342.01, 342.01],
    [342.14, 342.21],
    [342.54, 344.91],
    [345.05, 345.05],
    [345.25, 345.41],
    [345.64, 345.64],
    [345.95, 346.01],
    [346.25, 346.51],
  ],
};

const syntheticQuad = [
  [971.272757, 572.372823],
  [1155.976869, 554.58357],
  [951.463257, 515.484394],
  [788.748549, 527.256365],
] as const;

const jumpFixture: BallTrajectoryInput = {
  ...youngServeFixture,
  quad: syntheticQuad,
  track: [
    [1, 0.519631243, 0.520105665],
    [1.1, 0.509599491, 0.512453352],
    [1.2, 0.725848296, 0.472965114],
    [1.3, 0.491606442, 0.498728087],
    [1.4, 0.480137084, 0.491266315],
  ],
  bounces: [
    { t: 1, u: 0.4, v: 0.3 },
    { t: 1.4, u: 0.8, v: 2 },
  ],
  contacts: [],
  serveTime: null,
};

const missedBounceFixture: BallTrajectoryInput = {
  ...youngServeFixture,
  quad: syntheticQuad,
  track: [
    [10, 0.449272676, 0.482330011],
    [10.1, 0.455971548, 0.484924834],
    [10.2, 0.462878859, 0.487600395],
    [10.3, 0.470004491, 0.490360525],
    [10.4, 0.477358961, 0.493209295],
    [10.5, 0.484953473, 0.496151045],
    [10.6, 0.492799973, 0.499190404],
    [10.7, 0.500911215, 0.502332311],
    [10.8, 0.509300827, 0.505582046],
    [10.9, 0.51798339, 0.508945256],
  ],
  bounces: [{ t: 10.9, u: 0.7, v: 0.8 }],
  contacts: [{ t: 10 }],
  crossings: [10.65],
  serveTime: 10,
  seen: [[10, 10.9]],
};

function nearest(
  points: ReturnType<typeof reconstructBallTrajectory>,
  time: number
) {
  return points.reduce((best, point) =>
    Math.abs(point.t - time) < Math.abs(best.t - time) ? point : best
  );
}

function closeTo(actual: number, expected: number, tolerance: number) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`
  );
}

test("height correction keeps a bounce fixed and returns the serve contact to its lateral source", () => {
  const points = reconstructBallTrajectory(youngServeFixture);
  const contact = nearest(points, 342.63);
  const bounce = nearest(points, 343.109);
  assert.ok(contact.u > -0.45 && contact.u < 1.975);
  assert.ok(contact.v > 2.65 && contact.v < 4.5);
  closeTo(contact.z, 0.28, 1e-9);
  closeTo(bounce.u, 0.6614, 0.035);
  closeTo(bounce.v, 1.9205, 0.035);
});

test("the Young 2 calibration recovers both physical camera candidates", () => {
  const candidates = recoverCameraCandidates(
    youngServeFixture.quad,
    youngServeFixture.sourceWidth,
    youngServeFixture.sourceHeight
  );
  assert.equal(candidates.length, 2);
  closeTo(candidates[0].focal, 1186.126, 0.01);
  closeTo(candidates[1].focal, 778.629, 0.01);
  assert.equal(
    candidates.every(
      (camera) => camera.v < 0 && camera.height >= 0.3 && camera.height <= 3
    ),
    true
  );
});

test("unavailable calibration produces no camera or trajectory", () => {
  const degenerate = youngServeFixture.quad.map(() => [1, 1]);
  assert.deepEqual(recoverCameraCandidates(degenerate, 1920, 1080), []);
  assert.deepEqual(
    reconstructBallTrajectory({ ...youngServeFixture, quad: degenerate }),
    []
  );
});

test("absent or insufficient flight anchors produce no trajectory", () => {
  assert.deepEqual(
    reconstructBallTrajectory({
      ...youngServeFixture,
      bounces: [],
      contacts: [],
      serveTime: null,
    }),
    []
  );
  assert.deepEqual(
    reconstructBallTrajectory({
      ...youngServeFixture,
      bounces: youngServeFixture.bounces.slice(0, 1),
      contacts: [],
      serveTime: null,
    }),
    []
  );
});

test("an out-of-range bounce never overwrites a sampled trajectory point", () => {
  const result = reconstructBallTrajectory({
    ...youngServeFixture,
    bounces: [
      ...youngServeFixture.bounces,
      { t: 345.5, u: 0.2, v: 0.3 },
    ],
  });
  assert.equal(result.some((point) => point.t === 345.5), false);
  assert.equal(result.at(-1)?.t, 344.077);
});

test("crossing evidence inserts exact net-time estimates for candidate scoring", () => {
  const result = reconstructBallTrajectory(youngServeFixture);
  const crossing = result.find((point) => point.t === 343.48);
  assert.ok(crossing);
  assert.equal(crossing.t, 343.48);
  assert.equal(Number.isFinite(crossing.v), true);
});

test("seen spans exclude observations the detector did not hold", () => {
  const result = reconstructBallTrajectory({
    ...youngServeFixture,
    track: [...youngServeFixture.track, [345, 0.95, 0.1, 99]],
    seen: [[342.54, 344.91]],
  });
  assert.equal(result.some((point) => point.t === 345), false);
});

test("an isolated neighbouring-ball teleport is removed", () => {
  const result = reconstructBallTrajectory(jumpFixture);
  assert.equal(result.some((point) => point.u < -1 || point.u > 2.5), false);
});

test("a missing first serve bounce still produces one continuous net-traversing path", () => {
  const result = reconstructBallTrajectory(missedBounceFixture);
  assert.ok(result.length > 10);
  assert.equal(
    result.every((_, index) => index === 0 || result[index].t > result[index - 1].t),
    true
  );
  assert.ok(result.some((point) => point.v < 1.37));
  assert.ok(result.some((point) => point.v > 1.37));
});
