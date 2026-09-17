import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { COACH_WALKTHROUGH } from "../../lib/coachWalkthrough.ts";
import { COACH_CHAPTERS } from "../../lib/videoCuts.ts";

const root = join(import.meta.dirname, "../../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const page = read("src/app/coaches/page.tsx");
const playerPage = read("src/app/page.tsx");
const videoScript = JSON.parse(
  read("scripts/demos/landing/chapters/coach.json")
) as {
  lines: Array<{ beat: string; label: string; text: string }>;
};

test("every picture on the coaches page is a published file", () => {
  const srcs = [...page.matchAll(/src="(\/(?:showcase|learn|demo)\/[^"]+)"/g)].map(
    (m) => m[1]
  );
  assert.ok(srcs.length >= 6, "expected one real screen per feature");
  for (const src of srcs) {
    assert.equal(existsSync(join(root, `public${src}`)), true, `${src} is missing`);
  }
});

test("the coaches page is built from the same pieces as the player page", () => {
  for (const name of ["Feature", "Phone", "CTA_CLASS", "BrowserFrame", "TrackedLink", "LandingVideo"]) {
    assert.match(page, new RegExp(`\\b${name}\\b`), `coaches page does not use ${name}`);
    assert.match(playerPage, new RegExp(`\\b${name}\\b`), `player page does not use ${name}`);
  }
  // The walkthrough sits second on both, with chapter buttons and the
  // poster showing under the scrim rather than a black cover.
  assert.match(page, /<LandingVideo[\s\S]*?chapters=\{COACH_CHAPTERS\}[\s\S]*?posterIdle/);
  assert.match(playerPage, /<LandingVideo[\s\S]*?chapters=\{WALKTHROUGH_CHAPTERS\}[\s\S]*?posterIdle/);
});

test("the headline says which sport this is", () => {
  // The one line a visitor and a search engine both read first. It lost
  // the sport once, in a rename, and nobody noticed until Adil did.
  const h1 = page.match(/<h1[\s\S]*?<\/h1>/)?.[0] ?? "";
  assert.match(h1, /table tennis/);
});

test("the chapter buttons follow the video's own script", () => {
  const labels = [...new Set(videoScript.lines.map((line) => line.label).filter(Boolean))];
  assert.deepEqual(
    COACH_CHAPTERS.map((c) => c.label),
    labels,
    "chapter labels must be the script's, in order"
  );
  let last = -1;
  for (const c of COACH_CHAPTERS) {
    assert.ok(c.at > last, `${c.label} starts before the chapter before it`);
    assert.ok(c.at < COACH_WALKTHROUGH.durationSeconds, `${c.label} starts after the video ends`);
    last = c.at;
  }
});

test("the transcript on the page is the narration that was recorded", () => {
  assert.deepEqual(
    [...COACH_WALKTHROUGH.lines],
    videoScript.lines.map((line) => line.text)
  );
});

test("the separately maintained coach video retains its current sections and runtime", () => {
  const labels = [...new Set(videoScript.lines.map((line) => line.label).filter(Boolean))];
  assert.deepEqual(labels, [
    "Coach profile",
    "Your students",
    "Lesson recording",
    "Shared journals",
    "Review orders",
    "Delivery and payouts",
  ]);

  const narration = videoScript.lines.map((line) => line.text).join(" ");
  assert.match(narration, /coach profile/i);
  assert.match(narration, /review requests/i);
  assert.match(narration, /payouts/i);
  assert.equal(COACH_WALKTHROUGH.length, "1:16");
  assert.equal(COACH_WALKTHROUGH.duration, "PT1M16S");
  assert.equal(COACH_WALKTHROUGH.durationSeconds, 76);
});
