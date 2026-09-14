import assert from "node:assert/strict";
import test from "node:test";
import {
  deepgramUsageEvents,
  normalizeUsageEvent,
  openAIUsageEvents,
  recordUsage,
} from "./meter.ts";

test("OpenAI usage separates cached and noncached input tokens", () => {
  const events = openAIUsageEvents({
    usage: {
      prompt_tokens: 100,
      completion_tokens: 20,
      prompt_tokens_details: { cached_tokens: 40 },
    },
    model: "gpt-5-mini",
    operation: "lesson_summary",
    idempotencyKey: "openai:response-1:lesson",
  });

  assert.deepEqual(
    events.map((event) => [event.unit, event.quantity]),
    [
      ["input_token", 60],
      ["cached_input_token", 40],
      ["output_token", 20],
    ],
  );
  assert.equal(new Set(events.map((event) => event.idempotencyKey)).size, 3);
});

test("OpenAI Responses-style usage fields are also accepted", () => {
  const events = openAIUsageEvents({
    usage: {
      input_tokens: 30,
      output_tokens: 5,
      input_tokens_details: { cached_tokens: 10 },
    },
    model: "gpt-5-nano",
    operation: "video_content_validation",
    idempotencyKey: "openai:response-2:video",
  });

  assert.deepEqual(
    events.map((event) => [event.unit, event.quantity]),
    [
      ["input_token", 20],
      ["cached_input_token", 10],
      ["output_token", 5],
    ],
  );
});

test("a 5.6-family cache miss is billed as a cache write", () => {
  const events = openAIUsageEvents({
    usage: {
      input_tokens: 5000,
      output_tokens: 300,
      input_tokens_details: { cached_tokens: 4000 },
    },
    model: "gpt-5.6-luna",
    operation: "journal_ask",
    idempotencyKey: "openai:response-3:ask",
  });

  assert.deepEqual(
    events.map((event) => [event.unit, event.quantity]),
    [
      ["cache_write_token", 1000],
      ["cached_input_token", 4000],
      ["output_token", 300],
    ],
  );
});

test("a prompt below the caching floor stays plain input", () => {
  // Nothing under the floor is cached, so nothing was written and the 1.25x
  // never applies. Charging it would overstate every short Luna call.
  const events = openAIUsageEvents({
    usage: { input_tokens: 400, output_tokens: 50 },
    model: "gpt-5.6-luna",
    operation: "review_check",
    idempotencyKey: "openai:response-4:review",
  });

  assert.deepEqual(
    events.map((event) => [event.unit, event.quantity]),
    [
      ["input_token", 400],
      ["output_token", 50],
    ],
  );
});

test("models without a write premium keep billing plain input", () => {
  const events = openAIUsageEvents({
    usage: { input_tokens: 9000, output_tokens: 100 },
    model: "gpt-5-mini",
    operation: "recollect_extraction",
    idempotencyKey: "openai:response-5:recollect",
  });

  assert.equal(events[0].unit, "input_token");
});

test("invalid quantities are dropped rather than persisted", () => {
  const events = openAIUsageEvents({
    usage: {
      prompt_tokens: Number.NaN,
      completion_tokens: -2,
    },
    model: "gpt-5-mini",
    operation: "lesson_summary",
    idempotencyKey: "openai:response-3:lesson",
  });

  assert.deepEqual(events, []);
});

test("event normalization strips identifying metadata keys", () => {
  const event = normalizeUsageEvent({
    provider: "OpenAI",
    service: "AI",
    operation: "lesson_summary",
    sku: "gpt-5-mini",
    quantity: 10,
    unit: "input_token",
    idempotencyKey: "safe-key",
    metadata: {
      confidence: "metered",
      user_id: "secret",
      email: "person@example.com",
      prompt: "private",
    },
  });

  assert.deepEqual(event?.metadata, { confidence: "metered" });
});

test("recording failure is swallowed after the transport is attempted", async () => {
  let attempts = 0;
  const originalError = console.error;
  console.error = () => undefined;
  try {
    await assert.doesNotReject(() =>
      recordUsage(
        [
          {
            provider: "OpenAI",
            service: "AI",
            operation: "lesson_summary",
            sku: "gpt-5-mini",
            quantity: 1,
            unit: "request",
            idempotencyKey: "request-1",
          },
        ],
        async () => {
          attempts += 1;
          throw new Error("database unavailable");
        },
      ),
    );
  } finally {
    console.error = originalError;
  }
  assert.equal(attempts, 1);
});

test("Deepgram metadata duration becomes exact audio seconds", () => {
  const events = deepgramUsageEvents({
    response: {
      metadata: {
        request_id: "dg-request-1",
        duration: 12.75,
      },
    },
    operation: "voice_note_transcription",
  });

  assert.deepEqual(
    events.map((event) => [event.unit, event.quantity]),
    [["audio_second", 12.75]],
  );
  assert.equal(
    events[0]?.idempotencyKey,
    "deepgram:dg-request-1:voice-note:audio",
  );
});

test("Deepgram without duration records a request without invented seconds", () => {
  const events = deepgramUsageEvents({
    response: { metadata: { request_id: "dg-request-2" } },
    operation: "voice_note_transcription",
  });

  assert.deepEqual(
    events.map((event) => [event.unit, event.quantity, event.source]),
    [["request", 1, "assumed"]],
  );
});

const SUBJECT = "8f14e45f-ce0a-4de5-9f1b-2c3d4e5f6a7b";

test("a metered cost carries the account that caused it", () => {
  const events = openAIUsageEvents({
    usage: { prompt_tokens: 40, completion_tokens: 10 },
    model: "gpt-5-mini",
    operation: "lesson_summary",
    idempotencyKey: "openai:sub-1",
    subjectUserId: SUBJECT,
  });

  assert.ok(events.length > 0);
  for (const event of events) {
    assert.equal(normalizeUsageEvent(event)?.subjectUserId, SUBJECT);
  }
});

test("a malformed subject loses the attribution, never the charge", () => {
  // Metering is best-effort in every other respect, and a charge that
  // really happened must not be thrown away over the shape of an id.
  for (const bad of ["", "   ", "not-a-uuid", "12345", null, undefined]) {
    const normalized = normalizeUsageEvent({
      provider: "OpenAI",
      service: "AI",
      operation: "lesson_summary",
      sku: "gpt-5-mini",
      quantity: 7,
      unit: "output_token",
      idempotencyKey: "openai:sub-2",
      subjectUserId: bad as string | null | undefined,
    });
    assert.equal(normalized?.quantity, 7);
    assert.equal(normalized?.subjectUserId, null);
  }
});

test("an unattributed cost is normalised to null rather than left undefined", () => {
  // The column is nullable and the dashboard splits on "is not null", so
  // an event that names nobody has to say so in the same way every time.
  const normalized = normalizeUsageEvent({
    provider: "Cloudflare",
    service: "R2",
    operation: "storage_daily_accrual",
    sku: "r2-standard",
    quantity: 3,
    unit: "gb_month",
    idempotencyKey: "r2:sweep-1",
  });
  assert.equal(normalized?.subjectUserId, null);
});
