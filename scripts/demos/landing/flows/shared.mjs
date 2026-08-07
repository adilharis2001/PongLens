/**
 * The landing video's shot list, shared by both cuts.
 *
 * One continuous take timed to voice/landing.json.
 *
 * THE RULE THIS FLOW EXISTS TO SERVE: the voice sells the outcome, the
 * picture proves the mechanic. The narration never says "hold the right
 * side for double speed" — it says playback is built for studying the game,
 * and this flow silently does the holding while she says it. Anything the
 * viewer can see is a line the script does not have to spend.
 *
 * So the timings below are not decoration. Each visual action is placed to
 * land UNDER its line rather than after it: navigation happens while she is
 * still speaking the previous sentence, and the only silences left are ones
 * where the picture is doing something (a rally in slow motion, a score
 * climbing). Silence over a static screen is the thing that read as broken.
 *
 * Highlights are used sparingly, and only where a line names a specific
 * thing on screen: the two ways a match gets in, the cards the analysis
 * answers with, the placement map, the coach's drawing, the score sitting
 * on the picture. Screens that read as a whole get nothing drawn on them.
 *
 * Mobile and desktop run the SAME steps. They differ only in viewport and
 * scroll distances, which is what `layout` carries.
 *
 * Shot from the demo account. Public and unauthenticated, so no real
 * opponent is named on screen.
 *
 *   Alex   efff9208  60 points, 59 scored, all placed, 3 starred
 *   Marco  aa42d3b9  27 points, 3 starred, has a finished export
 *   Sam    5598d74a  27 points, carries the coach's voice note
 */

export const ALEX = "efff9208-abf2-4a20-a498-18cc5a5130b3";
export const MARCO = "aa42d3b9-2109-4e02-a638-10297d0606e8";
export const SAM = "5598d74a-88dd-464b-bacf-d9ac0c2b8976";
/** Carries the coach's drawing AND their voice note, so one frame has both. */
export const COACH_POINT = "da63c438-9c8e-4917-9031-523003228a11";
/** A completed paid review on the demo account, with real findings. */
export const REVIEW_ORDER = "87cde138-bd5f-4d12-ae14-27fd3611ce64";

const attempt = async (label, fn) => {
  try {
    await fn();
  } catch (err) {
    console.log(`  ! ${label}: ${String(err).split("\n")[0]}`);
  }
};

const go = async (page, url) => {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(600);
};

/**
 * Put a section on screen.
 *
 * The jump is INSTANT, not smooth. Match analysis and Placement maps sit a
 * long way down the match page, and a smooth scroll to something that
 * distant takes well over a second — longer than the window it was given,
 * so the beat was filmed mid-scroll and every later beat inherited the
 * delay. By the end the placement line was playing over the coach's screen.
 * An instant jump reads as a cut, which is what a product video is made of
 * anyway, and it cannot overrun.
 */
const bring = async (page, clock, text, headerClear, block = "center") => {
  await attempt(`bring ${text}`, async () => {
    const found = await page.evaluate(([t, b, clear]) => {
      const el = [...document.querySelectorAll("h1,h2,h3")].find((h) =>
        h.textContent.trim().toLowerCase().startsWith(t.toLowerCase())
      );
      if (!el) return false;
      // scrollIntoView, not window.scrollTo: the point sheet is its own
      // scroll box drawn over the page, so scrolling the window moves
      // nothing and the coach's notes stayed below the fold. This walks up
      // to whichever ancestor actually scrolls. `center` also removes the
      // need to offset for a sticky header.
      el.scrollIntoView({ behavior: "auto", block: b });
      if (b === "start") window.scrollBy(0, -clear);
      return true;
    }, [text, block, headerClear]);
    if (!found) throw new Error("heading not on the page");
    // Twice, with a beat between. Scrolling straight after a navigation gets
    // undone when hydration finishes and React restores scroll to the top —
    // which is how the analysis beat kept filming the point-detail panel
    // instead of the chart it had just been pointed at.
    await clock.sleep(400);
    await page.evaluate(([t, b, clear]) => {
      const el = [...document.querySelectorAll("h1,h2,h3")].find((h) =>
        h.textContent.trim().toLowerCase().startsWith(t.toLowerCase())
      );
      if (!el) return;
      el.scrollIntoView({ behavior: "auto", block: b });
      if (b === "start") window.scrollBy(0, -clear);
    }, [text, block, headerClear]);
    await clock.sleep(250);
  });
};

const tap = async (page, clock, spec, after = 600) => {
  await attempt(`tap ${JSON.stringify(spec)}`, async () => {
    const ok = await page.evaluate((s) => {
      const el = window.__pick(s);
      if (!el) return false;
      el.scrollIntoView({ block: "center" });
      if (typeof el.click === "function") el.click();
      else el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return true;
    }, spec);
    if (!ok) throw new Error("no target");
    await clock.sleep(after);
  });
};

/** Open the full-match player and wait until it has real frames. */
const openPlayer = async (page) => {
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
};

/**
 * Where the picture actually is. The <video> fills the viewport but the
 * footage letterboxes inside it, so a "right half of the screen" press
 * lands in a black bar rather than on the gesture target.
 */
const pictureRect = (page) =>
  page
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

/** Start playing somewhere in the middle, where there is a rally. */
const playFrom = async (page, seconds) => {
  await attempt("seek and play", () =>
    page.evaluate((t) => {
      const v = document.querySelector("video");
      if (!v) return;
      v.currentTime = t;
      void v.play().catch(() => {});
    }, seconds)
  );
};

export async function prepare(page) {
  // Open on home. The product is named over the thing being sold — the app
  // itself, with real matches in it — rather than over raw match footage,
  // which shows the sport but says nothing about the software.
  await page.waitForSelector("text=Recent matches", { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(1000);
}

/**
 * Highlight an element for the length of a beat.
 *
 * Learned the hard way on the tutorials, and every rule here cost a re-shoot:
 *  - box the SECTION, not the heading, or you get a 28px sliver;
 *  - scope inside an overlay, or document order hands back the element
 *    BEHIND the sheet, which is a valid rect pointing at the wrong thing;
 *  - never box something small at the very top of the screen, because the
 *    label chip tucks inside it and covers the thing it points at.
 * So everything highlighted below is a big, mid-screen block.
 */
const spot = async (page, clock, { label, spec, until, min = 40 }) => {
  let entry = null;
  await attempt(`spot ${label}`, async () => {
    const rect = await clock.rect(spec);
    // `min` is overridable for the one element whose real size is known and
    // genuinely small: the score bug is 238x99 on desktop but 53x28 on a
    // phone, so the blanket floor silently dropped the ring on the mobile
    // cut while reporting success on the desktop one.
    if (!rect || rect.w < min || rect.h < min) throw new Error("rect too small to box");
    entry = clock.mark({ kind: "box", label, rect });
  });
  await clock.until(until);
  if (entry) clock.close(entry);
};

export function makeFlow(layout) {
  return async function flow(page, clock, { beat }) {
    const base = process.env.BASE ?? "https://www.ponglens.com";

    // Every navigation below fires in the silence AFTER a line, never during
    // one. A page load costs about a second of dark frame, and a dark frame
    // under a sentence is the thing that reads as broken; the same second
    // spent in a gap reads as an edit. The gaps exist for this.
    //
    // Every `until` below is a LEAD, not a cue. A page load against
    // production costs about a second and opening the player costs two or
    // three, so each screen is started early enough to be settled by the
    // time its line begins. Getting this wrong does not just spoil one beat:
    // clock.until cannot rewind, so a late section stays late and the whole
    // back half slides. That is exactly how the placement line ended up
    // playing over the coach's screen.

    // ------------------------------------------------- 1. home, and the name
    await clock.until(beat("intro").end);

    // ----------------------------------------------- 2. bringing one in
    // The line names two routes in, so the picture rings them in the order
    // it says them: "from your phone" on the upload card, "or straight from
    // YouTube" on the import card. One ring held across the whole line
    // pointed at the upload box while she was already talking about YouTube,
    // and the YouTube box was never shown at all.
    await go(page, `${base}/upload`);
    await clock.until(beat("upload").start - 0.2);
    await spot(page, clock, {
      label: "From your phone",
      spec: { sectionOf: "Upload a match" },
      until: beat("upload").start + 1.9,
    });
    // Only the phone needs to move: at desktop width both cards are already
    // on screen, and scrolling under a line is the thing that read as bad.
    if (layout.uploadScroll) {
      await attempt("scroll to YouTube", () =>
        page.evaluate((y) => window.scrollBy({ top: y, behavior: "auto" }), layout.uploadScroll)
      );
      await clock.sleep(350);
    }
    await spot(page, clock, {
      label: "Straight from YouTube",
      spec: { sectionOf: "Import from YouTube" },
      until: beat("upload").end,
    });

    // --------------------------------- 3. what comes back: every point
    // Uninterrupted playback, nothing drawn over it. The jump-to-point grid
    // used to open here as "proof" that the match came back cut up, and it
    // was a bad trade: a panel slid over the picture the instant the rally
    // got going, and the thing the line is actually about — that what comes
    // back is pure table tennis — is better shown by just letting it play.
    // The player's own point transport says "of 59" without any help.
    await clock.until(beat("upload").end - 0.7);
    await go(page, `${base}/match/${ALEX}`);
    await clock.until(beat("playback1").start + 1.2);
    await attempt("open player", () => openPlayer(page));
    await playFrom(page, 40);

    // ------------------- 4. playback built for studying: shown, not said
    // Slow first, fast second, and both on ONE point rather than wherever
    // the clock happened to land. The previous take dropped into quarter
    // speed after the rally had already finished, which is a slow motion
    // shot of two people picking up a ball.
    //
    // 89.34s is the longest rally in the cut (7.93s), read off the player's
    // own point boundaries rather than computed from the clip table — the
    // cut runs 331s where summing t1-t0 predicts about 200, so that
    // arithmetic was wrong by a third of the match.
    //
    // Seek INTO the rally and let the player's own "Replay this point" snap
    // back to its first frame: that lands on the serve exactly, where a
    // bare seek lands a second or so into it.
    await clock.until(beat("playback1").end - 1.1);
    await playFrom(page, 91);
    await tap(page, clock, { aria: "Replay this point" }, 500);

    const pic = await pictureRect(page);
    const holdSide = async (side, ms) => {
      await attempt(`hold ${side}`, async () => {
        const vp = page.viewportSize();
        const x = pic
          ? side === "right"
            ? pic.x + pic.w * 0.75
            : pic.x + pic.w * 0.25
          : side === "right"
            ? vp.width * 0.78
            : vp.width * 0.22;
        const y = pic ? pic.y + pic.h / 2 : vp.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await clock.sleep(ms);
        await page.mouse.up();
      });
    };
    // A moment at normal speed so the serve reads, then quarter speed
    // through the opening exchange, then double speed to run out the rest
    // of the point. The long silence held after this line is deliberate: it
    // is that rally, not a stalled video.
    await clock.until(beat("playback2").start + 0.1);
    await holdSide("left", 2000);
    await clock.sleep(300);
    await holdSide("right", 2300);

    // ------------------------------------------------------ 5. scoring
    await clock.until(beat("score1").start - 2.6);
    await attempt("close player", () =>
      page.evaluate(() =>
        document.querySelector('[aria-label="Close player"]')?.click()
      )
    );
    await page.waitForSelector("text=Score Keeper", { timeout: 30000 }).catch(() => {});
    await tap(page, clock, { text: "Score Keeper", tag: "button" }, 1400);
    // Taps land in rhythm under "just by saying who won each point"; the
    // scoreboard climbing under the next line is what proves "keeps itself".
    // The winner pads are a different size in each layout: a tall column in
    // the phone rail, a compact pair inside the floating card on desktop. A
    // single size floor finds one and misses the other entirely.
    const padSize = layout.padSize ?? { w: 120, h: 200 };
    const padMe = { text: "Me", tag: "button", min: padSize };
    const padThem = { text: layout.opponentPad, tag: "button", min: padSize };
    await clock.until(beat("score1").start + 1.6);
    for (const pad of [padMe, padThem, padMe, padThem]) {
      await tap(page, clock, pad, 1100);
    }

    // ------------------------------------- 6. the questions it answers
    await clock.until(beat("score2").end + 0.1);
    await go(page, `${base}/match/${ALEX}`);
    // "Overview" is the card, anchored to the top. Centring the SECTION
    // heading instead left the point-detail panel filling the upper half of
    // a desktop frame, with the chart squeezed underneath it.
    await bring(page, clock, "Overview", layout.headerClear, "start");
    await clock.sleep(300);
    // The CARDS, not "the first big svg on the page". That selector was
    // ringing whatever chart it found, and on this match it found the only
    // one there was: Alex had no loss reasons and two described serves, so
    // the deck rendered a single card and the second ring landed on empty
    // background. The demo data now carries enough for all three
    // (AnalysisCards needs 3 samples per cut), and `div.snap-center` names
    // the card itself at both widths.
    await spot(page, clock, {
      label: "How the match swung",
      spec: { sel: "div.snap-center", nth: 0 },
      until: beat("analysis").start + 3.4,
    });
    // Mobile swipes to the next card; desktop already has both side by side
    // in its 2-up grid, so there is nothing to scroll and scrolling anyway
    // is what dragged the frame off centre.
    if (layout.analysisSwipe) {
      await attempt("next card", () =>
        page.evaluate(() => {
          const h2 = [...document.querySelectorAll("h2")].find(
            (h) => h.textContent.trim() === "Match analysis"
          );
          const deck = h2?.closest("section")?.querySelector("div[class*='snap-x']");
          if (!deck) throw new Error("no analysis deck");
          deck.scrollBy({ left: deck.clientWidth, behavior: "smooth" });
        })
      );
      await clock.sleep(900);
    }
    await spot(page, clock, {
      label: "Why you lost",
      spec: { sel: "div.snap-center", nth: 1 },
      until: beat("analysis").end,
    });

    await clock.until(beat("analysis").end + 0.1);
    await go(page, `${base}/stats`);

    // ---------------------------------------------------- 7. placement
    await clock.until(beat("season").end + 0.1);
    await go(page, `${base}/match/${ALEX}`);
    await bring(page, clock, "Placement maps", layout.headerClear, "start");
    await attempt("onto the maps", () =>
      page.evaluate((y) => window.scrollBy({ top: y, behavior: "auto" }), layout.mapNudge)
    );
    await clock.until(beat("placement").start + 2.6);
    await tap(page, clock, { aria: "Placement heat map" }, 1400);
    await spot(page, clock, {
      label: "Where it kept landing",
      spec: { aria: "Placement heat map" },
      until: beat("placement").end,
    });

    // -------------------------------------------------------- 8. coach
    await clock.until(beat("placement").end + 0.1);
    await go(page, `${base}/match/${ALEX}?p=${COACH_POINT}`);
    await clock.until(beat("coach").start + 3.2);
    await bring(page, clock, "Notes", layout.headerClear);
    // The drawing itself, not the whole Notes block: with a frame drawn on
    // it the section is 550px tall and hangs off a phone screen, and the
    // drawing is the thing worth pointing at anyway.
    //
    // It is signed and lazy, so it has to be scrolled to and WAITED for.
    // Ringing it before it decodes finds no element at all, which is how the
    // beat ended up on an empty box under the note text.
    await attempt("wait for the drawing", async () => {
      await page.evaluate(() => {
        const img = [...document.images].find((i) => i.src.includes("sketch"));
        img?.scrollIntoView({ behavior: "auto", block: "center" });
      });
      // Short and bounded. This is one shot inside a fixed-length take, so a
      // wait that outlives its beat costs every beat after it — a 30s
      // default here pushed the whole cut six seconds long.
      await page.waitForFunction(
        () =>
          [...document.images].some(
            (i) => i.complete && i.naturalWidth > 100 && i.getBoundingClientRect().height > 80
          ),
        { timeout: 3000 }
      );
    });
    await clock.sleep(400);
    await spot(page, clock, {
      label: "Drawn on the frame",
      spec: { sel: "img", visible: true, min: { w: 120, h: 80 } },
      until: beat("coach").end,
    });

    // ------------------------------------------ 9. a review from a stranger
    await clock.until(beat("coach").end + 0.1);
    await go(page, `${base}/orders/${REVIEW_ORDER}`);
    // Nothing ringed. The review reads as a whole — summary, what it is
    // costing you, a practice plan, the points to watch — and singling out
    // one heading made the page look like it had one idea in it.
    await clock.until(beat("review").end);

    // ----------------------------------------- 10. journal, then Recollect
    await clock.until(beat("review").end + 0.1);
    await go(page, `${base}/journal`);
    await clock.until(beat("journal1").start + 2.2);
    await attempt("scroll journal", () =>
      page.evaluate((y) => window.scrollBy({ top: y, behavior: "auto" }), layout.journalScroll)
    );
    // Recollect is open BEFORE the line names it, so the cards are already
    // on screen when she says what they do.
    await clock.until(beat("journal2").start - 1.0);
    await tap(page, clock, { text: "Recollect" }, 1300);

    // ------------------------------------------- 11. export, and sharing
    // Two beats, because the export used to get one and was rushed through
    // it: the line said "with the score burned in" over a settings row with
    // a toggle in it, which shows the option and never the result.
    //
    // The player already draws the exact table the render burns in
    // (ScoreBug.tsx is matched to worker.py::_reel_scorebug so the app and
    // the file you share look alike), so the burn-in can be shown as
    // itself — a live rally with the score sitting on the picture — rather
    // than promised by a checkbox.
    //
    // Started early: a page load plus opening the player costs three or
    // four seconds, and this beat is at the end of the take where there is
    // no slack left to borrow.
    await clock.until(beat("journal2").end - 2.5);
    await go(page, `${base}/match/${MARCO}`);
    await attempt("open player", () => openPlayer(page));
    await playFrom(page, 24);
    // Let the transport fade before measuring. The bug sits 52px up while
    // the controls are on screen and 12px up once they are gone, so a rect
    // read too early is a ring that slides off what it is pointing at.
    await clock.sleep(2200);
    await spot(page, clock, {
      label: "Score burned in",
      spec: { sel: "[data-scorebug]" },
      // 53x28 on a phone, 238x99 on desktop. Both are the right element.
      min: 24,
      until: beat("export").end,
    });

    await attempt("close player", () =>
      page.evaluate(() =>
        document.querySelector('[aria-label="Close player"]')?.click()
      )
    );
    await page.waitForSelector("text=Export", { timeout: 20000 }).catch(() => {});
    await tap(page, clock, { text: "Export", tag: "button", min: { w: 200 } }, 1200);
    await spot(page, clock, {
      label: "One point or the whole match",
      spec: { text: "Include score", tag: "div, label, p", min: { w: 180, h: 44 } },
      until: beat("share").end,
    });

    // -------------------------------------------------------- 11. close
    // The match library, not the dashboard: home carries a first-steps
    // checklist, which is the wrong last thing for a stranger to read.
    await clock.until(beat("share").end + 0.1);
    await go(page, `${base}/matches`);
    await clock.until(beat("close").end + 1.2);
  };
}
