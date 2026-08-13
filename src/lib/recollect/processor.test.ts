import assert from "node:assert/strict";
import test from "node:test";
import { processNextRecollectJob } from "./processor.ts";
import type { RecollectRepository } from "./repository.ts";
import type {
  ClaimedRecollectJob,
  ExistingRecollectPoint,
  SortedPoint,
} from "./types.ts";

class MemoryRepository implements RecollectRepository {
  claimValue: ClaimedRecollectJob | null = null;
  enabled = true;
  completed: SortedPoint[] | null = null;
  failed: string | null = null;
  existing: ExistingRecollectPoint[] = [];

  async claim() {
    return this.claimValue;
  }
  async complete(_job: ClaimedRecollectJob, points: SortedPoint[]) {
    this.completed = points;
  }
  async fail(_jobId: string, _attempt: number, message: string) {
    this.failed = message;
  }
  async isEnabled() {
    return this.enabled;
  }
  async existingPoints() {
    return this.existing;
  }
}

function job(overrides: Partial<ClaimedRecollectJob> = {}): ClaimedRecollectJob {
  return {
    id: "job-1",
    userId: "user-1",
    lessonId: "lesson-1",
    contentHash: "a".repeat(64),
    processorVersion: "recollect-topics-v1",
    attemptCount: 1,
    themes: [{ name: "Backhand", points: ["Keep the racket high"] }],
    body: null,
    kind: "lesson",
    ...overrides,
  };
}

function point(overrides: Partial<SortedPoint> = {}): SortedPoint {
  return {
    topicKey: "backhand",
    text: "Keep the racket high",
    themeName: "Backhand",
    duplicate: false,
    ...overrides,
  };
}

test("processor is idle without a claim", async () => {
  const repository = new MemoryRepository();
  const result = await processNextRecollectJob("user-1", {
    repository,
    sort: async () => {
      throw new Error("must not run");
    },
  });
  assert.deepEqual(result, { status: "idle", pending: false });
});

test("an entry is sorted and stored in one pass", async () => {
  const repository = new MemoryRepository();
  repository.claimValue = job();
  const result = await processNextRecollectJob("user-1", {
    repository,
    sort: async () => [point()],
  });
  assert.deepEqual(result, { status: "complete", pending: false });
  assert.equal(repository.completed?.length, 1);
  assert.equal(repository.completed?.[0]?.topicKey, "backhand");
});

test("the sort sees what the account already holds", async () => {
  const repository = new MemoryRepository();
  repository.claimValue = job();
  repository.existing = [{ topicKey: "backhand", text: "Keep the racket high" }];
  let seen: ExistingRecollectPoint[] = [];
  await processNextRecollectJob("user-1", {
    repository,
    sort: async ({ existing }) => {
      seen = existing;
      return [point({ duplicate: true })];
    },
  });
  assert.equal(seen.length, 1);
  assert.equal(repository.completed?.[0]?.duplicate, true);
});

test("an entry with nothing worth filing completes with zero points", async () => {
  const repository = new MemoryRepository();
  repository.claimValue = job({ themes: [], body: "Paid Chris for the table." });
  const result = await processNextRecollectJob("user-1", {
    repository,
    sort: async () => [],
  });
  assert.equal(result.status, "complete");
  assert.deepEqual(repository.completed, []);
});

test("provider failures retry without storing anything", async () => {
  const repository = new MemoryRepository();
  repository.claimValue = job();
  const result = await processNextRecollectJob("user-1", {
    repository,
    sort: async () => {
      throw new Error("provider unavailable");
    },
  });
  assert.deepEqual(result, { status: "failed", pending: true });
  assert.equal(repository.completed, null);
  assert.equal(repository.failed, "provider unavailable");
});

test("an opt-out that wins the race discards the sort", async () => {
  const repository = new MemoryRepository();
  repository.claimValue = job();
  await processNextRecollectJob("user-1", {
    repository,
    sort: async () => {
      repository.enabled = false;
      return [point()];
    },
  });
  assert.deepEqual(repository.completed, []);
});
