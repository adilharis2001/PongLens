/**
 * Landing video render.
 *
 *   node scripts/demos/landing/render.mjs mobile
 *
 * Deliberately plain. The tutorial renderer draws an annotation cue track,
 * a chapter header and logo bookends over the capture; none of that belongs
 * on a landing page, so this does the one thing that is actually needed:
 * lay the narration under the picture and fade out at the end.
 *
 * Picture and voice need no alignment pass. The capture was driven by the
 * measured line durations in voice/landing.json, so they already agree —
 * that is the whole point of generating narration first.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CUT = process.argv[2] ?? "mobile";
const VOICE = process.argv[3] ?? "landing";

const ff = (args) => execFileSync("ffmpeg", ["-y", "-v", "error", ...args]);
const probe = (file) =>
  Number(
    execFileSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file],
      { encoding: "utf8" }
    ).trim()
  );

const raw = path.join(DIR, "raw", `tut-${CUT}.mp4`);
if (!existsSync(raw)) throw new Error(`no capture at ${raw}`);
const voice = JSON.parse(
  readFileSync(path.join(DIR, "voice", `${VOICE}.json`), "utf8")
);

mkdirSync(path.join(DIR, "out"), { recursive: true });
const tmp = path.join(DIR, "raw", `.render-${CUT}`);
mkdirSync(tmp, { recursive: true });

/**
 * Rebuild the spoken track at full length: a lead-in, then each line
 * followed by exactly the silence the timing map says follows it. Rebuilt
 * here rather than kept as a file so it can never drift from voice.json.
 */
const silence = (seconds, name) => {
  const file = path.join(tmp, `${name}.mp3`);
  ff(["-f", "lavfi", "-t", seconds.toFixed(3), "-i", "anullsrc=r=24000:cl=mono", "-q:a", "9", file]);
  return file;
};

const parts = [silence(voice.lead, "lead")];
voice.lines.forEach((line, i) => {
  parts.push(path.join(DIR, line.file));
  const next = voice.lines[i + 1]?.start ?? voice.total;
  const hold = next - (line.start + line.dur);
  if (hold > 0.01) parts.push(silence(hold, `gap${i}`));
});

const listFile = path.join(tmp, "list.txt");
writeFileSync(listFile, parts.map((p) => `file '${p}'\n`).join(""));
const track = path.join(tmp, "narration.mp3");
ff(["-f", "concat", "-safe", "0", "-i", listFile, "-c:a", "libmp3lame", "-q:a", "2", track]);

const vDur = probe(raw);
const aDur = probe(track);
const dur = Math.min(vDur, aDur);
const out = path.join(DIR, "out", `landing-${CUT}.mp4`);

// Fade the picture out over the last second so the close lands rather than
// stopping. Audio fades with it.
ff([
  "-i", raw,
  "-i", track,
  "-map", "0:v:0", "-map", "1:a:0",
  "-t", dur.toFixed(3),
  // Up to 1080x1920 with lanczos. CDP hands back CSS-pixel frames whatever
  // the context's deviceScaleFactor says, so the capture is 390 wide and the
  // scale happens here — the same place the tutorial renders do it.
  "-vf", `scale=1080:1920:flags=lanczos,fade=t=out:st=${(dur - 1).toFixed(2)}:d=1`,
  "-af", `afade=t=out:st=${(dur - 1).toFixed(2)}:d=1`,
  "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
  out,
]);

const size = execFileSync("du", ["-h", out], { encoding: "utf8" }).split("\t")[0];
console.log(
  `picture ${vDur.toFixed(1)}s, voice ${aDur.toFixed(1)}s -> ${path.relative(
    process.cwd(),
    out
  )}  ${dur.toFixed(1)}s  ${size}`
);
