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

// A question that opens with an auxiliary verb is answerable "yes", which is
// not recall. The model is told this too; this is the backstop for when it
// forgets.
const YES_NO_OPENERS = new Set([
  "am", "are", "is", "was", "were", "do", "does", "did", "can", "could",
  "shall", "should", "will", "would", "have", "has", "had", "must", "may",
  "might",
]);

const STOPWORDS = new Set([
  "the", "and", "but", "for", "you", "your", "yours", "our", "with", "that",
  "this", "these", "those", "from", "into", "onto", "when", "what", "where",
  "which", "while", "who", "why", "how", "should", "shall", "would", "could",
  "can", "will", "does", "did", "are", "was", "were", "been", "being", "make",
  "makes", "made", "get", "gets", "got", "than", "then", "there", "their",
  "them", "they", "its", "it's", "not", "any", "all", "some", "more", "most",
  "very", "just", "own", "too", "over", "after", "before", "during", "about",
]);

function contentWords(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

/**
 * A recall prompt has to leave something to recall. Two ways it fails:
 * it can be answered yes/no, or it simply restates the cue in question form
 * ("Can I shorten my swing?" / "Shorten the swing."), which is the shape
 * that made the first Recollect cards useless.
 */
export function questionRevealsAnswer(question: string, cue: string): boolean {
  const opener = question.trim().toLowerCase().split(/\s+/)[0] ?? "";
  if (YES_NO_OPENERS.has(opener)) return true;

  const cueWords = new Set(contentWords(cue));
  if (cueWords.size === 0) return false;
  const asked = new Set(contentWords(question));
  let shared = 0;
  for (const word of cueWords) {
    if (asked.has(word)) shared += 1;
  }
  return shared / cueWords.size >= 0.6;
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
      localStart < 0 ||
      questionRevealsAnswer(question, cue)
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
  candidate: ExtractedCandidate | BufferedCandidate,
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

/**
 * Buffer a candidate between segments, keeping the evidence so the final
 * validation pass can check the cue against the words it came from. This
 * lives in the job row only; `withoutEvidence` runs before anything reaches
 * a stored item.
 */
export function buffered(candidate: ExtractedCandidate): BufferedCandidate {
  return { ...withoutEvidence(candidate), evidence: candidate.evidence };
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
      // Evidence has done its job by now and must not reach storage.
      ...withoutEvidence(candidate),
      duplicateOf: choice === "duplicate" ? duplicate : null,
    });
  }
  return result;
}
