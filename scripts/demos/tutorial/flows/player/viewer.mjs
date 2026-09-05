/**
 * Chapter 3 — "Watch it back". The full-match player on the Gui match.
 *
 * The player is full-bleed (the video is the whole 390x844 viewport) with
 * its chrome floating on top, so every target here is a real control from
 * the probe rather than a guessed region. Gestures are performed for real
 * where the player supports them; the boxes mark the HALF of the screen the
 * gesture belongs to, because that is what a viewer has to learn.
 *
 * Starring writes a boolean the guard restores. Nothing else is written:
 * the note sheet is opened and closed without sending.
 */

import {
  MATCH_ID as MATCH,
  playerGuard,
  stageOriginal,
} from "../../fixtures/player-match.mjs";

export { account } from "../account.mjs";
export const entry = "/matches";
export const guard = [MATCH, playerGuard];

export async function stage(key) {
  await stageOriginal(key);
}

export async function prepare(page) {
  // Starts on the library, not inside a match: the chapter now explains
  // where a processed match actually turns up before opening one.
  await page.waitForSelector('a[href^="/match/"]', { timeout: 90000 });
  await page.waitForTimeout(2500);
  await page.goto(`${new URL(page.url()).origin}/match/${MATCH}`);
  await openPlayer(page);
}

/** Wait until the player is open and has real frames. */
async function openPlayer(page) {
  await page.waitForSelector('[aria-label="Play the full video"]', { timeout: 60000 });
  await page.waitForTimeout(900);
  await page.evaluate(() =>
    document.querySelector('[aria-label="Play the full video"]')?.click()
  );
  await page.waitForSelector('[aria-label="Close player"]', { timeout: 30000 });
  await page
    .waitForFunction(
      () => {
        const v = document.querySelector("video");
        return v && v.readyState >= 2 && v.videoWidth > 0;
      },
      { timeout: 30000 }
    )
    .catch(() => {});
  await page.waitForTimeout(900);
}

/**
 * Where the picture actually is.
 *
 * The <video> fills the whole 390x844 viewport but the footage letterboxes
 * inside it, so a "right half of the screen" box is mostly black bars. The
 * gesture belongs to the half of the PICTURE, which is what this measures
 * from the element size and the source aspect ratio.
 */
const pictureRect = (page) =>
  page.evaluate(() => {
    const v = document.querySelector("video");
    if (!v || !v.videoWidth) return null;
    const r = v.getBoundingClientRect();
    const scale = Math.min(r.width / v.videoWidth, r.height / v.videoHeight);
    const w = v.videoWidth * scale;
    const h = v.videoHeight * scale;
    return { x: r.x + (r.width - w) / 2, y: r.y + (r.height - h) / 2, w, h };
  });

/** Half of the picture, inset so the outline is never flush to the edge. */
const half = (pic, side) => ({
  x: side === "right" ? pic.x + pic.w / 2 + 4 : pic.x + 6,
  y: pic.y + 6,
  w: pic.w / 2 - 10,
  h: pic.h - 12,
});

export async function flow(page, clock, { beat, voice, union, dismiss }) {
  // prepare() opens the approved player fixture before the recording clock
  // starts, so the first narrated cue is not consumed by route/media setup.
  const pic = await pictureRect(page);
  if (!pic) throw new Error("video has no picture yet");
  const b1 = beat("open");
  await clock.until(b1.start + 0.2);
  await page.evaluate(() => {
    const v = document.querySelector("video");
    if (v?.paused) v.play().catch(() => {});
  });
  const c1 = clock.mark({ kind: "box", label: "Just the play", rect: pic });
  await clock.until(b1.end);
  clock.close(c1);

  // ------------------------------------------- 2. double tap either side
  const b2 = beat("taps");
  await clock.until(b2.start + 0.15);
  const right = clock.mark({ kind: "box", label: "Next point", rect: half(pic, "right") });
  await clock.until(b2.start + 1.6);
  clock.mark({ kind: "tap", x: pic.x + pic.w * 0.75, y: pic.y + pic.h / 2, end: Number((clock.now() + 0.6).toFixed(3)) });
  await page.evaluate(() => document.querySelector('[aria-label="Next point"]')?.click());
  await clock.until(b2.start + b2.dur * 0.6);
  clock.close(right);
  const left = clock.mark({ kind: "box", label: "Back a point", rect: half(pic, "left") });
  await clock.until(b2.end - 0.7);
  clock.mark({ kind: "tap", x: pic.x + pic.w * 0.25, y: pic.y + pic.h / 2, end: Number((clock.now() + 0.6).toFixed(3)) });
  await page.evaluate(() => document.querySelector('[aria-label="Previous point"]')?.click());
  await clock.until(b2.end - 0.65);
  clock.close(left);
  const middle = clock.mark({ kind: "box", label: "Replay this point", rect: {
    x: pic.x + pic.w / 3 + 4,
    y: pic.y + 6,
    w: pic.w / 3 - 8,
    h: pic.h - 12,
  } });
  await page.mouse.dblclick(pic.x + pic.w / 2, pic.y + pic.h / 2);
  await clock.until(b2.end);
  clock.close(middle);

  // ----------------------------------------- 3. hold right 2x, left 0.25x
  const b3 = beat("fast");
  await clock.until(b3.start + 0.15);
  const fast = clock.mark({ kind: "box", label: "Hold for 2x", rect: half(pic, "right") });
  await page.mouse.move(pic.x + pic.w * 0.75, pic.y + pic.h / 2);
  await page.mouse.down();
  await page.waitForFunction(
    (rate) => document.querySelector("video")?.playbackRate === rate,
    2,
    { timeout: 5000 },
  );
  await clock.until(b3.start + b3.dur * 0.47);
  await page.mouse.up();
  clock.close(fast);

  const slow = clock.mark({ kind: "box", label: "Hold for 0.25x", rect: half(pic, "left") });
  await page.mouse.move(pic.x + pic.w * 0.25, pic.y + pic.h / 2);
  await page.mouse.down();
  await page.waitForFunction(
    (rate) => document.querySelector("video")?.playbackRate === rate,
    0.25,
    { timeout: 5000 },
  );
  await clock.until(b3.end - 0.25);
  await page.mouse.up();
  await clock.until(b3.end);
  clock.close(slow);

  // ------------------------------------------------------------ 5. zoom
  const b5 = beat("zoom");
  await clock.until(b5.start + 0.15);
  const zoomIn = await clock.rect({ aria: "Zoom in" });
  const zoomOut = await clock.rect({ aria: "Zoom out" });
  const c5 = clock.mark({
    kind: "box",
    label: "Zoom the table",
    rect: union(zoomIn, zoomOut),
  });
  await clock.until(b5.start + 1.2);
  await page.evaluate(() => document.querySelector('[aria-label="Zoom in"]')?.click());
  await clock.sleep(700);
  await page.evaluate(() => document.querySelector('[aria-label="Zoom in"]')?.click());
  await clock.until(b5.end - 0.5);
  await page.evaluate(() => {
    document.querySelector('[aria-label="Zoom out"]')?.click();
    document.querySelector('[aria-label="Zoom out"]')?.click();
  });
  clock.close(c5);

  // ------------------------------------------------ 6. jump to any point
  const bj = beat("jump");
  await clock.until(bj.start + 0.15);
  const jump = await clock.rect({ aria: "Jump to a point" });
  const cj = clock.mark({
    kind: "box",
    label: "Go to any point",
    rect: { x: jump.x - 10, y: jump.y - 10, w: jump.w + 20, h: jump.h + 20 },
  });
  // The control is shown but NOT opened. Its grid is a sheet that Escape
  // does not close, and the only "Close" label in the tree belongs to the
  // player itself — clicking that shut the whole player and took the score
  // bug with it. A line about being able to jump does not need the jump.
  await clock.until(bj.end);
  clock.close(cj);

  // -------------------------------------------------- 7. star and note
  const b7 = beat("star");
  await clock.until(b7.start + 0.15);
  const star = await clock.rect({ aria: "Star this point" });
  const note = await clock.rect({ aria: "Add a note on this point" });
  const c7 = clock.mark({
    kind: "box",
    label: "Star or note it",
    rect: union(star, note),
  });
  await clock.until(b7.start + 1.3);
  clock.mark({
    kind: "tap",
    x: star.x + star.w / 2,
    y: star.y + star.h / 2,
    end: Number((clock.now() + 0.6).toFixed(3)),
  });
  await page.evaluate(() =>
    document.querySelector('[aria-label="Star this point"]')?.click()
  );
  await clock.until(b7.end);
  clock.close(c7);

  // ---------------------------------------- 8. the untouched upload
  const original = beat("original");
  await page.evaluate(() => document.querySelector('[aria-label="Close player"]')?.click());
  await page.waitForSelector("text=Original", { timeout: 20000 });
  await clock.sleep(600);
  await clock.until(original.start + 0.1);
  const originalButton = await clock.rect({ text: "Original", tag: "button" });
  const originalMark = clock.mark({
    kind: "box",
    label: "Watch the original upload",
    rect: { x: originalButton.x - 10, y: originalButton.y - 10, w: originalButton.w + 20, h: originalButton.h + 20 },
  });
  await clock.until(original.end);
  clock.close(originalMark);
  await clock.until(voice.total + 0.4);
}
