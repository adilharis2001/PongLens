/**
 * The landing video's shot list, shared by both cuts.
 *
 * One continuous take timed to voice/landing.json. Nothing is drawn over
 * the picture: no boxes, no labels, no chapter header. The flow's only job
 * is to have the right screen on display, settled, while each line is
 * spoken.
 *
 * Mobile and desktop run the SAME steps against the same demo account. They
 * differ only in viewport and in how far a page has to scroll, which is
 * what `layout` carries. Two flow files that drifted apart would be two
 * videos telling slightly different stories.
 *
 * Every step is defensive. It is a single ninety-second take, so a step
 * that cannot find its target logs and moves on rather than aborting: one
 * dull beat beats no take at all.
 *
 * Shot from the demo account. The video is public and unauthenticated, so
 * no real opponent is named on screen.
 *
 * Matches (demo account):
 *   Alex   efff9208  60 points, 59 scored, all placed, 3 starred
 *   Marco  aa42d3b9  27 points, 3 starred, has a finished export
 *   Sam    5598d74a  27 points, carries the coach's voice note
 */

export const ALEX = "efff9208-abf2-4a20-a498-18cc5a5130b3";
export const MARCO = "aa42d3b9-2109-4e02-a638-10297d0606e8";
export const SAM = "5598d74a-88dd-464b-bacf-d9ac0c2b8976";
export const COACH_POINT = "3e874301-63d7-4912-a8c0-fc0a4111e6f1";

const attempt = async (label, fn) => {
  try {
    await fn();
  } catch (err) {
    console.log(`  ! ${label}: ${String(err).split("\n")[0]}`);
  }
};

const go = async (page, url) => {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
};

/** Scroll a heading into view and let the sticky header clear it. */
const bring = async (page, clock, text, headerClear) => {
  await attempt(`bring ${text}`, async () => {
    await page.evaluate((t) => {
      const el = [...document.querySelectorAll("h1,h2,h3")].find((h) =>
        h.textContent.trim().toLowerCase().startsWith(t.toLowerCase())
      );
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, text);
    await clock.sleep(500);
    await page.evaluate((y) => window.scrollBy({ top: y, behavior: "smooth" }), -headerClear);
    await clock.sleep(300);
  });
};

const tap = async (page, clock, spec, after = 600) => {
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

export async function prepare(page) {
  await page.waitForSelector("text=Recent matches", { timeout: 30000 });
  await page.waitForTimeout(1000);
}

/**
 * @param layout.headerClear  px to back off after scrolling a heading up
 * @param layout.uploadScroll px down the upload page to reach the YouTube field
 * @param layout.opponentPad  the Keep score pad label for the opponent
 */
export function makeFlow(layout) {
  return async function flow(page, clock, { beat }) {
    const base = process.env.BASE ?? "https://www.ponglens.com";

    // ------------------------------------------------- 1. what this is
    // Home, still. The opening names the product; pointing at a particular
    // control while it does that would be pointing at nothing in particular.
    await clock.until(beat("intro").start);
    await bring(page, clock, "Recent matches", layout.headerClear);
    await clock.until(beat("intro2").end);

    // ------------------------------------------------------- 2. upload
    await clock.until(beat("upload").start - 0.9);
    await go(page, `${base}/upload`);
    await clock.until(beat("upload2").start - 0.3);
    await attempt("scroll upload", () =>
      page.evaluate((y) => window.scrollBy({ top: y, behavior: "smooth" }), layout.uploadScroll)
    );
    await clock.until(beat("upload2").end);

    // ------------------------------- 3. the player, and the two speeds
    await clock.until(beat("speeds").start - 2.4);
    await go(page, `${base}/match/${ALEX}`);
    await attempt("open player", async () => {
      await page.waitForSelector('[aria-label="Play the full video"]', { timeout: 25000 });
      await page.evaluate(() =>
        document.querySelector('[aria-label="Play the full video"]')?.click()
      );
      await page.waitForSelector('[aria-label="Close player"]', { timeout: 20000 });
      await page
        .waitForFunction(
          () => {
            const v = document.querySelector("video");
            return v && v.readyState >= 2 && v.videoWidth > 0;
          },
          { timeout: 20000 }
        )
        .catch(() => {});
    });
    // The holds belong to the halves of the PICTURE, not of the screen: the
    // video element fills the viewport but the footage letterboxes inside
    // it, so screen-relative coordinates land in a black bar.
    const picture = await page
      .evaluate(() => {
        const v = document.querySelector("video");
        if (!v || !v.videoWidth) return null;
        const r = v.getBoundingClientRect();
        const s = Math.min(r.width / v.videoWidth, r.height / v.videoHeight);
        const w = v.videoWidth * s;
        const h = v.videoHeight * s;
        return { x: r.x + (r.width - w) / 2, y: r.y + (r.height - h) / 2, w, h };
      })
      .catch(() => null);
    const hold = async (side, ms) => {
      await attempt(`hold ${side}`, async () => {
        const vp = page.viewportSize();
        const x = picture
          ? side === "right"
            ? picture.x + picture.w * 0.75
            : picture.x + picture.w * 0.25
          : side === "right"
            ? vp.width * 0.78
            : vp.width * 0.22;
        const y = picture ? picture.y + picture.h / 2 : vp.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await clock.sleep(ms);
        await page.mouse.up();
      });
    };
    await clock.until(beat("speeds").start + 1.4);
    await hold("right", 2400);
    await clock.sleep(400);
    await hold("left", 2600);

    // ------------------------------------------------------ 4. scoring
    await clock.until(beat("score").start - 2.2);
    await go(page, `${base}/match/${ALEX}`);
    await page.waitForSelector("text=Score Keeper", { timeout: 40000 }).catch(() => {});
    await tap(page, clock, { text: "Score Keeper", tag: "button" }, 1800);
    // Honest taps on the winner pads. The guard puts these back afterwards.
    const padMe = { text: "Me", tag: "button", min: { w: 120, h: 200 } };
    const padThem = { text: layout.opponentPad, tag: "button", min: { w: 120, h: 200 } };
    await clock.until(beat("score").start + 2.2);
    for (const pad of [padMe, padThem, padMe]) {
      await tap(page, clock, pad, 1300);
    }
    await clock.until(beat("score-keeps").end);

    // ------------------------------------- 5. analysis, then the season
    await clock.until(beat("analysis").start - 1.6);
    await go(page, `${base}/match/${ALEX}`);
    await bring(page, clock, "Match analysis", layout.headerClear);
    await clock.until(beat("analysis").start + 3.2);
    await bring(page, clock, "Point differential", layout.headerClear);
    await clock.until(beat("season").start - 1.2);
    await go(page, `${base}/stats`);
    await clock.until(beat("season").end);

    // ---------------------------------------------------- 6. placement
    await clock.until(beat("placement").start - 1.8);
    await go(page, `${base}/match/${ALEX}`);
    await bring(page, clock, "Placement maps", layout.headerClear);
    await clock.until(beat("placement").start + 2.4);
    await tap(page, clock, { aria: "Placement heat map" }, 1600);
    await clock.until(beat("placement").end);

    // -------------------------------------------------------- 7. coach
    await clock.until(beat("coach").start - 1.8);
    await go(page, `${base}/match/${SAM}?p=${COACH_POINT}`);
    await clock.until(beat("coach").start + 2.0);
    await bring(page, clock, "Notes", layout.headerClear);
    await clock.until(beat("coach").end);

    // ------------------------------------------ 8. journal, and Recollect
    await clock.until(beat("journal").start - 1.4);
    await go(page, `${base}/journal`);
    await clock.until(beat("journal2").start - 0.2);
    await attempt("scroll journal", () =>
      page.evaluate((y) => window.scrollBy({ top: y, behavior: "smooth" }), layout.journalScroll)
    );
    await clock.until(beat("journal2").start + 2.6);
    await tap(page, clock, { text: "Recollect" }, 1800);
    await clock.until(beat("journal2").end);

    // ------------------------------------------------------- 9. export
    await clock.until(beat("export").start - 1.6);
    await go(page, `${base}/match/${MARCO}`);
    await tap(page, clock, { text: "Export", tag: "button", min: { w: 200 } }, 1600);
    await clock.until(beat("export").end);

    // -------------------------------------------------------- 10. close
    await clock.until(beat("close").start - 0.6);
    await go(page, `${base}/dashboard`);
    await clock.until(beat("close").end + 1.0);
  };
}
