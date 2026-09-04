import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { catalogChapters, chapterPaths } from "./course-paths.mjs";

const tutorialRoot = fileURLToPath(new URL(".", import.meta.url));
const expectedPlayerSlugs = [
  "home",
  "upload",
  "viewer",
  "point",
  "keepscore",
  "analysis",
  "export",
  "coach",
  "journal",
];

function fakePage() {
  const resolved = async () => ({});
  return {
    url: () => "https://staging.invalid/match/fixture",
    goto: resolved,
    click: resolved,
    type: resolved,
    waitForSelector: resolved,
    waitForTimeout: resolved,
    waitForFunction: resolved,
    evaluate: async (fn) => {
      const source = String(fn);
      if (source.includes("videoWidth * scale")) {
        return { x: 20, y: 150, w: 350, h: 200 };
      }
      if (source.includes('closest("li, article")')) {
        return { x: 20, y: 150, w: 350, h: 200 };
      }
      if (source.includes("backdrop-blur-sm")) {
        return { x: 20, y: 700, w: 180, h: 30 };
      }
      return true;
    },
    mouse: {
      move: resolved,
      down: resolved,
      up: resolved,
      click: resolved,
    },
    keyboard: { press: resolved },
    touchscreen: { tap: resolved },
  };
}

async function scheduledBeats(flowModule) {
  const calls = [];
  const page = fakePage();
  const rect = { x: 20, y: 100, w: 200, h: 80 };
  const clock = {
    until: async () => {},
    sleep: async () => {},
    rect: async () => rect,
    mark: () => ({}),
    close: () => {},
    now: () => 0,
  };
  const beat = (name) => {
    calls.push(name);
    return { start: 0, end: 1, dur: 1 };
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ hashed_token: "tutorial-fixture-token" }),
    text: async () => "",
  });
  try {
    await flowModule.flow(page, clock, {
      beat,
      voice: { total: 1 },
      union: () => rect,
      dismiss: async () => {},
      sectionRect: async () => rect,
      serviceKey: "tutorial-fixture-service-key",
      base: "https://staging.invalid",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  return calls;
}

test("the player flow set follows the Learn catalog in course order", () => {
  assert.deepEqual(
    catalogChapters("player", "web").map(({ slug }) => slug),
    expectedPlayerSlugs,
  );
});

test("every player narration beat is scheduled exactly once by its real flow", async () => {
  process.env.TUTORIAL_ACCOUNT = "player@example.com";
  process.env.TUTORIAL_COACH = "coach@example.com";
  try {
    for (const slug of expectedPlayerSlugs) {
      const paths = chapterPaths(tutorialRoot, "player", slug);
      const manifest = JSON.parse(await readFile(paths.chapter, "utf8"));
      const flowModule = await import(paths.flow);
      const expected = manifest.lines.map(({ beat }) => beat);
      const actual = await scheduledBeats(flowModule);

      assert.deepEqual(actual, expected, `player/${slug} scheduled beats`);
      assert.equal(new Set(actual).size, actual.length, `player/${slug} duplicate beat`);
    }
  } finally {
    delete process.env.TUTORIAL_ACCOUNT;
    delete process.env.TUTORIAL_COACH;
  }
});

test("every player flow that changes staged data declares how it is restored", async () => {
  process.env.TUTORIAL_ACCOUNT = "player@example.com";
  process.env.TUTORIAL_COACH = "coach@example.com";
  try {
    for (const slug of expectedPlayerSlugs) {
      const flowModule = await import(
        chapterPaths(tutorialRoot, "player", slug).flow
      );
      const changesData = Boolean(flowModule.stage) || [
        "viewer",
        "keepscore",
      ].includes(slug);
      if (!changesData) continue;

      const guardedMatch = flowModule.guard !== undefined;
      const guardedCustomRows =
        typeof flowModule.stage === "function" &&
        typeof flowModule.cleanup === "function";
      assert.ok(
        guardedMatch || guardedCustomRows,
        `player/${slug} changes staged data without a restoration guard`,
      );
    }
  } finally {
    delete process.env.TUTORIAL_ACCOUNT;
    delete process.env.TUTORIAL_COACH;
  }
});
