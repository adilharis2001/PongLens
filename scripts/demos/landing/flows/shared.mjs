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
 * Nothing is drawn over the picture. No boxes, no labels, no chapter
 * header: the script is at benefit level and the frames are whole screens,
 * so there is no specific control that needs pointing at.
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
const spot = async (page, clock, { label, spec, until }) => {
  let entry = null;
  await attempt(`spot ${label}`, async () => {
    const rect = await clock.rect(spec);
    if (!rect || rect.w < 40 || rect.h < 40) throw new Error("rect too small to box");
    entry = clock.mark({ kind: "box", label, rect });
  });
  await clock.until(until);
  if (entry) clock.close(entry);
};

export function makeFlow(layout) {
  return async function flow(page, clock, { beat, dismiss }) {
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
    await go(page, `${base}/upload`);
    await clock.until(beat("upload").start + 2.2);
    await attempt("scroll to YouTube", () =>
      page.evaluate((y) => window.scrollBy({ top: y, behavior: "auto" }), layout.uploadScroll)
    );
    await clock.sleep(500);
    await spot(page, clock, {
      label: "From your phone",
      spec: { sectionOf: "Upload a match" },
      until: beat("upload").end,
    });

    // --------------------------------- 3. what comes back: every point
    // The library of points IS the proof that the match came back cut up.
    await clock.until(beat("upload").end - 0.7);
    await go(page, `${base}/match/${ALEX}`);
    // The player's jump-to-point grid, not a row in a list. Every point of
    // the match laid out at once IS "it comes back as every point you
    // played"; a ring around one list row pointed at the wrong idea.
    await clock.until(beat("playback1").start + 1.2);
    await attempt("open player", () => openPlayer(page));
    await playFrom(page, 40);
    await clock.sleep(700);
    await tap(page, clock, { aria: "Jump to a point" }, 1200);
    await clock.until(beat("playback1").end - 1.4);

    // ------------------- 4. playback built for studying: shown, not said
    // No navigation: the player opens from the page we are already on, which
    // buys back the second a reload would have cost.
    // Back to the picture for the speed holds; the player is already open.
    //
    // Through dismiss(), which clicks the real control and then PROVES the
    // panel is gone. The previous version looked for aria-label="Close" and
    // that control is a text button, so it matched nothing, reported
    // nothing, and left the grid sitting over the whole scoring beat.
    await attempt("close jump grid", () =>
      dismiss(page, {
        click: { text: "Close", tag: "button" },
        gone: { text: "Jump to a point" },
      })
    );
    await playFrom(page, 78);
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
    // Skim fast, then drop into slow motion. The silence after this line is
    // deliberate: it is a rally at quarter speed, not a stalled video.
    await clock.until(beat("playback2").start - 0.6);
    await holdSide("right", 1900);
    await clock.sleep(250);
    await holdSide("left", 2600);

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
    await spot(page, clock, {
      label: "How the match swung",
      spec: { sel: "svg", min: { w: 150, h: 80 } },
      until: beat("analysis").start + 3.4,
    });
    // Across the carousel to the next card. One chart is a chart; the cards
    // together are the answer the line is promising.
    await attempt("next card", () =>
      page.evaluate(() => {
        const el = [...document.querySelectorAll("*")].find((n) => {
          const st = getComputedStyle(n);
          return n.scrollWidth > n.clientWidth + 80 && /auto|scroll/.test(st.overflowX);
        });
        if (el) el.scrollBy({ left: el.clientWidth, behavior: "smooth" });
      })
    );
    await clock.sleep(1000);
    await spot(page, clock, {
      label: "What it cost you",
      spec: { sel: "svg", min: { w: 110, h: 70 } },
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
    await clock.until(beat("review").start + 2.4);
    await spot(page, clock, {
      label: "What it cost you",
      spec: { sectionOf: "What is costing you points" },
      until: beat("review").end,
    });

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

    // ------------------------------------------------------- 10. export
    await clock.until(beat("journal2").end + 0.1);
    await go(page, `${base}/match/${MARCO}`);
    await tap(page, clock, { text: "Export", tag: "button", min: { w: 200 } }, 1400);
    await spot(page, clock, {
      label: "Score burned in",
      spec: { text: "Include score", tag: "div, label, p", min: { w: 180, h: 44 } },
      until: beat("export").end,
    });

    // -------------------------------------------------------- 11. close
    // The match library, not the dashboard: home carries a first-steps
    // checklist, which is the wrong last thing for a stranger to read.
    await clock.until(beat("export").end + 0.1);
    await go(page, `${base}/matches`);
    await clock.until(beat("close").end + 1.2);
  };
}
