import { createHash } from "node:crypto";
import type {
  BufferedCandidate,
  ExtractedCandidate,
  RecollectCategory,
  RecollectSegment,
  ValidatedCandidate,
} from "./types.ts";

const CATEGORIES = new Set<RecollectCategory>([
  "technique",
  "tactics",
  "positioning",
  "serve_receive",
  "practice",
  "mental",
]);

function object(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function bounded(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

function topicKey(value: unknown): string {
  return bounded(value, 160)
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function priority(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : 0.5;
}

export function parseExtractionResult(
  raw: unknown,
  segment: RecollectSegment,
): ExtractedCandidate[] {
  const rows = object(raw).candidates;
  if (!Array.isArray(rows)) return [];
  const accepted: ExtractedCandidate[] = [];
  for (const rawRow of rows.slice(0, 3)) {
    const row = object(rawRow);
    const id = bounded(row.id, 80);
    const question = bounded(row.question, 240);
    const cue = bounded(row.cue, 400);
    const topic = topicKey(row.topic_key);
    const category = bounded(row.category, 40) as RecollectCategory;
    const evidence = bounded(row.evidence, 800);
    const localStart = evidence ? segment.text.indexOf(evidence) : -1;
    if (
      !id ||
      !question ||
      !cue ||
      !topic ||
      !CATEGORIES.has(category) ||
      localStart < 0
    ) {
      continue;
    }
    accepted.push({
      id,
      question,
      cue,
      topicKey: topic,
      category,
      priority: priority(row.importance),
      evidence,
      evidenceHash: createHash("sha256").update(evidence).digest("hex"),
      segmentStart: segment.start + localStart,
      segmentEnd: segment.start + localStart + evidence.length,
    });
  }
  return accepted;
}

export function withoutEvidence(
  candidate: ExtractedCandidate,
): BufferedCandidate {
  return {
    id: candidate.id,
    question: candidate.question,
    cue: candidate.cue,
    topicKey: candidate.topicKey,
    category: candidate.category,
    priority: candidate.priority,
    evidenceHash: candidate.evidenceHash,
    segmentStart: candidate.segmentStart,
    segmentEnd: candidate.segmentEnd,
  };
}

export function parseValidationResult(
  raw: unknown,
  allowedCandidates: Array<ExtractedCandidate | BufferedCandidate>,
  existingItemIds: Set<string>,
): ValidatedCandidate[] {
  const decisions = object(raw).decisions;
  if (!Array.isArray(decisions)) return [];
  const candidates = new Map(
    allowedCandidates.map((candidate) => [candidate.id, candidate]),
  );
  const result: ValidatedCandidate[] = [];
  for (const rawDecision of decisions) {
    const decision = object(rawDecision);
    const candidateId = bounded(decision.candidate_id, 80);
    const candidate = candidates.get(candidateId);
    const choice = bounded(decision.decision, 20);
    if (!candidate || choice === "reject") continue;
    const duplicate =
      choice === "duplicate"
        ? bounded(decision.duplicate_of, 80)
        : "";
    if (
      choice !== "accept" &&
      !(choice === "duplicate" && existingItemIds.has(duplicate))
    ) {
      continue;
    }
    result.push({
      ...("evidence" in candidate ? withoutEvidence(candidate) : candidate),
      duplicateOf: choice === "duplicate" ? duplicate : null,
    });
  }
  return result;
}
