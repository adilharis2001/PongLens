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
  assert.match(page, /audio_impact_research_state/);
  assert.match(page, /visibleAudioImpactRounds/);
  assert.match(page, /research_sources\.prefill->>round/);
  assert.match(
    page,
    /robots: \{ index: false, follow: false, nocache: true \}/,
  );
});

test("audio-impact export is phase-scoped and never uses the generic all-round export", () => {
  const labeler = read("./AudioImpactLabeler.tsx");
  const route = read("../../api/research/audio-impact-export/route.ts");

  assert.match(labeler, /\/api\/research\/audio-impact-export/);
  assert.match(route, /audio_impact_research_state/);
  assert.match(route, /visibleAudioImpactRounds/);
  assert.match(route, /media_sha256/);
  assert.match(route, /cohort_manifest_sha256/);
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

test("desktop reviewer mounts one protected video and durable assignment saves", () => {
  const labeler = read("./AudioImpactLabeler.tsx");

  assert.equal(labeler.match(/<video\b/g)?.length, 1);
  assert.match(labeler, /fetch\("\/api\/research\/media"/);
  assert.match(labeler, /\.from\("research_assignments"\)/);
  assert.match(labeler, /\.update\(\{/);
  assert.match(labeler, /human_label: nextLabel/);
  assert.match(labeler, /Save failed\. Your answer is still on this screen\./);
  assert.match(labeler, /Retry save/);
  assert.match(labeler, /onCanPlay/);
  assert.match(labeler, /onError/);
  assert.match(labeler, /canReviewAudioImpact\(mediaState, saveState\)/);
  assert.match(labeler, /saveState === "error"/);
});

test("reviewer exposes every plain-language class without model hints", () => {
  const labeler = read("./AudioImpactLabeler.tsx");

  for (const text of [
    "Paddle",
    "Table",
    "Ball on floor",
    "Shoe / stomp",
    "Net",
    "Background court",
    "Other",
    "No clear impact",
    "Unsure",
  ]) {
    assert.match(labeler, new RegExp(text.replace("/", "\\/")));
  }
  assert.doesNotMatch(labeler, /detector_scores|candidate\.strength|confidence hint/i);
});

test("reviewer starts naturally, supports deliberate replay speeds, and guards shortcuts", () => {
  const labeler = read("./AudioImpactLabeler.tsx");

  assert.match(labeler, /playbackRate = 1/);
  assert.match(labeler, /setPlaybackSpeed\(0\.5\)/);
  assert.match(labeler, /setPlaybackSpeed\(0\.25\)/);
  assert.match(labeler, /isAudioImpactShortcutTarget\(event\.target\)/);
  assert.match(labeler, /Undo/);
  assert.match(labeler, /Previous/);
  assert.match(labeler, /Add missed sound/);
  assert.match(labeler, /Point complete/);
  assert.match(labeler, /labeled sounds/);
});
