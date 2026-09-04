/**
 * Chapter 6 — "Read your match". The analysis deck on the Gui match.
 *
 * READ ONLY. Order is momentum chart, then the numbers in one pass, then
 * the reasons — the chart is the thing that shows what the match FELT
 * like, so it leads. The deck is a horizontal scroll-snap carousel, so the
 * last beat swipes it rather than clicking, and every rect is measured
 * after the swipe has settled.
 */

export { account } from "../account.mjs";
export const entry = "/match/a0fb8f44-89b1-464e-a2a5-388b502dbda5";

/**
 * The chapter covers everything the app tells you about a scored match:
 * the analysis deck, then the placement maps that sit under it. It has to
 * cross matches to do it. The Gui match carries the why-you-lost answers
 * but no drawable geometry; the Jason match has the only trusted maps in
 * the account. So the analysis half is shot on one and the maps half on
 * the other, with the crossing hidden in the hold after line five.
 */
const MAPPED = "5bd279f4-aae2-46b1-9d87-0fdd0a6b348a";

export const guard = MAPPED;

const MAP = {
  heading: { text: "Placement maps", tag: "h2" },
  games: { aria: "Which games" },
  whose: { aria: "Whose shots" },
  which: { aria: "Which shots" },
  landings: { aria: "Placement map, Me at the bottom" },
  heatmap: { aria: "Placement heat map" },
  wrong: { aria: "placement maps are wrong" },
};

/** Scroll the map deck one card along, the way a thumb would. */
const swipeDeck = (page, to) =>
  page.evaluate((target) => {
    const h = [...document.querySelectorAll("h2")].find((x) =>
      x.textContent.trim().startsWith("Placement maps")
    );
    const sec = h?.closest("section") ?? h?.parentElement;
    const s = [...(sec?.querySelectorAll("*") ?? [])].find(
      (d) => d.scrollWidth > d.clientWidth + 40
    );
    if (!s) return false;
    s.scrollTo({ left: target * (s.clientWidth + 12), behavior: "smooth" });
    return true;
  }, to);

const ANALYSIS = "Match analysis";

export async function prepare(page) {
  // Generous: the match page is the heaviest route in the app and a cold
  // dev compile of it can take the better part of a minute.
  await page.waitForSelector(`text=${ANALYSIS}`, { timeout: 90000 });
  await page.waitForTimeout(2000);
  await page.evaluate((t) => {
    const el = [...document.querySelectorAll("h2")].find((h) =>
      h.textContent.trim().startsWith(t)
    );
    el?.scrollIntoView({ block: "start" });
    // Clear the sticky app header, or the card's top edge sits under it.
    window.scrollBy(0, -70);
  }, ANALYSIS);
  await page.waitForTimeout(900);
}

export async function flow(page, clock, { beat, voice, union }) {
  // ------------------------------------------------- 1. the deck itself
  const b1 = beat("open");
  await clock.until(b1.start + 0.2);
  const head = await clock.rect({ text: ANALYSIS, tag: "h2" });
  const card = await clock.rect({
    text: "Overview",
    tag: "div",
    min: { w: 240, h: 200 },
  });
  const c1 = clock.mark({
    kind: "box",
    label: "Match analysis",
    rect: union(head, card),
  });
  await clock.until(b1.end);
  clock.close(c1);

  // ----------------------------------------------- 2. the momentum chart
  const b2 = beat("momentum");
  await clock.until(b2.start + 0.1);
  // Target the chart itself. Matching on the "Point differential" text
  // walks up to whichever ancestor happens to satisfy the size floor, and
  // that ancestor is the entire card — which then made this beat and the
  // next one draw the same box twice.
  const chartLabel = await clock.rect({ text: "Point differential", tag: "p" });
  const chartSvg = await clock.rect({ sel: "svg", min: { w: 150, h: 80 } });
  const c2 = clock.mark({
    kind: "box",
    label: "How it swung",
    rect: union(chartLabel, chartSvg),
  });
  await clock.until(b2.end);
  clock.close(c2);

  // ------------------------------------- 3. every number, in one sweep
  const b3 = beat("stats");
  await clock.until(b3.start + 0.1);
  const first = await clock.rect({ text: "Best run", tag: "span" });
  const last = await clock.rect({ text: "Games won", tag: "span" });
  const c3 = clock.mark({
    kind: "box",
    label: "The numbers",
    // Width comes from the CHART, not from the "Overview" container: that
    // container matched an ancestor wider than the visible card, so the
    // box spilled past the card edge and over the next one in the deck.
    // The chart is laid out to the card's inner content width, so it is
    // the honest measure of how wide a row is.
    rect: {
      x: chartSvg.x - 10,
      y: first.y - 8,
      w: chartSvg.w + 20,
      h: last.y + last.h + 8 - (first.y - 8),
    },
  });
  await clock.until(b3.end);
  clock.close(c3);

  // ------------------------------------------------ 4. why you lost them
  const b4 = beat("why");
  await clock.until(b4.start + 0.1);
  const swiped = await page.evaluate(() => {
    const h = [...document.querySelectorAll("h2")].find((x) =>
      x.textContent.trim().startsWith("Match analysis")
    );
    const sec = h?.closest("section") ?? h?.parentElement;
    const s = [...(sec?.querySelectorAll("*") ?? [])].find(
      (d) => d.scrollWidth > d.clientWidth + 40
    );
    if (!s) return false;
    s.scrollTo({ left: s.clientWidth + 12, behavior: "smooth" });
    return true;
  });
  if (!swiped) throw new Error("analysis deck scroller not found");
  await clock.sleep(1000);
  const whyCard = await clock.rect({
    text: "Why you lost",
    tag: "div",
    min: { w: 240, h: 180 },
  });
  const c4 = clock.mark({ kind: "box", label: "Why you lost", rect: whyCard });
  await clock.until(b4.end);
  clock.close(c4);

  // -------------------------------------------- 5. and the maps below
  const b5 = beat("maps");
  const crossing = page.goto(
    `${new URL(page.url()).origin}/match/${MAPPED}`
  );
  await crossing;
  await page.waitForSelector("text=Placement maps", { timeout: 60000 });
  await page.waitForTimeout(2200);
  await page.evaluate(() => {
    [...document.querySelectorAll("h2")]
      .find((h) => h.textContent.trim().startsWith("Placement maps"))
      ?.scrollIntoView({ block: "start" });
    window.scrollBy(0, -70);
  });
  await clock.sleep(1000);
  await clock.until(b5.start + 0.1);
  const mapHead = await clock.rect(MAP.heading);
  const mapCard = await clock.rect(MAP.landings);
  const c5 = clock.mark({
    kind: "box",
    label: "Where the ball landed",
    rect: union(mapHead, mapCard),
  });
  await clock.until(b5.end);
  clock.close(c5);

  // ---------------------------------- 6. the filters, and the heat map
  const b6 = beat("filters");
  await clock.until(b6.start + 0.1);
  const whose = await clock.rect(MAP.whose);
  const which = await clock.rect(MAP.which);
  const games = await clock.rect(MAP.games);
  const c6 = clock.mark({
    kind: "box",
    label: "Whose shots, which shots",
    rect: union(whose, which),
  });
  await clock.until(b6.start + b6.dur * 0.35);
  clock.close(c6);
  // The heat map is the second card in the deck.
  if (!(await swipeDeck(page, 1))) throw new Error("placement deck not found");
  await clock.sleep(1000);
  const heat = await clock.rect(MAP.heatmap);
  const c6b = clock.mark({ kind: "box", label: "Heat map", rect: heat });
  await clock.until(b6.start + b6.dur * 0.72);
  clock.close(c6b);
  await swipeDeck(page, 0);
  await clock.sleep(600);
  const c6c = clock.mark({ kind: "box", label: "One game at a time", rect: games });
  await page.evaluate(() => window.__pick({ aria: "Game 2" })?.click());
  await clock.until(b6.end);
  clock.close(c6c);

  // ------------------------------------------------------ 7. still beta
  const b7 = beat("beta");
  await clock.until(b7.start + 0.1);
  const wrong = await clock.rect(MAP.wrong);
  const c7 = clock.mark({
    kind: "box",
    // Never pressed: it would flag the whole match's maps.
    label: "Say so, and it stops counting",
    rect: { x: wrong.x - 10, y: wrong.y - 10, w: wrong.w + 20, h: wrong.h + 20 },
  });
  await clock.until(b7.end);
  clock.close(c7);
  await clock.until(voice.total + 0.4);
}
