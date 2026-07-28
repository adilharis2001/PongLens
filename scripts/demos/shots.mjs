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
const MATCH_A = "aa42d3b9-2109-4e02-a638-10297d0606e8";

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

async function magicLink() {
  const res = await fetch(`${SUPABASE}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "magiclink", email: DEMO_EMAIL }),
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

// Each shot: { viewport: 'm' | 'd', run(page) } — run() leaves the page
// looking like the screenshot.
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

  // 2 — the match viewer: a point with its analysis…
  "viewer-m": {
    viewport: "m",
    run: async (page) => {
      await page.goto(`${BASE}/match/${MATCH_A}?p=4`);
      await waitVideoReady(page);
      await sleep(2500);
      await pauseVideos(page);
    },
  },
  "viewer-d": {
    viewport: "d",
    run: async (page) => {
      await page.goto(`${BASE}/match/${MATCH_A}?p=4`);
      await waitVideoReady(page);
      await sleep(2500);
      await pauseVideos(page);
    },
  },
  // …and the note thread with the annotated frame
  "notes-m": {
    viewport: "m",
    run: async (page) => {
      await page.goto(`${BASE}/match/${MATCH_A}?p=8`);
      await waitVideoReady(page);
      await sleep(1500);
      await pauseVideos(page);
      await scrollSheetTo(page, "Notes", "center");
      await sleep(1500);
    },
  },

  // 3 — keep score
  "score-d": {
    viewport: "d",
    run: async (page) => {
      await page.goto(`${BASE}/match/${MATCH_A}`);
      await page.click('[aria-label="Play the full video"]');
      await waitVideoReady(page);
      await sleep(2500);
      await page.evaluate(() => {
        [...document.querySelectorAll("button")]
          .find((b) => b.textContent.trim() === "Keep score")
          ?.click();
      });
      await sleep(2500);
      await pauseVideos(page);
    },
  },
  "score-m": {
    viewport: "m",
    run: async (page) => {
      await page.goto(`${BASE}/match/${MATCH_A}`);
      await page.click('[aria-label="Play the full video"]');
      await waitVideoReady(page);
      await sleep(2500);
      await page.evaluate(() => {
        [...document.querySelectorAll("button")]
          .find((b) => b.textContent.trim() === "Keep score")
          ?.click();
      });
      await sleep(2500);
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
      await page.goto(`${BASE}/match/${MATCH_A}?p=5`);
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
      await page.goto(`${BASE}/match/${MATCH_A}?p=5`);
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

  // 8 — the journal
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
};

const VIEWPORTS = {
  m: { width: 390, height: 844 },
  d: { width: 1440, height: 900 },
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
  await page.goto(await magicLink());
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
