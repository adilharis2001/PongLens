import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { dismiss as realDismiss } from "./capture.mjs";
import { catalogChapters, chapterPaths } from "./course-paths.mjs";
import { restore, runGuard, snapshot } from "./guard.mjs";
import { playerGuard } from "./fixtures/player-match.mjs";

const EXPECTED_TUTORIAL_POINT_NOTE = {
  matchId: "efff9208-abf2-4a20-a498-18cc5a5130b3",
  pointId: "06128a30-88a3-4330-8ab5-a5c002d1b4e8",
  authorId: "6eb09df4-7d44-4ef9-b1cc-8cdfc4119fc4",
  body: "Caught flat on the wide backhand again. Split step earlier here.",
};

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

async function runUploadWithRealDismiss() {
  const trace = [];
  const state = { guideOpen: false, detailsOpen: false, sideOpen: false };
  const page = fakePage(trace);
  const fallbackEvaluate = page.evaluate;
  const visible = (spec) => {
    if (spec?.text === "Where to put the camera") return state.guideOpen;
    if (spec?.aria === "Opponent name") return state.detailsOpen;
    if (spec?.text === "Which player are you?") return state.sideOpen;
    return false;
  };

  page.evaluate = async (fn, ...args) => {
    const source = String(fn);
    if (source.includes("Boolean(window.__pick(s))")) return visible(args[0]);
    if (source.includes("const el = window.__pick(s)")) {
      const spec = args[0];
      let hit = false;
      if (spec?.text === "Got it" && state.guideOpen) {
        state.guideOpen = false;
        hit = true;
      } else if (spec?.text === "Done" && state.detailsOpen) {
        state.detailsOpen = false;
        hit = true;
      } else if (spec?.aria === "Close" && state.sideOpen) {
        state.sideOpen = false;
        hit = true;
      }
      trace.push({ type: "dismiss.click", spec, hit });
      return hit;
    }
    if (source.includes('"How to record"') && source.includes("?.click()")) {
      state.guideOpen = true;
    }
    if (source.includes('"Match details"') && source.includes("?.click()")) {
      state.detailsOpen = true;
    }
    return fallbackEvaluate(fn, ...args);
  };
  page.waitForFunction = async (fn, arg, options) => {
    const source = String(fn);
    trace.push({ type: "waitForFunction", source, options, args: [arg] });
    if (source.includes("!window.__pick(s)")) {
      if (!visible(arg)) return true;
      throw new Error(`still visible: ${JSON.stringify(arg)}`);
    }
    return {};
  };
  page.keyboard.press = async (key) => trace.push({ type: "keyboard.press", key });
  page.click = async (selector) => {
    trace.push({
      type: "page.click",
      selector,
      opponentVisible: state.detailsOpen,
    });
    if (selector === 'button:has-text("Your side")') {
      assert.equal(state.detailsOpen, false, "Opponent field must be gone before Your side opens");
      state.sideOpen = true;
    }
  };

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
  };
  const upload = await import("./flows/player/upload.mjs");
  await upload.flow(page, clock, {
    beat: () => ({ start: 0, end: 1, dur: 1 }),
    voice: { total: 1 },
    union: () => rect,
    dismiss: realDismiss,
  });
  return { state, trace };
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

test("upload visibly opens the shipping Your side picker without changing it", async () => {
  const trace = [];
  const upload = await import("./flows/player/upload.mjs");
  await scheduledBeats(upload, trace);
  assert.ok(trace.some(({ type, selector }) =>
    type === "page.click" && selector === 'button:has-text("Your side")'
  ));
  assert.ok(trace.some(({ type, selector }) =>
    type === "waitForSelector" && selector === "text=Which player are you?"
  ));
  assert.ok(trace.some(({ type, spec }) =>
    type === "rect" && spec?.text === "Which player are you?" && spec?.tag === "h2"
  ));
  assert.ok(trace.some(({ type, spec }) =>
    type === "rect" && spec?.text === "I'm at the bottom" && spec?.tag === "button"
  ));
});

test("upload closes Match details with Done before opening Your side", async () => {
  const { state, trace } = await runUploadWithRealDismiss();
  assert.equal(state.detailsOpen, false);
  assert.ok(trace.some(({ type, spec, hit }) =>
    type === "dismiss.click" && spec?.text === "Done" && spec?.tag === "button" && hit
  ));
  assert.ok(trace.some(({ type, selector, opponentVisible }) =>
    type === "page.click" &&
    selector === 'button:has-text("Your side")' &&
    opponentVisible === false
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

test("point notes require the verified demo owner and leave cleanup to the player guard", async () => {
  const point = await import("./flows/player/point.mjs");
  assert.equal(point.guard?.kind, "player");
  assert.equal(point.guard.ownerId, "6eb09df4-7d44-4ef9-b1cc-8cdfc4119fc4");
  assert.equal(point.guard.ownerEmail, "uploader-test@example.com");
  assert.equal(typeof point.stagePointNote, "function");
  assert.equal(point.cleanup, undefined);

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
});

function recoveryAdapter(spec) {
  const state = {
    match: { id: spec.matchId, user_id: spec.ownerId },
    points: spec.pointIds.map((id) => ({ id, match_id: spec.matchId, placement: null, deleted: false })),
    notes: [],
  };
  const sameMarker = (row, marker) =>
    row.match_id === marker.matchId &&
    row.point_id === marker.pointId &&
    row.author_id === marker.authorId &&
    row.body === marker.body;
  return {
    state,
    async verifyOwner(ownerId, ownerEmail) {
      assert.equal(ownerId, spec.ownerId);
      assert.equal(ownerEmail, spec.ownerEmail);
    },
    async getMatch(matchId) {
      assert.equal(matchId, spec.matchId);
      return structuredClone(state.match);
    },
    async getPoints(matchId, pointIds) {
      assert.equal(matchId, spec.matchId);
      assert.deepEqual(new Set(pointIds), new Set(spec.pointIds));
      return structuredClone(state.points);
    },
    async updateMatch(matchId, patch) {
      assert.equal(matchId, spec.matchId);
      Object.assign(state.match, structuredClone(patch));
    },
    async updatePoint(pointId, patch) {
      Object.assign(state.points.find(({ id }) => id === pointId), structuredClone(patch));
    },
    async getNotes(marker) {
      assert.deepEqual(marker, EXPECTED_TUTORIAL_POINT_NOTE);
      return structuredClone(state.notes.filter((row) => sameMarker(row, marker)));
    },
    async deleteNote(noteId, marker) {
      const index = state.notes.findIndex(({ id }) => id === noteId);
      assert.ok(index >= 0);
      assert.ok(sameMarker(state.notes[index], marker));
      state.notes.splice(index, 1);
    },
    async insertNote(row, marker) {
      assert.ok(sameMarker(row, marker));
      state.notes.push(structuredClone(row));
    },
    async updateNote(noteId, row, marker) {
      const index = state.notes.findIndex(({ id }) => id === noteId);
      assert.ok(index >= 0);
      assert.ok(sameMarker(row, marker));
      state.notes[index] = structuredClone(row);
    },
    async objectExists() {
      return false;
    },
    async deleteObject() {},
  };
}

test("player recovery rejects a note marker outside the vetted owner match and point", async () => {
  const adapter = recoveryAdapter(playerGuard);
  await assert.rejects(
    snapshot("unused", {
      ...playerGuard,
      cleanupNotes: [{ ...EXPECTED_TUTORIAL_POINT_NOTE, authorId: "not-the-owner" }],
    }, adapter),
    /owned tutorial note marker/,
  );
});

test("disk-backed point recovery removes the exact note left by an interrupted capture", async () => {
  assert.deepEqual(playerGuard.cleanupNotes, [EXPECTED_TUTORIAL_POINT_NOTE]);

  const adapter = recoveryAdapter(playerGuard);
  const saved = await snapshot("unused", playerGuard, adapter);
  const dir = await mkdtemp(path.join(os.tmpdir(), "ponglens-player-guard-"));
  const snapshotPath = path.join(dir, "point-guard.json");
  try {
    await writeFile(snapshotPath, JSON.stringify([saved]));
    adapter.state.notes.push({
      id: "interrupted-note",
      match_id: EXPECTED_TUTORIAL_POINT_NOTE.matchId,
      point_id: EXPECTED_TUTORIAL_POINT_NOTE.pointId,
      author_id: EXPECTED_TUTORIAL_POINT_NOTE.authorId,
      body: EXPECTED_TUTORIAL_POINT_NOTE.body,
    });

    await runGuard(["restore", "player", "point"], {
      key: "unused",
      snapshotPath,
      adapter,
    });
    assert.deepEqual(adapter.state.notes, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("full capture cleanup preserves a pre-existing marker and removes only the staged copy", async () => {
  const point = await import("./flows/player/point.mjs");
  const adapter = recoveryAdapter(playerGuard);
  const existing = {
    id: "pre-existing-note",
    match_id: EXPECTED_TUTORIAL_POINT_NOTE.matchId,
    point_id: EXPECTED_TUTORIAL_POINT_NOTE.pointId,
    author_id: EXPECTED_TUTORIAL_POINT_NOTE.authorId,
    body: EXPECTED_TUTORIAL_POINT_NOTE.body,
    audio_path: null,
    image_path: null,
    created_at: "2026-09-04T12:00:00.000Z",
  };
  adapter.state.notes.push(structuredClone(existing));
  const saved = await snapshot("unused", playerGuard, adapter);
  adapter.state.notes.push({
    ...structuredClone(existing),
    id: "newly-staged-note",
    created_at: "2026-09-04T12:01:00.000Z",
  });

  // This is capture.mjs's real finally order: restore the guard first, then
  // invoke an optional chapter cleanup hook. The guard is the sole note
  // snapshot authority, so the latter must not exist for this chapter.
  await restore("unused", saved, adapter);
  if (typeof point.cleanup === "function") {
    await point.cleanup("unused", async (_key, resource, init = {}) => {
      if (!resource.startsWith("notes?") || init.method !== "DELETE") {
        throw new Error(`unexpected cleanup request: ${resource}`);
      }
      adapter.state.notes = [];
    });
  }

  assert.deepEqual(adapter.state.notes, [existing]);
});
