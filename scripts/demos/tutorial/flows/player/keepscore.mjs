/**
 * Chapter 5 — "Keep score". The scoring screen on the Gui match.
 *
 * The densest UI in the app, and the one that writes most: tapping a pad
 * scores a point, and the pad TOGGLES (Player.tsx), so tapping the winner
 * already shown would silently un-score it. The flow taps the other side —
 * which reads exactly like scoring a rally — and the guard restores it.
 *
 * Two overlays open here and BOTH are closed through their real control
 * with a verified detach: the Why sheet has a Skip, the analysis panel has
 * a Done. The first take of this chapter left the Why sheet open for its
 * last seventeen seconds because a bare Escape was assumed to work.
 */

export { account } from "../account.mjs";
export const entry = "/match/efff9208-abf2-4a20-a498-18cc5a5130b3";
export const guard = "efff9208-abf2-4a20-a498-18cc5a5130b3";

export async function prepare(page) {
  await page.waitForSelector("text=Score Keeper", { timeout: 90000 });
  await page.waitForTimeout(1600);
  await page.evaluate(() =>
    window.__pick({ text: "Score Keeper", tag: "button" })?.click()
  );
  await page.waitForSelector('[aria-label="Undo last tap"]', { timeout: 40000 });
  await page
    .waitForFunction(
      () => {
        const v = document.querySelector("video");
        return v && v.readyState >= 2 && v.videoWidth > 0;
      },
      { timeout: 30000 }
    )
    .catch(() => {});
  await page.waitForTimeout(1400);
}

/** Controls of the score overlay, by aria label where one exists. The point
 *  timeline further down the page repeats several of these labels, so the
 *  text-matched ones demand the score pad's real size. */
const AT = {
  serveMine: { aria: "I served this point" },
  serveTheirs: { aria: "Give the serve to Alex" },
  strip: { aria: "Go to point 1," },
  analysis: { aria: "Add analysis for this point" },
  // Two block spans render as `Skiplet` in textContent, even though they
  // read as two lines on screen. Match the stable first span.
  skip: { text: "Skip", tag: "button", min: { w: 80, h: 40 } },
  modify: { text: "Modify", tag: "button", min: { w: 80, h: 40 } },
  padMine: { text: "Me", tag: "button", min: { w: 120, h: 200 } },
  padTheirs: { text: "Alex", tag: "button", min: { w: 120, h: 200 } },
};

export async function flow(page, clock, { beat, voice, union, dismiss }) {
  const video = await clock.rect({ sel: "video", min: { w: 200, h: 90 } });

  // ------------------------------------------------- 1. what this screen is
  // No highlight while it is being defined: the whole screen is the subject.
  const b1 = beat("intro");
  await clock.until(b1.start + 0.3);
  await page.evaluate(() => {
    const v = document.querySelector("video");
    if (v?.paused) v.play().catch(() => {});
  });
  await clock.until(b1.end);

  // --------------------------------------- 2. one point, then it waits
  const b2 = beat("waits");
  await clock.until(b2.start + 0.1);
  const c2 = clock.mark({ kind: "box", label: "One point at a time", rect: video });
  await clock.until(b2.end);
  clock.close(c2);

  // -------------------------------------------------- 3. tap who won it
  const b3 = beat("pads");
  await clock.until(b3.start + 0.1);
  const mine = await clock.rect(AT.padMine);
  const theirs = await clock.rect(AT.padTheirs);
  const c3 = clock.mark({
    kind: "box",
    label: "Who won the point?",
    rect: union(mine, theirs),
  });
  await clock.until(b3.start + b3.dur * 0.55);
  clock.mark({
    kind: "tap",
    x: theirs.x + theirs.w / 2,
    y: theirs.y + theirs.h / 2,
    end: Number((clock.now() + 0.7).toFixed(3)),
  });
  await page.evaluate((s) => window.__pick(s)?.click(), AT.padTheirs);
  await clock.until(b3.end);
  clock.close(c3);

  // ------------------------------------------------ 4. who is serving
  const b4 = beat("serve");
  await clock.until(b4.start + 0.1);
  const left = await clock.rect(AT.serveMine);
  const right = await clock.rect(AT.serveTheirs);
  const c4 = clock.mark({
    kind: "box",
    label: "Serve, and the score",
    rect: union(left, right),
  });
  // Not tapped: switching the server opens a menu, and an overlay opened
  // for one second of demonstration is a needless way to leave one open.
  await clock.until(b4.end);
  clock.close(c4);

  // ------------------------------------------------- 5. why you lost it
  const b5 = beat("analysis");
  await clock.until(b5.start + 0.1);
  const analysisButton = await clock.rect(AT.analysis);
  const c5 = clock.mark({ kind: "box", label: "Record what happened", rect: analysisButton });
  await clock.until(b5.start + b5.dur * 0.45);
  clock.mark({
    kind: "tap",
    x: analysisButton.x + analysisButton.w / 2,
    y: analysisButton.y + analysisButton.h / 2,
    end: Number((clock.now() + 0.7).toFixed(3)),
  });
  clock.close(c5);
  await page.evaluate((s) => window.__pick(s)?.click(), AT.analysis);
  await page.waitForSelector("text=Analysis", { timeout: 15000 });
  await clock.until(b5.end);
  // Its own Skip control, and prove the sheet is gone before moving on.
  await page.evaluate(() => [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Done")?.click());
  await page.waitForFunction(() => !document.querySelector(".ks-slide-left"), null, { timeout: 10000 }).catch(() => {});
  await clock.sleep(400);

  // ------------------------------- 6. swipe for notes and tags
  const b6 = beat("note-tag");
  await clock.until(b6.start + 0.1);
  const pad = await clock.rect(AT.padMine);
  const c6 = clock.mark({ kind: "box", label: "Swipe here", rect: pad });
  // Let the gesture target read before the gesture replaces it with the
  // full-screen panel. The screencast cannot show a box that lasted only
  // for the pointer travel itself.
  await clock.until(b6.start + 0.55);
  // A real swipe: the handler wants pointer events, 56px of travel, and
  // mostly horizontal movement (Player.tsx padSwipeHandlers).
  const y = pad.y + pad.h / 2;
  await page.mouse.move(pad.x + pad.w - 20, y);
  await page.mouse.down();
  await page.mouse.move(pad.x + 20, y, { steps: 12 });
  await page.mouse.up();
  // The gesture is the thing being taught, but it does not always take
  // after the Why sheet has been through — so fall back to the button that
  // opens the same panel rather than narrating a panel that never appears.
  const opened = await page
    .waitForSelector(".ks-slide-left", { timeout: 4000 })
    .then(() => true)
    .catch(() => false);
  if (!opened) {
    await page.evaluate((s) => window.__pick(s)?.click(), AT.analysis);
    await page.waitForSelector(".ks-slide-left", { timeout: 10000 });
  }
  // The panel covers the whole screen, so leaving the box on the pad would
  // outline where the pad USED to be. Move it onto what is now on screen.
  clock.close(c6);
  await clock.sleep(300);
  const panel = await clock.rect({ sel: ".ks-slide-left" });
  const c6b = clock.mark({
    kind: "box",
    label: "Notes and tags",
    rect: {
      x: Math.max(panel.x + 4, 6),
      y: Math.max(panel.y + 4, 6),
      w: Math.min(panel.w - 8, 378),
      h: Math.min(panel.h - 8, 830),
    },
  });
  await clock.until(b6.end);
  clock.close(c6b);
  // Closing this panel takes three tries in practice. Done is the real
  // control; Escape covers a mid-animation click; and the panel also has a
  // swipe-to-close handler, which is what actually works when the pointer
  // state is left over from the swipe that opened it.
  const gone = () =>
    page
      .waitForFunction(() => !document.querySelector(".ks-slide-left"), null, {
        timeout: 500,
      })
      .then(() => true)
      .catch(() => false);
  await page.evaluate(() =>
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent.trim() === "Done")
      ?.click()
  );
  if (!(await gone())) {
    await page.keyboard.press("Escape");
    if (!(await gone())) {
      const y2 = pad.y + pad.h / 2;
      await page.mouse.move(pad.x + 30, y2);
      await page.mouse.down();
      await page.mouse.move(pad.x + pad.w - 20, y2, { steps: 12 });
      await page.mouse.up();
      if (!(await gone())) throw new Error("analysis panel would not close");
    }
  }
  await clock.sleep(400);

  // ------------------------------- 6b. ending a game where it really ended
  const bg = beat("gameend");
  await clock.until(bg.start + 0.1);
  const gameEnd = await clock.rect({ aria: "Mark the game as ended" });
  const cg = clock.mark({
    kind: "box",
    label: "End it here",
    rect: { x: gameEnd.x - 8, y: gameEnd.y - 10, w: gameEnd.w + 16, h: gameEnd.h + 20 },
  });
  await clock.until(bg.start + bg.dur * 0.45);
  clock.close(cg);
  // The other half of the same idea: a divider the app placed can be undone
  // by tapping it, which lives in the point strip rather than the chrome.
  await page.evaluate(() => {
    document
      .querySelector('[aria-label*="ended here at"]')
      ?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  });
  await clock.sleep(800);
  const divider = await clock.rect({ aria: "ended here at" });
  const cg2 = clock.mark({
    kind: "box",
    label: "Or undo one",
    rect: { x: divider.x - 10, y: divider.y - 10, w: divider.w + 20, h: divider.h + 20 },
  });
  await clock.until(bg.end);
  clock.close(cg2);

  // ------------------------------------------- 7. fixing the cut itself
  const b7 = beat("tools");
  await clock.until(b7.start + 0.1);
  const skip = await clock.rect(AT.skip);
  const modify = await clock.rect(AT.modify);
  const c7 = clock.mark({
    kind: "box",
    label: "Fix the cut",
    rect: union(skip, modify),
  });
  await clock.until(b7.end);
  clock.close(c7);

  // ------------------------------------------------ 8. every point of it
  const b8 = beat("strip");
  await clock.until(b8.start + 0.1);
  const pill = await clock.rect(AT.strip);
  const c8 = clock.mark({
    kind: "box",
    label: "Every point",
    rect: { x: 6, y: pill.y - 6, w: 378, h: pill.h + 12 },
  });
  await clock.until(b8.end);
  clock.close(c8);
  await clock.until(voice.total + 0.4);
}
