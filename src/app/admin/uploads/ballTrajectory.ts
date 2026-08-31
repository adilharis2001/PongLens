const TABLE_WIDTH_M = 1.525;
const TABLE_LENGTH_M = 2.74;
const NET_V_M = TABLE_LENGTH_M / 2;
const NET_HEIGHT_M = 0.1525;
const DISPLAY_U_MIN = -0.45;
const DISPLAY_U_MAX = 1.975;
const DISPLAY_V_MIN = -0.7;
const DISPLAY_V_MAX = 3.44;
const MAX_HORIZONTAL_SPEED_MPS = 35;
const EPSILON = 1e-10;

export interface EstimatedTrajectoryPoint {
  t: number;
  u: number;
  v: number;
  z: number;
}

export interface TrajectoryBounce {
  t: number;
  u: number;
  v: number;
}

export interface TrajectoryContact {
  t: number;
  u?: number;
  v?: number;
  z?: number;
}

export interface BallTrajectoryInput {
  track: readonly (readonly number[])[];
  quad: readonly (readonly number[])[];
  sourceWidth: number;
  sourceHeight: number;
  bounces: readonly TrajectoryBounce[];
  contacts?: readonly TrajectoryContact[];
  crossings?: readonly number[];
  serveTime?: number | null;
  seen?: readonly (readonly [number, number])[];
}

export interface CameraCandidate {
  u: number;
  v: number;
  height: number;
  focal: number;
}

type Matrix3 = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
];

interface PlaneSample {
  t: number;
  u0: number;
  v0: number;
  confidence: number;
}

interface CandidateTrajectoryPoint extends EstimatedTrajectoryPoint {
  confidence: number;
}

interface HeightAnchor {
  t: number;
  z: number;
  kind: "bounce" | "contact";
}

/** Recover physically plausible camera centres from an A/B/C/D table quad. */
export function recoverCameraCandidates(
  quad: BallTrajectoryInput["quad"],
  width: number,
  height: number
): CameraCandidate[] {
  const homography = tableToImageHomography(quad, width, height);
  if (!homography) return [];

  const cx = width / 2;
  const cy = height / 2;
  const h1 = [
    homography[0][0] - cx * homography[2][0],
    homography[1][0] - cy * homography[2][0],
    homography[2][0],
  ];
  const h2 = [
    homography[0][1] - cx * homography[2][1],
    homography[1][1] - cy * homography[2][1],
    homography[2][1],
  ];
  const equations = [
    {
      numerator: h1[0] * h2[0] + h1[1] * h2[1],
      denominator: h1[2] * h2[2],
    },
    {
      numerator:
        h1[0] ** 2 + h1[1] ** 2 - h2[0] ** 2 - h2[1] ** 2,
      denominator: h1[2] ** 2 - h2[2] ** 2,
    },
  ];

  const focals: number[] = [];
  for (const { numerator, denominator } of equations) {
    if (Math.abs(denominator) <= 1e-12) continue;
    const focalSquared = -numerator / denominator;
    if (!Number.isFinite(focalSquared) || focalSquared <= 0) continue;
    const focal = Math.sqrt(focalSquared);
    if (!focals.some((value) => Math.abs(value - focal) <= focal * 1e-6)) {
      focals.push(focal);
    }
  }

  const candidates: CameraCandidate[] = [];
  for (const focal of focals) {
    const columns = ([0, 1, 2] as const).map((column) => [
      (homography[0][column] - cx * homography[2][column]) / focal,
      (homography[1][column] - cy * homography[2][column]) / focal,
      homography[2][column],
    ]);
    const n1 = norm(columns[0]);
    const n2 = norm(columns[1]);
    if (n1 <= EPSILON || n2 <= EPSILON) continue;

    for (const sign of [1, -1]) {
      const scale = (sign * 2) / (n1 + n2);
      const first = normalize(scaleVector(columns[0], scale));
      if (!first) continue;
      const rawSecond = scaleVector(columns[1], scale);
      const second = normalize(
        subtract(rawSecond, scaleVector(first, dot(rawSecond, first)))
      );
      if (!second) continue;
      const third = cross(first, second);
      const translation = scaleVector(columns[2], scale);
      const camera: CameraCandidate = {
        u: -dot(first, translation),
        v: -dot(second, translation),
        height: -dot(third, translation),
        focal,
      };
      if (
        Object.values(camera).every(Number.isFinite) &&
        camera.height >= 0.3 &&
        camera.height <= 3 &&
        camera.v < 0
      ) {
        candidates.push(camera);
      }
    }
  }
  return candidates;
}

export function reconstructBallTrajectory(
  input: BallTrajectoryInput
): EstimatedTrajectoryPoint[] {
  const homography = tableToImageHomography(
    input.quad,
    input.sourceWidth,
    input.sourceHeight
  );
  const inverse = homography && invert3(homography);
  const cameras = recoverCameraCandidates(
    input.quad,
    input.sourceWidth,
    input.sourceHeight
  );
  if (!inverse || cameras.length === 0) return [];

  const seen = (input.seen ?? [])
    .filter(
      (span) =>
        span.length >= 2 &&
        Number.isFinite(span[0]) &&
        Number.isFinite(span[1]) &&
        span[1] >= span[0]
    )
    .map((span) => [span[0], span[1]] as const);
  const samples = input.track.flatMap((row): PlaneSample[] => {
    const [t, normalizedX, normalizedY, confidence] = row;
    if (![t, normalizedX, normalizedY].every(Number.isFinite)) return [];
    if (seen.length > 0 && !timeInSeen(t, seen)) return [];
    const projected = project(
      inverse,
      normalizedX * input.sourceWidth,
      normalizedY * input.sourceHeight
    );
    return projected
      ? [{
          t,
          u0: projected[0],
          v0: projected[1],
          confidence: normalizeConfidence(confidence),
        }]
      : [];
  });
  samples.sort((left, right) => left.t - right.t);
  const uniqueSamples = samples.filter(
    (sample, index) => index === 0 || sample.t > samples[index - 1].t
  );
  if (uniqueSamples.length < 2) return [];
  const firstSampleTime = uniqueSamples[0].t;
  const lastSampleTime = uniqueSamples[uniqueSamples.length - 1].t;

  const bounces = input.bounces
    .filter((bounce) =>
      [bounce.t, bounce.u, bounce.v].every(Number.isFinite) &&
      bounce.t >= firstSampleTime &&
      bounce.t <= lastSampleTime
    )
    .slice()
    .sort((left, right) => left.t - right.t);
  const rawContacts = (input.contacts ?? [])
    .filter((contact) => Number.isFinite(contact.t))
    .slice()
    .sort((left, right) => left.t - right.t);
  if (
    Number.isFinite(input.serveTime) &&
    !rawContacts.some(
      (contact) => Math.abs(contact.t - Number(input.serveTime)) <= 0.035
    )
  ) {
    rawContacts.push({ t: Number(input.serveTime) });
    rawContacts.sort((left, right) => left.t - right.t);
  }
  const contacts = rawContacts.filter(
    (contact) =>
      contact.t >= firstSampleTime && contact.t <= lastSampleTime
  );
  const crossings = (input.crossings ?? [])
    .filter(
      (time) =>
        Number.isFinite(time) &&
        time >= firstSampleTime &&
        time <= lastSampleTime &&
        (seen.length === 0 || timeInSeen(time, seen))
    )
    .slice()
    .sort((left, right) => left - right);
  let anchors: HeightAnchor[] = [
    ...bounces.map((bounce) => ({
      t: bounce.t,
      z: 0,
      kind: "bounce" as const,
    })),
    ...contacts.map((contact) => ({
      t: contact.t,
      z: clamp(contact.z ?? 0.28, 0, 1.6),
      kind: "contact" as const,
    })),
  ].sort((left, right) => left.t - right.t || left.z - right.z);
  anchors = anchors.filter(
    (anchor, index) =>
      index === 0 || Math.abs(anchor.t - anchors[index - 1].t) > 1e-6
  );
  if (anchors.length < 2 || bounces.length === 0) return [];

  const serveContact = Number.isFinite(input.serveTime)
    ? Number(input.serveTime)
    : contacts[0]?.t;
  const firstLanding = bounces.find((bounce) => bounce.t > serveContact);
  const contactPlane = Number.isFinite(serveContact)
    ? interpolatePlaneSample(uniqueSamples, serveContact)
    : null;
  if (
    contactPlane &&
    firstLanding &&
    (contactPlane.v0 - NET_V_M) * (firstLanding.v - NET_V_M) <
      0
  ) {
    const latentTime = latentBounceTime(
      input.track,
      serveContact,
      firstLanding.t
    );
    if (latentTime > serveContact && latentTime < firstLanding.t) {
      anchors.push({ t: latentTime, z: 0, kind: "bounce" });
      anchors.sort((left, right) => left.t - right.t);
    }
  }

  const allSamples = insertEventSamples(
    uniqueSamples,
    [...anchors.map((anchor) => anchor.t), ...crossings],
    contacts.map((contact) => contact.t),
    seen
  );
  const representedCrossings = crossings.filter((time) =>
    allSamples.some((sample) => Math.abs(sample.t - time) <= 1e-6)
  );
  const trajectories = cameras.flatMap((camera) => {
    const lifted = allSamples.map((sample): CandidateTrajectoryPoint => {
      const z = heightAt(sample.t, anchors);
      const point = liftAlongRay(sample.u0, sample.v0, z, camera);
      return {
        t: sample.t,
        u: point.u,
        v: point.v,
        z,
        confidence: sample.confidence,
      };
    });
    const points = lifted.slice();
    for (const bounce of bounces) {
      const index = points.findIndex(
        (point) => Math.abs(point.t - bounce.t) <= 1e-6
      );
      if (index >= 0) {
        points[index] = {
          t: bounce.t,
          u: bounce.u,
          v: bounce.v,
          z: 0,
          confidence: points[index].confidence,
        };
      }
    }
    const supported = stabilizeSupportedTrajectory(
      points.sort((left, right) => left.t - right.t),
      anchors
    );
    if (!supported) return [];
    return [{
      cost:
        bounceProjectionCost(lifted, bounces) +
        trajectoryCost(supported, [], representedCrossings),
      points: supported,
    }];
  });

  if (trajectories.length === 0) return [];

  const best = trajectories.reduce((best, candidate) =>
    candidate.cost < best.cost ? candidate : best
  ).points;
  return best.map(({ t, u, v, z }) => ({ t, u, v, z }));
}

/**
 * Keep only event-bounded flights. Observations which cannot participate in a
 * physically plausible, monotone flight are missing data; their timestamps are
 * retained and their horizontal position is interpolated between supported
 * points so the renderer receives one continuous estimate.
 */
function stabilizeSupportedTrajectory(
  points: readonly CandidateTrajectoryPoint[],
  anchors: readonly HeightAnchor[]
): CandidateTrajectoryPoint[] | null {
  const output: CandidateTrajectoryPoint[] = [];
  for (let anchorIndex = 1; anchorIndex < anchors.length; anchorIndex += 1) {
    const startTime = anchors[anchorIndex - 1].t;
    const endTime = anchors[anchorIndex].t;
    const flight = points.filter(
      (point) => point.t >= startTime - 1e-6 && point.t <= endTime + 1e-6
    );
    const start = flight.find((point) => Math.abs(point.t - startTime) <= 1e-6);
    const end = flight.find((point) => Math.abs(point.t - endTime) <= 1e-6);
    if (!start || !end || !isInsideDisplay(start) || !isInsideDisplay(end)) {
      return null;
    }

    const minimumV = Math.min(start.v, end.v) - 1e-6;
    const maximumV = Math.max(start.v, end.v) + 1e-6;
    const candidates = flight.filter(
      (point) =>
        point === start ||
        point === end ||
        (isInsideDisplay(point) && point.v >= minimumV && point.v <= maximumV)
    );
    const previous = new Array<number>(candidates.length).fill(-1);
    const retainedCounts = new Array<number>(candidates.length).fill(
      Number.NEGATIVE_INFINITY
    );
    const retainedConfidence = new Array<number>(candidates.length).fill(
      Number.NEGATIVE_INFINITY
    );
    retainedCounts[0] = 1;
    retainedConfidence[0] = candidates[0].confidence;
    const direction = Math.sign(end.v - start.v);
    for (let right = 1; right < candidates.length; right += 1) {
      for (let left = 0; left < right; left += 1) {
        if (!Number.isFinite(retainedCounts[left])) continue;
        const deltaV = candidates[right].v - candidates[left].v;
        const followsFlight =
          direction === 0
            ? Math.abs(deltaV) <= 1e-6
            : direction * deltaV >= -1e-6;
        if (
          followsFlight &&
          horizontalSpeed(candidates[left], candidates[right]) <=
            MAX_HORIZONTAL_SPEED_MPS
        ) {
          const count = retainedCounts[left] + 1;
          const confidence =
            retainedConfidence[left] + candidates[right].confidence;
          if (
            count > retainedCounts[right] ||
            (count === retainedCounts[right] &&
              confidence > retainedConfidence[right] + EPSILON)
          ) {
            retainedCounts[right] = count;
            retainedConfidence[right] = confidence;
            previous[right] = left;
          }
        }
      }
    }
    const endIndex = candidates.length - 1;
    if (!Number.isFinite(retainedCounts[endIndex])) return null;

    const supportedIndices: number[] = [];
    for (let index = endIndex; index >= 0; index = previous[index]) {
      supportedIndices.push(index);
      if (index === 0) break;
    }
    supportedIndices.reverse();
    const supported = supportedIndices.map((index) => candidates[index]);
    let supportedIndex = 1;
    for (const point of flight) {
      while (
        supportedIndex < supported.length - 1 &&
        point.t > supported[supportedIndex].t + 1e-9
      ) {
        supportedIndex += 1;
      }
      const left = supported[supportedIndex - 1];
      const right = supported[supportedIndex];
      const duration = right.t - left.t;
      const ratio = duration <= EPSILON ? 1 : (point.t - left.t) / duration;
      const stabilized = supported.some(
        (candidate) => Math.abs(candidate.t - point.t) <= 1e-9
      )
        ? point
        : {
            ...point,
            u: left.u + ratio * (right.u - left.u),
            v: left.v + ratio * (right.v - left.v),
          };
      if (
        output.length === 0 ||
        Math.abs(output[output.length - 1].t - stabilized.t) > 1e-9
      ) {
        output.push(stabilized);
      }
    }
  }
  return output.length >= 2 ? output : null;
}

function isInsideDisplay(point: Pick<EstimatedTrajectoryPoint, "u" | "v">) {
  return (
    point.u >= DISPLAY_U_MIN &&
    point.u <= DISPLAY_U_MAX &&
    point.v >= DISPLAY_V_MIN &&
    point.v <= DISPLAY_V_MAX
  );
}

function bounceProjectionCost(
  points: readonly EstimatedTrajectoryPoint[],
  bounces: readonly TrajectoryBounce[]
) {
  return bounces.reduce((cost, bounce) => {
    const point = points.find(
      (candidate) => Math.abs(candidate.t - bounce.t) <= 1e-6
    );
    return point ? cost + 1_000 * horizontalDistance(point, bounce) ** 2 : cost;
  }, 0);
}

function liftAlongRay(
  u0: number,
  v0: number,
  z: number,
  camera: CameraCandidate
) {
  return {
    u: u0 + (z / camera.height) * (camera.u - u0),
    v: v0 + (z / camera.height) * (camera.v - v0),
  };
}

function heightAt(time: number, anchors: readonly HeightAnchor[]): number {
  if (anchors.length === 0) return 0;
  if (time <= anchors[0].t) return anchors[0].z;
  if (time >= anchors[anchors.length - 1].t) {
    return anchors[anchors.length - 1].z;
  }
  const nextIndex = anchors.findIndex((anchor) => anchor.t >= time);
  const start = anchors[nextIndex - 1];
  const end = anchors[nextIndex];
  const duration = end.t - start.t;
  if (duration <= EPSILON) return end.z;
  const s = clamp((time - start.t) / duration, 0, 1);
  if (start.kind === "bounce" && end.kind === "bounce") {
    const peak = Math.min(0.55, (9.81 * duration ** 2) / 8);
    return Math.min(0.55, 4 * peak * s * (1 - s));
  }
  return (
    start.z * (1 - s) +
    end.z * s +
    4 * 0.08 * s * (1 - s)
  );
}

function insertEventSamples(
  samples: readonly PlaneSample[],
  eventTimes: readonly number[],
  contactTimes: readonly number[],
  seen: readonly (readonly [number, number])[]
): PlaneSample[] {
  const output = samples.slice();
  for (const time of eventTimes) {
    if (output.some((sample) => Math.abs(sample.t - time) <= 1e-9)) {
      continue;
    }
    const after = output.findIndex((sample) => sample.t > time);
    if (after <= 0) continue;
    const left = output[after - 1];
    const right = output[after];
    if (!canInterpolateAt(time, left.t, right.t, seen)) continue;
    // A racket impact is a velocity discontinuity. When BlurBall misses the
    // exact impact frame, the outgoing observation is the relevant ray;
    // blending it with the pre-impact ball recreates the false outer loop.
    const ratio = contactTimes.some(
      (contactTime) => Math.abs(contactTime - time) <= 1e-6
    )
      ? 1
      : (time - left.t) / (right.t - left.t);
    output.push({
      t: time,
      u0: left.u0 + ratio * (right.u0 - left.u0),
      v0: left.v0 + ratio * (right.v0 - left.v0),
      confidence:
        left.confidence + ratio * (right.confidence - left.confidence),
    });
  }
  return output.sort((left, right) => left.t - right.t);
}

function interpolatePlaneSample(
  samples: readonly PlaneSample[],
  time: number
): PlaneSample | null {
  const exact = samples.find((sample) => Math.abs(sample.t - time) <= 1e-9);
  if (exact) return exact;
  const after = samples.findIndex((sample) => sample.t > time);
  if (after <= 0) return null;
  const left = samples[after - 1];
  const right = samples[after];
  const ratio = (time - left.t) / (right.t - left.t);
  return {
    t: time,
    u0: left.u0 + ratio * (right.u0 - left.u0),
    v0: left.v0 + ratio * (right.v0 - left.v0),
    confidence:
      left.confidence + ratio * (right.confidence - left.confidence),
  };
}

function normalizeConfidence(value: number | undefined): number {
  return Number.isFinite(value) && Number(value) > 0
    ? Number(value) / (1 + Number(value))
    : 0.5;
}

function latentBounceTime(
  track: BallTrajectoryInput["track"],
  contactTime: number,
  landingTime: number
): number {
  const samples = track
    .filter(
      (row) =>
        row.length >= 3 &&
        row.slice(0, 3).every(Number.isFinite) &&
        row[0] > contactTime &&
        row[0] < landingTime
    )
    .slice()
    .sort((left, right) => left[0] - right[0]);
  const localMaxima = samples.filter((sample, index) => {
    if (index === 0 || index === samples.length - 1) return false;
    return sample[2] >= samples[index - 1][2] && sample[2] >= samples[index + 1][2];
  });
  if (localMaxima.length > 0) {
    return localMaxima.reduce((best, sample) =>
      sample[2] > best[2] ? sample : best
    )[0];
  }
  return contactTime + 0.55 * (landingTime - contactTime);
}

function trajectoryCost(
  points: readonly EstimatedTrajectoryPoint[],
  bounces: readonly TrajectoryBounce[],
  crossings: readonly number[]
): number {
  let cost = 0;
  for (const bounce of bounces) {
    const index = points.findIndex(
      (point) => Math.abs(point.t - bounce.t) <= 1e-6
    );
    if (index < 0) continue;
    cost += 1_000 * horizontalDistance(points[index], bounce) ** 2;
  }
  for (const crossing of crossings) {
    const point = points.find(
      (candidate) => Math.abs(candidate.t - crossing) <= 1e-6
    );
    if (!point) continue;
    cost += 1_000 * (point.v - NET_V_M) ** 2;
    if (point.z < NET_HEIGHT_M) {
      cost += 1_000 * (NET_HEIGHT_M - point.z) ** 2;
    }
  }
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (point.z < 0 || point.z > 1.6) {
      cost += 1_000 * Math.abs(point.z < 0 ? point.z : point.z - 1.6);
    }
    if (
      index > 0 &&
      index < points.length - 1 &&
      !isInsideDisplay(point)
    ) {
      cost +=
        100 +
        100 *
          (distanceOutside(point.u, DISPLAY_U_MIN, DISPLAY_U_MAX) ** 2 +
            distanceOutside(point.v, DISPLAY_V_MIN, DISPLAY_V_MAX) ** 2);
    }
    if (index > 0) {
      const speed = horizontalSpeed(points[index - 1], point);
      if (speed > MAX_HORIZONTAL_SPEED_MPS) {
        cost += 10 * (speed - MAX_HORIZONTAL_SPEED_MPS) ** 2;
      }
    }
    if (index > 1) {
      const before = points[index - 2];
      const middle = points[index - 1];
      const firstDuration = middle.t - before.t;
      const secondDuration = point.t - middle.t;
      if (firstDuration > EPSILON && secondDuration > EPSILON) {
        const firstVelocity = [
          (middle.u - before.u) / firstDuration,
          (middle.v - before.v) / firstDuration,
        ];
        const secondVelocity = [
          (point.u - middle.u) / secondDuration,
          (point.v - middle.v) / secondDuration,
        ];
        const acceleration =
          norm(subtract(secondVelocity, firstVelocity)) /
          ((firstDuration + secondDuration) / 2);
        cost += acceleration * 0.001;
      }
    }
  }
  return cost;
}

function horizontalSpeed(
  first: EstimatedTrajectoryPoint,
  second: EstimatedTrajectoryPoint
): number {
  const duration = second.t - first.t;
  return duration > EPSILON
    ? horizontalDistance(first, second) / duration
    : Number.POSITIVE_INFINITY;
}

function horizontalDistance(
  first: Pick<EstimatedTrajectoryPoint, "u" | "v">,
  second: Pick<EstimatedTrajectoryPoint, "u" | "v">
): number {
  return Math.hypot(second.u - first.u, second.v - first.v);
}

function distanceOutside(value: number, minimum: number, maximum: number) {
  return value < minimum ? minimum - value : value > maximum ? value - maximum : 0;
}

function timeInSeen(
  time: number,
  seen: readonly (readonly [number, number])[]
): boolean {
  return seen.some(([start, end]) => time >= start - 1e-6 && time <= end + 1e-6);
}

function canInterpolateAt(
  time: number,
  leftTime: number,
  rightTime: number,
  seen: readonly (readonly [number, number])[]
): boolean {
  if (seen.length === 0) return true;
  return seen.some(
    ([start, end]) =>
      leftTime >= start - 1e-6 &&
      time >= start - 1e-6 &&
      rightTime <= end + 1e-6
  );
}

function tableToImageHomography(
  quad: BallTrajectoryInput["quad"],
  width: number,
  height: number
): Matrix3 | null {
  if (
    quad.length !== 4 ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  const normalizedQuad = quad.map((point) => {
    if (point.length < 2 || !point.slice(0, 2).every(Number.isFinite)) {
      return null;
    }
    const normalized = Math.abs(point[0]) <= 2 && Math.abs(point[1]) <= 2;
    return [
      normalized ? point[0] * width : point[0],
      normalized ? point[1] * height : point[1],
    ];
  });
  if (normalizedQuad.some((point) => point === null)) return null;

  const world = [
    [0, 0],
    [TABLE_WIDTH_M, 0],
    [TABLE_WIDTH_M, TABLE_LENGTH_M],
    [0, TABLE_LENGTH_M],
  ];
  const equations: number[][] = [];
  const values: number[] = [];
  for (let index = 0; index < 4; index += 1) {
    const [u, v] = world[index];
    const [x, y] = normalizedQuad[index]!;
    equations.push([u, v, 1, 0, 0, 0, -x * u, -x * v]);
    values.push(x);
    equations.push([0, 0, 0, u, v, 1, -y * u, -y * v]);
    values.push(y);
  }
  const solved = solveLinearSystem(equations, values);
  return solved
    ? [
        [solved[0], solved[1], solved[2]],
        [solved[3], solved[4], solved[5]],
        [solved[6], solved[7], 1],
      ]
    : null;
}

function solveLinearSystem(
  matrix: readonly (readonly number[])[],
  values: readonly number[]
): number[] | null {
  const size = values.length;
  const rows = matrix.map((row, index) => [...row, values[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) {
        pivot = row;
      }
    }
    if (Math.abs(rows[pivot][column]) <= EPSILON) return null;
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    for (let item = column; item <= size; item += 1) {
      rows[column][item] /= divisor;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = rows[row][column];
      for (let item = column; item <= size; item += 1) {
        rows[row][item] -= factor * rows[column][item];
      }
    }
  }
  const solution = rows.map((row) => row[size]);
  return solution.every(Number.isFinite) ? solution : null;
}

function invert3(matrix: Matrix3): Matrix3 | null {
  const [[a, b, c], [d, e, f], [g, h, i]] = matrix;
  const determinant =
    a * (e * i - f * h) -
    b * (d * i - f * g) +
    c * (d * h - e * g);
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= EPSILON) {
    return null;
  }
  return [
    [
      (e * i - f * h) / determinant,
      (c * h - b * i) / determinant,
      (b * f - c * e) / determinant,
    ],
    [
      (f * g - d * i) / determinant,
      (a * i - c * g) / determinant,
      (c * d - a * f) / determinant,
    ],
    [
      (d * h - e * g) / determinant,
      (b * g - a * h) / determinant,
      (a * e - b * d) / determinant,
    ],
  ];
}

function project(matrix: Matrix3, x: number, y: number): [number, number] | null {
  const denominator = matrix[2][0] * x + matrix[2][1] * y + matrix[2][2];
  if (!Number.isFinite(denominator) || Math.abs(denominator) <= EPSILON) {
    return null;
  }
  const u =
    (matrix[0][0] * x + matrix[0][1] * y + matrix[0][2]) / denominator;
  const v =
    (matrix[1][0] * x + matrix[1][1] * y + matrix[1][2]) / denominator;
  return Number.isFinite(u) && Number.isFinite(v) ? [u, v] : null;
}

function dot(left: readonly number[], right: readonly number[]): number {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function norm(vector: readonly number[]): number {
  return Math.sqrt(dot(vector, vector));
}

function normalize(vector: readonly number[]): number[] | null {
  const length = norm(vector);
  return length <= EPSILON ? null : scaleVector(vector, 1 / length);
}

function scaleVector(vector: readonly number[], scale: number): number[] {
  return vector.map((value) => value * scale);
}

function subtract(left: readonly number[], right: readonly number[]): number[] {
  return left.map((value, index) => value - right[index]);
}

function cross(left: readonly number[], right: readonly number[]): number[] {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
