import { withoutEvidence } from "./candidates.ts";
import {
  extractRecollectCandidates,
  validateRecollectCandidates,
} from "./openai.ts";
import type { RecollectRepository } from "./repository.ts";
import { splitRecollectSource } from "./segments.ts";
import type {
  BufferedCandidate,
  ExistingRecollectItem,
  ExtractedCandidate,
  ValidatedCandidate,
} from "./types.ts";

export interface ProcessResult {
  status: "idle" | "processing" | "complete" | "failed";
  pending: boolean;
}

export interface ProcessorDeps {
  repository: RecollectRepository;
  extract: (args: {
    segment: ReturnType<typeof splitRecollectSource>[number];
  }) => Promise<ExtractedCandidate[]>;
  validate: (args: {
    candidates: BufferedCandidate[];
    existing: ExistingRecollectItem[];
  }) => Promise<ValidatedCandidate[]>;
}

async function defaultDeps(): Promise<ProcessorDeps> {
  const { createRecollectRepository } = await import("./repository.ts");
  return {
    repository: createRecollectRepository(),
    extract: ({ segment }) => extractRecollectCandidates({ segment }),
    validate: ({ candidates, existing }) =>
      validateRecollectCandidates({ candidates, existing }),
  };
}

export async function processNextRecollectJob(
  ownerId: string,
  supplied?: ProcessorDeps,
): Promise<ProcessResult> {
  const deps = supplied ?? (await defaultDeps());
  const job = await deps.repository.claim(ownerId);
  if (!job) return { status: "idle", pending: false };

  try {
    const segments = splitRecollectSource(job.transcript);
    const segment = segments[job.nextSegment];
    if (!segment) {
      await deps.repository.complete(job, []);
      return { status: "complete", pending: false };
    }

    const extracted = await deps.extract({ segment });
    const buffer = [
      ...job.candidateBuffer,
      ...extracted.map((candidate) =>
        withoutEvidence({
          ...candidate,
          // Models commonly reuse ids such as "c1" in every segment.
          // Namespace them before the final cross-segment validation.
          id: `${segment.index}:${candidate.id}`.slice(0, 80),
        }),
      ),
    ];
    if (job.nextSegment + 1 < segments.length) {
      await deps.repository.requeueSegment(
        job.id,
        job.nextSegment + 1,
        buffer,
      );
      return { status: "processing", pending: true };
    }

    const existing = await deps.repository.existingByTopics(
      ownerId,
      buffer.map((candidate) => candidate.topicKey),
    );
    const validated = await deps.validate({ candidates: buffer, existing });
    const enabled = await deps.repository.isEnabled(ownerId);
    await deps.repository.complete(job, enabled ? validated : []);
    return { status: "complete", pending: false };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Recollect processing failed";
    await deps.repository.fail(job.id, job.attemptCount, message);
    return { status: "failed", pending: job.attemptCount < 4 };
  }
}
