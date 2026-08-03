/**
 * Landing video, phone cut.
 *
 * One continuous take of about two and a half minutes, timed to
 * voice/landing.json. Unlike the tutorial chapters this draws NOTHING on
 * top of the picture: no boxes, no labels, no chapter header. The flow's
 * only job is to have the right screen on display, settled, while each line
 * is spoken.
 *
 * That makes it far less fragile than a tutorial flow — there are no rects
 * to measure and nothing that can land off-screen — but it is also a single
 * long take, so every step is defensive. A step that cannot find its target
 * logs and moves on rather than aborting: a take with one dull beat is worth
 * more than no take at all.
 *
 * Shot from the demo account. This video is public and unauthenticated, so
 * no real opponent's name goes on screen.
 *
 * Matches (demo account):
 *   Alex   efff9208  60 points, 59 scored, all placed, 3 starred
 *   Marco  aa42d3b9  27 points, 3 starred, has a finished export
 *   Sam    5598d74a  27 points, carries the coach's voice note
 */

export const account = "uploader-test@example.com";
export const entry = "/dashboard";

const ALEX = "efff9208-abf2-4a20-a498-18cc5a5130b3";
const MARCO = "aa42d3b9-2109-4e02-a638-10297d0606e8";
const SAM = "5598d74a-88dd-464b-bacf-d9ac0c2b8976";
const COACH_POINT = "3e874301-63d7-4912-a8c0-fc0a4111e6f1";

/** Keep score writes. Restore whatever it touches. */
export const guard = [ALEX];

export async function prepare(page) {
  await page.waitForSelector("text=Recent matches", { timeout: 30000 });
  await page.waitForTimeout(1200);
}

/** Never let one missing selector cost the whole take. */
const attempt = async (label, fn) => {
  try {
    await fn();
  } catch (err) {
    console.log(`  ! ${label}: ${String(err).split("\n")[0]}`);
  }
};

const go = async (page, url) => {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
};

/** Scroll a heading into view and let the sticky header clear it. */
const bring = async (page, clock, text) => {
  await attempt(`bring ${text}`, async () => {
    await page.evaluate((t) => {
      const el = [...document.querySelectorAll("h1,h2,h3")].find((h) =>
        h.textContent.trim().toLowerCase().startsWith(t.toLowerCase())
      );
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, text);
    await clock.sleep(600);
    await page.evaluate(() => window.scrollBy({ top: -74, behavior: "smooth" }));
    await clock.sleep(350);
  });
};

const tap = async (page, clock, spec, after = 700) => {
  await attempt(`tap ${JSON.stringify(spec)}`, async () => {
    const ok = await page.evaluate((s) => {
      const el = window.__pick(s);
      if (!el) return false;
      el.scrollIntoView({ block: "center" });
      // SVG elements have no .click(); dispatch instead so a target that is
      // drawn rather than laid out is still tappable.
      if (typeof el.click === "function") el.click();
      else el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return true;
    }, spec);
    if (!ok) throw new Error("no target");
    await clock.sleep(after);
  });
};

export async function flow(page, clock, { beat }) {
  const base = process.env.BASE ?? "https://www.ponglens.com";

  // ---------------------------------------------- 1-2. hook, and what it is
  // Home, still. The opening is about the viewer's own situation, not about
  // any particular screen, so nothing moves while it is spoken.
  const hook = beat("hook");
  const what = beat("what-it-is");
  await clock.until(hook.start);
  await bring(page, clock, "Recent matches");
  await clock.until(what.end);

  // ------------------------------------------------------------- 3. upload
  const up = beat("upload");
  await clock.until(up.start - 0.5);
  await go(page, `${base}/upload`);
  await clock.sleep(1600);
  // Down to the YouTube field as the line reaches it.
  await attempt("scroll upload", async () => {
    await page.evaluate(() => window.scrollBy({ top: 260, behavior: "smooth" }));
  });
  await clock.until(up.end);

  // ------------------------------------------- 4-5. the cut, and the speeds
  const shorter = beat("shorter");
  await clock.until(shorter.start - 0.6);
  await go(page, `${base}/match/${ALEX}`);
  await clock.sleep(1800);
  await clock.until(shorter.end);

  const speeds = beat("speeds");
  await clock.until(speeds.start);
  // The player takeover, then the two holds the line describes.
  await attempt("open player", async () => {
    await page.waitForSelector('[aria-label="Play the full video"]', { timeout: 30000 });
    await page.evaluate(() =>
      document.querySelector('[aria-label="Play the full video"]')?.click()
    );
    await page.waitForSelector('[aria-label="Close player"]', { timeout: 20000 });
    await page.waitForFunction(
      () => { const v = document.querySelector("video"); return v && v.readyState >= 2 && v.videoWidth > 0; },
      { timeout: 20000 }
    ).catch(() => {});
    await clock.sleep(1200);
  });
  // The holds belong to the halves of the PICTURE, not of the screen: the
  // video element fills the viewport but the footage letterboxes inside it,
  // so screen-relative coordinates land in a black bar.
  const picture = await page.evaluate(() => {
    const v = document.querySelector("video");
    if (!v || !v.videoWidth) return null;
    const r = v.getBoundingClientRect();
    const s = Math.min(r.width / v.videoWidth, r.height / v.videoHeight);
    const w = v.videoWidth * s, h = v.videoHeight * s;
    return { x: r.x + (r.width - w) / 2, y: r.y + (r.height - h) / 2, w, h };
  }).catch(() => null);
  const holdAt = async (side, ms) => {
    await attempt(`hold ${side}`, async () => {
      const vp = page.viewportSize();
      const x = picture
        ? (side === "right" ? picture.x + picture.w * 0.75 : picture.x + picture.w * 0.25)
        : (side === "right" ? vp.width * 0.78 : vp.width * 0.22);
      const y = picture ? picture.y + picture.h / 2 : vp.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await clock.sleep(ms);
      await page.mouse.up();
    });
  };
  await holdAt("right", 2600);
  await clock.sleep(600);
  await holdAt("left", 2600);
  await clock.until(speeds.end);

  // ---------------------------------------------------------- 6-7. scoring
  const score = beat("score");
  await clock.until(score.start - 0.6);
  await go(page, `${base}/match/${ALEX}`);
  await page.waitForSelector("text=Keep score", { timeout: 60000 }).catch(() => {});
  await tap(page, clock, { text: "Keep score", tag: "button" }, 2600);
  // A few honest taps on the winner pads. The guard puts these back after.
  const PAD_ME = { text: "Me", tag: "button", min: { w: 120, h: 200 } };
  const PAD_THEM = { text: "Alex", tag: "button", min: { w: 120, h: 200 } };
  for (const pad of [PAD_ME, PAD_THEM, PAD_ME]) {
    await tap(page, clock, pad, 1600);
  }
  const keeps = beat("score-keeps");
  await clock.until(keeps.end);

  // ----------------------------------------------- 8-9. analysis, then season
  const analysis = beat("analysis");
  await clock.until(analysis.start - 0.6);
  await go(page, `${base}/match/${ALEX}`);
  await clock.sleep(1200);
  await bring(page, clock, "Match analysis");
  await clock.sleep(2200);
  await bring(page, clock, "Point differential");
  await clock.until(analysis.end);

  const season = beat("season");
  await clock.until(season.start - 0.5);
  await go(page, `${base}/stats`);
  await clock.sleep(1500);
  await clock.until(season.end);

  // ------------------------------------------------------ 10-11. placement
  const pOpen = beat("placement-open");
  await clock.until(pOpen.start - 0.6);
  await go(page, `${base}/match/${ALEX}`);
  await clock.sleep(1000);
  await bring(page, clock, "Placement maps");
  await clock.until(pOpen.end);

  const placement = beat("placement");
  await clock.until(placement.start);
  await tap(page, clock, { aria: "Placement heat map" }, 2400);
  await clock.until(placement.end);

  // ------------------------------------------------------------ 12. coach
  const coach = beat("coach");
  await clock.until(coach.start - 0.6);
  await go(page, `${base}/match/${SAM}?p=${COACH_POINT}`);
  await clock.sleep(2000);
  await bring(page, clock, "Notes");
  await clock.until(coach.end);

  // ------------------------------------------------------- 13-14. journal
  const jOpen = beat("journal-open");
  await clock.until(jOpen.start - 0.6);
  await go(page, `${base}/journal`);
  await clock.sleep(1400);
  await clock.until(jOpen.end);

  const journal = beat("journal");
  await clock.until(journal.start);
  await attempt("scroll journal", async () => {
    await page.evaluate(() => window.scrollBy({ top: 340, behavior: "smooth" }));
  });
  await clock.sleep(2400);
  await tap(page, clock, { text: "Recollect" }, 2400);
  await clock.until(journal.end);

  // ------------------------------------------------------------ 15. export
  const exp = beat("export");
  await clock.until(exp.start - 0.6);
  await go(page, `${base}/match/${MARCO}`);
  await clock.sleep(1000);
  await tap(page, clock, { text: "Export", tag: "button", min: { w: 200 } }, 2400);
  await clock.until(exp.end);

  // ------------------------------------------------------------- 16-17. close
  // The logo card is drawn at render time, not captured. Hold on something
  // calm so the crossfade into it has somewhere to come from.
  const closeLogo = beat("close-logo");
  await clock.until(closeLogo.start - 0.4);
  await go(page, `${base}/dashboard`);
  await clock.sleep(1200);
  const closeLine = beat("close-line");
  await clock.until(closeLine.end + 1.2);
}
