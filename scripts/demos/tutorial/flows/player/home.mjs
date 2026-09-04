/**
 * Chapter 1 — "Start here". Opens the whole series, so it carries the
 * two-line intro before anything gets pointed at.
 *
 * READ ONLY. Home is a stack of sections, so every highlight is the
 * heading plus the block it introduces, and the page is scrolled and
 * allowed to settle BEFORE a box is measured — a rect taken mid-scroll
 * lands on nothing.
 */

export { account } from "../account.mjs";
export const entry = "/dashboard";

export async function prepare(page) {
  await page.waitForSelector("text=Recent matches", { timeout: 20000 });
  // Export rows are fetched after paint; without them beat 5 has no target.
  await page
    .waitForSelector('[aria-label="Download export"]', { timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
}

/** Scroll a heading to the top of the viewport and let it settle. */
async function bring(page, clock, text, block = "start") {
  await page.evaluate(
    ([t, b]) => {
      const el = [...document.querySelectorAll("h1, h2, h3")].find((h) =>
        h.textContent.trim().startsWith(t)
      );
      el?.scrollIntoView({ behavior: "smooth", block: b });
    },
    [text, block]
  );
  await clock.sleep(650);
  // Back off enough to clear the sticky app header, so the section lands
  // below the bar instead of behind it.
  await page.evaluate(() => window.scrollBy({ top: -74, behavior: "smooth" }));
  await clock.sleep(420);
}

export async function flow(page, clock, { beat, voice, sectionRect }) {
  // ------------------------------------------------------- 1-2. the intro
  // No highlight: the phone just sits there while the series is introduced.
  // Pointing at something during "here is what it does" would be pointing
  // at nothing in particular.
  const b1 = beat("intro1");
  const b2 = beat("intro2");
  await clock.until(b2.end);

  // ------------------------------------------------ 3. pick up where you left off
  const b3 = beat("continue");
  await clock.until(b3.start + 0.15);
  // "Keep scoring" in the DOM, uppercased by CSS on screen.
  const cont = await clock.rect({ text: "Keep scoring", tag: "a" });
  const c3 = clock.mark({
    kind: "box",
    label: "Continue scoring",
    rect: cont,
  });
  await clock.until(b3.end);
  clock.close(c3);

  // ----------------------------------- 4. recent matches, then your game
  // No label chips on these three: each box already contains the heading
  // that names it, so a chip saying the same word twice is just noise.
  const b4 = beat("recent");
  await bring(page, clock, "Recent matches");
  await clock.until(b4.start + 0.1);
  const c4 = clock.mark({
    kind: "box",
    rect: await sectionRect(page, "Recent matches"),
  });
  // Half way through the line, move on to the aggregate card the same
  // sentence is describing.
  await clock.until(b4.start + b4.dur * 0.55);
  clock.close(c4);
  await bring(page, clock, "Your game");
  const c4b = clock.mark({
    kind: "box",
    rect: await sectionRect(page, "Your game"),
  });
  await clock.until(b4.end);
  clock.close(c4b);

  // ---------------------------------------------------------- 5. exports
  const b5 = beat("exports");
  await bring(page, clock, "Latest activity");
  await clock.until(b5.start + 0.1);
  const dl = await clock.rect({ sel: '[aria-label="Download export"]' });
  // The button is the anchor; the row around it is what to look at.
  const c5 = clock.mark({
    kind: "box",
    label: "Ready to download",
    rect: { x: 16, y: dl.y - 12, w: 358, h: dl.h + 24 },
  });
  await clock.until(b5.start + b5.dur * 0.75);
  clock.mark({
    kind: "tap",
    x: dl.x + dl.w / 2,
    y: dl.y + dl.h / 2,
    end: Number((clock.now() + 0.7).toFixed(3)),
  });
  await clock.until(b5.end);
  clock.close(c5);

  // ------------------------------------------------------- 6. working on
  const b6 = beat("workingon");
  await bring(page, clock, "Working on");
  await clock.until(b6.start + 0.1);
  const c6 = clock.mark({
    kind: "box",
    rect: await sectionRect(page, "Working on"),
  });
  await clock.until(b6.end);
  clock.close(c6);
  await clock.until(voice.total + 0.4);
}
