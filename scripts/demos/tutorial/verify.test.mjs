import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { verifyChapter } from "./verify.mjs";

function fixture(overrides = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "ponglens-tutorial-verify-"));
  const course = overrides.course ?? "player";
  const slug = overrides.slug ?? "home";
  const title = overrides.title ?? "Start here";
  const chapterDir = path.join(root, "chapters", course);
  const voiceDir = path.join(root, "voice", course);
  const rawDir = path.join(root, "raw", course);
  const outDir = path.join(root, "out", course);
  for (const dir of [chapterDir, voiceDir, rawDir, outDir]) mkdirSync(dir, { recursive: true });

  const text = overrides.text ?? "A useful tutorial sentence.";
  writeFileSync(
    path.join(chapterDir, `${slug}.json`),
    JSON.stringify({ chapter: slug, title, lines: [{ id: "l1", beat: "screen", text }] }),
  );
  writeFileSync(
    path.join(voiceDir, `${slug}.json`),
    JSON.stringify({
      chapter: slug,
      title,
      total: overrides.voiceTotal ?? 10,
      lines: [{ id: "l1", beat: "screen", text, file: `audio/${course}/${slug}/l1.mp3`, start: 0.6, dur: 4 }],
    }),
  );
  writeFileSync(
    path.join(rawDir, `tut-${slug}.cues.json`),
    JSON.stringify(
      overrides.cues ?? {
        course,
        chapter: slug,
        viewport: { w: 390, h: 844, dsf: 2 },
        duration: 10,
        cues: [{ kind: "box", t: 1, end: 3, rect: { x: 8, y: 12, w: 200, h: 80 } }],
      },
    ),
  );
  writeFileSync(path.join(outDir, `${slug}.mp4`), "fixture");

  const probe = overrides.probe ?? (() => ({
    duration: overrides.outputDuration ?? 13,
    streams: [
      { codec_type: "video", codec_name: "h264", width: 1080, height: 1920 },
      { codec_type: "audio", codec_name: "aac" },
    ],
  }));
  const catalogLookup = () => ({ slug, title });
  return { root, course, slug, probe, catalogLookup };
}

test("accepts a render whose media, timing, cues, narration, and catalog agree", () => {
  const input = fixture();
  const result = verifyChapter(input.course, input.slug, input);
  assert.equal(result.id, "player/home");
  assert.equal(result.duration, 13);
});

test("rejects the wrong video geometry or codecs", () => {
  const input = fixture({
    probe: () => ({
      duration: 13,
      streams: [
        { codec_type: "video", codec_name: "hevc", width: 720, height: 1280 },
        { codec_type: "audio", codec_name: "mp3" },
      ],
    }),
  });
  assert.throws(() => verifyChapter(input.course, input.slug, input), /player\/home.*1080x1920/i);
});

test("rejects a render more than 0.25 seconds away from voice plus bookends", () => {
  const input = fixture({ outputDuration: 13.3 });
  assert.throws(() => verifyChapter(input.course, input.slug, input), /player\/home.*duration/i);
});

test("rejects cues outside the 390 by 844 viewport or narration interval", () => {
  const input = fixture({
    cues: {
      course: "player",
      chapter: "home",
      viewport: { w: 390, h: 844, dsf: 2 },
      duration: 10,
      cues: [{ kind: "box", t: 1, end: 11, rect: { x: 300, y: 12, w: 100, h: 80 } }],
    },
  });
  assert.throws(() => verifyChapter(input.course, input.slug, input), /player\/home.*cue/i);
});

test("rejects a cue too short to be visible", () => {
  const input = fixture({
    cues: {
      course: "player",
      chapter: "home",
      viewport: { w: 390, h: 844, dsf: 2 },
      duration: 10,
      cues: [{ kind: "box", t: 1, end: 1.2, rect: { x: 20, y: 20, w: 100, h: 80 } }],
    },
  });
  assert.throws(() => verifyChapter(input.course, input.slug, input), /player\/home.*cue/i);
});

test("rejects voice words that differ from the approved manifest", () => {
  const input = fixture();
  const voicePath = path.join(input.root, "voice", input.course, `${input.slug}.json`);
  writeFileSync(voicePath, JSON.stringify({
    chapter: input.slug,
    title: "Start here",
    total: 10,
    lines: [{ id: "l1", beat: "screen", text: "Different words.", file: "audio/l1.mp3", start: 0.6, dur: 4 }],
  }));
  assert.throws(() => verifyChapter(input.course, input.slug, input), /player\/home.*voice text/i);
});

test("rejects a title that differs from the Learn catalog", () => {
  const input = fixture();
  input.catalogLookup = () => ({ slug: input.slug, title: "Different catalog title" });
  assert.throws(() => verifyChapter(input.course, input.slug, input), /player\/home.*catalog title/i);
});

test("rejects output over 60 seconds", () => {
  const input = fixture({ voiceTotal: 58, outputDuration: 61 });
  assert.throws(() => verifyChapter(input.course, input.slug, input), /player\/home.*60 seconds/i);
});

test("rejects forbidden coach recording-roadmap wording in captions", () => {
  const input = fixture({
    course: "coach",
    slug: "coach-start",
    text: "Video recording is coming soon.",
  });
  assert.throws(() => verifyChapter(input.course, input.slug, input), /coach\/coach-start.*forbidden/i);
});
