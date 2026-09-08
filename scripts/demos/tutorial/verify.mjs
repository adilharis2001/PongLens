import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { catalogChapter, chapterPaths, parseChapterRef } from "./course-paths.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const USAGE = "usage: verify.mjs <player|coach> <chapter>";
const WIDTH = 390;
const HEIGHT = 844;
const BOOKENDS_SECONDS = (36 + 54) / 30;
const FORBIDDEN_COACH_COPY = /coming soon|video lesson|video recording|record video/i;

export function parseVerifyArgs(args) {
  if (args.length !== 2) throw new Error(USAGE);
  const [course, slug] = args;
  try {
    catalogChapter(course, slug);
  } catch (error) {
    throw new Error(`${USAGE}\n${error.message}`);
  }
  return { course, slug };
}

function inspectOutput(file) {
  return JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v", "error",
        "-show_entries", "format=duration:stream=codec_type,codec_name,width,height",
        "-of", "json",
        file,
      ],
      { encoding: "utf8" },
    ),
  );
}

function fail(id, condition) {
  throw new Error(`${id}: ${condition}`);
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function cueIsValid(cue, total) {
  if (!finite(cue.t) || !finite(cue.end) || cue.t < 0 || cue.end - cue.t < 0.3 || cue.end > total) {
    return false;
  }
  if (cue.kind === "box") {
    const rect = cue.rect;
    return Boolean(
      rect &&
      [rect.x, rect.y, rect.w, rect.h].every(finite) &&
      rect.w > 0 &&
      rect.h > 0 &&
      rect.x >= 0 &&
      rect.y >= 0 &&
      rect.x + rect.w <= WIDTH &&
      rect.y + rect.h <= HEIGHT,
    );
  }
  if (cue.kind === "tap") {
    return finite(cue.x) && finite(cue.y) && cue.x >= 0 && cue.x <= WIDTH && cue.y >= 0 && cue.y <= HEIGHT;
  }
  return false;
}

export function verifyChapter(
  course,
  slug,
  {
    root = DIR,
    probe = inspectOutput,
    catalogLookup = catalogChapter,
  } = {},
) {
  const { id } = parseChapterRef(course, slug);
  const paths = chapterPaths(root, course, slug);
  for (const [kind, file] of [
    ["chapter manifest", paths.chapter],
    ["voice timing", paths.voice],
    ["cue track", paths.rawCues],
    ["output", paths.output],
  ]) {
    if (!existsSync(file)) fail(id, `${kind} does not exist: ${file}`);
  }

  const chapter = JSON.parse(readFileSync(paths.chapter, "utf8"));
  const voice = JSON.parse(readFileSync(paths.voice, "utf8"));
  const cues = JSON.parse(readFileSync(paths.rawCues, "utf8"));
  const media = probe(paths.output);
  const video = media.streams?.find((stream) => stream.codec_type === "video");
  const audio = media.streams?.find((stream) => stream.codec_type === "audio");
  const duration = Number(media.format?.duration ?? media.duration);

  if (!video || video.width !== 1080 || video.height !== 1920) {
    fail(id, "output must be 1080x1920");
  }
  if (video.codec_name !== "h264") fail(id, "video codec must be H.264");
  if (!audio || audio.codec_name !== "aac") fail(id, "audio codec must be AAC");
  if (!finite(duration) || duration <= 0) fail(id, "output duration must be positive");
  if (duration > 60) fail(id, "output duration must not exceed 60 seconds");

  if (!finite(voice.total) || voice.total <= 0) fail(id, "voice total must be positive");
  const expectedDuration = voice.total + BOOKENDS_SECONDS;
  if (Math.abs(duration - expectedDuration) > 0.25) {
    fail(id, `duration ${duration.toFixed(3)}s differs from voice plus bookends ${expectedDuration.toFixed(3)}s`);
  }

  if (cues.viewport?.w !== WIDTH || cues.viewport?.h !== HEIGHT) {
    fail(id, `cue viewport must be ${WIDTH}x${HEIGHT}`);
  }
  for (const [index, cue] of (cues.cues ?? []).entries()) {
    if (!cueIsValid(cue, voice.total)) fail(id, `cue ${index + 1} is outside the viewport or chapter interval`);
  }

  const manifestLines = chapter.lines ?? [];
  const voiceLines = voice.lines ?? [];
  if (
    manifestLines.length !== voiceLines.length ||
    manifestLines.some((line, index) =>
      line.id !== voiceLines[index]?.id || line.text !== voiceLines[index]?.text
    )
  ) {
    fail(id, "voice text does not match the chapter manifest");
  }

  const catalog = catalogLookup(course, slug);
  if (chapter.title !== catalog.title || voice.title !== catalog.title) {
    fail(id, "chapter or voice title does not match the catalog title");
  }

  if (course === "coach" && FORBIDDEN_COACH_COPY.test(`${JSON.stringify(chapter)}\n${JSON.stringify(voice)}`)) {
    fail(id, "forbidden coach recording-roadmap wording appears in captions");
  }

  return { id, duration, expectedDuration, cues: (cues.cues ?? []).length };
}

export function runVerify(args) {
  const { course, slug } = parseVerifyArgs(args);
  const result = verifyChapter(course, slug);
  console.log(
    `${result.id}: verified ${result.duration.toFixed(3)}s, 1080x1920 H.264/AAC, ${result.cues} cues`,
  );
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runVerify(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
