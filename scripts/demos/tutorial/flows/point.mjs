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

export { account } from "./account.mjs";
export const entry = "/match/a0fb8f44-89b1-464e-a2a5-388b502dbda5?p=1";
const GUI = "a0fb8f44-89b1-464e-a2a5-388b502dbda5";
/**
 * The Gui match has the filled-in answers but NO drawable placement: every
 * point of it renders "a placement map couldn't be generated". So the map
 * and notes beats move to a match that has real geometry, and the chapter
 * changes match halfway through. Point 45 there is one of the few that
 * survives the trust gate, and its rally is a readable two-shot exchange
 * rather than the 30-plus stroke tangle most of the others draw.
 */
const MAPPED = "5bd279f4-aae2-46b1-9d87-0fdd0a6b348a";
const MAPPED_POINT = 30;

export const guard = [GUI, MAPPED];

const SUPA = "https://pdycinmyfnritemrsfjf.supabase.co/rest/v1/";
const api = async (key, path, init = {}) => {
  const res = await fetch(SUPA + path, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`supabase ${res.status}: ${await res.text()}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
};

/**
 * No point on this match carries a note, so the notes beat would otherwise
 * point at an empty state. Stage one on the point we show. It is created
 * after the guard snapshot, so the delete pass removes it afterwards.
 */
export async function stage(key) {
  const pts = (
    await api(key, `points?match_id=eq.${MAPPED}&select=id,t0,idx,deleted&order=t0`)
  ).filter((p) => !p.deleted);
  const point = pts[MAPPED_POINT - 1];
  const [match] = await api(key, `matches?id=eq.${MAPPED}&select=user_id`);
  await api(key, "notes", {
    method: "POST",
    body: JSON.stringify({
      match_id: MAPPED,
      point_id: point.id,
      author_id: match.user_id,
      body: "Caught flat on the wide backhand again. Split step earlier here.",
    }),
  });
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
  const crossing = page.goto(
    `${new URL(page.url()).origin}/match/${MAPPED}?p=${MAPPED_POINT}`
  );

  // ---------------------------------- 4. where the ball actually went
  const b4 = beat("map");
  await crossing;
  await page.waitForSelector("text=carried to the end", { timeout: 60000 });
  await clock.sleep(700);
  await bringTop(page, clock, "Where the ball landed");
  await clock.until(b4.start + 0.1);
  // The table is not an SVG (it is laid out in DOM), so measure the whole
  // section from its heading to the next one rather than hunting a shape.
  const c4 = clock.mark({
    kind: "box",
    label: "The rally, traced",
    rect: fit(
      await clock.rect({ sectionOf: "Where the ball landed", within: SHEET })
    ),
  });
  await clock.until(b4.end);
  clock.close(c4);

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

  // ------------------------------------ 6. and where those answers go
  const b6 = beat("feeds");
  await dismiss(page, {
    click: { aria: "Close point view" },
    gone: { text: "Who won this point?", tag: "h3" },
  });
  await clock.sleep(700);
  await page.evaluate(() => {
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent.trim().startsWith("Match analysis"))
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  await clock.sleep(900);
  await clock.until(b6.start + 0.1);
  const analysisRow = await clock.rect({
    text: "Match analysis",
    tag: "button",
    min: { w: 200 },
  });
  const c6 = clock.mark({
    kind: "box",
    label: "It fills this in",
    rect: analysisRow,
  });
  await clock.until(b6.end);
  clock.close(c6);
  await clock.until(voice.total + 0.4);
}
