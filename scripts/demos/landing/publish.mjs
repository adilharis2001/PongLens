/**
 * Put a rendered cut on the site.
 *
 *   node scripts/demos/landing/publish.mjs coach-desktop coach-desktop
 *   node scripts/demos/landing/publish.mjs coach-mobile   coach-mobile
 *
 * Takes out/landing-<cut>.mp4 and writes public/demo/<name>.mp4 plus its
 * poster. Two things happen on the way:
 *
 * WEIGHT. The Remotion render is about 1.4 Mbps, which is 23MB for a two
 * minute cut, and these files are committed — they ride along in every
 * deploy forever. The landing cuts ship at about 800 kbps and that is the
 * number matched here. CRF with a ceiling rather than a fixed bitrate, so a
 * still section costs nothing and the rallies get the bits.
 *
 * THE POSTER. It is the title card, not a frame from the middle. The landing
 * page deliberately masks it with a black idle cover and one centred play
 * control, but the branded frame still represents the file in other media
 * surfaces and appears immediately once playback begins.
 *
 * faststart matters more than it looks: without it the moov atom is at the
 * end of the file and the browser downloads the whole thing before the
 * first frame paints, which on a 10MB file is the difference between a
 * video that starts and a video that hangs.
 */

import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CUT = process.argv[2];
const NAME = process.argv[3] ?? CUT;
if (!CUT) {
  console.error("usage: publish.mjs <cut> [name]");
  process.exit(1);
}

const src = path.join(DIR, "out", `landing-${CUT}.mp4`);
if (!existsSync(src)) throw new Error(`no render at ${src}`);
const outDir = path.join(DIR, "..", "..", "..", "public", "demo");
const mp4 = path.join(outDir, `${NAME}.mp4`);
const jpg = path.join(outDir, `${NAME}.jpg`);

const mb = (f) => (statSync(f).size / 1e6).toFixed(1);

// The intro card holds for 40 frames at 30fps; 0.9s is inside it with room
// on either side, so this cannot land on the dissolve into the first shot.
execFileSync("ffmpeg", [
  "-nostdin", "-v", "error", "-y",
  "-ss", "0.9", "-i", src, "-frames:v", "1", "-q:v", "4", jpg,
]);

execFileSync("ffmpeg", [
  "-nostdin", "-v", "error", "-y",
  "-i", src,
  "-c:v", "libx264",
  "-crf", "26",
  "-maxrate", "1000k",
  "-bufsize", "2000k",
  "-preset", "slow",
  "-profile:v", "high",
  "-pix_fmt", "yuv420p",
  "-movflags", "+faststart",
  "-c:a", "aac", "-b:a", "96k",
  mp4,
]);

const rate = execFileSync(
  "ffprobe",
  ["-v", "error", "-show_entries", "format=bit_rate", "-of", "default=nw=1:nk=1", mp4],
  { encoding: "utf8" }
).trim();
console.log(
  `${path.relative(process.cwd(), mp4)}  ${mb(src)}MB -> ${mb(mp4)}MB  ` +
    `(${Math.round(Number(rate) / 1000)} kbps)  + poster ${mb(jpg)}MB`
);
