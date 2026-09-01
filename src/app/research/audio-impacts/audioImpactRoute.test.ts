import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function read(path: string): string {
  const url = new URL(path, import.meta.url);
  return existsSync(url) ? readFileSync(url, "utf8") : "";
}

test("audio impact route is authenticated, admin-only, batch-scoped, and noindex", () => {
  const page = read("./page.tsx");

  assert.match(page, /auth\.getUser\(\)/);
  assert.match(
    page,
    /redirect\("\/login\?next=\/research\/audio-impacts"\)/,
  );
  assert.match(page, /supabase\.rpc\("is_admin"\)/);
  assert.match(page, /if \(!isAdmin\) notFound\(\)/);
  assert.match(page, /\.from\("research_assignments"\)/);
  assert.match(page, /\.eq\("reviewer_id", user\.id\)/);
  assert.match(page, /research_batches\.slug/);
  assert.match(page, /audio-impact-labeling-recent-v1/);
  assert.match(
    page,
    /robots: \{ index: false, follow: false, nocache: true \}/,
  );
});

test("route loads only the source fields needed by the audio reviewer", () => {
  const page = read("./page.tsx");

  assert.match(page, /source_point_idx/);
  assert.match(page, /match_label/);
  assert.match(page, /venue_label/);
  assert.match(page, /duration_s/);
  assert.match(page, /proposal/);
  assert.match(page, /prefill/);
  assert.match(page, /<AudioImpactLabeler/);
});

test("reviewer has a clear empty assignment state", () => {
  const labeler = read("./AudioImpactLabeler.tsx");

  assert.match(labeler, /No audio-impact assignments yet/);
  assert.match(labeler, /Back to research/);
});
