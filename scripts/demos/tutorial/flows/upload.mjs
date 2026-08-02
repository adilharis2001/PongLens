/**
 * Chapter 2 — "Upload a match".
 *
 * This chapter WRITES, and it is the only one that starts real work: it
 * pastes a YouTube link and presses Import, which inserts a `jobs` row, and
 * a database trigger drops a message on the queue the Mac worker polls
 * every fifteen seconds. That is the point — the queued state and the
 * details form that fills itself in are what the last two lines describe,
 * and neither exists without a real import.
 *
 * `cleanup` below deletes the job and purges its queue message immediately
 * after the capture, so the worker does not spend a full download and
 * pipeline run on a throwaway. It races the poll; see the notes there.
 */

export { account } from "./account.mjs";
export const entry = "/upload";

/** The match Adil supplied for this: the same footage as the Gui match. */
const YT = "youtu.be/m_3fX8dFclQ";

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

/** Jobs that existed before the capture, so cleanup only removes ours. */
let jobsBefore = new Set();

export async function stage(key) {
  const rows = await api(key, "jobs?select=id&kind=eq.youtube_import");
  jobsBefore = new Set(rows.map((r) => r.id));
}

export async function cleanup(key) {
  const rows = await api(
    key,
    "jobs?select=id,status,input_path&kind=eq.youtube_import&order=created_at.desc&limit=5"
  );
  const mine = rows.filter((r) => !jobsBefore.has(r.id));
  for (const job of mine) {
    // Any match the worker already created from it goes first (points and
    // media cascade from the match row).
    const matches = await api(key, `matches?select=id&job_id=eq.${job.id}`);
    for (const m of matches) {
      await api(key, `matches?id=eq.${m.id}`, { method: "DELETE" });
      console.log(`  deleted match created by the capture (${m.id.slice(0, 8)})`);
    }
    await api(key, `jobs?id=eq.${job.id}`, { method: "DELETE" });
    console.log(`  deleted import job ${job.id.slice(0, 8)} (was ${job.status})`);
  }
  if (mine.length === 0) console.log("  no import job to clean up");
}

export async function prepare(page) {
  await page.waitForSelector("text=Import from YouTube", { timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
}

/** Scroll a heading to the top of the viewport, clear of the app header. */
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

export async function flow(page, clock, { beat, voice, union, dismiss, sectionRect }) {
  // ---------------------------------------------------- 1. the tab itself
  const b1 = beat("header");
  await clock.until(b1.start + 0.3);
  const header = await clock.rect({ sel: "main h1" });
  const intro = await clock.rect({ sel: "main p" });
  const c1 = clock.mark({ kind: "box", label: "Upload", rect: union(header, intro) });
  await clock.until(b1.end);
  clock.close(c1);

  // ------------------------------------------------- 2. how to record
  const b2 = beat("guide");
  await clock.until(b2.start + 0.15);
  const guide = await clock.rect({ text: "How to record", tag: "button" });
  const c2 = clock.mark({ kind: "box", label: "Camera setup", rect: guide });
  await clock.until(b2.start + 1.9);
  clock.mark({
    kind: "tap",
    x: guide.x + guide.w / 2,
    y: guide.y + guide.h / 2,
    end: Number((clock.now() + 0.7).toFixed(3)),
  });
  clock.close(c2);
  await page.evaluate(() =>
    window.__pick({ text: "How to record", tag: "button" })?.click()
  );
  await page.waitForSelector("text=Where to put the camera", { timeout: 15000 });
  await clock.until(b2.end - 0.9);
  await dismiss(page, {
    click: { text: "Got it", tag: "button" },
    gone: { text: "Where to put the camera" },
  });

  // ---------------------------------------------------- 3. pick a video
  const b3 = beat("dropzone");
  await clock.until(b3.start + 0.15);
  const drop = await clock.rect({ sel: "main div.border-dashed" });
  const c3 = clock.mark({
    kind: "box",
    label: "MP4 or MOV, up to 2 GB",
    rect: drop,
  });
  await clock.until(b3.end);
  clock.close(c3);

  // -------------------------------- 4. or a YouTube link, for real
  const b4 = beat("youtube");
  await bring(page, clock, "Import from YouTube");
  await clock.until(b4.start + 0.2);
  const field = await clock.rect({
    sel: 'input[placeholder="Paste a YouTube link"]',
  });
  const c4 = clock.mark({ kind: "box", label: "Paste a link", rect: field });
  await clock.until(b4.start + 1.2);
  await page.click('input[placeholder="Paste a YouTube link"]');
  await page.type('input[placeholder="Paste a YouTube link"]', YT, { delay: 55 });
  await clock.until(b4.end - 0.4);
  clock.close(c4);

  // Press Import. Everything after this beat is the real queued state.
  const importBtn = await clock.rect({ text: "Import", tag: "button" });
  clock.mark({
    kind: "tap",
    x: importBtn.x + importBtn.w / 2,
    y: importBtn.y + importBtn.h / 2,
    end: Number((clock.now() + 0.7).toFixed(3)),
  });
  await page.evaluate(() => window.__pick({ text: "Import", tag: "button" })?.click());
  await page.waitForSelector("text=We're fetching it", { timeout: 45000 });
  await clock.sleep(900);

  // -------------------------------------------- 5. fill in the details
  const b5 = beat("details");
  await bring(page, clock, "Import from YouTube");
  await clock.until(b5.start + 0.1);
  // Box the fields the line actually names, not "heading down to wherever":
  // this card has no heading after it, so sectionRect falls back to a fixed
  // 220px and cuts off mid-form.
  const opponent = await clock.rect({ sel: 'input[placeholder="Opponent name"]' });
  const kind = await clock.rect({ text: "Tournament", tag: "button" });
  const c5 = clock.mark({
    kind: "box",
    label: "Who, where, what kind",
    rect: {
      x: 24,
      y: opponent.y - 12,
      w: 342,
      h: kind.y + kind.h + 12 - (opponent.y - 12),
    },
  });
  // Type an opponent so the form is seen being used, not just sitting there.
  await clock.until(b5.start + 1.4);
  await page.click('input[placeholder="Opponent name"]').catch(() => {});
  await page.type('input[placeholder="Opponent name"]', "Alex", { delay: 90 });
  await clock.until(b5.end);
  clock.close(c5);

  // ------------------------------------------------------------ 6. outro
  const b6 = beat("outro");
  await clock.until(b6.start + 0.1);
  const promise = await clock.rect({ text: "You'll get an email", tag: "p" });
  const c6 = clock.mark({
    kind: "box",
    label: "Then it emails you",
    rect: { x: 24, y: promise.y - 10, w: 342, h: promise.h + 20 },
  });
  await clock.until(b6.end);
  clock.close(c6);
  await clock.until(voice.total + 0.4);
}
