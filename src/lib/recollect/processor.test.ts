import assert from "node:assert/strict";
import test from "node:test";
import { processNextRecollectJob } from "./processor.ts";
import type {
  BufferedCandidate,
  ClaimedRecollectJob,
  ExistingRecollectItem,
  ExtractedCandidate,
  ValidatedCandidate,
} from "./types.ts";
import type { RecollectRepository } from "./repository.ts";

class MemoryRepository implements RecollectRepository {
  claimValue: ClaimedRecollectJob | null = null;
  enabled = true;
  requeued: { nextSegment: number; buffer: BufferedCandidate[] } | null = null;
  completed: ValidatedCandidate[] | null = null;
  failed: string | null = null;
  existing: ExistingRecollectItem[] = [];

  async claim() {
    return this.claimValue;
  }
  async requeueSegment(
    _jobId: string,
    nextSegment: number,
    buffer: BufferedCandidate[],
  ) {
    this.requeued = { nextSegment, buffer };
  }
  async complete(
    _job: ClaimedRecollectJob,
    items: ValidatedCandidate[],
  ) {
    this.completed = items;
  }
  async fail(_jobId: string, _attempt: number, message: string) {
    this.failed = message;
  }
  async isEnabled() {
    return this.enabled;
  }
  async existingByTopics() {
    return this.existing;
  }
}

function job(overrides: Partial<ClaimedRecollectJob> = {}): ClaimedRecollectJob {
  return {
    id: "job-1",
    userId: "user-1",
    lessonId: "lesson-1",
    contentHash: "a".repeat(64),
    processorVersion: "recollect-v1",
    nextSegment: 0,
    candidateBuffer: [],
    firstDueAt: "2026-07-31T12:00:00.000Z",
    attemptCount: 1,
    transcript: "Keep the racket high.",
    kind: "lesson",
    sourceCreatedAt: "2026-07-30T12:00:00.000Z",
    sourceTitle: "Backhand timing",
    ...overrides,
  };
}

function candidate(id = "c1"): ExtractedCandidate {
  return {
    id,
    question: "What should stay high?",
    cue: "Keep the racket high.",
    topicKey: "racket-height",
    category: "technique",
    priority: 0.9,
    evidence: "Keep the racket high",
    evidenceHash: "b".repeat(64),
    segmentStart: 0,
    segmentEnd: 20,
  };
}

test("processor is idle without a claim", async () => {
  const repository = new MemoryRepository();
  const result = await processNextRecollectJob("user-1", {
    repository,
    extract: async () => {
      throw new Error("must not run");
    },
    validate: async () => [],
  });
  assert.deepEqual(result, { status: "idle", pending: false });
});

test("processor stores a bounded nonfinal segment without evidence text", async () => {
  const repository = new MemoryRepository();
  repository.claimValue = job({ transcript: "x".repeat(30_000) });
  const result = await processNextRecollectJob("user-1", {
    repository,
    extract: async () => [candidate()],
    validate: async () => {
      throw new Error("must not validate yet");
    },
  });
  assert.equal(result.status, "processing");
  assert.equal(repository.requeued?.nextSegment, 1);
  assert.equal(repository.requeued?.buffer[0]?.id, "0:c1");
  assert.equal(
    "evidence" in (repository.requeued?.buffer[0] ?? {}),
    false,
  );
});

test("final segment records a successful zero-result completion", async () => {
  const repository = new MemoryRepository();
  repository.claimValue = job();
  const result = await processNextRecollectJob("user-1", {
    repository,
    extract: async () => [],
    validate: async () => [],
  });
  assert.equal(result.status, "complete");
  assert.deepEqual(repository.completed, []);
});

test("validation can merge a repeated cue into an existing reminder", async () => {
  const repository = new MemoryRepository();
  repository.claimValue = job();
  repository.existing = [
    {
      id: "existing-1",
      question: "How high should the racket be?",
      cue: "Keep the racket high.",
      topicKey: "racket-height",
      category: "technique",
    },
  ];
  await processNextRecollectJob("user-1", {
    repository,
    extract: async () => [candidate()],
    validate: async ({ candidates }) => [
      { ...candidates[0], duplicateOf: "existing-1" },
    ],
  });
  assert.equal(repository.completed?.[0]?.duplicateOf, "existing-1");
});

test("processor retries provider failures without storing reminders", async () => {
  const repository = new MemoryRepository();
  repository.claimValue = job();
  const result = await processNextRecollectJob("user-1", {
    repository,
    extract: async () => {
      throw new Error("provider unavailable");
    },
    validate: async () => [],
  });
  assert.equal(result.status, "failed");
  assert.equal(repository.completed, null);
  assert.equal(repository.failed, "provider unavailable");
});

test("an opt-out that wins the race discards extracted candidates", async () => {
  const repository = new MemoryRepository();
  repository.claimValue = job();
  await processNextRecollectJob("user-1", {
    repository,
    extract: async () => {
      repository.enabled = false;
      return [candidate()];
    },
    validate: async ({ candidates }) =>
      candidates.map((item) => ({ ...item, duplicateOf: null })),
  });
  assert.deepEqual(repository.completed, []);
});
