import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  projectCanonicalScore,
  type CanonicalMatchInput,
} from "../../src/lib/scoring/canonical.ts";
import { compareCanonicalProjection } from "../../src/lib/scoring/client.ts";
import {
  parseCanonicalCommandResult,
  type CanonicalScoreSnapshot,
} from "../../src/lib/scoring/commands.ts";

interface CorpusRow {
  matchId: string;
  legacyInput: CanonicalMatchInput;
  canonicalSnapshot: unknown;
}

interface CorpusMismatch {
  matchId: string;
  revision: number;
  mismatchedMatchFields: number;
  mismatchedPoints: number;
  canonicalPointCount: number;
  legacyPointCount: number;
}

export interface CanonicalCorpusAudit {
  schemaVersion: 1;
  totalMatches: number;
  matchingMatches: number;
  mismatchingMatches: number;
  invalidRows: number;
  mismatchedMatchFields: number;
  mismatchedPoints: number;
  mismatches: CorpusMismatch[];
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseSnapshot(value: unknown): CanonicalScoreSnapshot | null {
  if (!object(value) || !Number.isInteger(value.revision)) return null;
  const parsed = parseCanonicalCommandResult({
    ok: true,
    requestId: "corpus-audit",
    revision: value.revision,
    snapshot: value,
    payload: null,
  });
  return parsed?.ok ? parsed.snapshot : null;
}

function parseRow(value: unknown): CorpusRow | null {
  if (!object(value) || typeof value.matchId !== "string") return null;
  if (!object(value.legacyInput) || !Array.isArray(value.legacyInput.points)) {
    return null;
  }
  return value as unknown as CorpusRow;
}

export function auditCanonicalCorpus(values: unknown[]): CanonicalCorpusAudit {
  const mismatches: CorpusMismatch[] = [];
  let matchingMatches = 0;
  let invalidRows = 0;
  let mismatchedMatchFields = 0;
  let mismatchedPoints = 0;

  for (const value of values) {
    const row = parseRow(value);
    const snapshot = row ? parseSnapshot(row.canonicalSnapshot) : null;
    if (!row || !snapshot || snapshot.matchId !== row.matchId) {
      invalidRows += 1;
      continue;
    }

    const diagnostic = compareCanonicalProjection(
      snapshot,
      projectCanonicalScore(row.legacyInput),
    );
    if (diagnostic.matches) {
      matchingMatches += 1;
      continue;
    }
    mismatchedMatchFields += diagnostic.mismatchedMatchFields;
    mismatchedPoints += diagnostic.mismatchedPoints;
    mismatches.push({
      matchId: diagnostic.matchId,
      revision: diagnostic.revision,
      mismatchedMatchFields: diagnostic.mismatchedMatchFields,
      mismatchedPoints: diagnostic.mismatchedPoints,
      canonicalPointCount: diagnostic.canonicalPointCount,
      legacyPointCount: diagnostic.legacyPointCount,
    });
  }

  return {
    schemaVersion: 1,
    totalMatches: values.length,
    matchingMatches,
    mismatchingMatches: mismatches.length,
    invalidRows,
    mismatchedMatchFields,
    mismatchedPoints,
    mismatches,
  };
}

function main(path: string | undefined): void {
  if (!path) throw new Error("Usage: audit-canonical-corpus.ts <corpus.ndjson>");
  const rows = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown);
  const report = auditCanonicalCorpus(rows);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.invalidRows > 0 || report.mismatchingMatches > 0) {
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2]);
}
