import assert from "node:assert/strict";
import test from "node:test";
import {
  parseExtractionResult,
  parseValidationResult,
  questionRevealsAnswer,
} from "./candidates.ts";
import type { RecollectSegment } from "./types.ts";

function segment(text: string): RecollectSegment {
  return { index: 0, start: 100, end: 100 + text.length, text };
}

test("a question that answers itself is not a recall prompt", () => {
  // Both shipped in the first Recollect cards and left nothing to recall.
  assert.equal(
    questionRevealsAnswer(
      "Can I shorten my swing and focus on timing on the next ball?",
      "Shorten the swing and focus on timing.",
    ),
    true,
  );
  assert.equal(
    questionRevealsAnswer(
      "Do I gather information after my 1-2 open before committing?",
      "After your one-two open, pause and gather information before deciding.",
    ),
    true,
  );
});

test("open questions about a cue are kept", () => {
  assert.equal(
    questionRevealsAnswer(
      "What should stay high?",
      "Keep the racket high.",
    ),
    false,
  );
  assert.equal(
    questionRevealsAnswer(
      "Where should I hold my backhand to make transitions smoother?",
      "Hold the backhand in front of the belly button so the elbow sits central.",
    ),
    false,
  );
});

test("extraction drops a candidate whose question gives away its cue", () => {
  const source = "Coach: shorten the swing and focus on timing.";
  assert.deepEqual(
    parseExtractionResult(
      {
        candidates: [
          {
            id: "candidate-1",
            question: "Should I shorten the swing and focus on timing?",
            cue: "Shorten the swing and focus on timing.",
            topic_key: "swing-length",
            category: "technique",
            evidence: "shorten the swing and focus on timing",
            importance: 1,
          },
        ],
      },
      segment(source),
    ),
    [],
  );
});

test("irrelevant sources may produce zero candidates", () => {
  assert.deepEqual(
    parseExtractionResult({ candidates: [] }, segment("My paddle is red.")),
    [],
  );
});

test("a candidate without verbatim source evidence is rejected", () => {
  assert.deepEqual(
    parseExtractionResult(
      {
        candidates: [
          {
            id: "candidate-1",
            question: "What should you do on short serves?",
            cue: "Step in under the table.",
            topic_key: "short-serve-receive",
            category: "serve_receive",
            evidence: "Words the coach never said",
            importance: 0.9,
          },
        ],
      },
      segment("Keep your racket high."),
    ),
    [],
  );
});

test("valid candidates are normalized and retain offsets but not excess text", () => {
  const source = "Coach: Keep the racket high when you step in.";
  const [candidate] = parseExtractionResult(
    {
      candidates: [
        {
          id: "candidate-1",
          question: " How should the racket start? ",
          cue: " Keep the racket high. ",
          topic_key: " Racket Height ",
          category: "technique",
          evidence: "Keep the racket high",
          importance: 2,
        },
      ],
    },
    segment(source),
  );
  assert.equal(candidate?.question, "How should the racket start?");
  assert.equal(candidate?.cue, "Keep the racket high.");
  assert.equal(candidate?.topicKey, "racket-height");
  assert.equal(candidate?.priority, 1);
  assert.equal(candidate?.segmentStart, 107);
  assert.equal(candidate?.segmentEnd, 127);
  assert.match(candidate?.evidenceHash ?? "", /^[a-f0-9]{64}$/);
});

test("validation accepts only supplied candidate and duplicate identifiers", () => {
  const [candidate] = parseExtractionResult(
    {
      candidates: [
        {
          id: "candidate-1",
          question: "What should stay high?",
          cue: "Keep the racket high.",
          topic_key: "racket-height",
          category: "technique",
          evidence: "Keep the racket high",
          importance: 0.8,
        },
      ],
    },
    segment("Keep the racket high."),
  );
  assert.ok(candidate);
  const accepted = parseValidationResult(
    {
      decisions: [
        {
          candidate_id: "candidate-1",
          decision: "duplicate",
          duplicate_of: "existing-1",
        },
        {
          candidate_id: "invented",
          decision: "accept",
          duplicate_of: null,
        },
      ],
    },
    [candidate],
    new Set(["existing-1"]),
  );
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0]?.duplicateOf, "existing-1");
});
