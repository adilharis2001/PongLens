/**
 * OPTION B — render a tutorial chapter with Remotion.
 *
 *   node scripts/demos/tutorial/render-b.mjs <course> <chapter>
 *
 * Same inputs as render-a (the capture, its cue track, voice.json). This
 * step only stages them where the Remotion project can see them and then
 * shells out to the renderer; all the composition lives in
 * remotion/src/Chapter.tsx.
 *
 * Remotion's free licence covers individuals and companies up to three
 * people, rendering locally like this. See remotion.pro/license before the
 * team grows or this moves onto a render farm.
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { catalogChapter, chapterPaths } from "./course-paths.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJ = path.join(DIR, "remotion");
const RENDER_USAGE = "usage: render-b.mjs <player|coach> <chapter>";

export function parseRenderArgs(args) {
  if (args.length !== 2) throw new Error(RENDER_USAGE);
  const [course, slug] = args;
  try {
    catalogChapter(course, slug);
  } catch (error) {
    throw new Error(`${RENDER_USAGE}\n${error.message}`);
  }
  return { course, slug };
}

export function validateNativeInserts(inserts, root = DIR) {
  if (!Array.isArray(inserts)) throw new Error("native inserts must be an array");
  return inserts.map((insert) => {
    const chapter = catalogChapter(insert.course, insert.chapter);
    if (insert.course === "coach" && insert.chapter === "coach-paid-review") {
      throw new Error("native inserts never target coach-paid-review");
    }
    const values = [insert.start, insert.end, insert.at];
    if (!values.every(Number.isFinite) || insert.start < 0 || insert.at < 0) {
      throw new Error(`invalid native insert time for ${insert.course}/${insert.chapter}`);
    }
    if (insert.end <= insert.start) {
      throw new Error(`native insert end must follow start for ${insert.course}/${insert.chapter}`);
    }
    if (insert.at + insert.end - insert.start > chapter.seconds) {
      throw new Error(`native insert exceeds narration duration for ${insert.course}/${insert.chapter}`);
    }
    if (typeof insert.source !== "string" || !insert.source.startsWith("raw/native/")) {
      throw new Error("native insert source must be under raw/native");
    }
    const nativeRoot = path.resolve(root, "raw", "native");
    const sourcePath = path.resolve(root, insert.source);
    const relative = path.relative(nativeRoot, sourcePath);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("native insert source must be a file under raw/native");
    }
    return { ...insert };
  });
}

export function probeNativeVideo(file) {
  if (!existsSync(file)) throw new Error(`native source does not exist: ${file}`);
  let data;
  try {
    data = JSON.parse(
      execFileSync(
        "ffprobe",
        [
          "-v", "error",
          "-select_streams", "v:0",
          "-show_entries", "stream=width,height,duration:format=duration",
          "-of", "json",
          file,
        ],
        { encoding: "utf8" },
      ),
    );
  } catch {
    throw new Error(`native source cannot be inspected: ${file}`);
  }
  const stream = data.streams?.[0];
  const duration = Number(stream?.duration ?? data.format?.duration);
  if (!(stream?.width > 0) || !(stream?.height > 0) || !(duration > 0)) {
    throw new Error(`native source has invalid dimensions or duration: ${file}`);
  }
  return {
    width: stream.width,
    height: stream.height,
    duration: Number(duration.toFixed(3)),
  };
}

export function prepareNativeChapter(
  course,
  slug,
  { root = DIR, project = PROJ, inserts } = {},
) {
  const manifest = inserts ?? JSON.parse(
    readFileSync(path.join(root, "native-inserts.json"), "utf8"),
  ).inserts;
  const validated = validateNativeInserts(manifest, root);
  const selected = validated.find(
    (insert) => insert.course === course && insert.chapter === slug,
  );
  const publicDir = path.join(project, "public");
  const sourceDir = path.join(project, "src");
  const stagedInsert = path.join(publicDir, "native-insert.mp4");
  mkdirSync(publicDir, { recursive: true });
  mkdirSync(sourceDir, { recursive: true });
  rmSync(stagedInsert, { force: true });

  let staged = { inserts: [], nativeInserts: [] };
  const stagedManifest = path.join(sourceDir, "inserts.json");
  if (existsSync(stagedManifest)) {
    const current = JSON.parse(readFileSync(stagedManifest, "utf8"));
    staged = { ...current, nativeInserts: [] };
  }
  if (!selected) {
    writeFileSync(stagedManifest, `${JSON.stringify(staged, null, 2)}\n`);
    return { mode: "none" };
  }

  const source = path.resolve(root, selected.source);
  const metadata = probeNativeVideo(source);
  if (metadata.height <= metadata.width) {
    throw new Error(`native source must be portrait: ${selected.source}`);
  }
  if (metadata.duration + 0.05 < selected.end) {
    throw new Error(`native source is shorter than its insert: ${selected.source}`);
  }

  if (course === "coach" && slug === "coach-audio-lesson") {
    const paths = chapterPaths(root, course, slug);
    mkdirSync(path.dirname(paths.rawVideo), { recursive: true });
    copyFileSync(source, paths.rawVideo);
    writeFileSync(
      paths.rawCues,
      `${JSON.stringify(
        {
          course,
          chapter: slug,
          video: path.basename(paths.rawVideo),
          viewport: { w: 390, h: 844, dsf: 1 },
          duration: metadata.duration,
          cues: [],
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(stagedManifest, `${JSON.stringify(staged, null, 2)}\n`);
    return { mode: "chapter", metadata };
  }

  copyFileSync(source, stagedInsert);
  staged.nativeInserts = [
    {
      src: "native-insert.mp4",
      start: selected.start,
      end: selected.end,
      at: selected.at,
    },
  ];
  writeFileSync(stagedManifest, `${JSON.stringify(staged, null, 2)}\n`);
  return { mode: "insert", metadata };
}

export function runRender(args) {
const { course, slug } = parseRenderArgs(args);
const paths = chapterPaths(DIR, course, slug);

prepareNativeChapter(course, slug);

// Staged into the project: public/ for anything <OffthreadVideo>/<Audio>
// loads at runtime, src/ for the JSON the composition needs at build time
// (durationInFrames has to be known before the first frame renders).
mkdirSync(path.join(PROJ, "public", "audio"), { recursive: true });
mkdirSync(path.dirname(paths.output), { recursive: true });

copyFileSync(
  paths.rawVideo,
  path.join(PROJ, "public", "chapter.mp4")
);
rmSync(path.join(PROJ, "public", "audio"), { recursive: true, force: true });
cpSync(paths.audio, path.join(PROJ, "public", "audio"), {
  recursive: true,
});
copyFileSync(paths.rawCues, path.join(PROJ, "src", "cues.json"));
copyFileSync(paths.voice, path.join(PROJ, "src", "voice.json"));

const out = paths.output;
const res = spawnSync(
  "npx",
  [
    "remotion",
    "render",
    "src/index.ts",
    "Chapter",
    out,
    "--codec=h264",
    "--crf=21",
    "--log=info",
  ],
  { cwd: PROJ, stdio: "inherit" }
);
if (res.status !== 0) process.exit(res.status ?? 1);

const size = execFileSync("stat", ["-f%z", out], { encoding: "utf8" }).trim();
console.log(`-> ${out}  ${(Number(size) / 1048576).toFixed(2)} MB`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runRender(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
