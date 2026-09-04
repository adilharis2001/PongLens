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

function fakePage(trace = []) {
  const resolved = async () => ({});
  return {
    url: () => "https://staging.invalid/match/fixture",
    goto: async (url) => trace.push({ type: "goto", url }),
    click: async (selector) => trace.push({ type: "page.click", selector }),
    type: resolved,
    waitForSelector: async (selector) => trace.push({ type: "waitForSelector", selector }),
    waitForEvent: async (event) => trace.push({ type: "waitForEvent", event }),
    waitForTimeout: resolved,
    waitForFunction: async (fn, arg, options) => {
      trace.push({ type: "waitForFunction", source: String(fn), options, args: [arg] });
      return {};
    },
    evaluate: async (fn, ...args) => {
      const source = String(fn);
      trace.push({ type: "evaluate", source, args });
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
      move: async (x, y) => trace.push({ type: "mouse.move", x, y }),
      down: async () => trace.push({ type: "mouse.down" }),
      up: async () => trace.push({ type: "mouse.up" }),
      click: async (x, y, options) => trace.push({ type: "mouse.click", x, y, options }),
      dblclick: async (x, y) => trace.push({ type: "mouse.dblclick", x, y }),
    },
    keyboard: { press: resolved },
    touchscreen: { tap: resolved },
  };
}

async function scheduledBeats(flowModule, trace = []) {
  const calls = [];
  const page = fakePage(trace);
  const rect = { x: 20, y: 100, w: 200, h: 80 };
  const clock = {
    until: async () => {},
    sleep: async () => {},
    rect: async (spec) => {
      trace.push({ type: "rect", spec });
      return rect;
    },
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

test("viewer performs the narrated middle double-tap replay", async () => {
  const trace = [];
  const viewer = await import("./flows/player/viewer.mjs");
  await scheduledBeats(viewer, trace);
  assert.deepEqual(
    trace.filter(({ type }) => type === "mouse.dblclick"),
    [{ type: "mouse.dblclick", x: 195, y: 250 }],
  );
});

test("viewer demonstrates real right 2x and left quarter-speed holds", async () => {
  const trace = [];
  const viewer = await import("./flows/player/viewer.mjs");
  await scheduledBeats(viewer, trace);
  const holdRates = trace
    .filter(({ type, source }) => type === "waitForFunction" && source.includes("playbackRate"))
    .flatMap(({ args }) => args)
    .filter((value) => typeof value === "number");
  assert.deepEqual(holdRates, [2, 0.25]);
  assert.equal(trace.filter(({ type }) => type === "mouse.down").length, 2);
  assert.equal(trace.filter(({ type }) => type === "mouse.up").length, 2);
});

test("upload opens the real player-side file chooser without selecting a file", async () => {
  const trace = [];
  const upload = await import("./flows/player/upload.mjs");
  await scheduledBeats(upload, trace);
  assert.ok(trace.some(({ type, event }) => type === "waitForEvent" && event === "filechooser"));
  assert.ok(trace.some(({ type, selector }) =>
    type === "page.click" && selector === 'button:has-text("Choose a video")'
  ));
});

test("point opens the genuine missing-rally affordance and sheet", async () => {
  const trace = [];
  const point = await import("./flows/player/point.mjs");
  await scheduledBeats(point, trace);
  assert.ok(trace.some(({ type, selector }) =>
    type === "page.click" && selector === 'button:has-text("Score the Match")'
  ));
  assert.ok(trace.some(({ type, selector }) =>
    type === "waitForSelector" && selector === 'button[aria-label*="Add a missing rally"]'
  ));
  assert.ok(trace.some(({ type, selector }) =>
    type === "page.click" && selector === 'button[aria-label*="Add a missing rally"]'
  ));
  assert.ok(trace.some(({ type, selector }) =>
    type === "waitForSelector" && selector === "text=Add a missing rally"
  ));
  assert.ok(trace.some(({ type, spec }) =>
    type === "rect" && spec?.aria === "Drag where the rally starts"
  ));
});

test("point notes require the verified demo owner and clean up their exact marker", async () => {
  const point = await import("./flows/player/point.mjs");
  assert.equal(point.guard?.kind, "player");
  assert.equal(point.guard.ownerId, "6eb09df4-7d44-4ef9-b1cc-8cdfc4119fc4");
  assert.equal(point.guard.ownerEmail, "uploader-test@example.com");
  assert.equal(typeof point.stagePointNote, "function");
  assert.equal(typeof point.cleanup, "function");

  const notes = [];
  const verified = [];
  const adapter = {
    async verifyOwner(ownerId, ownerEmail) {
      verified.push({ ownerId, ownerEmail });
    },
  };
  const request = async (key, resource, init = {}) => {
    if (resource.startsWith("matches?")) {
      assert.match(resource, new RegExp(`id=eq\\.${point.guard.matchId}`));
      assert.match(resource, new RegExp(`user_id=eq\\.${point.guard.ownerId}`));
      return [{ id: point.guard.matchId, user_id: point.guard.ownerId }];
    }
    if (resource.startsWith("points?")) {
      return [{ id: point.POINT_NOTE.pointId, match_id: point.guard.matchId }];
    }
    if (resource === "notes" && init.method === "POST") {
      notes.push(JSON.parse(init.body));
      return null;
    }
    if (resource.startsWith("notes?") && init.method === "DELETE") {
      const filters = new URL(`https://staging.invalid/${resource}`).searchParams;
      assert.equal(filters.get("match_id"), `eq.${point.guard.matchId}`);
      assert.equal(filters.get("point_id"), `eq.${point.POINT_NOTE.pointId}`);
      assert.equal(filters.get("author_id"), `eq.${point.guard.ownerId}`);
      assert.equal(filters.get("body"), `eq.${point.POINT_NOTE.body}`);
      notes.splice(0);
      return null;
    }
    throw new Error(`unexpected tutorial request: ${resource}`);
  };

  await point.stagePointNote("service-key", { adapter, request });
  assert.deepEqual(verified, [{ ownerId: point.guard.ownerId, ownerEmail: point.guard.ownerEmail }]);
  assert.deepEqual(notes, [{
    match_id: point.guard.matchId,
    point_id: point.POINT_NOTE.pointId,
    author_id: point.guard.ownerId,
    body: point.POINT_NOTE.body,
  }]);
  await point.cleanup("service-key", request);
  assert.deepEqual(notes, []);
});
