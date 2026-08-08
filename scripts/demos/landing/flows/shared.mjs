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
/**
 * The completed paid review the review beat opens. It is created by
 * flows/review.mjs at the top of a capture and deleted at the end of it —
 * see the note there about the take that filmed a 404.
 */
export { REVIEW_ORDER } from "./review.mjs";
import { REVIEW_ORDER } from "./review.mjs";
import { takeWinners, clearWinners, restoreWinners, pointCuts } from "./scoring.mjs";

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
 * Land on the match page already scrolled past the hero.
 *
 * The match page paints its shell fast and then holds a black rectangle
 * where the video goes, for as long as it takes to resolve a signed URL —
 * seconds, on a cold navigation. Every beat that arrives at this page had
 * that rectangle on screen for the whole gap it was given, which is what
 * two reviews in a row called "an awkward pause where nothing happens".
 *
 * Scrolling after the fact cannot fix it: by the time a flow can find a
 * heading to scroll to, the page has been sitting there for a second and a
 * half. This runs as a context init script, so it is installed before any
 * of the page's own JavaScript on every navigation, and it starts pushing
 * the hero out of frame from the first frame that has anything to push.
 *
 * Opt in per navigation with ?skiphero=<y>, so the beats that genuinely
 * want the top of a page still get it.
 */
const SKIP_HERO = () => {
  const want = Number(new URLSearchParams(location.search).get("skiphero"));
  if (!want) return;
  const t0 = Date.now();
  const tick = () => {
    // Bounded, and it stops the moment it succeeds. It has to let go: the
    // flow's own `bring` scrolls somewhere specific straight afterwards, and
    // two things fighting over scrollTop is its own kind of broken picture.
    if (Date.now() - t0 > 6000) return;
    if (document.scrollingElement) {
      window.scrollTo(0, want);
      if (window.scrollY >= want - 4) return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
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
    // scrollIntoView, not window.scrollTo: the point sheet is its own
    // scroll box drawn over the page, so scrolling the window moves
    // nothing and the coach's notes stayed below the fold. This walks up
    // to whichever ancestor actually scrolls. `center` also removes the
    // need to offset for a sticky header.
    const apply = () =>
      page.evaluate(([t, b, clear]) => {
        const el = [...document.querySelectorAll("h1,h2,h3")].find((h) =>
          h.textContent.trim().toLowerCase().startsWith(t.toLowerCase())
        );
        if (!el) return false;
        el.scrollIntoView({ behavior: "auto", block: b });
        if (b === "start") window.scrollBy(0, -clear);
        return true;
      }, [text, block, headerClear]);

    /** Where the heading ended up, as a share of the viewport. */
    const where = () =>
      page.evaluate((t) => {
        const el = [...document.querySelectorAll("h1,h2,h3")].find((h) =>
          h.textContent.trim().toLowerCase().startsWith(t.toLowerCase())
        );
        return el ? el.getBoundingClientRect().top / window.innerHeight : null;
      }, text);

    // Wait for the heading to EXIST before trying to scroll to it. The
    // match page is client rendered, so `go`'s domcontentloaded plus a beat
    // returns while the body is still a loading shell — bring then found no
    // heading, logged it, and left the take sitting at the top of the page
    // on an unloaded hero.
    await page.waitForFunction(
      (t) =>
        [...document.querySelectorAll("h1,h2,h3")].some((h) =>
          h.textContent.trim().toLowerCase().startsWith(t.toLowerCase())
        ),
      text,
      { timeout: 9000 }
    );
    if (!(await apply())) throw new Error("heading not on the page");

    // Scrolling straight after a navigation gets undone when hydration
    // finishes and React restores scroll to the top. The old fix was to do
    // it twice with 400ms between, which was tuned on a light page and
    // quietly did nothing on the match page — that one hydrates slower than
    // the two attempts lasted, so the "every point you played" line played
    // over the top of the page and a hero video that had not loaded yet.
    // Re-apply until it actually stays put, and say so if it never does.
    let stuck = false;
    for (let i = 0; i < 8; i++) {
      await clock.sleep(260);
      const at = await where();
      if (at === null) break;
      if (at > -0.05 && at < 0.6) {
        stuck = true;
        break;
      }
      await apply();
    }
    if (!stuck) throw new Error("scroll would not stay put");
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

/**
 * Put an element's top edge a fixed distance down the frame.
 *
 * `bring` anchors a HEADING, which is the right handle for "show me this
 * section" and the wrong one for "show me this card": the match page carries
 * 122px of chrome that scrolls with nothing — a sticky app bar with a fixed
 * "Alex · PingPod 1-1" strip under it — so a card anchored off its heading
 * came to rest with its top 17px above the viewport and another 122 behind
 * the bar. Both the analysis deck and the placement maps were shot with
 * their tops sliced off, ring and all.
 *
 * This anchors the thing itself, which is the only measurement that can be
 * checked against the chrome it has to clear.
 */
const place = async (page, clock, spec, top) => {
  await attempt(`place at ${top}`, async () => {
    let last = Infinity;
    for (let i = 0; i < 6; i++) {
      const d = await page.evaluate(([s, t]) => {
        const el = window.__pick(s);
        if (!el) return null;
        const delta = el.getBoundingClientRect().top - t;
        if (Math.abs(delta) > 2) window.scrollBy(0, delta);
        return delta;
      }, [spec, top]);
      if (d === null) throw new Error("no target");
      if (Math.abs(d) <= 2) return;
      // A page already scrolled to its end cannot move any further, and
      // spinning six times over a delta that never shrinks is a slow way of
      // saying so.
      if (Math.abs(d) >= Math.abs(last) - 2) return;
      last = d;
      await clock.sleep(140);
    }
  });
};

export async function prepare(page) {
  // Installed on the context, so it runs before the page's own scripts on
  // every navigation from here on. See SKIP_HERO.
  await page.context().addInitScript(SKIP_HERO);
  // Open on home. The product is named over the thing being sold — the app
  // itself, with real matches in it — rather than over raw match footage,
  // which shows the sport but says nothing about the software.
  await page.waitForSelector("text=Recent matches", { timeout: 40000 }).catch(() => {});
  // Retire the player's first-run gesture hints. They are per-device
  // localStorage (gestureHints.ts) and a capture always runs in a fresh
  // profile, so every take so far had "Double tap the right side for the
  // next point" floating over the middle of the picture — including across
  // the whole beat about the score being burned into it. A landing video is
  // not where anyone learns the gestures.
  await attempt("retire gesture hints", () =>
    page.evaluate(() =>
      window.localStorage.setItem(
        "ponglens:gesture-hints",
        JSON.stringify({ shown: {}, done: { dtap: true, hold: true, score: true } })
      )
    )
  );
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
  return async function flow(page, clock, { beat, dismiss, serviceKey }) {
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

    // ----------------------------------------------- 2. bringing one in
    // The line names two routes in, so the picture rings them in the order
    // it says them: "from your phone" on the upload card, "or straight from
    // YouTube" on the import card. One ring held across the whole line
    // pointed at the upload box while she was already talking about YouTube,
    // and the YouTube box was never shown at all.
    // Left half a second early: a production page load costs about a
    // second, and the gap after the intro line is shorter than that, so
    // waiting for the gap to open means loading under the next sentence.
    await clock.until(beat("intro").end - 0.5);
    await go(page, `${base}/upload`);
    // The score comes off here, with the upload screen up and the match page
    // not yet loaded, so the point list and the pad are honestly a match
    // nobody has scored. It goes back on before the analysis beat re-reads
    // the page — see flows/scoring.mjs for why the window is this shape.
    // The dashboard has already had its beat, so it keeps its 1-1.
    let taken = null;
    if (serviceKey) {
      taken = await takeWinners(serviceKey, ALEX);
      await clearWinners(serviceKey, ALEX);
      console.log(`  score off ${ALEX.slice(0, 8)} (${taken.count} points)`);
    }
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
    // The point list, then uninterrupted playback. The jump-to-point grid
    // used to open here as "proof" that the match came back cut up, and it
    // was a bad trade: a panel slid over the picture the instant the rally
    // got going. The list says the same thing without covering anything.
    await clock.until(beat("upload").end - 0.7);
    await go(page, `${base}/match/${ALEX}?skiphero=${layout.heroSkip}`);
    // The points, not the top of the page. The match hero has to resolve a
    // signed URL before it paints anything, so arriving at the top means
    // four seconds of black rectangle under the one line that is about what
    // the match comes back AS. The point list renders with the page and is
    // the literal subject of the sentence, so it is both the faster picture
    // and the better one.
    await bring(page, clock, "Points", layout.headerClear, "start");
    // Then into the player, timed so the rally is already running at normal
    // speed when the next line starts and the speed holds begin.
    await clock.until(beat("playback1").end - 3.6);
    await attempt("open player", () => openPlayer(page));

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
    // A bare seek to the boundary, not a click on "Replay this point": that
    // control lives in the transport, which hides itself while the video is
    // playing, and a press that lands on faded chrome is the silent no-op
    // this pipeline keeps getting caught by. The number is exact because it
    // was read from the player, so there is nothing left for the button to
    // add.
    await clock.until(beat("playback1").end - 1.1);
    await playFrom(page, 89.34);

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
    //
    // The fast half is measured against the clock rather than given a fixed
    // length. Line durations move by up to a second between narration runs
    // — the same sentence came back 7.15s one day and 8.33s the next — so a
    // hardcoded hold that fits today overruns into the next beat tomorrow,
    // and clock.until cannot rewind once it does.
    const scoreAt = beat("score1").start - 2.6;
    await clock.until(beat("playback2").start + 0.1);
    await holdSide("left", 2000);
    await clock.sleep(300);
    await holdSide("right", Math.max(900, Math.min(2600, (scoreAt - clock.now()) * 1000 - 150)));

    // ------------------------------------------------------ 5. scoring
    await clock.until(scoreAt);
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
    // Each answer goes in at the END of its rally, which is where the pad
    // waits for you and the only place a tap actually moves the match on.
    // See pointCuts. Alternating winners is safe: the "why did I lose it"
    // sheet only opens from the Why chip (Player.tsx, opts.thenWhy), never
    // from a plain winner tap.
    const cuts = serviceKey ? await pointCuts(serviceKey, ALEX, 4) : [];
    await clock.until(beat("score1").start + 1.4);
    for (let i = 0; i < cuts.length; i++) {
      await attempt(`to the end of point ${i + 1}`, () =>
        page.evaluate((t) => {
          const v = document.querySelector("video");
          if (!v) return;
          v.currentTime = t;
          void v.play().catch(() => {});
        }, cuts[i].at)
      );
      await clock.sleep(700);
      await tap(page, clock, i % 2 === 0 ? padMe : padThem, 380);
    }

    // Score back on, with a couple of seconds to spare before the analysis
    // beat navigates. Not wrapped in `attempt`: everything from here to the
    // end of the video is downstream of this, so a half-landed restore
    // should end the take, not quietly survive it. guard.mjs restores from
    // its own disk snapshot on the way out either way.
    if (taken) {
      const back = await restoreWinners(serviceKey, taken);
      console.log(`  score back on (${back} points)`);
    }

    // ------------------------------------- 6. the questions it answers
    await clock.until(beat("score2").end + 0.1);
    await go(page, `${base}/match/${ALEX}?skiphero=${layout.heroSkip}`);
    // "Overview" is the card, anchored to the top. Centring the SECTION
    // heading instead left the point-detail panel filling the upper half of
    // a desktop frame, with the chart squeezed underneath it.
    await bring(page, clock, "Overview", layout.headerClear, "start");
    // Then put the deck itself clear of the fixed match bar. Anchoring on
    // the heading alone left the cards' top edge 17px above the frame with
    // another 122 behind the chrome, so both rings opened on a card whose
    // title was somewhere off screen.
    await place(page, clock, { sel: "div.snap-center", nth: 0 }, layout.chromeClear + layout.deckGap);
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
    await go(page, `${base}/match/${ALEX}?skiphero=${layout.heroSkip}`);
    await bring(page, clock, "Placement maps", layout.headerClear, "start");
    // The whole section, sat just under the chrome. It used to be nudged a
    // fixed distance past its heading, which put the heading and the game
    // filter half behind the fixed match bar — a title sliced down the
    // middle is the first thing anyone notices in a still.
    await place(page, clock, { sectionOf: "Placement maps" }, layout.chromeClear + 10);
    await clock.until(beat("placement").start + 2.6);
    await tap(page, clock, { aria: "Placement heat map" }, 1400);
    // Nothing ringed. The ring here lasted half a second — the beat spends
    // most of its length switching to the heat map, so the box arrived after
    // the tap and left with the line — and a highlight that blinks reads as
    // a glitch rather than as emphasis.
    await clock.until(beat("placement").end);

    // -------------------------------------------------------- 8. coach
    // No navigation. The point sheet is an overlay on the page already on
    // screen, so opening it by its card is instant, where re-loading the
    // match at ?p= cost a second and a half of loading hero in the only gap
    // this beat has. Same picture, none of the black.
    await clock.until(beat("placement").end + 0.1);
    await attempt("open the coach's point", async () => {
      // Back up to the timeline first. Expanding it adds forty-nine cards
      // ABOVE the placement maps, so doing it from down there would yank
      // several thousand pixels of page out from under the frame; done from
      // the list itself the growth happens where the eye already is.
      await page.evaluate((y) => window.scrollTo(0, y), layout.heroSkip);
      // The timeline renders its first ten points and hides the rest behind
      // "Show all" (POINTS_PREVIEW in MatchView). The coach's point is the
      // 53rd, so until this runs the card is genuinely not in the document
      // and clicking it is a silent no-op.
      await page.evaluate(() =>
        [...document.querySelectorAll("button")]
          .find((b) => b.textContent.trim().startsWith("Show all"))
          ?.click()
      );
      await page.waitForFunction(
        (id) => Boolean(document.getElementById(`point-card-${id}`)),
        COACH_POINT,
        { timeout: 5000 }
      );
      await page.evaluate((id) => {
        const el = document.getElementById(`point-card-${id}`);
        (el?.querySelector('[role="button"][aria-label^="Open point"]') ?? el)?.click();
      }, COACH_POINT);
      await page.waitForFunction(
        () =>
          [...document.querySelectorAll("h3")].some(
            (h) => h.textContent.trim() === "Notes"
          ),
        { timeout: 8000 }
      );
    });
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
    // the file you share look alike), so the burn-in gets shown as itself —
    // a live rally with the score sitting on the picture.
    //
    // The sheet goes FIRST and the picture second, and that ordering is
    // what makes the beat fit at all: the sheet is a page load and one tap,
    // where opening the player and letting its transport fade costs about
    // six seconds against a five second line. The lines were written in the
    // order the pictures can actually arrive, and l13's three second hold
    // is the window the player opens in.
    //
    // Shot on Alex, like the rest of the video. This beat used to run on
    // Marco because his match carried a finished export, which is not
    // something the picture ever shows — and he has not consented to being
    // in a public video, which is the only argument that matters.
    await clock.until(beat("journal2").end + 0.1);
    // Tools, not the point list. This beat used to land wherever the
    // hero-skip put it, which was halfway down the timeline: eight seconds
    // of scrolling past point cards under a line about exporting, and then
    // a tap on a button nobody had been shown. The tools card is where both
    // of these live, and it is the answer to "where do I do this".
    await go(page, `${base}/match/${ALEX}?skiphero=${layout.toolsSkip}`);
    await place(page, clock, { sectionOf: "Tools" }, layout.chromeClear + 10);
    const exportRow = { text: "Export", tag: "button", min: { w: 200 } };
    // The ring opens BEFORE the line does. Everything after it in this beat
    // is on a clock — a sheet to show, a player to open, a transport to wait
    // out — and the second the ring borrows from the silence in front is a
    // second the picture does not have to borrow from the sentence.
    await clock.until(beat("export").start - 1.0);
    await spot(page, clock, {
      label: "One point or the whole match",
      spec: exportRow,
      until: beat("export").start + 1.2,
    });
    await tap(page, clock, exportRow, 900);
    await clock.until(beat("export").end - 0.5);

    await attempt("close export sheet", () =>
      dismiss(page, {
        click: { aria: "Close export sheet" },
        gone: { text: "Include score", tag: "div, label, p" },
      })
    );
    await attempt("open player", () => openPlayer(page));
    // Anywhere in the cut is inside a rally — that is the product — so this
    // only has to be far from the 89s rally the speed beat already used.
    await playFrom(page, 150);
    // Wait for the transport to hide itself before measuring. It fades 2.5s
    // after playback starts, and the bug sits 52px up while it is on screen
    // against 12px once it is gone — a rect read too early is a ring that
    // sits above the thing it points at for the whole beat.
    //
    // "Unchanged since the last poll" is NOT enough on its own, and that is
    // how the first take got it wrong: controls-still-visible is every bit
    // as stable as controls-gone, so the check passed a second in and
    // measured the raised position. The elapsed floor is what makes it
    // outlast the fade rather than agree with whatever it finds first.
    // Wait for the transport to hide itself before measuring: the bug sits
    // 52px up while it is on screen and 12px once it is gone, so a rect read
    // too early is a ring floating above the thing it points at.
    //
    // This used to be an elapsed-time guess, and it had to be a generous one
    // because "unchanged since the last poll" is every bit as true of
    // controls-visible as of controls-gone. Ask the real question instead:
    // the chrome fades as a block, so the close button ends up inside an
    // ancestor at opacity 0, and that is the state itself rather than a
    // stopwatch pointed at it. Tapping the picture to hurry it along is not
    // an option — in watch mode a tap is play/pause.
    await attempt("let the transport fade", () =>
      page.waitForFunction(
        () => {
          const el = document.querySelector('[aria-label="Close player"]');
          if (!el) return false;
          for (let n = el; n; n = n.parentElement) {
            if (Number(getComputedStyle(n).opacity) < 0.1) return true;
          }
          return false;
        },
        { timeout: 9000, polling: 200 }
      )
    );
    await clock.sleep(250);
    await spot(page, clock, {
      label: "Score burned in",
      spec: { sel: "[data-scorebug]" },
      // 53x28 on a phone, 238x99 on desktop. Both are the right element, so
      // the blanket 40px floor would have dropped the ring on the phone cut
      // while quietly succeeding on the desktop one.
      min: 24,
      // Into the hold after the line, not up to it. The ring cannot exist
      // until the transport has faded, which is about two seconds after
      // this line starts, so ending it on the last word would leave it on
      // screen for barely a second — and a ring that blinks reads as a
      // glitch rather than as emphasis.
      until: beat("share").end + 0.8,
    });

    // ------------------------------------------- 12. and a link to send
    // The other half of sharing, and the half that costs nothing: a public
    // link to the starred points, which is what most people actually want
    // to send their family. Same shape as the export beat — the row is
    // ringed first, then opened — so the two read as a pair.
    await clock.until(beat("share").end + 0.9);
    await attempt("close player", () =>
      page.evaluate(() =>
        document.querySelector('[aria-label="Close player"]')?.click()
      )
    );
    await place(page, clock, { sectionOf: "Tools" }, layout.chromeClear + 10);
    const shareRow = { text: "Share", tag: "button", min: { w: 200 } };
    await spot(page, clock, {
      label: "A link anyone can watch",
      spec: shareRow,
      until: beat("link").start + 1.3,
    });
    // Opening the sheet writes nothing: it offers the starred points and the
    // whole match, and only a press on one of those mints a link.
    await tap(page, clock, shareRow, 900);

    // -------------------------------------------------------- 13. close
    // The match library, not the dashboard: home carries a first-steps
    // checklist, which is the wrong last thing for a stranger to read.
    await clock.until(beat("link").end + 0.1);
    await go(page, `${base}/matches`);
    await clock.until(beat("close").end + 1.2);
  };
}
