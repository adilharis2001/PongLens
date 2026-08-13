import { sortRecollectPoints } from "./openai.ts";
import type { RecollectRepository } from "./repository.ts";
import type {
  ClaimedRecollectJob,
  ExistingRecollectPoint,
  SortedPoint,
} from "./types.ts";

export interface ProcessResult {
  status: "idle" | "complete" | "failed";
  pending: boolean;
}

export interface ProcessorDeps {
  repository: RecollectRepository;
  sort: (args: {
    job: ClaimedRecollectJob;
    existing: ExistingRecollectPoint[];
  }) => Promise<SortedPoint[]>;
}

async function defaultDeps(): Promise<ProcessorDeps> {
  const { createRecollectRepository } = await import("./repository.ts");
  return {
    repository: createRecollectRepository(),
    sort: ({ job, existing }) => sortRecollectPoints({ job, existing }),
  };
}

/**
 * One entry, one provider call, one request.
 *
 * The v1 processor walked a transcript in segments and then ran a second
 * validation call, which put two provider calls inside one route budget and
 * timed out on long lessons. There is nothing to walk here: the input is an
 * entry's distilled takeaways, or a note short enough to have skipped
 * distillation entirely.
 */
export async function processNextRecollectJob(
  ownerId: string,
  supplied?: ProcessorDeps,
): Promise<ProcessResult> {
  const deps = supplied ?? (await defaultDeps());
  const job = await deps.repository.claim(ownerId);
  if (!job) return { status: "idle", pending: false };

  try {
    const existing = await deps.repository.existingPoints(ownerId);
    const sorted = await deps.sort({ job, existing });
    // An opt-out that lands mid-flight wins: nothing is stored.
    const enabled = await deps.repository.isEnabled(ownerId);
    await deps.repository.complete(job, enabled ? sorted : []);
    return { status: "complete", pending: false };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Recollect sorting failed";
    await deps.repository.fail(job.id, job.attemptCount, message);
    return { status: "failed", pending: job.attemptCount < 4 };
  }
}
