import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sortRecollectPoints } from "./openai.ts";
import type { UsageEvent } from "../costs/meter.ts";
import type { ClaimedRecollectJob } from "./types.ts";

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

function job(overrides: Partial<ClaimedRecollectJob> = {}): ClaimedRecollectJob {
  return {
    id: "job-1",
    userId: "user-1",
    lessonId: "lesson-1",
    contentHash: "a".repeat(64),
    processorVersion: "recollect-topics-v1",
    attemptCount: 1,
    themes: [{ name: "Backhand", points: ["Keep the racket up high"] }],
    body: null,
    kind: "lesson",
    ...overrides,
  };
}

test("the sort sends distilled themes, never a transcript", async () => {
  const requests: Record<string, unknown>[] = [];
  const events: UsageEvent[] = [];

  const sorted = await sortRecollectPoints({
    job: job(),
    existing: [],
    apiKey: "test-key",
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return response("resp_sort_1", {
        points: [
          {
            topic_key: "backhand",
            text: "Keep the racket up high",
            theme_name: "Backhand",
            duplicate: false,
          },
        ],
      });
    },
    recordUsageImpl: async (next) => {
      events.push(...next);
    },
  });

  assert.equal(sorted.length, 1);
  const request = requests[0] as {
    model: string;
    messages: { role: string; content: string }[];
  };
  assert.equal(request.model, "gpt-5-mini");
  const system = request.messages[0]?.content ?? "";
  assert.match(system, /Copy each point's text EXACTLY/i);
  assert.match(system, /backhand: Backhand/);
  assert.doesNotMatch(system, /question/i);
  assert.equal(events[0]?.operation, "recollect_topics");
  assert.match(events[0]?.idempotencyKey ?? "", /^openai:resp_sort_1:recollect-topics:/);
  assert.deepEqual(
    events.flatMap((event) => Object.keys(event.metadata ?? {})),
    [],
  );
});

test("a short undistilled note uses the splitting prompt", async () => {
  const requests: Record<string, unknown>[] = [];
  await sortRecollectPoints({
    job: job({ themes: [], body: "Serve: short side-under to FH. Stay low." }),
    existing: [],
    apiKey: "test-key",
    fetchImpl: async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return response("resp_split_1", { points: [] });
    },
    recordUsageImpl: async () => {},
  });
  const request = requests[0] as { messages: { content: string }[] };
  assert.match(request.messages[0]?.content ?? "", /Split it into the separate things/i);
  assert.match(request.messages[1]?.content ?? "", /short side-under/);
});

test("an entry with no material costs no provider call", async () => {
  let called = false;
  const sorted = await sortRecollectPoints({
    job: job({ themes: [], body: "  " }),
    existing: [],
    apiKey: "test-key",
    fetchImpl: async () => {
      called = true;
      return response("nope", { points: [] });
    },
    recordUsageImpl: async () => {},
  });
  assert.deepEqual(sorted, []);
  assert.equal(called, false);
});

test("the feature no longer generates questions anywhere", () => {
  const source = readFileSync(new URL("./openai.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bquestion\b/i);
  assert.doesNotMatch(source, /\bcue\b/i);
  assert.match(source, /Never invent a point/);
});
