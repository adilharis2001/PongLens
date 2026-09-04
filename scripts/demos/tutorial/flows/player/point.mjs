/**
 * Chapter 4 — "Score a point". The point sheet on the Gui match.
 *
 * Shot on point 1, the only point in this match carrying BOTH a
 * how-it-ended answer and a why-you-lost answer, so the follow-ups are
 * on screen as real data rather than empty controls.
 *
 * The sheet scrolls, so the follow-up block is brought into view and
 * allowed to settle before it is measured — and the last beat closes the
 * sheet through the real Close control, proved shut, before pointing at
 * the analysis row underneath.
 */

import { makePlayerGuardAdapter } from "../../guard.mjs";
import {
  MATCH_ID,
  STAGED_POINTS,
  playerGuard,
  stageOriginal,
  tutorialApi,
} from "../../fixtures/player-match.mjs";

export { account } from "../account.mjs";
export const entry = "/match/efff9208-abf2-4a20-a498-18cc5a5130b3?p=3";
const GUI = MATCH_ID;
/**
 * The Gui match has the filled-in answers but NO drawable placement: every
 * point of it renders "a placement map couldn't be generated". So the map
 * and notes beats move to a match that has real geometry, and the chapter
 * changes match halfway through. Point 45 there is one of the few that
 * survives the trust gate, and its rally is a readable two-shot exchange
 * rather than the 30-plus stroke tangle most of the others draw.
 */
const MAPPED = GUI;
const MAPPED_POINT = 3;

export const guard = playerGuard;

export const POINT_NOTE = {
  pointId: STAGED_POINTS[2].id,
  body: "Caught flat on the wide backhand again. Split step earlier here.",
};

/**
 * No point on this match carries a note, so the notes beat would otherwise
 * point at an empty state. Stage one on the point we show. It is created
 * after the verified player snapshot. `cleanup` removes only this exact
 * author/match/point/body marker afterwards.
 */
export async function stagePointNote(
  key,
  {
    adapter = makePlayerGuardAdapter(key),
    request = tutorialApi,
  } = {},
) {
  await adapter.verifyOwner(playerGuard.ownerId, playerGuard.ownerEmail);
  const [match] = await request(
    key,
    `matches?id=eq.${MAPPED}&user_id=eq.${playerGuard.ownerId}&select=id,user_id`,
  );
  if (match?.id !== MAPPED || match.user_id !== playerGuard.ownerId) {
    throw new Error("approved player tutorial match is missing or changed owner");
  }
  const [point] = await request(
    key,
    `points?id=eq.${POINT_NOTE.pointId}&match_id=eq.${MAPPED}&select=id,match_id`,
  );
  if (point?.id !== POINT_NOTE.pointId || point.match_id !== MAPPED) {
    throw new Error("approved player tutorial point is missing or changed match");
  }
  await request(key, "notes", {
    method: "POST",
    body: JSON.stringify({
      match_id: MAPPED,
      point_id: POINT_NOTE.pointId,
      author_id: playerGuard.ownerId,
      body: POINT_NOTE.body,
    }),
  });
}

export async function stage(key) {
  await stageOriginal(key);
  await stagePointNote(key);
}

export async function cleanup(key, request = tutorialApi) {
  const filters = new URLSearchParams({
    match_id: `eq.${MAPPED}`,
    point_id: `eq.${POINT_NOTE.pointId}`,
    author_id: `eq.${playerGuard.ownerId}`,
    body: `eq.${POINT_NOTE.body}`,
  });
  await request(key, `notes?${filters}`, { method: "DELETE" });
}

export async function prepare(page) {
  await page.waitForSelector("text=Who won this point?", { timeout: 90000 });
  await page.waitForTimeout(2200);
}

/** The point sheet. Everything this chapter points at lives inside it, and
 *  the match page behind it holds duplicates of several of them. */
const SHEET = { sel: '[role="dialog"]' };

/** Bring an element to the middle of the sheet and let the scroll settle. */
async function centre(page, clock, text) {
  await page.evaluate((t) => {
    const el = [...document.querySelectorAll("span, p, h3")].find((e) =>
      e.textContent.trim().toLowerCase().startsWith(t.toLowerCase())
    );
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, text);
  await clock.sleep(950);
}

/**
 * Put a heading near the top of the screen rather than the middle, so the
 * block it introduces has room to sit fully in frame. Centring a 450px
 * section leaves half of it below the fold and the highlight gets cut.
 */
async function bringTop(page, clock, text) {
  await page.evaluate((t) => {
    const el = [...document.querySelectorAll("h1, h2, h3")].find((e) =>
      e.textContent.trim().toLowerCase().startsWith(t.toLowerCase())
    );
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, text);
  await clock.sleep(700);
  await page.evaluate(() => window.scrollBy({ top: -90, behavior: "smooth" }));
  await clock.sleep(500);
}

/** Last-resort trim so a box never draws off the edge of the screen. */
const fit = (r) => {
  const x = Math.max(r.x, 6);
  const y = Math.max(r.y, 6);
  return { x, y, w: Math.min(r.w, 384 - x), h: Math.min(r.h, 838 - y) };
};

/** A full-width row around a label, so a box is a row and not a word. */
const row = (r, pad = 10) => ({
  x: 24,
  y: r.y - pad,
  w: 342,
  h: r.h + pad * 2,
});

export async function flow(page, clock, { beat, voice, union, dismiss, sectionRect }) {
  // ------------------------------------------------------ 1. the rally
  const b1 = beat("open");
  await clock.until(b1.start + 0.2);
  const clip = await clock.rect({
    sel: "video",
    within: SHEET,
    min: { w: 200, h: 90 },
  });
  const c1 = clock.mark({ kind: "box", label: "This rally", rect: clip });
  await clock.until(b1.end);
  clock.close(c1);

  // ------------------------------------------------------ 2. who won it
  const b2 = beat("winner");
  await centre(page, clock, "Who won this point?");
  await clock.until(b2.start + 0.1);
  const q = await clock.rect({ text: "Who won this point?", tag: "h3" });
  const skip = await clock.rect({ text: "Skip", tag: "button", min: { w: 60 } });
  const c2 = clock.mark({
    kind: "box",
    label: "Who won it",
    rect: union(q, skip),
  });
  await clock.until(b2.end);
  clock.close(c2);

  // --------------------------------------- 3. how it ended, and why
  const b3 = beat("detail");
  await centre(page, clock, "Recorded earlier");
  await clock.until(b3.start + 0.1);
  const how = await clock.rect({ text: "Recorded earlier", tag: "span" });
  const c3 = clock.mark({ kind: "box", label: "How it ended", rect: row(how) });
  await clock.until(b3.start + b3.dur * 0.4);
  clock.close(c3);

  await centre(page, clock, "Why did you lose it?");
  const why = await clock.rect({ text: "Why did you lose it?", tag: "span" });
  const lastPill = await clock.rect({ text: "Lost focus", tag: "button" });
  const c3b = clock.mark({
    kind: "box",
    label: "Why you lost it",
    rect: union(row(why, 8), row(lastPill, 8)),
  });
  // The line is short, so its two boxes are short. The crossing to the
  // other match runs in the HOLD after the line rather than eating into
  // it — see the `pause` on this beat in the chapter script.
  await clock.until(b3.end);
  clock.close(c3b);
  // ------------------------------------ 4. and where those answers go
  const b4 = beat("feeds");
  await dismiss(page, {
    click: { aria: "Close point view" },
    gone: { text: "Who won this point?", tag: "h3" },
  });
  await clock.sleep(700);
  await page.evaluate(() => {
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent.trim().startsWith("Match analysis"))
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  await clock.sleep(800);
  await clock.until(b4.start + 0.1);
  const analysisRow = await clock.rect({ text: "Match analysis", tag: "button", min: { w: 200 } });
  const c4 = clock.mark({ kind: "box", label: "Feeds your analysis", rect: analysisRow });
  await clock.until(b4.end);
  clock.close(c4);

  await page.goto(`${new URL(page.url()).origin}/match/${MAPPED}?p=${MAPPED_POINT}`);
  await page.waitForSelector("text=Who won this point?", { timeout: 60000 });
  await clock.sleep(700);

  // ------------------------------------------- 5. the notes on the point
  const b5 = beat("notes");
  // Notes are fetched after the sheet paints, so wait for the staged one to
  // actually be on screen rather than assuming it arrived with the point.
  await page.waitForSelector("text=Caught flat", { timeout: 30000 });
  await centre(page, clock, "Caught flat");
  await clock.until(b5.start + 0.1);
  const c5 = clock.mark({
    kind: "box",
    label: "Notes on this point",
    rect: fit(await clock.rect({ sectionOf: "Notes", within: SHEET })),
  });
  await clock.until(b5.end);
  clock.close(c5);

  // --------------------------------------------- 6. repair the clip
  const b6 = beat("clip-tools");
  await clock.until(b6.start + 0.1);
  const modify = await clock.rect({ text: "Modify", tag: "button" });
  const remove = await clock.rect({ text: "Remove", tag: "button" });
  const c6 = clock.mark({ kind: "box", label: "Repair a bad cut", rect: union(modify, remove) });
  await clock.until(b6.start + Math.min(1.5, b6.dur * 0.45));
  await page.evaluate(() => window.__pick({ text: "Modify", tag: "button" })?.click());
  await page.waitForSelector("text=Split", { timeout: 20000 });
  await clock.sleep(500);
  const split = await clock.rect({ text: "Split", tag: "button" });
  const join = await clock.rect({ text: "Join", tag: "button" });
  const adjust = await clock.rect({ text: "Adjust", tag: "button" });
  clock.close(c6);
  const tools = clock.mark({ kind: "box", label: "Split, join, or adjust", rect: union(split, join, adjust) });
  await clock.until(b6.start + b6.dur * 0.55);
  clock.close(tools);

  // The missing-rally tool belongs to the full Score Keeper strip rather
  // than the point sheet. Open the real offer on a measured source gap, but
  // never press the sheet's Add rally mutation.
  await page.goto(`${new URL(page.url()).origin}/match/${MAPPED}`);
  await page.waitForSelector('[aria-label="Play the full video"]', { timeout: 60000 });
  await page.evaluate(() =>
    document.querySelector('[aria-label="Play the full video"]')?.click()
  );
  await page.waitForSelector("text=Score the Match", { timeout: 30000 });
  await page.click('button:has-text("Score the Match")');
  await page.waitForSelector('button[aria-label*="Add a missing rally"]', { timeout: 30000 });
  await page.evaluate(() =>
    document.querySelector('button[aria-label*="Add a missing rally"]')?.scrollIntoView({ block: "center" })
  );
  await clock.sleep(500);
  const missing = await clock.rect({ sel: 'button[aria-label*="Add a missing rally"]' });
  const missingMark = clock.mark({ kind: "box", label: "Put back a missed rally", rect: fit({
    x: missing.x - 8,
    y: missing.y - 8,
    w: missing.w + 16,
    h: missing.h + 16,
  }) });
  await page.click('button[aria-label*="Add a missing rally"]');
  await page.waitForSelector("text=Add a missing rally", { timeout: 20000 });
  await clock.sleep(450);
  clock.close(missingMark);
  const missingTitle = await clock.rect({ text: "Add a missing rally", tag: "h2" });
  const startHandle = await clock.rect({ aria: "Drag where the rally starts" });
  const missingSheet = clock.mark({
    kind: "box",
    label: "Choose the missing rally",
    rect: fit(union(missingTitle, startHandle)),
  });
  await clock.until(b6.end);
  clock.close(missingSheet);
  await clock.until(voice.total + 0.4);
}
