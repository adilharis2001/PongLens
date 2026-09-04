import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  catalogChapters,
  chapterPaths,
  parseChapterRef,
} from "./course-paths.mjs";
import { parseCaptureArgs } from "./capture.mjs";
import { parseGuardArgs } from "./guard.mjs";
import { parseProbeArgs } from "./probe.mjs";
import { parseRenderArgs } from "./render-b.mjs";
import { parseTTSArgs } from "./tts.mjs";

const root = path.join("tmp", "tutorial");

test("chapter references accept only known courses and path-safe slugs", () => {
  assert.equal(parseChapterRef("player", "home").id, "player/home");
  assert.equal(
    parseChapterRef("coach", "coach-start").id,
    "coach/coach-start",
  );
  assert.throws(() => parseChapterRef("../coach", "home"), /course/);
  assert.throws(() => parseChapterRef("player", "../../secret"), /slug/);
  assert.throws(() => parseChapterRef("spectator", "home"), /course/);
  assert.throws(() => parseChapterRef("player", "Home"), /slug/);
});

test("chapter paths keep player and coach media in separate directories", () => {
  assert.deepEqual(chapterPaths(root, "player", "home"), {
    chapter: path.join(root, "chapters", "player", "home.json"),
    flow: path.join(root, "flows", "player", "home.mjs"),
    voice: path.join(root, "voice", "player", "home.json"),
    audio: path.join(root, "audio", "player", "home"),
    rawVideo: path.join(root, "raw", "player", "tut-home.mp4"),
    rawCues: path.join(root, "raw", "player", "tut-home.cues.json"),
    guard: path.join(root, "raw", "player", "home-guard.json"),
    output: path.join(root, "out", "player", "home.mp4"),
  });
  assert.notEqual(
    chapterPaths(root, "player", "home").output,
    chapterPaths(root, "coach", "home").output,
  );
});

test("capture accepts exactly one catalog-owned course and chapter", () => {
  assert.deepEqual(parseCaptureArgs(["player", "home"]), {
    course: "player",
    slug: "home",
  });
  assert.throws(() => parseCaptureArgs([]), /usage:/i);
  assert.throws(() => parseCaptureArgs(["spectator", "home"]), /usage:/i);
  assert.throws(() => parseCaptureArgs(["player", "not-a-chapter"]), /usage:/i);
  assert.throws(() => parseCaptureArgs(["player", "home", "extra"]), /usage:/i);
});

test("tts accepts only an optional reuse flag after a catalog chapter", () => {
  assert.deepEqual(parseTTSArgs(["coach", "coach-start", "--reuse"]), {
    course: "coach",
    slug: "coach-start",
    reuse: true,
  });
  assert.deepEqual(parseTTSArgs(["player", "upload"]), {
    course: "player",
    slug: "upload",
    reuse: false,
  });
  assert.throws(() => parseTTSArgs(["player"]), /usage:/i);
  assert.throws(() => parseTTSArgs(["invalid", "upload"]), /usage:/i);
  assert.throws(() => parseTTSArgs(["player", "unknown"]), /usage:/i);
  assert.throws(() => parseTTSArgs(["player", "upload", "extra"]), /usage:/i);
  assert.throws(() => parseTTSArgs(["player", "upload", "--unknown"]), /usage:/i);
});

test("renderer accepts exactly one catalog-owned course and chapter", () => {
  assert.deepEqual(parseRenderArgs(["coach", "coach-feedback"]), {
    course: "coach",
    slug: "coach-feedback",
  });
  assert.throws(() => parseRenderArgs(["coach"]), /usage:/i);
  assert.throws(() => parseRenderArgs(["invalid", "coach-feedback"]), /usage:/i);
  assert.throws(() => parseRenderArgs(["coach", "unknown"]), /usage:/i);
  assert.throws(() => parseRenderArgs(["coach", "coach-feedback", "extra"]), /usage:/i);
});

test("probe validates its course, account, route, and supported steps", () => {
  assert.deepEqual(
    parseProbeArgs([
      "coach",
      "coach@example.com",
      "/coaching/students",
      "click:Students",
      "wait:500",
    ]),
    {
      course: "coach",
      account: "coach@example.com",
      routePath: "/coaching/students",
      steps: ["click:Students", "wait:500"],
    },
  );
  assert.throws(() => parseProbeArgs([]), /usage:/i);
  assert.throws(
    () => parseProbeArgs(["invalid", "coach@example.com", "/coaching"]),
    /usage:/i,
  );
  assert.throws(
    () => parseProbeArgs(["coach", "coach@example.com", "/coaching", "type:X"]),
    /usage:/i,
  );
  assert.throws(
    () => parseProbeArgs(["coach", "not-an-email", "/coaching"]),
    /usage:/i,
  );
  assert.throws(
    () => parseProbeArgs(["coach", "coach@example.com", "https://example.com"]),
    /usage:/i,
  );
});

test("guard recovery accepts only a catalog-owned course and chapter", () => {
  assert.deepEqual(parseGuardArgs(["restore", "player", "keepscore"]), {
    command: "restore",
    course: "player",
    slug: "keepscore",
  });
  assert.throws(() => parseGuardArgs(["restore", "player"]), /usage:/i);
  assert.throws(() => parseGuardArgs(["restore", "invalid", "keepscore"]), /usage:/i);
  assert.throws(() => parseGuardArgs(["restore", "player", "unknown"]), /usage:/i);
  assert.throws(
    () => parseGuardArgs(["restore", "player", "keepscore", "extra"]),
    /usage:/i,
  );
});

test("media production defaults to both complete web course catalogs", () => {
  assert.equal(catalogChapters("player").length, 9);
  assert.equal(catalogChapters("coach").length, 9);
});

test("explicit platform validation excludes web-only coach media from iOS", () => {
  const coachIOS = catalogChapters("coach", "ios");

  assert.equal(coachIOS.length, 8);
  assert.equal(
    coachIOS.some(({ slug }) => slug === "coach-paid-review"),
    false,
  );
  assert.throws(() => catalogChapters("coach", "android"), /platform/);
  assert.throws(() => catalogChapters("spectator", "web"), /course/);
});

test("every catalog record has a unique course slug and catalog-owned media key", () => {
  const records = [
    ...catalogChapters("player", "web").map((chapter) => ({
      course: "player",
      chapter,
    })),
    ...catalogChapters("coach", "web").map((chapter) => ({
      course: "coach",
      chapter,
    })),
  ];
  const ids = records.map(({ course, chapter }) => `${course}/${chapter.slug}`);

  assert.equal(new Set(ids).size, ids.length);
  for (const { course, chapter } of records) {
    assert.equal(chapter.mediaKey, `tutorial/${course}/${chapter.slug}.mp4`);
  }
});

test("every namespaced player flow still imports the shared account module", async () => {
  const pipelineRoot = fileURLToPath(new URL(".", import.meta.url));
  process.env.TUTORIAL_ACCOUNT = "player@example.com";
  process.env.TUTORIAL_COACH = "coach@example.com";
  try {
    for (const chapter of catalogChapters("player")) {
      const module = await import(chapterPaths(pipelineRoot, "player", chapter.slug).flow);
      assert.equal(typeof module.flow, "function", `player/${chapter.slug}`);
    }
  } finally {
    delete process.env.TUTORIAL_ACCOUNT;
    delete process.env.TUTORIAL_COACH;
  }
});
