/**
 * Showcase screenshots — retina stills of the real product for
 * /showcase (and anywhere else that needs a crisp screen).
 *
 *   SERVICE_KEY=... BASE=https://www.ponglens.com node scripts/demos/shots.mjs [name ...]
 *
 * Mobile shots at 390x844@2x, desktop shots at 1440x900@2x, written to
 * public/showcase/<name>.jpg. Uses the staged demo account (see
 * capture.mjs). Re-run after UI changes; the showcase updates itself.
 */

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE ?? "http://localhost:3000";
const SERVICE_KEY = process.env.SERVICE_KEY;
const SUPABASE = "https://pdycinmyfnritemrsfjf.supabase.co";
const DEMO_EMAIL = "uploader-test@example.com";
// The coach side of the same story: Miguel Santos sells reviews and John
// Miller buys them. Staged by scripts/demos/stage_coach.sql, which is also
// where these order ids come from.
const COACH_EMAIL = "miguel-demo@example.com";
// A second coach part way through setup, so the checklist can be shot in
// the state a coach actually meets it: offering made, payouts still to do.
const SETUP_EMAIL = "setup-demo@example.com";
const ACCOUNTS = {
  student: DEMO_EMAIL,
  coach: COACH_EMAIL,
  newcoach: SETUP_EMAIL,
};
const ORDER_ACTIVE = "0a5e0002-0000-4000-8000-000000000001"; // in_review
const ORDER_DONE = "0a5e0002-0000-4000-8000-000000000002"; // completed
const ORDER_NEW = "0a5e0002-0000-4000-8000-000000000003"; // submitted
// The demo "Alex" match — the cloned Adil vs Gui match. Featured points
// come from GAMES 1 and 3, where the uploader (not the opponent) plays
// the near side. NOTE the app orders points by time, which drifts ahead
// of idx: ?p=55 is idx 52, ?p=48 is idx 45.
const MATCH_A = "efff9208-abf2-4a20-a498-18cc5a5130b3";
// A cut-video timestamp inside game 1 (idx 5's rally) for shots of the
// full-video player, so paused frames show the uploader at the table.
const GAME2_T = 24;

const OUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "public",
  "showcase"
);

if (!SERVICE_KEY) {
  console.error("SERVICE_KEY env var required");
  process.exit(1);
}

async function magicLink(email = DEMO_EMAIL) {
  const res = await fetch(`${SUPABASE}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "magiclink", email }),
  });
  const data = await res.json();
  if (!data.hashed_token) throw new Error("magic link failed");
  return `${BASE}/auth/confirm?token_hash=${data.hashed_token}&type=email&next=/dashboard`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitVideoReady(page, timeout = 15000) {
  await page
    .waitForFunction(
      () => {
        const v = document.querySelector("video");
        return v && v.readyState >= 2 && v.videoWidth > 0;
      },
      { timeout }
    )
    .catch(() => {});
}

/** Pause any playing clip so the shot is a clean frame, not motion blur. */
async function pauseVideos(page) {
  await page.evaluate(() => {
    document.querySelectorAll("video").forEach((v) => v.pause());
  });
  await sleep(300);
}

const scrollToText = (page, needle, block = "start") =>
  page.evaluate(
    ([n, b]) => {
      const el = [...document.querySelectorAll("h1,h2,h3,p,span")].find((e) =>
        e.textContent.trim().startsWith(n)
      );
      el?.scrollIntoView({ block: b });
    },
    [needle, block]
  );

/** Scroll the open point sheet (its own scroll container) to a heading —
 *  page-level text search would hit the match page behind the sheet. */
const scrollSheetTo = (page, heading, block = "start") =>
  page.evaluate(
    ([n, b]) => {
      const dlg = document.querySelector('[role="dialog"]') ?? document;
      const el = [...dlg.querySelectorAll("h3")].find(
        (e) => e.textContent.trim() === n
      );
      el?.scrollIntoView({ block: b });
    },
    [heading, block]
  );

/**
 * Wait for the coach workspace to know the score. The point strip renders
 * before the points arrive, and in that gap every chip is empty and the
 * label reads "unscored" — which is a true sentence about a match that is
 * fully scored, and it shipped into a landing page screenshot once.
 */
const waitScored = (page, timeout = 20000) =>
  page
    .waitForFunction(
      () => {
        const el = [...document.querySelectorAll("p")].find((e) =>
          e.textContent.trim().startsWith("Point ")
        );
        return !!el && !el.textContent.includes("unscored");
      },
      { timeout }
    )
    .catch(() => {});

/** Open the offering editor on the coach's offerings page. */
const openOffering = (page, title) =>
  page.evaluate((t) => {
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent.trim().startsWith(t))
      ?.click();
  }, title);

// Each shot: { viewport: 'm' | 'd', as?: 'student' | 'coach', run(page) } —
// run() leaves the page looking like the screenshot. `as` picks which demo
// account the browser signs in as; it defaults to the student.
const shots = {
  // 1 — upload, both form factors
  "upload-m": {
    viewport: "m",
    run: async (page) => {
      await page.goto(`${BASE}/upload`);
      await page.waitForSelector("text=YouTube", { timeout: 15000 });
      await sleep(1200);
    },
  },
  "upload-d": {
    viewport: "d",
    run: async (page) => {
      await page.goto(`${BASE}/upload`);
      await page.waitForSelector("text=YouTube", { timeout: 15000 });
      await sleep(1200);
    },
  },
  // The camera sheet, open. The landing page's first step is the one thing
  // that happens before the product exists — you and a phone at the end of
  // a table — and this diagram is the only picture of it we have.
  "record-m": {
    viewport: "m",
    run: async (page) => {
      await page.goto(`${BASE}/upload`);
      await page.waitForSelector("text=How to record", { timeout: 15000 });
      await page.getByRole("button", { name: "How to record" }).click();
      await page.waitForSelector("text=Where to put the camera", {
        timeout: 10000,
      });
      await sleep(1500); // the sheet slides up and the ball rally settles
    },
  },

  // 2 — the match viewer: a point with its analysis…
  "viewer-m": {
    viewport: "m",
    run: async (page) => {
      await page.goto(`${BASE}/match/${MATCH_A}?p=55`);
      await waitVideoReady(page);
      await sleep(2500);
      await pauseVideos(page);
    },
  },
  "viewer-d": {
    viewport: "d",
    run: async (page) => {
      await page.goto(`${BASE}/match/${MATCH_A}?p=55`);
      await waitVideoReady(page);
      await sleep(2500);
      await pauseVideos(page);
    },
  },
  // …and the note thread with the annotated frame
  "notes-m": {
    viewport: "m",
    run: async (page) => {
      await page.goto(`${BASE}/match/${MATCH_A}?p=55`);
      await waitVideoReady(page);
      await sleep(1500);
      await pauseVideos(page);
      await scrollSheetTo(page, "Notes", "center");
      await sleep(1500);
    },
  },

  // …the match review UI itself (video + point timeline)
  "match-m": {
    viewport: "m",
    run: async (page) => {
      await page.goto(`${BASE}/match/${MATCH_A}`);
      await page.waitForSelector("text=Points", { timeout: 15000 });
      await sleep(1500);
      await scrollToText(page, "Points", "start");
      await sleep(1500);
    },
  },
  // …the point's trajectory map
  "trajectory-m": {
    viewport: "m",
    run: async (page) => {
      await page.goto(`${BASE}/match/${MATCH_A}?p=55`);
      await waitVideoReady(page);
      await sleep(1500);
      await pauseVideos(page);
      await scrollSheetTo(page, "Where the ball landed", "start");
      await sleep(1500);
    },
  },
  // …and drawing on a paused frame, annotator open mid-stroke (nothing
  // is saved: the screenshot is taken before any Save click)
  "annotate-m": {
    viewport: "m",
    run: async (page) => {
      await page.goto(`${BASE}/match/${MATCH_A}?p=55`);
      await waitVideoReady(page);
      await sleep(1500);
      await pauseVideos(page);
      await page.evaluate(() => {
        [...document.querySelectorAll("button")]
          .find((b) => b.textContent.includes("Draw on this frame"))
          ?.scrollIntoView({ block: "center" });
      });
      await sleep(900);
      await page.evaluate(() => {
        [...document.querySelectorAll("button")]
          .find((b) => b.textContent.includes("Draw on this frame"))
          ?.click();
      });
      await page.waitForSelector("canvas", { timeout: 10000 });
      await sleep(800);
      const canvas = await page.$("canvas");
      const box = await canvas.boundingBox();
      const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
      await page.mouse.move(...at(0.28, 0.66));
      await page.mouse.down();
      for (let i = 0; i <= 14; i++) {
        await page.mouse.move(
          ...at(0.28 + i * 0.02, 0.66 - Math.sin((i / 14) * Math.PI) * 0.16),
          { steps: 2 }
        );
      }
      await page.mouse.up();
      await sleep(400);
      await page.evaluate(() => {
        document.querySelector('button[aria-label="Arrow"]')?.click();
      });
      await sleep(300);
      await page.mouse.move(...at(0.55, 0.3));
      await page.mouse.down();
      await page.mouse.move(...at(0.78, 0.52), { steps: 12 });
      await page.mouse.up();
      await sleep(800);
    },
  },

  // 3 — Score Keeper (seeked into game 1: the uploader is the near player)
  "score-d": {
    viewport: "d",
    run: async (page) => {
      await page.goto(`${BASE}/match/${MATCH_A}`);
      await page.click('[aria-label="Play the full video"]');
      await waitVideoReady(page);
      await sleep(1500);
      await page.evaluate(() => {
        [...document.querySelectorAll("button")]
          .find((b) => b.textContent.trim() === "Score Keeper")
          ?.click();
      });
      // Score Keeper jumps to the first unscored point on entry — seek to
      // the game-1 rally AFTER that jump, or it wins.
      await sleep(2000);
      await page.evaluate((t) => {
        const v = document.querySelector("video");
        if (v) { v.currentTime = t; void v.play(); }
      }, GAME2_T);
      await sleep(1800);
      await pauseVideos(page);
    },
  },
  "score-m": {
    viewport: "m",
    run: async (page) => {
      await page.goto(`${BASE}/match/${MATCH_A}`);
      await page.click('[aria-label="Play the full video"]');
      await waitVideoReady(page);
      await sleep(1500);
      await page.evaluate(() => {
        [...document.querySelectorAll("button")]
          .find((b) => b.textContent.trim() === "Score Keeper")
          ?.click();
      });
      // Score Keeper jumps to the first unscored point on entry — seek to
      // the game-1 rally AFTER that jump, or it wins.
      await sleep(2000);
      await page.evaluate((t) => {
        const v = document.querySelector("video");
        if (v) { v.currentTime = t; void v.play(); }
      }, GAME2_T);
      await sleep(1800);
      await pauseVideos(page);
    },
  },

  // 4 — share + export options
  "share-d": {
    viewport: "d",
    run: async (page) => {
      await page.goto(`${BASE}/match/${MATCH_A}`);
      await page.waitForSelector("text=Share", { timeout: 15000 });
      await sleep(1000);
      await page.evaluate(() => {
        const row = [...document.querySelectorAll("button")].find((b) =>
          b.textContent.includes("Share")
        );
        row?.click();
      });
      await sleep(1500);
    },
  },
  "share-m": {
    viewport: "m",
    run: async (page) => {
      await page.goto(`${BASE}/match/${MATCH_A}`);
      await page.waitForSelector("text=Share", { timeout: 15000 });
      await sleep(1000);
      await page.evaluate(() => {
        const row = [...document.querySelectorAll("button")].find((b) =>
          b.textContent.includes("Share")
        );
        row?.click();
      });
      await sleep(1500);
    },
  },

  // 5 — coach notes on a point
  "coach-d": {
    viewport: "d",
    run: async (page) => {
      await page.goto(`${BASE}/match/${MATCH_A}?p=48`);
      await waitVideoReady(page);
      await sleep(1500);
      await pauseVideos(page);
      await scrollSheetTo(page, "Notes", "center");
      await sleep(1500);
    },
  },
  "coach-m": {
    viewport: "m",
    run: async (page) => {
      await page.goto(`${BASE}/match/${MATCH_A}?p=48`);
      await waitVideoReady(page);
      await sleep(1200);
      await pauseVideos(page);
      await scrollSheetTo(page, "Notes", "center");
      await sleep(1200);
    },
  },

  // 6 — match statistics deck
  "stats-m": {
    viewport: "m",
    run: async (page) => {
      await page.goto(`${BASE}/match/${MATCH_A}`);
      await sleep(1500);
      await scrollToText(page, "Point differential", "center");
      await sleep(1200);
    },
  },
  "stats-d": {
    viewport: "d",
    run: async (page) => {
      await page.goto(`${BASE}/match/${MATCH_A}`);
      await sleep(1500);
      await scrollToText(page, "Point differential", "center");
      await sleep(1200);
    },
  },

  // 7 — placement map (match-level ball map)
  "placement-d": {
    viewport: "d",
    run: async (page) => {
      await page.goto(`${BASE}/match/${MATCH_A}`);
      await sleep(1500);
      // target the MATCH-level ball map (its "My serves" tab is unique) —
      // the desktop point pane has its own "Where the ball landed" that
      // a text search would hit first
      await page.evaluate(() => {
        const el = [...document.querySelectorAll("button")].find(
          (e) => e.textContent.trim() === "My serves"
        );
        el?.scrollIntoView({ block: "center" });
      });
      await sleep(1500);
    },
  },
  "placement-m": {
    viewport: "m",
    run: async (page) => {
      await page.goto(`${BASE}/match/${MATCH_A}`);
      await sleep(1500);
      await page.evaluate(() => {
        const el = [...document.querySelectorAll("h2,h3,p")].find((e) =>
          e.textContent.includes("Where the ball land")
        );
        el?.scrollIntoView({ block: "start" });
      });
      await sleep(1500);
    },
  },

  // 8 — the journal…
  "journal-feed-m": {
    viewport: "m",
    run: async (page) => {
      await page.goto(`${BASE}/journal`);
      await page.waitForSelector("text=Working on", { timeout: 15000 });
      await sleep(1800);
      await page.evaluate(() => {
        const el = [...document.querySelectorAll("p")].find((e) =>
          e.textContent.includes("Falkenberg")
        );
        el?.scrollIntoView({ block: "center" });
      });
      await sleep(1500);
    },
  },
  "journal-m": {
    viewport: "m",
    run: async (page) => {
      await page.goto(`${BASE}/journal`);
      await page.waitForSelector("text=Working on", { timeout: 15000 });
      await sleep(2000);
    },
  },
  "journal-d": {
    viewport: "d",
    run: async (page) => {
      await page.goto(`${BASE}/journal`);
      await page.waitForSelector("text=Working on", { timeout: 15000 });
      await sleep(2000);
    },
  },

  // 9 — the coach side, for /coaches. The storefront a student lands on…
  "coach-page-m": {
    viewport: "m",
    run: async (page) => {
      await page.goto(`${BASE}/coach/miguel`);
      await page.waitForSelector("text=Full match review", { timeout: 15000 });
      await sleep(1500);
    },
  },
  "coach-page-d": {
    viewport: "d",
    run: async (page) => {
      await page.goto(`${BASE}/coach/miguel`);
      await page.waitForSelector("text=Full match review", { timeout: 15000 });
      await sleep(1500);
    },
  },
  // …the queue, grouped by whose move it is. The hub only groups it that
  // way on a laptop; the phone's grouped view is the orders page.
  "coach-queue-m": {
    viewport: "m",
    as: "coach",
    run: async (page) => {
      await page.goto(`${BASE}/coaching/orders`);
      await page.waitForSelector("text=In progress", { timeout: 15000 });
      await sleep(1800);
    },
  },
  // …the setup checklist, payouts still to do
  "coach-setup-m": {
    viewport: "m",
    as: "newcoach",
    run: async (page) => {
      await page.goto(`${BASE}/coaching`);
      await page.waitForSelector("text=Set up payouts", { timeout: 15000 });
      await sleep(1500);
    },
  },
  // …the payout end of the hub, framed for the /coaches hero. The phone
  // there sits BEHIND the tablet, so only its lower half is ever seen:
  // the earnings and the payouts card have to be in that half or the
  // shot is a picture of a navigation list.
  "coach-payout-m": {
    viewport: "m",
    as: "coach",
    run: async (page) => {
      await page.goto(`${BASE}/coaching`);
      await page.waitForSelector("text=earned", { timeout: 15000 });
      await sleep(1500);
      await page.evaluate(() => {
        const h = [...document.querySelectorAll("h2")].find(
          (e) => e.textContent.trim() === "Payouts"
        );
        if (!h) return;
        // Payouts about two thirds down, which puts the earnings row and
        // the Stripe card together in the part that shows.
        const y = window.scrollY + h.getBoundingClientRect().top - window.innerHeight * 0.62;
        window.scrollTo(0, Math.max(0, y));
      });
      await sleep(1200);
    },
  },

  // …the hub itself on a phone: what is owed, what is earned, what is paid
  "coach-hub-m": {
    viewport: "m",
    as: "coach",
    run: async (page) => {
      await page.goto(`${BASE}/coaching`);
      await page.waitForSelector("text=earned", { timeout: 15000 });
      await sleep(1800);
    },
  },
  "coach-queue-d": {
    viewport: "d",
    as: "coach",
    run: async (page) => {
      await page.goto(`${BASE}/coaching`);
      await page.waitForSelector("text=Your move", { timeout: 15000 });
      await sleep(1800);
    },
  },

  // …a new order, which is an accept or decline with their brief in full
  "coach-order-m": {
    viewport: "m",
    as: "coach",
    run: async (page) => {
      await page.goto(`${BASE}/coaching/orders/${ORDER_NEW}`);
      await page.waitForSelector("text=Accept and start", { timeout: 15000 });
      await sleep(1500);
    },
  },

  // …the workspace: the player, the point strip, and the patterns under it
  "coach-points-m": {
    viewport: "m",
    as: "coach",
    run: async (page) => {
      await page.goto(`${BASE}/coaching/orders/${ORDER_ACTIVE}`);
      await page.waitForSelector("text=The points", { timeout: 20000 });
      await waitVideoReady(page);
      await waitScored(page);
      await sleep(2000);
      await pauseVideos(page);
      await scrollToText(page, "The points", "start");
      await sleep(1200);
    },
  },
  "coach-points-d": {
    viewport: "d",
    as: "coach",
    run: async (page) => {
      await page.goto(`${BASE}/coaching/orders/${ORDER_ACTIVE}`);
      await page.waitForSelector("text=The points", { timeout: 20000 });
      await waitVideoReady(page);
      await waitScored(page);
      await sleep(2500);
      await pauseVideos(page);
    },
  },

  // …and the write-up beside it, dictation button on every section
  "coach-writeup-m": {
    viewport: "m",
    as: "coach",
    run: async (page) => {
      await page.goto(`${BASE}/coaching/orders/${ORDER_ACTIVE}`);
      await page.waitForSelector("text=Your write-up", { timeout: 20000 });
      await waitVideoReady(page);
      await waitScored(page);
      await sleep(1500);
      await pauseVideos(page);
      await scrollToText(page, "Your write-up", "start");
      await sleep(1200);
    },
  },

  // …what the coach sets, with the student's card built live beside it
  "coach-offering-m": {
    viewport: "m",
    as: "coach",
    run: async (page) => {
      await page.goto(`${BASE}/coaching/offerings`);
      await page.waitForSelector("text=Full match review", { timeout: 15000 });
      await sleep(800);
      await openOffering(page, "Full match review");
      await sleep(1200);
      // The fee line sits right under the price field, which is the part
      // of this screen worth showing: what they set and what they keep.
      await scrollToText(page, "You receive", "center");
      await sleep(1000);
    },
  },
  "coach-offering-d": {
    viewport: "d",
    as: "coach",
    run: async (page) => {
      await page.goto(`${BASE}/coaching/offerings`);
      await page.waitForSelector("text=Full match review", { timeout: 15000 });
      await sleep(800);
      await openOffering(page, "Full match review");
      await sleep(1500);
    },
  },

  // …the workspace on a landscape tablet, for the /coaches hero: the
  // rally on one side and the write-up on the other, which is the whole
  // job in one picture.
  "coach-work-t": {
    viewport: "t",
    as: "coach",
    run: async (page) => {
      await page.goto(`${BASE}/coaching/orders/${ORDER_ACTIVE}`);
      await page.waitForSelector("text=The points", { timeout: 20000 });
      await waitVideoReady(page);
      await waitScored(page);
      await sleep(2000);
      await pauseVideos(page);
    },
  },

  // …one WHOLE offering as a student sees it, for the same hero. The old
  // hero shot was this page mid-scroll, so its top card was cut in half
  // and the picture was a price list rather than a thing being sold.
  "coach-offer-m": {
    viewport: "m",
    run: async (page) => {
      await page.goto(`${BASE}/coach/miguel`);
      await page.waitForSelector("text=Serve review", { timeout: 15000 });
      await sleep(1200);
      await page.evaluate(() => {
        const h = [...document.querySelectorAll("h3")].find(
          (e) => e.textContent.trim() === "Serve review"
        );
        const card = h?.closest("section");
        if (!card) return;
        // Its own top edge just under the app bar, so the card's art, its
        // price and its Buy button are all inside one frame.
        const y = window.scrollY + card.getBoundingClientRect().top - 72;
        window.scrollTo(0, Math.max(0, y));
      });
      await sleep(1200);
    },
  },

  // …and the review itself, read the way the student reads it
  "coach-review-m": {
    viewport: "m",
    run: async (page) => {
      await page.goto(`${BASE}/orders/${ORDER_DONE}`);
      await page.waitForSelector("text=Watch these points", { timeout: 15000 });
      await sleep(1500);
      await scrollToText(page, "Watch these points", "start");
      await sleep(1200);
    },
  },
  "coach-review-d": {
    viewport: "d",
    run: async (page) => {
      await page.goto(`${BASE}/orders/${ORDER_DONE}`);
      await page.waitForSelector("text=Watch these points", { timeout: 15000 });
      await sleep(1800);
    },
  },
};

const VIEWPORTS = {
  m: { width: 390, height: 844 },
  d: { width: 1440, height: 900 },
  // Landscape tablet. The coach workspace only splits into its two panes
  // above 1024, so a narrower tablet would photograph the phone layout.
  t: { width: 1180, height: 820 },
};

const wanted = process.argv.slice(2);
const names = wanted.length ? wanted : Object.keys(shots);
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--force-device-scale-factor=2"],
});

for (const name of names) {
  const spec = shots[name];
  if (!spec) {
    console.error(`unknown shot: ${name}`);
    continue;
  }
  const ctx = await browser.newContext({
    viewport: VIEWPORTS[spec.viewport],
    deviceScaleFactor: 2,
    isMobile: spec.viewport === "m",
    hasTouch: spec.viewport === "m",
  });
  const page = await ctx.newPage();
  // A fresh profile counts as a first visit, so the one-time gesture
  // hints would photobomb every player shot. Mark them used up front.
  // Shooting against a dev server puts Next's dev-tools badge in the
  // bottom-left corner of every frame. It is a real element, so nothing
  // short of hiding it keeps it out of the picture.
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = "nextjs-portal{display:none!important}";
      document.head.appendChild(style);
    });
  });
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem(
        "ponglens:gesture-hints",
        JSON.stringify({
          shown: {},
          done: { dtap: true, hold: true, score: true },
        })
      );
    } catch {}
  });
  await page.goto(await magicLink(ACCOUNTS[spec.as ?? "student"]));
  await page.waitForURL("**/dashboard", { timeout: 20000 }).catch(() => {});
  await sleep(500);
  console.log(`shooting ${name}…`);
  try {
    await spec.run(page);
    await page.screenshot({
      path: path.join(OUT, `${name}.jpg`),
      type: "jpeg",
      quality: 90,
    });
    console.log(`  -> public/showcase/${name}.jpg`);
  } catch (e) {
    console.error(`shot ${name} failed:`, e.message);
  }
  await ctx.close();
}

await browser.close();
console.log("done");
