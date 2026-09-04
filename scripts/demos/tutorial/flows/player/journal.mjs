/** Chapter 9 — one searchable journal for notes, lessons, and cues. */
export { account } from "../account.mjs";
export const entry = "/journal";

export async function prepare(page) {
  await page.waitForSelector("text=Recollect", { timeout: 60000 });
  await page.waitForTimeout(1800);
  await page.evaluate(() => window.scrollTo(0, 0));
}

const padded = (rect, pad = 10) => ({ x: rect.x - pad, y: rect.y - pad, w: rect.w + pad * 2, h: rect.h + pad * 2 });
const tab = (name) => ({ text: name, tag: "button", max: { w: 160, h: 60 } });

async function top(page, clock) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await clock.sleep(750);
}

export async function flow(page, clock, { beat, voice, union, dismiss }) {
  const one = beat("one");
  await clock.until(one.start + 0.1);
  const all = await clock.rect(tab("All"));
  const practice = await clock.rect(tab("Practice"));
  const oneMark = clock.mark({ kind: "box", label: "One journal", rect: union(all, practice) });
  await clock.until(one.end);
  clock.close(oneMark);

  const capture = beat("capture-options");
  await page.evaluate(() => window.__pick({ text: "New", tag: "button" })?.click());
  await page.waitForSelector('[aria-label="Entry text"]', { timeout: 20000 });
  await clock.sleep(500);
  await clock.until(capture.start + 0.1);
  const field = await clock.rect({ aria: "Entry text" });
  const dictate = await clock.rect({ aria: "Speak instead" });
  const photo = await clock.rect({ text: "Add photo", tag: "button" });
  const scan = await clock.rect({ text: "Scan pages", tag: "button" });
  const captureMark = clock.mark({ kind: "box", label: "Write, dictate, photo, or scan", rect: union(field, dictate, photo, scan) });
  await clock.until(capture.end);
  clock.close(captureMark);

  const improve = beat("improve");
  await clock.until(improve.start + 0.1);
  const improveControl = await clock.rect({ text: "Improve with AI", tag: "span" });
  const improveCopy = await clock.rect({ text: "Your rough notes become", tag: "span" });
  const improveMark = clock.mark({ kind: "box", label: "Improve, then edit", rect: union(improveControl, improveCopy) });
  await clock.until(improve.end);
  clock.close(improveMark);
  await dismiss(page, { click: { aria: "Close" }, gone: { aria: "Entry text" } });
  await top(page, clock);

  const searchAsk = beat("search-ask");
  await page.click('[aria-label="Search or ask your journal"]');
  await page.type('[aria-label="Search or ask your journal"]', "backhand", { delay: 55 });
  await page.waitForSelector("text=Ask your journal", { timeout: 10000 });
  await clock.until(searchAsk.start + 0.1);
  const search = await clock.rect({ aria: "Search or ask your journal" });
  const ask = await clock.rect({ text: "Ask your journal", tag: "button" });
  const searchMark = clock.mark({ kind: "box", label: "Search or ask", rect: union(search, ask) });
  await clock.until(searchAsk.end);
  clock.close(searchMark);

  const tags = beat("tags");
  await clock.until(tags.start + 0.1);
  const tagChip = await clock.rect({ text: "backhand error", tag: "button" });
  const tagsMark = clock.mark({ kind: "box", label: "Related entries and rallies", rect: padded(tagChip, 6) });
  await clock.until(tags.end);
  clock.close(tagsMark);

  const cues = beat("cues");
  await clock.until(cues.start + 0.1);
  const working = await clock.rect({ text: "Working on", tag: "h2, h3, p, span, div" });
  const cuesMark = clock.mark({ kind: "box", label: "Current cues", rect: padded(working, 12) });
  await clock.until(cues.end);
  clock.close(cuesMark);

  const recollect = beat("recollect");
  await page.evaluate(() => window.__pick({ text: "Recollect", tag: "button", max: { w: 160, h: 60 } })?.click());
  await page.waitForSelector("text=Recollect groups", { timeout: 20000 });
  await page.evaluate(() => window.__pick({ text: "Recollect", tag: "button", max: { w: 160, h: 60 } })?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" }));
  await clock.sleep(600);
  await clock.until(recollect.start + 0.1);
  const recollectHeading = await clock.rect({ text: "Recollect", tag: "button", max: { w: 160, h: 60 } });
  const recollectCopy = await clock.rect({ text: "Recollect groups", tag: "p" });
  const recollectMark = clock.mark({ kind: "box", label: "Older advice, back in view", rect: union(recollectHeading, recollectCopy) });
  await clock.until(recollect.end);
  clock.close(recollectMark);
  await clock.until(voice.total + 0.4);
}
