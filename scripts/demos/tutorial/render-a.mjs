/**
 * OPTION A — render a tutorial chapter with ffmpeg.
 *
 *   node scripts/demos/tutorial/render-a.mjs [chapter]
 *
 * Reads the capture (raw/tut-<chapter>.mp4), its cue track and voice.json,
 * and produces out/<chapter>-A.mp4:
 *
 *   - a highlight box and label chip per cue, and a tap ring
 *   - burned-in captions from the narration timings
 *   - the narration itself, each line delayed to its own start offset
 *
 * The annotation layer is pre-rendered to transparent PNGs by overlays.py
 * and composited here with `overlay`. That indirection exists because the
 * ffmpeg on this machine is built without freetype and libass — no
 * `drawtext`, no `subtitles` — which is worth knowing before betting a
 * pipeline on either filter.
 *
 * The ceiling of this approach: overlays pop on and off, because ffmpeg's
 * `enable` is a boolean rather than a curve. No easing, no zoom that
 * follows a target, no device frame. That is the honest difference between
 * this and render-b (Remotion).
 */

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(DIR, "out");
const CHAPTER = process.argv[2] ?? "upload";
const PY =
  process.env.PONGLENS_PY ?? path.join(DIR, "..", "..", "..", "worker", "venv", "bin", "python");

const cues = JSON.parse(
  readFileSync(path.join(DIR, "raw", `tut-${CHAPTER}.cues.json`), "utf8")
);
const voice = JSON.parse(
  readFileSync(path.join(DIR, "voice", `${CHAPTER}.json`), "utf8")
);

mkdirSync(OUT_DIR, { recursive: true });

// ------------------------------------------------- 1. the annotation layer
console.log("rendering overlays…");
execFileSync(PY, [path.join(DIR, "overlays.py"), CHAPTER], {
  stdio: "inherit",
});
const layer = JSON.parse(
  readFileSync(path.join(OUT_DIR, "overlay", CHAPTER,"manifest.json"), "utf8")
);

// --------------------------------------------------------- 2. filter graph
// Inputs: [0] video, [1..n] narration mp3s, then one image per overlay.
const audioCount = voice.lines.length;
const inputs = [
  "-i", path.join(DIR, "raw", `tut-${CHAPTER}.mp4`),
  ...voice.lines.flatMap((l) => ["-i", path.join(DIR, l.file)]),
  ...layer.items.flatMap((it) => [
    "-loop", "1",
    "-i", path.join(OUT_DIR, "overlay", CHAPTER,it.file),
  ]),
];

// fps=30 before anything else: the capture is variable-rate (CDP only emits
// a frame when the page repaints), and overlaying onto a 4 fps stream makes
// the typing and the sheet transition stutter.
const chain = [`[0:v]fps=30,scale=${layer.w}:${layer.h},format=rgba[base0]`];
layer.items.forEach((it, i) => {
  const idx = 1 + audioCount + i;
  chain.push(
    `[base${i}][${idx}:v]overlay=0:0:enable='between(t,${it.start.toFixed(
      2
    )},${it.end.toFixed(2)})'[base${i + 1}]`
  );
});
chain.push(`[base${layer.items.length}]format=yuv420p[v]`);

// Each narration line delayed to its own offset, then mixed onto one track.
const delays = voice.lines.map((l, i) => {
  const ms = Math.round(l.start * 1000);
  return `[${i + 1}:a]adelay=${ms}|${ms}[a${i}]`;
});
const mix = `${voice.lines
  .map((_, i) => `[a${i}]`)
  .join("")}amix=inputs=${audioCount}:normalize=0:dropout_transition=0[aout]`;

const out = path.join(OUT_DIR, `${CHAPTER}-A.mp4`);
const args = [
  "-y", "-v", "error", "-stats",
  ...inputs,
  "-filter_complex", [...chain, ...delays, mix].join(";"),
  "-map", "[v]", "-map", "[aout]",
  "-c:v", "libx264", "-crf", "23", "-preset", "slow", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-b:a", "128k",
  "-movflags", "+faststart",
  "-t", String(cues.duration.toFixed(2)),
  out,
];

const res = spawnSync("ffmpeg", args, { stdio: "inherit" });
if (res.status !== 0) process.exit(res.status ?? 1);

const size = execFileSync("stat", ["-f%z", out], { encoding: "utf8" }).trim();
console.log(`-> ${out}  ${(Number(size) / 1048576).toFixed(2)} MB`);
