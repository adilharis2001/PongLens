/**
 * "Introduction to PongLens" — the shot list, shared by both cuts.
 *
 * The player video and the coach video each explain one half of the product
 * to the person who would buy it. This one explains the whole thing to
 * someone who has never heard of it: a friend, an investor, anyone Adil
 * hands a link to before a conversation. So it runs both halves in one
 * take, and it stays at the altitude a person would actually talk at
 * rather than the altitude a user manual would.
 *
 * THREE THINGS IT DOES DIFFERENTLY FROM THE OTHER TWO
 *
 * 1. It changes account halfway through. The player half is the demo
 *    student, the coach half is the demo coach, and there is no version of
 *    this video where one account can show both. The switch happens behind
 *    the "For coaches" separator card, which is the only reason a sign-out,
 *    a magic link and two redirects are not on screen.
 *
 * 2. It has separators at all. `chapters/intro.json` marks two lines with
 *    `separator`, and Landing.tsx holds a full-frame title for as long as
 *    each is spoken. They exist because the two halves are two products to
 *    anyone watching, and running them together reads as the video losing
 *    its place.
 *
 * 3. The coach half is deliberately shallower than flows/coach.mjs. That
 *    video walks a coach through Stripe onboarding, the offering editor,
 *    Tidy up, the submission checklist and attachments, because a coach
 *    deciding whether to sell here needs all of it. Someone being shown the
 *    product for the first time does not, and the depth mismatch between
 *    the two halves was the thing to avoid. Rough rule: every coach beat
 *    here is one sentence where the coach video spends two or three.
 *
 * Everything else is lifted from the two flows that already work, including
 * the scroll offsets and the element specs, because those were paid for one
 * re-shoot at a time. See shared.mjs for why the score comes off during the
 * upload beat, why navigation only ever happens in a gap, and why `bring`
 * jumps instead of scrolling.
 */

import {
  ALEX,
  COACH_POINT,
  attempt,
  bring,
  go,
  openPlayer,
  pictureRect,
  place,
  playFrom,
  spot,
  tap,
} from "./shared.mjs";
import { takeWinners, clearWinners, restoreWinners, pointCuts } from "./scoring.mjs";
import {
  COACH_HANDLE,
  ORDER_ACTIVE,
  ORDER_DONE,
  arrive,
  click,
  glide,
  stage as coachStage,
  place as placeText,
} from "./coach.mjs";

const SUPABASE = "https://pdycinmyfnritemrsfjf.supabase.co";
/** The demo student, whose journal the Ask beat asks a question of. */
const DEMO_USER = "6eb09df4-7d44-4ef9-b1cc-8cdfc4119fc4";

/**
 * Everything the take needs set up, in one place.
 *
 * The coach's order is rewound so the accept can be filmed (see
 * coach.mjs), and the demo account's Ask ledger is emptied so the question
 * gets a real answer.
 *
 * That second one is not optional. Ask is capped at 25 questions a user a
 * day, and the demo account is what everybody develops against — the first
 * take of this beat filmed "That is all your questions for today", which is
 * a true sentence and the worst possible advertisement for the feature.
 * `journal_ask_runs` is a rate-limit ledger for a test account and nothing
 * else, so clearing it costs nothing and there is nothing to put back.
 */
export async function stage(key) {
  await coachStage(key);
  const res = await fetch(
    `${SUPABASE}/rest/v1/journal_ask_runs?user_id=eq.${DEMO_USER}`,
    {
      method: "DELETE",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: "return=minimal",
      },
    }
  );
  console.log(
    res.ok
      ? "  cleared the demo account's ask ledger"
      : `  ! could not clear the ask ledger: ${res.status}`
  );
}

/**
 * A signed-in URL for another account, minted ahead of time.
 *
 * The window this take has to change identity in is the length of one
 * spoken line — about four seconds. Asking Supabase for the link inside
 * that window would spend a chunk of it on a network round trip that has
 * nothing to do with the browser, so the link is fetched during an earlier
 * beat and only the navigation happens behind the card.
 *
 * Magic links are single use and do not expire in four seconds, so minting
 * early costs nothing.
 */
const magicLinkFor = async (serviceKey, base, email, next) => {
  const res = await fetch(`${SUPABASE}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "magiclink", email }),
  });
  const data = await res.json();
  if (!data.hashed_token) {
    throw new Error(`magic link failed: ${JSON.stringify(data)}`);
  }
  return `${base}/auth/confirm?token_hash=${data.hashed_token}&type=email&next=${encodeURIComponent(next)}`;
};

export function makeFlow(layout) {
  return async function flow(page, clock, { beat, dismiss, serviceKey }) {
    const base = process.env.BASE ?? "https://www.ponglens.com";
    const WORK = `${base}/coaching/orders/${ORDER_ACTIVE}`;

    // ================================================== the opening
    // Two lines over the player's home screen. The product is named over
    // the app with real matches in it, not over match footage: the footage
    // shows the sport and says nothing about the software.

    // ================================================== FOR PLAYERS
    // The separator card is up from about 13.6s, so the upload page can be
    // loaded under it rather than in a gap. This is the one navigation in
    // the take that is genuinely free.
    await clock.until(beat("players").start - 0.4);
    await go(page, `${base}/upload`);

    // The score comes off with the upload screen showing and the match page
    // not yet loaded, so the point list and the pad are honestly a match
    // nobody has scored. It goes back on before the analysis beat re-reads
    // the page. See flows/scoring.mjs.
    let taken = null;
    if (serviceKey) {
      taken = await takeWinners(serviceKey, ALEX);
      await clearWinners(serviceKey, ALEX);
      console.log(`  score off ${ALEX.slice(0, 8)} (${taken.count} points)`);
    }

    // -------------------------------------------------- upload
    // The line names two routes in, so the picture rings them in the order
    // it says them.
    await clock.until(beat("upload").start - 0.2);
    await spot(page, clock, {
      label: "From your phone",
      spec: { sectionOf: "Upload a match" },
      until: beat("upload").start + 2.1,
    });
    if (layout.uploadScroll) {
      await attempt("scroll to YouTube", () =>
        page.evaluate((y) => window.scrollBy({ top: y, behavior: "auto" }), layout.uploadScroll)
      );
      await clock.sleep(350);
    }
    await spot(page, clock, {
      label: "Or a YouTube link",
      spec: { sectionOf: "Import from YouTube" },
      until: beat("upload").end,
    });

    // -------------------------------------------------- every point
    await clock.until(beat("upload").end - 0.7);
    await go(page, `${base}/match/${ALEX}?skiphero=${layout.heroSkip}`);
    // The points, not the top of the page: the match hero holds a black
    // rectangle until a signed URL resolves, and the point list is both the
    // faster picture and the literal subject of the sentence.
    await bring(page, clock, "Points", layout.headerClear, "start");

    // -------------------------------------------------- playback
    // Position the playhead BEFORE the takeover opens, so the first frame
    // the player paints is already the rally this beat wants. 89.34s is the
    // longest rally in the cut, read off the player's own point boundaries.
    // Late enough that the POINT LIST is what is on screen for the line
    // about the match coming back as clips. At 3.6s of lead the takeover
    // had already cut in by the time the sentence was half spoken, so the
    // one line that is about the list was played over the player.
    await clock.until(beat("cut").end - 2.0);
    const startSlowAt = beat("playback").start + 0.6;
    const preLead = Math.max(0.6, Math.min(6, startSlowAt - clock.now() - 2.6));
    await attempt("pre-position the playhead", () =>
      page.evaluate((t) => {
        const v = document.querySelector("video");
        if (v) v.currentTime = t;
      }, 89.34 - preLead)
    );
    await attempt("open player", () => openPlayer(page));
    const lead = Math.max(0.6, Math.min(6, startSlowAt - clock.now() - 0.3));
    await playFrom(page, 89.34 - lead, 1.5);

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
    const zoom = async (dir, times) => {
      for (let i = 0; i < times; i++) {
        await tap(page, clock, { aria: `Zoom ${dir}` }, 320);
      }
    };
    // Slow first so the contact reads, then the zoom the line names, then
    // fast to run out the rest of the point. The hold after this line is
    // that rally, not a stalled video.
    const scoreAt = beat("score").start - 2.8;
    await clock.until(startSlowAt);
    await holdSide("left", 1900);
    await clock.sleep(250);
    await zoom("in", 2);
    await clock.sleep(1100);
    await zoom("out", 2);
    await clock.sleep(150);
    await holdSide(
      "right",
      Math.max(900, Math.min(2600, (beat("playback").end + 1.2 - clock.now()) * 1000))
    );

    // ------------------------------- moving around the match
    // Replay, then the jump grid. Both are on the transport, which has
    // faded itself out by now — that does not matter, because
    // element.click() dispatches straight at the element and CSS
    // pointer-events never sees it.
    await clock.until(beat("playback2").start - 0.8);
    await tap(page, clock, { aria: "Replay this point" }, 900);
    await clock.until(beat("playback2").start + 1.6);
    await tap(page, clock, { aria: "Jump to a point" }, 800);
    await clock.until(beat("playback2").end + 0.4);
    // The grid does NOT close on Escape, which the first probe of this
    // screen got wrong: the key was pressed, the check passed on a
    // selector that never existed, and the panel was still on screen
    // behind the next sheet. It has a Close button and that is the only
    // thing that shuts it. The gone-spec is one of the grid's own point
    // buttons, which exist only while it is open.
    await attempt("close the jump grid", () =>
      dismiss(page, {
        click: { text: "Close", tag: "button" },
        gone: { aria: "Play point 30" },
      })
    );

    // ------------------------------- a note, and the pencil, on the frame
    // The note sheet carries all three things the line names at once: the
    // coach's note already on this point, "Draw on this frame", and the
    // microphone next to the box. Opening it writes nothing.
    await clock.until(beat("playback3").start - 1.1);
    await tap(page, clock, { aria: "Add a note on this point" }, 900);
    await spot(page, clock, {
      label: "Draw on this frame",
      spec: { text: "Draw on this frame", tag: "button" },
      // 152x30. The blanket 40px floor drops this cue outright, and a
      // label chip tucks inside a target this short — so the chip goes
      // above it, which BoxCue already does for anything below y=96.
      min: 24,
      until: beat("playback3").end,
    });
    // `visible: true` is load-bearing. The note sheet does not unmount when
    // it closes, it slides off the bottom: the Draw button is still in the
    // document at y=2028 in an 810 frame. A presence-only gone-spec is
    // therefore never satisfied, and the first take spent eight seconds
    // retrying a close that had already worked — which put every beat after
    // it late and cost the take.
    await attempt("close the note sheet", () =>
      dismiss(page, {
        click: { text: "Close", tag: "button" },
        gone: { text: "Draw on this frame", tag: "button", visible: true },
      })
    );

    // -------------------------------------------------- scoring
    await clock.until(scoreAt);
    await attempt("close player", () =>
      page.evaluate(() =>
        document.querySelector('[aria-label="Close player"]')?.click()
      )
    );
    await page.waitForSelector("text=Score Keeper", { timeout: 30000 }).catch(() => {});
    await tap(page, clock, { text: "Score Keeper", tag: "button" }, 1400);
    const padSize = layout.padSize ?? { w: 120, h: 200 };
    const padMe = { text: "Me", tag: "button", min: padSize };
    const padThem = { text: layout.opponentPad, tag: "button", min: padSize };
    // Each answer goes in at the END of its rally, which is where the pad
    // waits for you and the only place a tap moves the match on.
    const cuts = serviceKey ? await pointCuts(serviceKey, ALEX, 4) : [];
    await clock.until(beat("score").start + 1.6);
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

    // Not wrapped in `attempt`: everything from here to the end of the
    // player half is downstream of this, so a half-landed restore should end
    // the take rather than quietly survive it.
    if (taken) {
      const back = await restoreWinners(serviceKey, taken);
      console.log(`  score back on (${back} points)`);
    }

    // -------------------------------------------------- match analysis
    await clock.until(beat("score").end + 0.2);
    await go(page, `${base}/match/${ALEX}?skiphero=${layout.analysisSkip}`);
    await bring(page, clock, "Overview", layout.headerClear, "start");
    await place(page, clock, { sel: "div.snap-center", nth: 0 }, layout.chromeClear + layout.deckGap);
    await clock.sleep(300);
    await spot(page, clock, {
      label: "How the match swung",
      spec: { sel: "div.snap-center", nth: 0 },
      until: beat("analysis").start + 3.6,
    });
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
      label: "Where it turned",
      spec: { sel: "div.snap-center", nth: 1 },
      until: beat("analysis").end,
    });

    // -------------------------------------------------- over time
    await clock.until(beat("analysis").end + 0.1);
    await go(page, `${base}/stats`);

    // -------------------------------------------------- placement maps
    await clock.until(beat("season").end + 0.1);
    await go(page, `${base}/match/${ALEX}?skiphero=${layout.placementSkip}`);
    await bring(page, clock, "Placement maps", layout.headerClear, "start");
    await place(page, clock, { sectionOf: "Placement maps" }, layout.chromeClear + 10);
    await clock.until(beat("placement").start + 2.8);
    await tap(page, clock, { aria: "Placement heat map" }, 1400);
    await clock.until(beat("placement").end);

    // -------------------------------------------------- your coach
    // No navigation: the point sheet is an overlay on the page already on
    // screen. Two halves matching the two halves of the line — how the
    // match reaches them, then what they leave on it.
    await clock.until(beat("placement").end + 0.1);
    await place(page, clock, { sectionOf: "Tools" }, layout.chromeClear + 10);
    const coachRow = { text: "Coach", tag: "button", min: { w: 200 } };
    await clock.until(beat("coach").start - 0.7);
    await spot(page, clock, {
      label: "Share it with your coach",
      spec: coachRow,
      until: beat("coach").start + 1.8,
    });
    // Opening the sheet writes nothing; only Create invite link would.
    await tap(page, clock, coachRow, 900);
    await clock.until(beat("coach").start + 3.4);
    await attempt("close the coach sheet", () =>
      dismiss(page, {
        click: { aria: "Close" },
        gone: { text: "Share with coach", tag: "h2, h3, p, div" },
      })
    );
    await attempt("open the coach's point", async () => {
      // Only the first ten points render; the coach's is the 53rd, so until
      // "Show all" runs the card is genuinely not in the document.
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
        undefined,
        { timeout: 8000 }
      );
    });
    // The drawing is signed and lazy, so it has to be waited for: ringing it
    // before it decodes finds no element at all.
    await attempt("to the drawing", async () => {
      await page.waitForFunction(
        () =>
          [...document.images].some(
            (i) => i.src.includes("sketch") && i.complete && i.naturalWidth > 100
          ),
        undefined,
        { timeout: 4000 }
      );
      await page.evaluate(() => {
        const img = [...document.images].find((i) => i.src.includes("sketch"));
        img?.scrollIntoView({ behavior: "auto", block: "center" });
      });
    });
    await clock.sleep(400);
    await spot(page, clock, {
      label: "Drawn on the frame",
      spec: { sel: "img", visible: true, min: { w: 120, h: 80 } },
      until: beat("coach").end,
    });

    // -------------------------------------------------- the journal
    await clock.until(beat("coach").end + 0.1);
    await go(page, `${base}/journal`);
    await clock.until(beat("journal").start + 2.2);
    await attempt("scroll journal", () =>
      page.evaluate((y) => window.scrollBy({ top: y, behavior: "auto" }), layout.journalScroll)
    );

    // -------------------------------------------------- ask the journal
    // The example chips sit under the search box at the top of the page,
    // and they only render while the box is empty and nothing has been
    // asked — so the picture is the top of the journal, not the feed the
    // previous line was showing.
    //
    // The question is asked in the gap BEFORE the line, not under it. The
    // answer is a model call against production and it takes a few
    // seconds; started on the line, the whole sentence would play over a
    // pulsing "thinking" placeholder. Started in the gap, the answer is
    // arriving as she says what it does.
    await clock.until(beat("journal").end + 0.2);
    await attempt("back to the top of the journal", () =>
      page.evaluate(() => window.scrollTo({ top: 0, behavior: "auto" }))
    );
    await clock.sleep(400);
    await attempt("ask the journal", () =>
      page.evaluate(() => {
        // The example chips are pills, and they are the only buttons on
        // this page whose own text is a question. Matching on the question
        // mark alone would also find anything else that happens to ask
        // one, so the pill shape is half the test.
        const chip = [...document.querySelectorAll("button")].find(
          (b) =>
            b.className.includes("rounded-full") &&
            b.textContent.trim().endsWith("?")
        );
        if (!chip) throw new Error("no example question on the journal");
        chip.click();
      })
    );
    // Wait for the ANSWER, not for a stopwatch. A fixed sleep is either
    // dead air or a screenshot of the placeholder, depending on how busy
    // the model is that minute. The panel opening is not enough on its
    // own: it opens immediately and pulses while it thinks, so the test is
    // "the panel is there AND nothing on the page is still pulsing".
    await attempt(
      "wait for the answer",
      () =>
        page.waitForFunction(
          () =>
            Boolean(document.querySelector('[aria-label="Close the answer"]')) &&
            !document.querySelector(".animate-pulse"),
          undefined,
          { timeout: 11000, polling: 200 }
        ),
      12000
    );
    await clock.until(beat("ask").end);

    // -------------------------------------------------- sharing
    // The sheet first and the picture second, because that is the order the
    // pictures can arrive in: the sheet is a page load and one tap, where
    // opening the player and waiting out its transport costs about six
    // seconds against a six second line.
    await clock.until(beat("journal").end + 0.1);
    await go(page, `${base}/match/${ALEX}?skiphero=${layout.toolsSkip}`);
    await place(page, clock, { sectionOf: "Tools" }, layout.chromeClear + 10);
    const exportRow = { text: "Export", tag: "button", min: { w: 200 } };
    await clock.until(beat("share").start - 1.0);
    await spot(page, clock, {
      label: "One point or the whole match",
      spec: exportRow,
      until: beat("share").start + 1.4,
    });
    await tap(page, clock, exportRow, 900);
    await clock.until(beat("share").start + 3.0);
    await attempt("close export sheet", () =>
      dismiss(page, {
        click: { aria: "Close export sheet" },
        gone: { text: "Include score", tag: "div, label, p" },
      })
    );
    await attempt("open player", () => openPlayer(page));
    // Anywhere in the cut is inside a rally; this only has to be far from
    // the 89s rally the playback beat already used.
    await playFrom(page, 150);
    // The transport fades as a block, so an ancestor at opacity 0 is the
    // state itself rather than a stopwatch pointed at it. The score bug
    // sits 52px up while the chrome is on screen and 12px once it is gone.
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
      label: "Score on the picture",
      spec: { sel: "[data-scorebug]" },
      // 53x28 on a phone, 238x99 on desktop. Both are the right element, so
      // the blanket 40px floor would drop the ring on the phone cut while
      // quietly succeeding on the desktop one.
      min: 24,
      until: beat("share").end + 0.6,
    });

    // ================================================== FOR COACHES
    // Everything here happens behind the separator card: the player's
    // session is dropped, the coach's magic link is followed, and two
    // redirects land on the coaching home. None of it is on screen.
    //
    // The link is minted BEFORE the card comes up, so the only thing inside
    // the window is the navigation.
    let coachLink = null;
    if (serviceKey) {
      await attempt("mint the coach's link", async () => {
        coachLink = await magicLinkFor(serviceKey, base, layout.coachAccount, "/coaching");
      });
    }
    await clock.until(beat("coaches").start - 0.35);
    await attempt("close player", () =>
      page.evaluate(() =>
        document.querySelector('[aria-label="Close player"]')?.click()
      )
    );
    await attempt("sign out", () => page.context().clearCookies());
    if (coachLink) {
      await attempt(
        "sign in as the coach",
        async () => {
          await page.goto(coachLink, { waitUntil: "domcontentloaded" });
          await page.waitForURL(/\/coaching/, { timeout: 12000 });
          await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
        },
        14000
      );
    }

    // -------------------------------------------------- what a coach sells
    await arrive(page, clock, `${base}/coaching/offerings`, {
      at: beat("offer").start - 2.4,
      anchor: "Offerings",
      offset: 90,
    });
    await clock.until(beat("offer").start);
    await glide(page, clock, {
      to: "Receive review",
      ms: beat("offer").dur * 1000,
      offset: 320,
    });
    await clock.until(beat("offer").end);

    // -------------------------------------------------- their page
    await arrive(page, clock, `${base}/coach/${COACH_HANDLE}`, {
      at: beat("page").start - 2.4,
      anchor: layout.pageAnchor,
      offset: layout.pageOffset ?? 110,
    });
    await clock.until(beat("page").start);
    await glide(page, clock, {
      to: layout.pageGlide,
      ms: beat("page").dur * 1000,
      offset: 180,
    });
    await clock.until(beat("page").end);

    // -------------------------------------------------- payments
    // One beat where the coach video spends three. A coach needs to know
    // what Stripe onboarding asks of them; someone being shown the product
    // needs to know that the money is handled and by whom.
    await arrive(page, clock, `${base}/coaching`, {
      at: beat("payouts").start - 2.4,
      anchor: "Coaching",
      offset: 90,
    });
    await attempt("find the payouts card", () => placeText(page, clock, "Payouts", 260));
    await clock.until(beat("payouts").start - 0.2);
    await spot(page, clock, {
      label: "Stripe pays your bank",
      spec: { sectionOf: "Payouts" },
      until: beat("payouts").end,
    });

    // -------------------------------------------------- a new order
    await arrive(page, clock, WORK, {
      at: beat("order").start - 2.6,
      anchor: "Their brief",
      offset: 150,
    });
    await clock.until(beat("order").start - 0.1);
    await spot(page, clock, {
      label: "What they asked for",
      spec: { sectionOf: "Their brief" },
      until: beat("order").start + 4.4,
    });
    await glide(page, clock, { to: "Accepting starts", ms: 1400, offset: 320 });
    // Accepted at the very end of the line: accepting re-renders the whole
    // page into the workspace, and a re-render under the last words of a
    // sentence reads as a stutter rather than as a cut.
    await clock.until(beat("order").end - 0.15);
    await click(page, "accept the order", "Accept and start");
    await clock.until(beat("order").end);

    // -------------------------------------------------- the match arrives
    // The accept is filmed; the workspace is not waited for on camera. The
    // transition round trip is a second or two against production, and
    // clock.until cannot rewind.
    await arrive(page, clock, WORK, {
      at: beat("arrive").start - 2.4,
      anchor: "The points",
      offset: 90,
    });
    await attempt("wait for the score", () =>
      page.waitForFunction(
        () => {
          const el = [...document.querySelectorAll("p")].find((e) =>
            e.textContent.trim().startsWith("Point ")
          );
          return !!el && !el.textContent.includes("unscored");
        },
        undefined,
        { timeout: 5000 }
      )
    );
    await attempt("play the clip", () =>
      page.evaluate(() => {
        const v = document.querySelector("video");
        if (v) void v.play();
      })
    );
    await clock.until(beat("arrive").end);

    // -------------------------------------------------- patterns
    // The heart of the coach side, and the one coach beat that keeps its
    // depth: naming a habit and hanging every point where it happened off
    // it is the thing nobody guesses from the outside.
    await attempt("pause the clip", () =>
      page.evaluate(() => document.querySelectorAll("video").forEach((v) => v.pause()))
    );
    await attempt("select a linked point", () =>
      page.evaluate(() => {
        const chip = [...document.querySelectorAll("button")].find(
          (b) =>
            /^★?\d+$/.test(b.textContent.trim()) &&
            b.className.includes("border-cyan-glow/50")
        );
        if (!chip) throw new Error("no tagged chip on the strip");
        chip.click();
      })
    );
    await clock.sleep(350);
    await click(page, "open the pattern sheet", "Add to a pattern");
    await clock.sleep(450);
    await clock.until(beat("patterns").start + 3.6);
    await attempt("close the pattern sheet", () =>
      dismiss(page, {
        click: { text: "Cancel", tag: "button" },
        gone: { text: "Cancel", tag: "button" },
      })
    );
    // The patterns as a list, each carrying the points it was built from.
    // No ring: three rows with their numbers on the right IS the picture,
    // and a box around a list of boxes is noise.
    await attempt("find the patterns", () =>
      placeText(page, clock, "The long serve is landing", 300)
    );
    await clock.until(beat("patterns").end);

    // -------------------------------------------------- the write-up
    // Dictation and the submission check in one beat. Tidy up and
    // attachments are real and are left to the coach video.
    await glide(page, clock, { to: "Your write-up", ms: 1400, offset: 90 });
    await clock.until(beat("writeup").start - 0.1);
    // Two 36px circles on the microphones and no label chips: a chip on a
    // target this small sits on top of the thing it names.
    const mics = [];
    for (const nth of [0, 1]) {
      await attempt(`mic ${nth}`, async () => {
        const rect = await clock.rect({
          sel: '[aria-label="Dictate into this section"]',
          nth,
        });
        if (!rect || rect.w < 20) throw new Error("no microphone");
        mics.push(clock.mark({ kind: "box", rect }));
      });
    }
    await clock.until(beat("writeup").start + 2.6);
    for (const m of mics) clock.close(m);
    await glide(page, clock, { to: "Tools", ms: 1100, offset: 110 });
    // The glide has to FINISH before the rect is read. `visible` requires
    // the element fully inside the viewport, so measuring mid-scroll finds
    // a checklist still hanging off the bottom edge and the cue is dropped
    // — which is exactly what happened on the first take.
    await clock.sleep(1200);
    await spot(page, clock, {
      label: "Checked before it goes",
      spec: { sel: "ul", visible: true, min: { w: 200, h: 90 } },
      until: beat("writeup").end,
    });

    // -------------------------------------------------- what the student gets
    await arrive(page, clock, `${base}/coaching/orders/${ORDER_DONE}`, {
      at: beat("deliver").start - 2.8,
      anchor: "Summary",
      offset: 120,
    });
    await clock.until(beat("deliver").start);
    await glide(page, clock, {
      to: "Watch these points",
      ms: beat("deliver").dur * 1000 + 600,
      offset: 140,
      max: 2200,
    });
    await clock.until(beat("deliver").end);

    // ================================================== close
    // The line offers Google or an email address, so the picture is the
    // screen that offers exactly those two. It cannot be reached while
    // signed in — middleware bounces an authenticated visitor off /login —
    // so the session goes first. Safe here and nowhere else: this is the
    // last thing the take does, and the guard and the cleanup both work
    // through the service key rather than the browser.
    await clock.until(beat("deliver").end + 0.2);
    await attempt("sign out", () => page.context().clearCookies());
    await go(page, `${base}/login`);
    await clock.until(beat("close").end + 1.2);
  };
}
