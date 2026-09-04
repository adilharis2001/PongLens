import path from "node:path";

import { visibleChapters } from "../../../src/app/learn/catalog.ts";

const COURSES = new Set(["player", "coach"]);
const PLATFORMS = new Set(["web", "ios"]);
const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function parseChapterRef(course, slug) {
  if (!COURSES.has(course)) {
    throw new Error(`Invalid tutorial course: ${String(course)}`);
  }
  if (typeof slug !== "string" || !SAFE_SLUG.test(slug)) {
    throw new Error(`Invalid tutorial slug: ${String(slug)}`);
  }

  return { course, slug, id: `${course}/${slug}` };
}

export function chapterPaths(root, course, slug) {
  const chapter = parseChapterRef(course, slug);

  return {
    chapter: path.join(root, "chapters", chapter.course, `${chapter.slug}.json`),
    flow: path.join(root, "flows", chapter.course, `${chapter.slug}.mjs`),
    voice: path.join(root, "voice", chapter.course, `${chapter.slug}.json`),
    audio: path.join(root, "audio", chapter.course, chapter.slug),
    rawVideo: path.join(root, "raw", chapter.course, `tut-${chapter.slug}.mp4`),
    rawCues: path.join(root, "raw", chapter.course, `tut-${chapter.slug}.cues.json`),
    guard: path.join(root, "raw", chapter.course, `${chapter.slug}-guard.json`),
    output: path.join(root, "out", chapter.course, `${chapter.slug}.mp4`),
  };
}

export function catalogChapters(course, platform = "web") {
  if (!COURSES.has(course)) {
    throw new Error(`Invalid tutorial course: ${String(course)}`);
  }
  if (!PLATFORMS.has(platform)) {
    throw new Error(`Invalid tutorial platform: ${String(platform)}`);
  }

  const seen = new Set();
  return visibleChapters(course, platform).map((chapter) => {
    const { id } = parseChapterRef(course, chapter.slug);
    if (seen.has(id)) {
      throw new Error(`Duplicate tutorial catalog chapter: ${id}`);
    }
    seen.add(id);

    const expectedMediaKey = `tutorial/${id}.mp4`;
    if (chapter.mediaKey !== expectedMediaKey) {
      throw new Error(
        `Invalid tutorial mediaKey for ${id}: expected ${expectedMediaKey}`,
      );
    }
    return chapter;
  });
}

export function catalogChapter(course, slug, platform = "web") {
  const ref = parseChapterRef(course, slug);
  const chapter = catalogChapters(course, platform).find(
    (candidate) => candidate.slug === ref.slug,
  );
  if (!chapter) {
    throw new Error(`Unknown tutorial catalog chapter: ${ref.id}`);
  }
  return chapter;
}
