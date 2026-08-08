/**
 * One rendered still per spoken line, so the caption can be checked without
 * spending a render on it.
 *
 *   node scripts/demos/landing/stills.mjs desktop
 *
 * The composition reserves a fixed band for the caption (CAPTION_H in
 * Landing.tsx) and gives the device everything above it. That trade only
 * holds if the reservation is right, and the failure mode is a sentence
 * running off the bottom of the frame — which is invisible until someone
 * watches that exact line. Seventeen stills and a contact sheet is two
 * minutes; finding it in the finished file is two renders.
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CUT = process.argv[2] ?? "mobile";
const PROJ = path.join(DIR, "..", "tutorial", "remotion");
const OUT = path.join(DIR, "preview", `stills-${CUT}`);

const raw = path.join(DIR, "raw", `tut-${CUT}.mp4`);
const cues = path.join(DIR, "raw", `tut-${CUT}.cues.json`);
const voicePath = path.join(DIR, "voice", "landing.json");
for (const f of [raw, cues, voicePath]) {
  if (!existsSync(f)) throw new Error(`missing ${f}`);
}

mkdirSync(path.join(PROJ, "public"), { recursive: true });
copyFileSync(raw, path.join(PROJ, "public", "chapter.mp4"));
rmSync(path.join(PROJ, "public", "audio"), { recursive: true, force: true });
cpSync(path.join(DIR, "audio", "landing"), path.join(PROJ, "public", "audio"), {
  recursive: true,
});
copyFileSync(cues, path.join(PROJ, "src", "cues.json"));
copyFileSync(voicePath, path.join(PROJ, "src", "voice.json"));

const voice = JSON.parse(readFileSync(voicePath, "utf8"));
const FPS = 30;
const INTRO = 40;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

voice.lines.forEach((l, i) => {
  // Six tenths in: past the caption's fade-in, before its fade-out.
  const frame = INTRO + Math.round((l.start + l.dur * 0.6) * FPS);
  const file = path.join(OUT, `${String(i).padStart(2, "0")}-${l.id}.png`);
  const res = spawnSync(
    "npx",
    ["remotion", "still", "src/index.ts", "Landing", file, `--frame=${frame}`, "--log=error"],
    { cwd: PROJ, stdio: "inherit" }
  );
  if (res.status !== 0) throw new Error(`still failed for ${l.id}`);
  console.log(`  ${l.id}  frame ${frame}  ${l.text.length} chars`);
});

const sheet = path.join(DIR, "preview", `stills-${CUT}.jpg`);
spawnSync(
  "ffmpeg",
  ["-y", "-v", "error", "-pattern_type", "glob", "-i", `${OUT}/*.png`,
   "-filter_complex", `scale=460:-1,tile=3x${Math.ceil(voice.lines.length / 3)}:padding=8:color=0x333333`,
   sheet],
  { stdio: "inherit" }
);
console.log(`-> ${sheet}`);
