import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = join(import.meta.dirname, "../../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const page = read("src/app/coaches/page.tsx");
const playerPage = read("src/app/page.tsx");
const band = read("src/components/marketing/WalkthroughBand.tsx");
const videos = read("src/lib/videos.ts");
const videoScript = JSON.parse(
  read("scripts/demos/landing/chapters/coach.json")
) as {
  lines: Array<{ beat: string; label: string; text: string }>;
};

test("every coach carousel screenshot resolves to a published image", () => {
  const groups = [...page.matchAll(/shots: \[([^\]]+)\]/g)];
  assert.ok(groups.length > 0);
  for (const group of groups) {
    for (const match of group[1].matchAll(/"([^"]+)"/g)) {
      const shot = match[1];
      assert.equal(
        existsSync(join(root, `public/showcase/${shot}-m.jpg`)),
        true,
        `${shot}-m.jpg is missing`
      );
    }
  }
});

test("coach and player carousels share the production screenshot dimensions", () => {
  assert.match(page, /<WalkthroughBand chapters=\{chapters\}/);
  assert.match(playerPage, /<WalkthroughBand chapters=\{chapters\}/);
  assert.match(band, /aspect-\[390\/844\]/);
  assert.match(band, /window\.innerWidth >= 1024 \? 300/);
  assert.match(band, /window\.innerWidth >= 768 \? 272 : 208/);
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
  assert.match(videos, /COACH_LENGTH = "1:16"/);
  assert.match(page, /duration: "PT1M16S"/);
});
