/**
 * Landing video render, framed.
 *
 *   node scripts/demos/landing/render-framed.mjs mobile
 *   node scripts/demos/landing/render-framed.mjs desktop
 *
 * The earlier renderer laid narration under the raw capture and stopped
 * there, which is a screen recording, not a video. This one goes through
 * the Remotion project the tutorial chapters use, so the capture arrives
 * inside a device on a branded backdrop, with the spoken line on screen,
 * highlights on what is being discussed, and a logo at each end.
 *
 * Remotion bakes in the narration; the music bed is mixed afterwards here,
 * because ducking it against the voice is an ffmpeg job and doing it in the
 * composition would mean re-rendering every frame to change the level.
 */

import { spawnSync, execFileSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CUT = process.argv[2] ?? "mobile";
const VOICE = process.argv[3] ?? "landing";
const PROJ = path.join(DIR, "..", "tutorial", "remotion");
const OUT_DIR = path.join(DIR, "out");

const raw = path.join(DIR, "raw", `tut-${CUT}.mp4`);
const cuesPath = path.join(DIR, "raw", `tut-${CUT}.cues.json`);
const voicePath = path.join(DIR, "voice", `${VOICE}.json`);
for (const f of [raw, cuesPath, voicePath]) {
  if (!existsSync(f)) throw new Error(`missing ${f}`);
}

// public/ for what the composition loads at runtime, src/ for the JSON it
// needs at BUILD time — durationInFrames and the canvas size have to be
// known before the first frame renders.
mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(path.join(PROJ, "public"), { recursive: true });
copyFileSync(raw, path.join(PROJ, "public", "chapter.mp4"));
rmSync(path.join(PROJ, "public", "audio"), { recursive: true, force: true });
cpSync(path.join(DIR, "audio", VOICE), path.join(PROJ, "public", "audio"), {
  recursive: true,
});
copyFileSync(cuesPath, path.join(PROJ, "src", "cues.json"));
copyFileSync(voicePath, path.join(PROJ, "src", "voice.json"));

const framed = path.join(OUT_DIR, `.framed-${CUT}.mp4`);
const res = spawnSync(
  "npx",
  ["remotion", "render", "src/index.ts", "Landing", framed,
   "--codec=h264", "--crf=20", "--log=info"],
  { cwd: PROJ, stdio: "inherit" }
);
if (res.status !== 0) process.exit(res.status ?? 1);

const probe = (f) =>
  Number(
    execFileSync("ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", f],
      { encoding: "utf8" }).trim()
  );

const out = path.join(OUT_DIR, `landing-${CUT}.mp4`);
const bed = path.join(DIR, "music", "bed.mp3");
const dur = probe(framed);
const fadeAt = (dur - 1.2).toFixed(2);

if (existsSync(bed)) {
  // Music to a bed, ducked by the narration so it lifts between lines
  // instead of sitting flat under them, then summed back with the voice.
  execFileSync("ffmpeg", [
    "-y", "-v", "error",
    "-i", framed,
    "-i", bed,
    "-filter_complex",
    // -30dB, and ducked harder. At -19 the bed was competing with the
    // narration rather than sitting under it; a landing video is carried by
    // the voice, and music that you notice is music that is too loud.
    `[1:a]volume=-30dB,aloop=loop=-1:size=2e9,atrim=0:${dur.toFixed(3)}[bed];` +
      `[bed][0:a]sidechaincompress=threshold=0.02:ratio=12:attack=5:release=420[duck];` +
      `[duck][0:a]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,` +
      `afade=t=out:st=${fadeAt}:d=1.2[a]`,
    "-map", "0:v:0", "-map", "[a]",
    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
    out,
  ]);
} else {
  execFileSync("ffmpeg", [
    "-y", "-v", "error", "-i", framed,
    "-af", `afade=t=out:st=${fadeAt}:d=1.2`,
    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
    out,
  ]);
}
rmSync(framed, { force: true });

const dims = execFileSync("ffprobe",
  ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
   "-of", "csv=p=0", out], { encoding: "utf8" }).trim();
const size = execFileSync("du", ["-h", out], { encoding: "utf8" }).split("\t")[0];
console.log(
  `${dims}  ${probe(out).toFixed(1)}s  ${size}` +
    (existsSync(bed) ? "  (music ducked under the voice)" : "  (no music)")
);
