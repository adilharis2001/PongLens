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

/**
 * Output shape follows the capture. The phone cut is portrait and gets
 * upscaled (CDP hands back CSS-pixel frames whatever deviceScaleFactor
 * says); the desktop cut is already 1440 wide and only needs the last step
 * up to 1080p.
 */
const dims = execFileSync(
  "ffprobe",
  ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
   "-of", "csv=p=0", raw],
  { encoding: "utf8" }
).trim().split(",").map(Number);
const portrait = dims[1] > dims[0];
const target = portrait ? "1080:1920" : "1920:1080";

/**
 * Music, if there is any. Dropped in by hand at music/bed.mp3 rather than
 * fetched: the licence matters on a commercial page and is not something a
 * script should decide. Ducked under the voice by sidechain compression, so
 * it lifts in the gaps between lines instead of sitting flat under them.
 */
const bed = path.join(DIR, "music", "bed.mp3");
const hasMusic = existsSync(bed);

const vDur = probe(raw);
const aDur = probe(track);
/**
 * Run to the END OF THE VOICE, not to whichever is shorter.
 *
 * The capture comes back a second or two under the narration (frame timing
 * drift over ninety seconds), and trimming to the picture cut the closing
 * line off mid-tagline. The last frame is held instead, which is what a
 * held close should look like anyway.
 */
const dur = aDur;
const hold = Math.max(0, aDur - vDur);
const out = path.join(DIR, "out", `landing-${CUT}.mp4`);

// Fade the picture out over the last second so the close lands rather than
// stopping. Audio fades with it.
const fadeAt = (dur - 1).toFixed(2);
const audio = hasMusic
  ? [
      "-filter_complex",
      // Music down to a bed, then ducked by the voice, then the two summed.
      `[2:a]volume=-18dB,aloop=loop=-1:size=2e9,atrim=0:${dur.toFixed(3)}[bed];` +
        `[bed][1:a]sidechaincompress=threshold=0.03:ratio=6:attack=5:release=380[duck];` +
        `[duck][1:a]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,` +
        `afade=t=out:st=${fadeAt}:d=1[a]`,
      "-map", "0:v:0", "-map", "[a]",
    ]
  : ["-map", "0:v:0", "-map", "1:a:0", "-af", `afade=t=out:st=${fadeAt}:d=1`];

ff([
  "-i", raw,
  "-i", track,
  ...(hasMusic ? ["-i", bed] : []),
  ...audio,
  "-t", dur.toFixed(3),
  // Up to 1080x1920 with lanczos. CDP hands back CSS-pixel frames whatever
  // the context's deviceScaleFactor says, so the capture is 390 wide and the
  // scale happens here — the same place the tutorial renders do it.
  "-vf",
  `${hold > 0.04 ? `tpad=stop_mode=clone:stop_duration=${(hold + 0.5).toFixed(2)},` : ""}` +
    `scale=${target}:flags=lanczos,fade=t=out:st=${fadeAt}:d=1`,
  "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
  out,
]);

const size = execFileSync("du", ["-h", out], { encoding: "utf8" }).split("\t")[0];
console.log(
  `${dims[0]}x${dims[1]} -> ${target.replace(":", "x")}${hasMusic ? ", with music" : ", no music"}` +
    (hold > 0.04 ? `, last frame held ${hold.toFixed(1)}s to let the close finish` : "")
);
console.log(
  `picture ${vDur.toFixed(1)}s, voice ${aDur.toFixed(1)}s -> ${path.relative(
    process.cwd(),
    out
  )}  ${dur.toFixed(1)}s  ${size}`
);
