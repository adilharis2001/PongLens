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
import { copyFileSync, cpSync, mkdirSync, rmSync } from "node:fs";
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

export function runRender(args) {
const { course, slug } = parseRenderArgs(args);
const paths = chapterPaths(DIR, course, slug);

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
