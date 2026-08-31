import assert from "node:assert/strict";
import test from "node:test";
import {
  reconstructBallTrajectory,
  type BallTrajectoryInput,
} from "./ballTrajectory.ts";

const youngServeFixture: BallTrajectoryInput = {
  sourceWidth: 1920,
  sourceHeight: 1080,
  quad: [
    [971.272757, 572.372823],
    [1155.976869, 554.58357],
    [951.463257, 515.484394],
    [788.748549, 527.256365],
  ],
  track: [
    [342.63, 0.42536636, 0.448215547],
    [342.87, 0.448011331, 0.469472662],
    [343.11, 0.47554271, 0.491899802],
    [343.38, 0.511972458, 0.494990732],
    [343.65, 0.545801905, 0.502223649],
  ],
  bounces: [
    { t: 343.11, u: 0.661, v: 1.92 },
    { t: 343.65, u: 1.246, v: 0.914 },
  ],
  contacts: [{ t: 342.63 }],
  serveTime: 342.63,
};

const jumpFixture: BallTrajectoryInput = {
  ...youngServeFixture,
  track: [
    [1, 0.519631243, 0.520105665],
    [1.1, 0.509599491, 0.512453352],
    [1.2, 0.725848296, 0.472965114],
    [1.3, 0.491606442, 0.498728087],
    [1.4, 0.480137084, 0.491266315],
  ],
  bounces: [],
  contacts: [],
  serveTime: null,
};

const missedBounceFixture: BallTrajectoryInput = {
  ...youngServeFixture,
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
  serveTime: 10,
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
  const bounce = nearest(points, 343.11);
  assert.ok(contact.u > 0.2 && contact.u < 0.9);
  assert.ok(contact.v > 2.65 && contact.v < 3.45);
  closeTo(bounce.u, 0.661, 0.035);
  closeTo(bounce.v, 1.92, 0.035);
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
