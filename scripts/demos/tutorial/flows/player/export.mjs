/**
 * Chapter 7 — "Export and share". The Gui match.
 *
 * Starring and tagging are folded in here rather than given a chapter of
 * their own, because on their own they are just labels; what makes them
 * worth knowing is that each becomes its own export.
 *
 * The match has no stars and no tags, so `stage` puts three of each on it
 * and the guard takes them all back afterwards — starred is a column it
 * restores, the tag applications and the tag itself are deletes.
 *
 * Nothing here presses Create (that queues a render on the Mac) and
 * nothing creates a share link; the sheets are opened and read, then
 * closed through their real controls.
 */

export { account } from "../account.mjs";
export const entry = "/match/a0fb8f44-89b1-464e-a2a5-388b502dbda5";
export const guard = "a0fb8f44-89b1-464e-a2a5-388b502dbda5";

/** Matches the example the narration gives, so voice and screen agree. */
const TAG = "backhand loop";
const STAR_POINTS = [3, 17, 41];
const TAG_POINTS = [8, 22, 35];

const SUPA = "https://pdycinmyfnritemrsfjf.supabase.co/rest/v1/";
const api = async (key, path, init = {}) => {
  const res = await fetch(SUPA + path, {
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

export async function stage(key) {
  const pts = (
    await api(key, `points?match_id=eq.${guard}&select=id,t0,deleted&order=t0`)
  ).filter((p) => !p.deleted);
  const [match] = await api(key, `matches?id=eq.${guard}&select=user_id`);

  for (const n of STAR_POINTS) {
    await api(key, `points?id=eq.${pts[n - 1].id}`, {
      method: "PATCH",
      body: JSON.stringify({ starred: true }),
    });
  }
  const [tag] = await api(key, "tags", {
    method: "POST",
    body: JSON.stringify({ owner_id: match.user_id, label: TAG }),
  });
  for (const n of TAG_POINTS) {
    await api(key, "point_tags", {
      method: "POST",
      body: JSON.stringify({
        point_id: pts[n - 1].id,
        tag_id: tag.id,
        created_by: match.user_id,
      }),
    });
  }
}

export async function prepare(page) {
  await page.waitForSelector("text=Export", { timeout: 60000 });
  await page.waitForTimeout(2500);
}

const SHEET = { sel: '[role="dialog"]' };

/** Scroll a point's card into the middle of the screen and let it settle. */
async function bringPoint(page, clock, n) {
  await page.evaluate((label) => {
    document.querySelector(`[aria-label="${label}"]`)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, `Open point ${n}`);
  await clock.sleep(900);
}

async function bring(page, clock, text) {
  await page.evaluate((t) => {
    [...document.querySelectorAll("h1, h2, h3")]
      .find((h) => h.textContent.trim().toLowerCase().startsWith(t.toLowerCase()))
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, text);
  await clock.sleep(650);
  await page.evaluate(() => window.scrollBy({ top: -74, behavior: "smooth" }));
  await clock.sleep(450);
}

export async function flow(page, clock, { beat, voice, union, dismiss }) {
  // --------------------------------------------------- 1. starred rallies
  const b1 = beat("stars");
  await bring(page, clock, "Points");
  await bringPoint(page, clock, STAR_POINTS[0]);
  await clock.until(b1.start + 0.15);
  const star = await clock.rect({ aria: "Remove star" });
  const c1 = clock.mark({
    kind: "box",
    label: "Star the good ones",
    rect: { x: star.x - 10, y: star.y - 10, w: star.w + 20, h: star.h + 20 },
  });
  await clock.until(b1.end);
  clock.close(c1);

  // ---------------------------------------------------------- 2. tagging
  const b2 = beat("tags");
  await bringPoint(page, clock, TAG_POINTS[0]);
  await clock.until(b2.start + 0.15);
  // The timeline card shows a tag GLYPH, not the label — the label itself
  // turns up later, as its own row in the export sheet.
  const chip = await clock.rect({ aria: `Tag point ${TAG_POINTS[0]}` });
  const c2 = clock.mark({
    kind: "box",
    label: "Your own label",
    rect: { x: chip.x - 10, y: chip.y - 10, w: chip.w + 20, h: chip.h + 20 },
  });
  await clock.until(b2.end);
  clock.close(c2);

  // ------------------------------------------------- 3. open the exports
  const b3 = beat("open");
  await bring(page, clock, "Tools");
  await clock.until(b3.start + 0.15);
  const row = await clock.rect({ text: "Export", tag: "button", min: { w: 200 } });
  const c3 = clock.mark({ kind: "box", label: "Export", rect: row });
  await clock.until(b3.start + b3.dur * 0.5);
  clock.mark({
    kind: "tap",
    x: row.x + row.w / 2,
    y: row.y + row.h / 2,
    end: Number((clock.now() + 0.7).toFixed(3)),
  });
  clock.close(c3);
  await page.evaluate(() =>
    window.__pick({ text: "Export", tag: "button", min: { w: 200 } })?.click()
  );
  await page.waitForSelector("text=Include score", { timeout: 20000 });
  await clock.until(b3.end);

  // ------------------------------------------------ 4. burn in the score
  const b4 = beat("score");
  await clock.until(b4.start + 0.15);
  const toggle = await clock.rect({
    text: "Include score",
    tag: "div",
    min: { w: 200, h: 50 },
    max: { w: 380, h: 140 },
    within: SHEET,
  });
  const c4 = clock.mark({ kind: "box", label: "Burn in the score", rect: toggle });
  await clock.until(b4.end);
  clock.close(c4);

  // --------------------------------------------- 5. what you can render
  const b5 = beat("rows");
  await clock.until(b5.start + 0.15);
  const full = await clock.rect({ text: "Full match", tag: "div, p, span", within: SHEET });
  const tagRow = await clock.rect({ text: TAG, tag: "div, p, span", within: SHEET });
  const c5 = clock.mark({
    kind: "box",
    label: "All of it, or a slice",
    rect: {
      x: 24,
      y: full.y - 14,
      w: 342,
      h: tagRow.y + tagRow.h + 14 - (full.y - 14),
    },
  });
  // Create is never pressed — it queues a render on the Mac worker.
  await clock.until(b5.end);
  clock.close(c5);
  await dismiss(page, {
    click: { aria: "Close" },
    gone: { text: "Include score" },
  });
  await clock.sleep(500);

  // ------------------------------------------------------- 6. a link
  const b6 = beat("share");
  await bring(page, clock, "Tools");
  await clock.until(b6.start + 0.1);
  await page.evaluate(() =>
    window.__pick({ text: "Share", tag: "button", min: { w: 200 } })?.click()
  );
  await page.waitForSelector("text=This match", { timeout: 20000 });
  await clock.sleep(800);
  const link = await clock.rect({ text: "This match", tag: "div, p, span, button", within: SHEET });
  const c6 = clock.mark({
    kind: "box",
    label: "Anyone can watch it",
    rect: { x: 24, y: link.y - 14, w: 342, h: link.h + 28 },
  });
  await clock.until(b6.end);
  clock.close(c6);
  await clock.until(voice.total + 0.4);
}
