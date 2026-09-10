// The five recording-brief pictures are drawn once, as SVG in public/brief/,
// and the web shows those files directly. iOS cannot draw an SVG with
// filters, so this exports the same files as PNG at @2x and @3x for a
// 320×240pt picture, into the app's loose Resources folder.
//
//   node scripts/brief/export-ios.mjs
//
// sharp (libvips) is already a dependency of Next, so nothing new is needed.
// The only edit on the way through is the font stack: the SVGs ask for
// system-ui, which the browser resolves to San Francisco, and librsvg does
// not know that name, so the export asks for Helvetica instead. The labels
// are nine-point captions and the two are not told apart at that size.
import { readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";

// The p-numbers have a hole in them: p2 was "Keep the whole table in frame",
// deleted in September because its phone mock showed a camera square to the
// net and argued with p1's band. The survivors keep their names rather than
// shuffling up, so a stale reference points at nothing instead of quietly
// at the wrong picture.
// p* is the recording brief, a* the audio lesson, v* the lesson video.
const PAGES = ["p1", "p3", "p4", "p5", "a1", "a2", "a3", "v1", "v2", "v3"];
const out = "ios/PongLens/PongLens/Resources";
for (const n of PAGES) {
  const svg = readFileSync(`public/brief/${n}.svg`, "utf8").replaceAll(
    "system-ui, -apple-system, sans-serif",
    "Helvetica Neue, Helvetica, Arial, sans-serif",
  );
  // Each drawing states its own size, and they are no longer all 4:3 — p1
  // is taller so the band and its labels are not cropped. Exporting every
  // page at one hardcoded size squashed it.
  const [, , vw, vh] = /viewBox="([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)"/
    .exec(svg)
    .slice(1)
    .map(Number);
  for (const scale of [2, 3]) {
    const png = await sharp(Buffer.from(svg), { density: 72 * scale * 2 })
      .resize(Math.round(vw * scale), Math.round(vh * scale))
      .png({ compressionLevel: 9 })
      .toBuffer();
    writeFileSync(`${out}/brief-${n}@${scale}x.png`, png);
  }
}
console.log(`exported ${PAGES.length * 2} files to`, out);
