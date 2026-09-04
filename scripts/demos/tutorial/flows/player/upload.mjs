/**
 * Chapter 2 — "Upload a match".
 *
 * READ ONLY. The chapter shows both web upload choices without choosing a
 * file or queuing a YouTube import. Processing settings are real controls,
 * but they are left untouched. Native recording footage is inserted by the
 * iOS capture task rather than being simulated in this browser flow.
 */

export { account } from "../account.mjs";
export const entry = "/upload";

export async function prepare(page) {
  await page.waitForSelector("text=Upload a match", { timeout: 60000 });
  await page.waitForSelector("text=Import from YouTube", { timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
}

async function bring(page, clock, text) {
  await page.evaluate((target) => {
    [...document.querySelectorAll("h1, h2, h3")]
      .find((node) => node.textContent.trim().startsWith(target))
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, text);
  await clock.sleep(650);
  await page.evaluate(() => window.scrollBy({ top: -74, behavior: "smooth" }));
  await clock.sleep(450);
}

const padded = (rect, pad = 10) => ({
  x: rect.x - pad,
  y: rect.y - pad,
  w: rect.w + pad * 2,
  h: rect.h + pad * 2,
});

export async function flow(page, clock, { beat, voice, union, dismiss }) {
  const header = beat("header");
  await clock.until(header.start + 0.2);
  const title = await clock.rect({ sel: "main h1" });
  const intro = await clock.rect({ sel: "main h1 + p" });
  const headerMark = clock.mark({ kind: "box", label: "Start with a video", rect: union(title, intro) });
  await clock.until(header.end);
  clock.close(headerMark);

  const options = beat("upload-options");
  await bring(page, clock, "Upload a match");
  await clock.until(options.start + 0.1);
  const choose = await clock.rect({ text: "Choose a video", tag: "button" });
  const youtube = await clock.rect({ text: "Import from YouTube", tag: "h2" });
  const optionsMark = clock.mark({
    kind: "box",
    label: "File or YouTube link",
    rect: { x: 18, y: choose.y - 14, w: 354, h: youtube.y + youtube.h + 14 - (choose.y - 14) },
  });
  await clock.until(options.end);
  clock.close(optionsMark);

  const guide = beat("guide");
  await clock.until(guide.start + 0.1);
  const guideButton = await clock.rect({ text: "How to record", tag: "button" });
  const guideMark = clock.mark({ kind: "box", label: "Camera setup", rect: padded(guideButton) });
  await clock.until(guide.start + Math.min(1.6, guide.dur * 0.55));
  await page.evaluate(() => window.__pick({ text: "How to record", tag: "button" })?.click());
  await page.waitForSelector("text=Where to put the camera", { timeout: 15000 });
  await clock.sleep(500);
  await clock.until(guide.end - 0.4);
  clock.close(guideMark);
  await dismiss(page, { click: { text: "Got it", tag: "button" }, gone: { text: "Where to put the camera" } });

  const duration = beat("duration-limit");
  await clock.until(duration.start + 0.1);
  const limit = await clock.rect({ text: "MP4 or MOV, up to 45 minutes.", tag: "p" });
  const durationMark = clock.mark({ kind: "box", label: "Up to 45 minutes", rect: padded(limit) });
  await clock.until(duration.end);
  clock.close(durationMark);

  const details = beat("details");
  await page.goto(`${new URL(page.url()).origin}/match/efff9208-abf2-4a20-a498-18cc5a5130b3`);
  await page.waitForSelector("text=Match details", { timeout: 60000 });
  await page.evaluate(() => {
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent.trim().startsWith("Match details"))
      ?.click();
  });
  await page.waitForSelector('[aria-label="Opponent name"]', { timeout: 20000 });
  await clock.sleep(600);
  await clock.until(details.start + 0.1);
  const opponent = await clock.rect({ aria: "Opponent name" });
  const venue = await clock.rect({ aria: "Venue" });
  const session = await clock.rect({ text: "league", tag: "button" });
  const detailsMark = clock.mark({
    kind: "box",
    label: "Who, where, and what kind",
    rect: union(opponent, venue, session),
  });
  await clock.until(details.end);
  clock.close(detailsMark);

  const processing = beat("processing-options");
  await page.goto(`${new URL(page.url()).origin}/upload`);
  await page.waitForSelector('[aria-label="Process when the upload finishes"]', { timeout: 60000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await clock.sleep(600);
  await clock.until(processing.start + 0.1);
  const breakIntoPoints = await clock.rect({ aria: "Process when the upload finishes" });
  const placements = await clock.rect({ aria: "Placement maps" });
  const processingMark = clock.mark({
    kind: "box",
    label: "Points and placement maps",
    rect: union(breakIntoPoints, placements),
  });
  await clock.until(processing.end);
  clock.close(processingMark);

  const outro = beat("outro");
  await clock.until(outro.start + 0.1);
  const processingMark2 = clock.mark({
    kind: "box",
    label: "Process after upload",
    rect: union(breakIntoPoints, placements),
  });
  await clock.until(outro.end);
  clock.close(processingMark2);
  await clock.until(voice.total + 0.4);
}
