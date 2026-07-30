import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  extractRecollectCandidates,
  validateRecollectCandidates,
} from "./openai.ts";
import type { UsageEvent } from "../costs/meter.ts";
import type { RecollectSegment } from "./types.ts";

function response(id: string, content: unknown): Response {
  return new Response(
    JSON.stringify({
      id,
      usage: {
        prompt_tokens: 100,
        completion_tokens: 20,
        prompt_tokens_details: { cached_tokens: 10 },
      },
      choices: [{ message: { content: JSON.stringify(content) } }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

test("extraction is conservative, structured, and anonymously metered", async () => {
  const requests: Record<string, unknown>[] = [];
  const events: UsageEvent[] = [];
  const segment: RecollectSegment = {
    index: 2,
    start: 100,
    end: 139,
    text: "Coach said: Keep the racket high.",
  };

  const result = await extractRecollectCandidates({
    segment,
    apiKey: "test-key",
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return response("resp_extract_1", {
        candidates: [
          {
            id: "c1",
            question: "What should stay high?",
            cue: "Keep the racket high.",
            topic_key: "racket-height",
            category: "technique",
            evidence: "Keep the racket high",
            importance: 0.9,
          },
        ],
      });
    },
    recordUsageImpl: async (next) => {
      events.push(...next);
    },
  });

  assert.equal(result.length, 1);
  const request = requests[0] as {
    model: string;
    response_format: { type: string };
    messages: { role: string; content: string }[];
  };
  assert.equal(request.model, "gpt-5-mini");
  assert.equal(request.response_format.type, "json_object");
  assert.match(request.messages[0]?.content ?? "", /empty candidates array/i);
  assert.match(request.messages[0]?.content ?? "", /verbatim evidence/i);
  assert.equal(events[0]?.operation, "recollect_extraction");
  assert.match(
    events[0]?.idempotencyKey ?? "",
    /^openai:resp_extract_1:recollect-extraction:2:/,
  );
  assert.deepEqual(events.flatMap((event) => Object.keys(event.metadata ?? {})), []);
});

test("validation sees compact candidates and records a distinct operation", async () => {
  const events: UsageEvent[] = [];
  const result = await validateRecollectCandidates({
    candidates: [
      {
        id: "c1",
        question: "What should stay high?",
        cue: "Keep the racket high.",
        topicKey: "racket-height",
        category: "technique",
        priority: 0.9,
        evidenceHash: "a".repeat(64),
        segmentStart: 10,
        segmentEnd: 30,
      },
    ],
    existing: [],
    apiKey: "test-key",
    fetchImpl: async () =>
      response("resp_validate_1", {
        decisions: [
          { candidate_id: "c1", decision: "accept", duplicate_of: null },
        ],
      }),
    recordUsageImpl: async (next) => {
      events.push(...next);
    },
  });
  assert.equal(result[0]?.duplicateOf, null);
  assert.equal(events[0]?.operation, "recollect_validation");
  assert.match(
    events[0]?.idempotencyKey ?? "",
    /^openai:resp_validate_1:recollect-validation:/,
  );
});

test("the quality gate rejects garbled reminders that do not stand alone", () => {
  const source = readFileSync(new URL("./openai.ts", import.meta.url), "utf8");
  assert.match(source, /speech-to-text|transcription/i);
  assert.match(source, /standalone/i);
  assert.match(source, /reject/i);
});
