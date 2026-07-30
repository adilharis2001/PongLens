import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(
  new URL(
    "../../app/research/winner-constrained-endings/page.tsx",
    import.meta.url,
  ),
  "utf8",
);
const labeler = readFileSync(
  new URL(
    "../../app/research/winner-constrained-endings/WinnerConstrainedEndingLabeler.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("route is authenticated, batch-scoped, and noindex", () => {
  assert.match(page, /winner-constrained-endings-cross-match-v1/);
  assert.match(page, /auth\.getUser/);
  assert.match(page, /redirect\("\/login\?next=\/research\/winner-constrained-endings"\)/);
  assert.match(page, /robots: \{ index: false, follow: false, nocache: true \}/);
  assert.match(page, /research_batches\.slug/);
});

test("labeler uses protected one-video media and durable assignment saves", () => {
  assert.match(labeler, /\/api\/research\/media/);
  assert.match(labeler, /\.from\("research_assignments"\)/);
  assert.match(labeler, /human_label: nextLabel/);
  assert.match(labeler, /Submit & next/);
  assert.match(labeler, /key=\{assignment\.id\}/);
  assert.match(labeler, /Is the imported server correct\?/);
  assert.match(labeler, /No — \{alternateServer\.name\} served/);
  assert.match(labeler, /Imported record said/);
});

test("labeler never renders hidden automatic ending outputs", () => {
  assert.doesNotMatch(labeler, /positive_evidence/);
  assert.doesNotMatch(labeler, /negative_evidence/);
  assert.doesNotMatch(labeler, /confidence_margin/);
  assert.doesNotMatch(labeler, /automatic.*ending/i);
});
