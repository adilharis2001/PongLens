import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import {
  catalogChapters,
  chapterPaths,
  parseChapterRef,
} from "./course-paths.mjs";

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
    output: path.join(root, "out", "player", "home.mp4"),
  });
  assert.notEqual(
    chapterPaths(root, "player", "home").output,
    chapterPaths(root, "coach", "home").output,
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
