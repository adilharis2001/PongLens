import assert from "node:assert/strict";
import test from "node:test";
import {
  readInferredBounceEvidence,
  type InferredBounceEvidence,
} from "./inferredBounceEvidence.ts";

function candidateFixture(): Record<string, unknown> {
  return {
    id: "ib-334.672-serve_first_bounce",
    time: {
      estimate_s: 334.672,
      interval_s: [334.638, 334.705],
      method: "weak_reversal",
    },
    table_position: null,
    context: "serve_first_bounce",
    confidence: { score: 0.94, tier: "high" },
    hypothesis_comparison: {
      preferred: "latent_bounce",
      continuous_airborne_cost: 18.4,
      latent_bounce_cost: 7.1,
      margin: 11.3,
    },
    support: [
      {
        kind: "weak_visual_reversal",
        strength: 0.82,
        detail: "Below the normal five-frame reversal gate.",
      },
    ],
    vetoes: [],
    normal_detector_miss: {
      reason: "below_reversal_threshold",
      detail: "The visual reversal did not clear the normal gate.",
    },
    trajectory_constraint: {
      safe_to_constrain_z0: false,
      mode: "display_only",
      reason: "The global shadow constraint gate is disabled.",
    },
  };
}

function envelopeFixture(): Record<string, unknown> {
  return {
    schema_version: 1,
    detector_version: "shadow-v1",
    clock: "source_seconds",
    candidates: [candidateFixture()],
  };
}

test("reads the exact shadow-v1 envelope with a null coordinate", () => {
  const parsed = readInferredBounceEvidence(envelopeFixture());

  assert.equal(parsed?.candidates[0].context, "serve_first_bounce");
  assert.equal(parsed?.candidates[0].table_position, null);
});
test("reads a complete coordinate without changing its uncertainty", () => {
  const value = envelopeFixture();
  const candidate = (value.candidates as Record<string, unknown>[])[0];
  candidate.table_position = {
    u_m: 0.62,
    v_m: 2.18,
    uncertainty_radius_m: 0.07,
    method: "two_sided_track_fit",
  };

  const parsed = readInferredBounceEvidence(value);

  assert.deepEqual(parsed?.candidates[0].table_position, candidate.table_position);
});

test("rejects a partial coordinate instead of fabricating defaults", () => {
  const value = envelopeFixture();
  const candidate = (value.candidates as Record<string, unknown>[])[0];
  candidate.table_position = { u_m: 0.4, v_m: 2.1 };

  assert.equal(readInferredBounceEvidence(value), null);
});

test("rejects an out-of-range confidence score", () => {
  const value = envelopeFixture();
  const candidate = (value.candidates as Record<string, unknown>[])[0];
  candidate.confidence = { score: 1.01, tier: "high" };

  assert.equal(readInferredBounceEvidence(value), null);
});

test("rejects an estimate outside its uncertainty interval", () => {
  const value = envelopeFixture();
  const candidate = (value.candidates as Record<string, unknown>[])[0];
  candidate.time = {
    estimate_s: 4,
    interval_s: [4.1, 4.2],
    method: "occlusion_bridge",
  };

  assert.equal(readInferredBounceEvidence(value), null);
});

test("rejects a hard-z0 mode whose safety boolean is false", () => {
  const value = envelopeFixture();
  const candidate = (value.candidates as Record<string, unknown>[])[0];
  candidate.trajectory_constraint = {
    safe_to_constrain_z0: false,
    mode: "hard_z0",
    reason: "inconsistent payload",
  };

  assert.equal(readInferredBounceEvidence(value), null);
});

test("accepts new diagnostic kinds within schema v1", () => {
  const value = envelopeFixture();
  const candidate = (value.candidates as Record<string, unknown>[])[0];
  candidate.support = [
    { kind: "future_physics_reading", strength: 0.5, residual: 0.012 },
  ];

  const parsed: InferredBounceEvidence | null =
    readInferredBounceEvidence(value);

  assert.equal(parsed?.candidates[0].support[0].kind,
               "future_physics_reading");
});

test("rejects an unknown schema while accepting a newer detector version", () => {
  const newerDetector = envelopeFixture();
  newerDetector.detector_version = "shadow-v1.1";
  assert.equal(
    readInferredBounceEvidence(newerDetector)?.detector_version,
    "shadow-v1.1"
  );

  const unknownSchema = envelopeFixture();
  unknownSchema.schema_version = 2;
  assert.equal(readInferredBounceEvidence(unknownSchema), null);
});
