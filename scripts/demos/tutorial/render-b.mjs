/**
 * OPTION B — render a tutorial chapter with Remotion.
 *
 *   node scripts/demos/tutorial/render-b.mjs [chapter]
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

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CHAPTER = process.argv[2] ?? "upload";
const PROJ = path.join(DIR, "remotion");
const OUT_DIR = path.join(DIR, "out");

const cuesPath = path.join(DIR, "raw", `tut-${CHAPTER}.cues.json`);
const voicePath = path.join(DIR, "voice", `${CHAPTER}.json`);

// Staged into the project: public/ for anything <OffthreadVideo>/<Audio>
// loads at runtime, src/ for the JSON the composition needs at build time
// (durationInFrames has to be known before the first frame renders).
mkdirSync(path.join(PROJ, "public", "audio"), { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

copyFileSync(
  path.join(DIR, "raw", `tut-${CHAPTER}.mp4`),
  path.join(PROJ, "public", "chapter.mp4")
);
rmSync(path.join(PROJ, "public", "audio"), { recursive: true, force: true });
cpSync(path.join(DIR, "audio", CHAPTER), path.join(PROJ, "public", "audio"), {
  recursive: true,
});
copyFileSync(cuesPath, path.join(PROJ, "src", "cues.json"));
copyFileSync(voicePath, path.join(PROJ, "src", "voice.json"));

const out = path.join(OUT_DIR, `${CHAPTER}-B.mp4`);
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
