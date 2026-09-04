/** Chapter 7 — automatic highlights, collections, exports, and sharing. */
import {
  playerGuard,
  stageOriginal,
} from "../../fixtures/player-match.mjs";

export { account } from "../account.mjs";
export const entry = "/match/efff9208-abf2-4a20-a498-18cc5a5130b3";
export const guard = playerGuard;

const TAG = "backhand error";
const STAR_POINT = 3;
const TAG_POINT = 41;
const SHEET = { sel: '[role="dialog"]' };

/** Original media is disposable; all highlight/star/tag rows are fixtures. */
export async function stage(key) {
  await stageOriginal(key);
}

export async function prepare(page) {
  await page.waitForSelector("text=Highlights", { timeout: 60000 });
  await page.waitForTimeout(2200);
}

async function bring(page, clock, text) {
  await page.evaluate((target) => {
    [...document.querySelectorAll("h1, h2, h3")]
      .find((heading) => heading.textContent.trim().startsWith(target))
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, text);
  await clock.sleep(650);
  await page.evaluate(() => window.scrollBy({ top: -74, behavior: "smooth" }));
  await clock.sleep(400);
}

async function bringPoint(page, clock, point) {
  await page.evaluate((label) => document.querySelector(`[aria-label="${label}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }), `Open point ${point}`);
  await clock.sleep(800);
}

const pad = (rect) => ({ x: rect.x - 10, y: rect.y - 10, w: rect.w + 20, h: rect.h + 20 });

export async function flow(page, clock, { beat, voice, union, dismiss }) {
  const highlights = beat("highlights");
  await bring(page, clock, "Tools");
  await clock.until(highlights.start + 0.1);
  const highlightsRow = await clock.rect({ text: "Highlights", tag: "button", min: { w: 200 } });
  const highlightsMark = clock.mark({ kind: "box", label: "Made automatically", rect: highlightsRow });
  await clock.until(highlights.start + Math.min(1.5, highlights.dur * 0.45));
  await page.evaluate(() => window.__pick({ text: "Highlights", tag: "button", min: { w: 200 } })?.click());
  await page.waitForSelector("text=Short highlight", { timeout: 20000 });
  await clock.sleep(500);
  clock.close(highlightsMark);
  const shortHighlight = await clock.rect({ text: "Short highlight", tag: "button, h3, p" });
  const longHighlight = await clock.rect({ text: "Long highlight", tag: "button, h3, p" });
  const choices = clock.mark({ kind: "box", label: "Short or longer", rect: union(shortHighlight, longHighlight) });
  await clock.until(highlights.end);
  clock.close(choices);

  const actions = beat("highlight-actions");
  await page.evaluate(() => window.__pick({ text: "Short highlight", tag: "button" })?.click());
  await page.waitForSelector('[aria-label="Close player"]', { timeout: 20000 });
  await clock.sleep(450);
  await clock.until(actions.start + 0.1);
  const download = await clock.rect({ text: "Download", tag: "button" });
  const actionsMark = clock.mark({ kind: "box", label: "Watch, then download", rect: pad(download) });
  await clock.until(actions.end);
  clock.close(actionsMark);
  await page.evaluate(() => document.querySelector('[aria-label="Close player"]')?.click());
  await page.waitForFunction(() => !document.querySelector('[aria-label="Close player"]'), null, { timeout: 10000 });

  const stars = beat("stars");
  await bring(page, clock, "Points");
  await bringPoint(page, clock, STAR_POINT);
  await clock.until(stars.start + 0.1);
  const star = await clock.rect({ aria: "Remove star" });
  const starsMark = clock.mark({ kind: "box", label: "Your starred rallies", rect: pad(star) });
  await clock.until(stars.end);
  clock.close(starsMark);

  const tags = beat("tags");
  await bringPoint(page, clock, TAG_POINT);
  await clock.until(tags.start + 0.1);
  const tag = await clock.rect({ aria: `Tag point ${TAG_POINT}` });
  const tagsMark = clock.mark({ kind: "box", label: "Points under your own words", rect: pad(tag) });
  await clock.until(tags.end);
  clock.close(tagsMark);

  await bring(page, clock, "Tools");
  await page.evaluate(() => window.__pick({ text: "Export", tag: "button", min: { w: 200 } })?.click());
  await page.waitForSelector("text=Include score", { timeout: 20000 });
  await clock.sleep(400);

  const rows = beat("rows");
  await clock.until(rows.start + 0.1);
  const full = await clock.rect({ text: "Full match", tag: "div, p, span", within: SHEET });
  const tagRow = await clock.rect({ text: TAG, tag: "div, p, span", within: SHEET });
  const rowsMark = clock.mark({
    kind: "box",
    label: "Full match, stars, or one tag",
    rect: { x: 24, y: full.y - 12, w: 342, h: tagRow.y + tagRow.h + 12 - (full.y - 12) },
  });
  await clock.until(rows.end);
  clock.close(rowsMark);

  const score = beat("score");
  await clock.until(score.start + 0.1);
  const includeScore = await clock.rect({ text: "Include score", tag: "div", min: { w: 200, h: 50 }, max: { w: 380, h: 140 }, within: SHEET });
  const scoreMark = clock.mark({ kind: "box", label: "Add the running score", rect: includeScore });
  await clock.until(score.end);
  clock.close(scoreMark);
  await dismiss(page, { click: { aria: "Close" }, gone: { text: "Include score" } });

  const share = beat("share");
  await bring(page, clock, "Tools");
  await page.evaluate(() => window.__pick({ text: "Share", tag: "button", min: { w: 200 } })?.click());
  await page.waitForSelector("text=This match", { timeout: 20000 });
  await clock.sleep(400);
  await clock.until(share.start + 0.1);
  const publicLink = await clock.rect({ text: "This match", tag: "div, p, span, button", within: SHEET });
  const shareMark = clock.mark({ kind: "box", label: "A public link", rect: pad(publicLink) });
  await clock.until(share.end);
  clock.close(shareMark);
  await dismiss(page, { click: { aria: "Close" }, gone: { text: "This match" } });

  const original = beat("original");
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await clock.sleep(700);
  await clock.until(original.start + 0.1);
  const originalButton = await clock.rect({ text: "Original", tag: "button" });
  const originalMark = clock.mark({ kind: "box", label: "Original upload", rect: pad(originalButton) });
  await clock.until(original.end);
  clock.close(originalMark);
  await clock.until(voice.total + 0.4);
}
