/**
 * Chapter 9 — "The journal", with Recollect folded in.
 *
 * One chapter because it is one screen: Recollect is a section of the
 * journal, not a page of its own.
 *
 * Shot on Adil's own account, the only one with Recollect cards, and now
 * also carrying a scanned entry ("Table Tennis Notes").
 *
 * On the scanning line: the photo is NOT what gets kept. Scan pages reads
 * the writing off the picture and stores the TEXT — the entry it produced
 * has no image on it at all. So the beat points at the Scan pages control
 * and then at the transcribed entry, never at a photograph.
 *
 * READ ONLY: the editor is opened to show its controls and closed without
 * saving, and revealing a Recollect card is a read.
 */

export { account } from "../account.mjs";
export const entry = "/journal";

export async function prepare(page) {
  await page.waitForSelector("text=Recollect", { timeout: 60000 });
  await page.waitForTimeout(2500);
}

/** A tab in the journal's section row. */
const tab = (name) => ({ text: name, tag: "button", max: { w: 160, h: 60 } });

/** An entry in the feed, found by its "Kind · date" line, padded to the card. */
async function entryCard(page, clock, prefix) {
  await page.evaluate((t) => {
    [...document.querySelectorAll("p")]
      .find((e) => e.textContent.trim().startsWith(t))
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, prefix);
  await clock.sleep(950);
  const line = await clock.rect({ text: prefix, tag: "p" });
  const top = Math.max(line.y - 18, 70);
  return { x: 26, y: top, w: 338, h: Math.min(230, 826 - top) };
}

export async function flow(page, clock, { beat, voice, union, dismiss }) {
  // ------------------------------------------------- 1. it is all one place
  const b1 = beat("one");
  await clock.until(b1.start + 0.2);
  const all = await clock.rect(tab("All"));
  const rec = await clock.rect(tab("Recollect"));
  const c1 = clock.mark({
    kind: "box",
    label: "Matches, lessons, practice",
    rect: { x: 12, y: all.y - 10, w: 366, h: Math.max(all.h, rec.h) + 20 },
  });
  await clock.until(b1.end);
  clock.close(c1);

  // --------------------------------------------- 2. type it or speak it
  const b2 = beat("voice");
  await page.evaluate(() => window.__pick({ text: "New", tag: "button" })?.click());
  await page.waitForSelector('[aria-label="Entry text"]', { timeout: 20000 });
  await clock.sleep(900);
  await clock.until(b2.start + 0.1);
  const field = await clock.rect({ aria: "Entry text" });
  const mic = await clock.rect({ aria: "Speak instead" });
  const c2 = clock.mark({
    kind: "box",
    label: "Write it or say it",
    rect: union(field, mic),
  });
  await clock.until(b2.end);
  clock.close(c2);

  // ------------------------------- 3. scanning a page, and what it leaves
  const b3 = beat("ocr");
  await clock.until(b3.start + 0.1);
  const scan = await clock.rect({ text: "Scan pages", tag: "button" });
  const c3 = clock.mark({
    kind: "box",
    label: "Scan a page",
    rect: { x: scan.x - 8, y: scan.y - 10, w: scan.w + 16, h: scan.h + 20 },
  });
  await clock.until(b3.start + b3.dur * 0.42);
  clock.close(c3);
  await dismiss(page, {
    click: { aria: "Close" },
    gone: { aria: "Entry text" },
  });
  await clock.sleep(500);
  const c3b = clock.mark({
    kind: "box",
    label: "Kept as text",
    rect: await entryCard(page, clock, "Practice ·"),
  });
  await clock.until(b3.end);
  clock.close(c3b);

  // ------------------------------------------------ 4. a lesson, distilled
  const b4 = beat("lesson");
  await page.evaluate(() =>
    window.__pick({ text: "Lessons", tag: "button", max: { w: 160, h: 60 } })?.click()
  );
  await clock.sleep(1400);
  await clock.until(b4.start + 0.1);
  const c4 = clock.mark({
    kind: "box",
    label: "Boiled down for you",
    rect: await entryCard(page, clock, "Lesson ·"),
  });
  await clock.until(b4.end);
  clock.close(c4);

  // ------------------------------------------------- 5. what you're on
  const b5 = beat("cues");
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await clock.sleep(900);
  await clock.until(b5.start + 0.1);
  // "WORKING ON" is a styled label rather than a heading, so the card is
  // measured from the two controls inside it.
  const add = await clock.rect({ text: "Add", tag: "button", max: { w: 90, h: 40 } });
  // Bounded below by the tab row rather than by the History link: History
  // only renders once something has been retired, and this account has
  // nothing retired, so anchoring to it fails outright.
  const tabs = await clock.rect(tab("All"));
  const c5 = clock.mark({
    kind: "box",
    label: "Pinned at the top",
    rect: { x: 16, y: add.y - 26, w: 358, h: tabs.y - 16 - (add.y - 26) },
  });
  await clock.until(b5.end);
  clock.close(c5);

  // ---------------------------------------------------- 6. Recollect
  const b6 = beat("recollect");
  await page.evaluate(() =>
    window.__pick({ text: "Recollect", tag: "button", max: { w: 160, h: 60 } })?.click()
  );
  await clock.sleep(1800);
  await page.evaluate(() => {
    [...document.querySelectorAll("p, span")]
      .find((e) => e.textContent.trim() === "Tap to reveal")
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  await clock.sleep(900);
  await clock.until(b6.start + 0.1);
  const reveal = await clock.rect({ text: "Tap to reveal", tag: "p, span, button" });
  const cardRect = { x: 20, y: Math.max(reveal.y - 200, 70), w: 350, h: 245 };
  const c6 = clock.mark({ kind: "box", label: "Asked again later", rect: cardRect });
  await clock.until(b6.end);
  clock.close(c6);

  // --------------------------------------------------- 7. turning a card
  const b7 = beat("card");
  await clock.until(b7.start + 0.1);
  const c7 = clock.mark({ kind: "box", label: "Tap to see the cue", rect: cardRect });
  await clock.until(b7.start + 1.1);
  clock.mark({
    kind: "tap",
    x: reveal.x + 40,
    y: reveal.y + reveal.h / 2,
    end: Number((clock.now() + 0.7).toFixed(3)),
  });
  await page.mouse.click(reveal.x + 40, reveal.y + reveal.h / 2).catch(() => {});
  await clock.until(b7.end);
  clock.close(c7);
  await clock.until(voice.total + 0.4);
}
