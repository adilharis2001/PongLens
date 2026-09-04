/**
 * Chapter 8 — "You and your coach". The only chapter that changes WHO is
 * signed in halfway through.
 *
 * Beat 1 is the player's side: the invite sheet, and the choice between one
 * match and everything. Then the capture signs in as the coach
 * (colbyassistant, an accepted all-matches coach on this account) and shows
 * the coach actually working — opening a point, drawing on a frame, saving
 * the note, the microphone beside it, and the overall review at the bottom
 * of the match. The last beat returns to the player and finds it in the
 * journal.
 *
 * The recorder re-arms its screencast on navigation, so the sign-ins are
 * invisible in the picture; each one hides inside the hold on the line
 * before it.
 *
 * This chapter genuinely writes: a note and a drawn frame from the coach,
 * plus an overall note. `guard` restores the columns and deletes the notes
 * afterwards. The drawing's image lands in R2 and is orphaned until the
 * retention sweep — the same trade the app makes for any deleted note.
 */

import { account, coach } from "../account.mjs";
export { account };
export const entry = "/match/a0fb8f44-89b1-464e-a2a5-388b502dbda5";
export const guard = "a0fb8f44-89b1-464e-a2a5-388b502dbda5";

const MATCH = "a0fb8f44-89b1-464e-a2a5-388b502dbda5";
const COACH = coach();
/** A point with a clip, mid-match so the timeline is interesting behind it. */
const POINT = 12;

const SUPABASE = "https://pdycinmyfnritemrsfjf.supabase.co";

/** A fresh single-use link, so the flow can change identity mid-capture. */
let coachLink = null;

async function magicLink(key, email, next, base) {
  const res = await fetch(`${SUPABASE}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "magiclink", email }),
  });
  const data = await res.json();
  if (!data.hashed_token) throw new Error(`magic link failed for ${email}`);
  return `${base}/auth/confirm?token_hash=${data.hashed_token}&type=email&next=${encodeURIComponent(next)}`;
}

const REST = `${SUPABASE}/rest/v1/`;
const api = async (key, path, init = {}) => {
  const res = await fetch(REST + path, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`supabase ${res.status}: ${await res.text()}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
};

/** The coach link this chapter creates, removed again by `cleanup`. */
let linkId = null;

export async function cleanup(key) {
  if (!linkId) return console.log("  no coach link to remove");
  await api(key, `coach_links?id=eq.${linkId}`, { method: "DELETE" });
  console.log("  removed the staged coach link");
}

export async function stage(key) {
  const base = process.env.BASE ?? "https://www.ponglens.com";

  // No coach on this account can actually see this match: the one accepted
  // link is scoped to a different match entirely. So the chapter grants the
  // access it is describing, and takes it back afterwards.
  const [player] = await api(key, `matches?id=eq.${MATCH}&select=user_id`);
  const coachUser = await fetch(
    `${SUPABASE}/auth/v1/admin/users?per_page=200`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  )
    .then((r) => r.json())
    .then((d) => d.users.find((u) => u.email === COACH));
  const [link] = await api(key, "coach_links", {
    method: "POST",
    body: JSON.stringify({
      player_id: player.user_id,
      coach_id: coachUser.id,
      scope_match_id: null,
      status: "accepted",
    }),
  });
  linkId = link.id;
  coachLink = await magicLink(key, COACH, `/match/${MATCH}?p=${POINT}`, base);
  // The player link is NOT made here: minting one for an account
  // invalidates any earlier link for the same account, and the driver mints
  // its own to sign in with straight after this runs. It is made at the
  // moment it is needed instead.
}

export async function prepare(page) {
  await page.waitForSelector("text=Coach", { timeout: 90000 });
  await page.waitForTimeout(2500);
}

export async function flow(page, clock, { beat, voice, union, dismiss, serviceKey, base }) {
  // ------------------------------------------------------- 1. the invite
  const b1 = beat("invite");
  await page.evaluate(() => {
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent.trim().startsWith("Coach"))
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  await clock.sleep(800);
  await clock.until(b1.start + 0.15);
  const row = await clock.rect({ text: "Coach", tag: "button", min: { w: 200 } });
  const c1 = clock.mark({ kind: "box", label: "Invite your coach", rect: row });
  await clock.until(b1.start + b1.dur * 0.5);
  clock.mark({
    kind: "tap",
    x: row.x + row.w / 2,
    y: row.y + row.h / 2,
    end: Number((clock.now() + 0.7).toFixed(3)),
  });
  // Closed BEFORE the click: leaving it up through the open animation left
  // a box hanging around a row that was no longer the subject.
  clock.close(c1);
  await page.evaluate(() =>
    window.__pick({ text: "Coach", tag: "button", min: { w: 200 } })?.click()
  );
  await page.waitForSelector("text=Share with coach", { timeout: 20000 });
  await clock.sleep(900);
  // [role=dialog] is the full-screen wrapper, not the panel — measuring it
  // drew a box round the whole phone while the sheet sat at the bottom.
  // The panel is what you can see: its heading down to its button.
  // Bounded: a bare text match walks up to the dialog wrapper, which
  // starts at y=0 and is the whole screen.
  const sheetTop = await clock.rect({
    text: "Share with coach",
    tag: "h2, h3",
    max: { h: 60 },
  });
  const sheetEnd = await clock.rect({ text: "Create invite link", tag: "button" });
  const c1b = clock.mark({
    kind: "box",
    label: "One match, or all of them",
    rect: {
      x: 16,
      y: sheetTop.y - 16,
      w: 358,
      h: sheetEnd.y + sheetEnd.h + 16 - (sheetTop.y - 16),
    },
  });
  await clock.until(b1.end);
  clock.close(c1b);

  // ------------------------------- become the coach, during the hold
  await page.goto(coachLink);
  await page.waitForSelector('[aria-label="Close point view"]', { timeout: 60000 });
  await clock.sleep(1500);

  // --------------------------------------------- 2. the same points
  const b2 = beat("sees");
  await clock.until(b2.start + 0.1);
  const clip = await clock.rect({
    sel: "video",
    within: { sel: '[role="dialog"]' },
    min: { w: 200, h: 90 },
  });
  const c2 = clock.mark({ kind: "box", label: "The coach's view", rect: clip });
  await clock.until(b2.end);
  clock.close(c2);

  // --------------------------------------------------- 3. draw on a frame
  const b3 = beat("draw");
  await page.evaluate(() => {
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent.trim().startsWith("Draw on this frame"))
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  await clock.sleep(900);
  await clock.until(b3.start + 0.1);
  const drawBtn = await clock.rect({ text: "Draw on this frame", tag: "button" });
  const c3 = clock.mark({
    kind: "box",
    label: "Draw on the frame",
    rect: { x: drawBtn.x - 8, y: drawBtn.y - 10, w: drawBtn.w + 16, h: drawBtn.h + 20 },
  });
  await clock.until(b3.start + 1.2);
  clock.close(c3);
  await page.evaluate(() =>
    window.__pick({ text: "Draw on this frame", tag: "button" })?.click()
  );
  await page.waitForSelector("text=Save", { timeout: 25000 });
  await clock.sleep(900);

  // An arrow across the table, drawn the way a coach would.
  const canvas = await clock.rect({ sel: "canvas", min: { w: 200, h: 120 } });
  const c3b = clock.mark({
    kind: "box",
    label: "Mark it up",
    rect: canvas,
  });
  const from = { x: canvas.x + canvas.w * 0.25, y: canvas.y + canvas.h * 0.7 };
  const to = { x: canvas.x + canvas.w * 0.72, y: canvas.y + canvas.h * 0.3 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 18 });
  await page.mouse.up();
  await clock.sleep(700);
  // Close it here: Save unmounts the annotator and the layout underneath
  // shifts, so a box measured on the canvas ends up outlining whatever
  // happens to land at those coordinates afterwards.
  clock.close(c3b);
  await page.evaluate(() =>
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent.trim() === "Save")
      ?.click()
  );
  // Saving the drawing only ATTACHES the frame to a DRAFT note. Until a
  // body is typed and Send is pressed there is no note row at all, which is
  // why the journal was empty at the last beat: the chapter was drawing a
  // picture and never posting it.
  await page.waitForSelector('img[alt="Annotated frame, attached to this note"]', {
    timeout: 30000,
  });
  await page.click('[placeholder="Add a note about this point"]').catch(() => {});
  await page.type(
    '[placeholder="Add a note about this point"]',
    "Hold your ground on the third ball instead of backing off.",
    { delay: 22 }
  );
  await page.evaluate(() =>
    window.__pick({ aria: "Send note", within: { sel: '[role="dialog"]' } })?.click()
  );
  await page.waitForSelector("text=Hold your ground on the third ball", {
    timeout: 30000,
  });
  await clock.sleep(400);
  // Re-measured against what is actually on screen now: the posted note.
  const posted = await clock.rect({
    text: "Hold your ground on the third",
    tag: "p, span, div",
  });
  const c3c = clock.mark({
    kind: "box",
    label: "On that exact point",
    rect: {
      x: 26,
      y: Math.max(posted.y - 34, 70),
      w: 338,
      h: Math.min(150, 820 - Math.max(posted.y - 34, 70)),
    },
  });
  await clock.until(b3.end);
  clock.close(c3c);

  // ------------------------------------------------- 4. or just say it
  const b4 = beat("audio");
  // The composer sits at the very bottom of the sheet, so the mic hangs a
  // few pixels below the fold until it is scrolled to.
  await page.evaluate(() => {
    document
      .querySelector('[role="dialog"] [aria-label="Record a voice note"]')
      ?.scrollIntoView({ block: "center" });
  });
  await clock.sleep(700);
  await clock.until(b4.start + 0.1);
  const mic = await clock.rect({
    aria: "Record a voice note",
    within: { sel: '[role="dialog"]' },
  });
  const c4 = clock.mark({
    kind: "box",
    label: "Or say it out loud",
    rect: { x: mic.x - 12, y: mic.y - 12, w: mic.w + 24, h: mic.h + 24 },
  });
  await clock.until(b4.end);
  clock.close(c4);

  // ------------------------------------------- 5. the overall review
  const b5 = beat("overall");
  await dismiss(page, {
    click: { aria: "Close point view" },
    gone: { aria: "Close point view" },
  });
  await clock.sleep(700);
  // Instant, not smooth: overall notes sit ~6000px down this match and a
  // smooth scroll of that distance is still travelling a second later, so
  // the rect gets measured while the page is nowhere near it.
  await page.evaluate(() => {
    [...document.querySelectorAll("h2")]
      .find((h) => h.textContent.trim().startsWith("Overall notes"))
      ?.scrollIntoView({ block: "start" });
    window.scrollBy(0, -74);
  });
  await clock.sleep(900);
  await clock.until(b5.start + 0.1);
  const overall = await clock.rect({ text: "Overall notes", tag: "h2" });
  const composer = await clock.rect({ aria: "Send note" });
  const c5 = clock.mark({
    kind: "box",
    label: "How the whole match went",
    rect: {
      x: 16,
      y: overall.y - 12,
      w: 358,
      h: composer.y + composer.h + 14 - (overall.y - 12),
    },
  });
  await clock.until(b5.end);
  clock.close(c5);

  // ------------------------------- back to the player, during the gap
  const playerLink = await magicLink(
    serviceKey,
    account,
    "/journal",
    base ?? "https://www.ponglens.com"
  );
  await page.goto(playerLink);
  await page.waitForSelector("text=Recollect", { timeout: 60000 });
  await clock.sleep(1600);

  // ------------------------------------------- 6. it lands in the journal
  const b6 = beat("lands");
  await clock.until(b6.start + 0.1);
  // Newest first, so the coach's note is at the top of the feed — but the
  // page can land mid-scroll after a sign-in, so put it back at the top.
  await page.evaluate(() => window.scrollTo(0, 0));
  await clock.sleep(700);
  // Wait for the note the coach just wrote, rather than assuming the feed
  // has caught up, and anchor on the body text — the feed's title line
  // format is not something to guess at.
  await page.waitForSelector("text=Hold your ground on the third ball", {
    timeout: 30000,
  });
  await page.evaluate(() => {
    [...document.querySelectorAll("p, span, div")]
      .find((e) => e.textContent.trim().startsWith("Hold your ground on the third"))
      ?.scrollIntoView({ block: "center" });
  });
  await clock.sleep(800);
  // Measure the card, not a guess: from the author line above the body to
  // the bottom of the drawn frame below it.
  const card = await page.evaluate(() => {
    const body = [...document.querySelectorAll("p, span, div")].find((e) =>
      e.textContent.trim().startsWith("Hold your ground on the third")
    );
    const box = body?.closest("li, article") ?? body?.parentElement?.parentElement;
    if (!box) return null;
    const r = box.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  if (!card) throw new Error("journal card not found");
  const top = Math.max(card.y - 8, 70);
  const c6 = clock.mark({
    kind: "box",
    label: "In your journal",
    rect: {
      x: Math.max(card.x - 8, 10),
      y: top,
      w: Math.min(card.w + 16, 370),
      h: Math.min(card.h + 16, 824 - top),
    },
  });
  await clock.until(b6.end);
  clock.close(c6);
  await clock.until(voice.total + 0.4);
}
