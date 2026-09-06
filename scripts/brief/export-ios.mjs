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

const out = "ios/PongLens/PongLens/Resources";
for (const n of [1, 2, 3, 4, 5]) {
  const svg = readFileSync(`public/brief/p${n}.svg`, "utf8").replaceAll(
    "system-ui, -apple-system, sans-serif",
    "Helvetica Neue, Helvetica, Arial, sans-serif",
  );
  for (const scale of [2, 3]) {
    const png = await sharp(Buffer.from(svg), { density: 72 * scale * 2 })
      .resize(320 * scale, 240 * scale)
      .png({ compressionLevel: 9 })
      .toBuffer();
    writeFileSync(`${out}/brief-p${n}@${scale}x.png`, png);
  }
}
console.log("exported 10 files to", out);
