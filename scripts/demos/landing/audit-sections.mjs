/**
 * Prove that no section's screen is on display before its title card.
 *
 *   node scripts/demos/landing/audit-sections.mjs coach-desktop coach
 *
 * This exists because the leak it looks for is invisible to every other
 * check. A cue that fires late still fires; a flow that navigates early
 * still navigates; the logs are clean, the render succeeds, and the only
 * symptom is that the Score Keeper is on screen a second before the card
 * saying "Score the match". On the landing cut that ran from 0.35s to 2.6s
 * a section, across all seven of them, and it took someone watching frame
 * by frame to notice.
 *
 * The test is the one the eye does: at the moment the flow is off loading
 * the next screen, is the picture covered? The card paints the device area
 * flat --color-ink, so a covered frame has almost no variation in it and a
 * live app screen has plenty. Sampled through the whole gap rather than at
 * one instant, because a leak of a tenth of a second and a leak of two
 * seconds are the same bug caught at different moments.
 *
 * The section maths is deliberately a copy of Landing.tsx rather than an
 * import. An audit that shares its arithmetic with the thing it audits
 * agrees with it by construction, including where both are wrong.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CUT = process.argv[2] ?? "coach-desktop";
const VOICE = process.argv[3] ?? "coach";

const file = path.join(DIR, "out", `landing-${CUT}.mp4`);
const voicePath = path.join(DIR, "voice", `${VOICE}.json`);
for (const f of [file, voicePath]) {
  if (!existsSync(f)) throw new Error(`missing ${f}`);
}
const voice = JSON.parse(readFileSync(voicePath, "utf8"));

/** Landing.tsx: 40 frames of logo before the body starts. */
const FPS = 30;
const INTRO_S = 40 / FPS;

const SECTIONS = [];
for (const l of voice.lines) {
  const label = l.label ?? "";
  const last = SECTIONS[SECTIONS.length - 1];
  if (last && last.label === label) last.end = l.start + l.dur;
  else SECTIONS.push({ label, start: l.start, end: l.start + l.dur });
}

const CARD_HEAD = 0.05;
const CARD_TAIL = 0.15;
const CARD_MIN = 0.6;
const SEPARATOR_LEAD = 0.45;
const SEPARATOR_TAIL = 0.7;

/**
 * The separators, with the same extended hold the composition gives them.
 *
 * A section that begins right after a separator has no card of its own —
 * two full-frame titles in a row reads as a stutter — and the separator
 * holds until the next sentence instead. So the window to test for that
 * section is the separator's, not the sliver of gap left over after it.
 * Testing the sliver is what made this pass on 0.85s of nominal cover while
 * the thing actually doing the covering went unmeasured.
 */
const SEPARATORS = voice.lines
  .map((l, i) => {
    if (!l.separator) return null;
    const next = voice.lines[i + 1];
    return {
      label: l.separator,
      from: l.start - SEPARATOR_LEAD,
      to: Math.max(l.start + l.dur + SEPARATOR_TAIL, next ? next.start - CARD_TAIL : 0),
    };
  })
  .filter(Boolean);

const CARDS = SECTIONS.map((s, i) => {
  const from = (i > 0 ? SECTIONS[i - 1].end : 0) + CARD_HEAD;
  const to = s.start - CARD_TAIL;
  const held = SEPARATORS.find((sep) => from < sep.to && to > sep.from);
  return held
    ? { label: s.label, from: held.from, to: held.to, start: s.start, held: held.label }
    : { label: s.label, from, to, start: s.start, held: null };
})
  .filter((c) => c.label)
  // A card needs a real gap; a separator-held section is covered whatever
  // the gap behind it looks like.
  .filter((c) => c.held || c.to - c.from >= CARD_MIN);

/**
 * A downscaled grey frame, so a whole gap can be sampled without writing
 * anything to disk. 192x108 keeps a section title legible as variation
 * while making each read a few kilobytes.
 */
const W = 192;
const H = 108;
const frameAt = (t) =>
  execFileSync(
    "ffmpeg",
    ["-v", "error", "-ss", t.toFixed(3), "-i", file, "-frames:v", "1",
     "-vf", `scale=${W}:${H}`, "-f", "rawvideo", "-pix_fmt", "gray", "-"],
    { encoding: "buffer", maxBuffer: 1 << 22 }
  );

/**
 * How much is going on in the device area, ignoring the middle.
 *
 * The middle is where the card draws its own title, so measuring it would
 * make a working card look like a busy screen. Everything outside that band
 * is flat ink for as long as the card is up.
 */
const busy = (buf) => {
  const vals = [];
  for (let y = Math.round(H * 0.1); y < Math.round(H * 0.9); y++) {
    if (y > H * 0.36 && y < H * 0.64) continue; // the title's band
    for (let x = Math.round(W * 0.14); x < Math.round(W * 0.86); x++) {
      vals.push(buf[y * W + x]);
    }
  }
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const varr = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
  return Math.sqrt(varr);
};

/** Flat ink measures about 1; a live app screen runs well past 10. */
const COVERED = 4;
const STEP = 0.2;
/**
 * The card's own fades are not leaks.
 *
 * SectionCard comes up over 4 frames and goes out over 5, so the frames at
 * either end of the window are a part-opaque card over a live screen and
 * measure exactly like the bug. Skipping them is not weakening the test:
 * the claim being checked is that the flow's navigation happens behind the
 * card, and the flow does not move for another two seconds. What the fade
 * buys is that the previous section's screen does not vanish the instant
 * its sentence stops, which is worth having and would look like a defect
 * to a test that demanded ink from the first frame.
 */
const FADE_CARD = 0.25;
/** A separator fades over ten frames at each end, not four. */
const FADE_SEP = 0.45;

let leaks = 0;
const held = CARDS.filter((c) => c.held).length;
console.log(
  `${path.basename(file)} — ${CARDS.length - held} section cards` +
    (held ? `, ${held} held by a separator` : "") +
    "\n"
);
for (const c of CARDS) {
  const fade = c.held ? FADE_SEP : FADE_CARD;
  const samples = [];
  for (let t = c.from + fade; t < c.to - fade; t += STEP) samples.push(t);
  samples.push(c.to - fade);

  let firstLeak = null;
  for (const t of samples) {
    const b = busy(frameAt(t + INTRO_S));
    if (b > COVERED && firstLeak === null) firstLeak = { t, b };
  }
  // And the other half of the claim: the screen IS there once the card goes.
  const after = busy(frameAt(c.start + 0.4 + INTRO_S));

  const cover = (c.to - c.from).toFixed(2) + "s" + (c.held ? ` by "${c.held}"` : "");
  if (firstLeak) {
    leaks += 1;
    const early = (c.start - firstLeak.t).toFixed(2);
    console.log(
      `  LEAK  ${c.label.padEnd(24)} covered ${cover}, but the screen shows ` +
        `${early}s early (variation ${firstLeak.b.toFixed(1)} at ${firstLeak.t.toFixed(2)}s)`
    );
  } else if (after <= COVERED) {
    console.log(
      `  ?     ${c.label.padEnd(24)} covered ${cover}, but nothing is on screen ` +
        `after it either (variation ${after.toFixed(1)})`
    );
  } else {
    console.log(`  ok    ${c.label.padEnd(24)} covered ${cover}, screen up on cue`);
  }
}
console.log(`\n${leaks === 0 ? "no leaks" : `${leaks} leaking section(s)`}`);
process.exit(leaks === 0 ? 0 : 1);
