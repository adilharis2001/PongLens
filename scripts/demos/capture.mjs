/**
 * Landing-page demo capture — real product, real data, scripted.
 *
 *   SERVICE_KEY=... BASE=http://localhost:3000 node scripts/demos/capture.mjs [flow ...]
 *
 * Drives the DEMO account (uploader-test@example.com, staged as "John
 * Miller") through named flows in installed Google Chrome (Playwright's
 * bundled Chromium lacks H.264, and the app is full of H.264 clips) at an
 * iPhone viewport, recording each flow to
 * scripts/demos/raw/<flow>.webm. ffmpeg post-processing (see render.sh)
 * turns the raws into the small posterized loops the landing page ships.
 *
 * Re-run whenever the UI changes: the landing page's demos re-record
 * themselves. That is the whole point of scripting this.
 */

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeRecorder } from "./record.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const SERVICE_KEY = process.env.SERVICE_KEY;
const SUPABASE = "https://pdycinmyfnritemrsfjf.supabase.co";
const DEMO_EMAIL = "uploader-test@example.com";
const MATCH_A = "aa42d3b9-2109-4e02-a638-10297d0606e8"; // John vs Vaibhav

const RAW_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "raw"
);

if (!SERVICE_KEY) {
  console.error("SERVICE_KEY env var required (supabase service role key)");
  process.exit(1);
}

/** Fresh magic link for the demo account (single-use, so per run). */
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
  if (!data.hashed_token) throw new Error(`magic link failed: ${JSON.stringify(data)}`);
  return `${BASE}/auth/confirm?token_hash=${data.hashed_token}&type=email&next=/dashboard`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait until the page's videos have real frames (poster-ready). */
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

// ---------------------------------------------------------------- flows

const flows = {
  /** The core magic: library -> match -> a point plays -> next point. */
  hero: async (page) => {
    await page.goto(`${BASE}/matches`);
    await page.waitForSelector("text=Vaibhav");
    await sleep(1800);
    await page.click(`a[href="/match/${MATCH_A}"]`);
    await page.waitForSelector("text=Points");
    await sleep(1200);
    // scroll the point timeline into view, settle, open point 3
    await page.evaluate(() => {
      const el = [...document.querySelectorAll("h2, h3")].find((h) =>
        h.textContent.trim().startsWith("Points")
      );
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    await sleep(1600);
    await page.evaluate(() => {
      // the open affordance is a div[role=button], not a <button>
      document.querySelector('[aria-label="Open point 3"]')?.click();
    });
    await waitVideoReady(page);
    await sleep(4500); // the rally plays
    // chevron to the next point, let it play
    await page.evaluate(() => {
      document.querySelector('button[aria-label="Next point"]')?.click();
    });
    await waitVideoReady(page);
    await sleep(4200);
  },

  /** Analyst: journal (lesson, cues, tags) -> tag view -> stats. */
  analyst: async (page) => {
    await page.goto(`${BASE}/journal`);
    await page.waitForSelector("text=Working on");
    await sleep(2200);
    await page.evaluate(() => {
      const el = [...document.querySelectorAll("p")].find((p) =>
        p.textContent.includes("Compact backhand")
      );
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    await sleep(2400);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    await sleep(1200);
    await page.evaluate(() => {
      const chip = [...document.querySelectorAll("button")].find((b) =>
        b.textContent.includes("footwork")
      );
      chip?.click();
    });
    await sleep(2600);
    await page.goto(`${BASE}/stats`);
    await page.waitForSelector("text=Winning points");
    await sleep(2600);
    await page.evaluate(() => {
      const tab = [...document.querySelectorAll("button")].find(
        (b) => b.textContent.trim() === "Tactics"
      );
      tab?.click();
    });
    await sleep(3000);
  },

  /** Coach: the point thread — amber coach note + annotated frame. */
  coach: async (page) => {
    await page.goto(`${BASE}/match/${MATCH_A}?p=5`);
    await waitVideoReady(page);
    await sleep(1500);
    await page.evaluate(() => {
      const el = [...document.querySelectorAll("h3")].find(
        (h) => h.textContent.trim() === "Notes"
      );
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    await sleep(2600);
    // next point (8) has the annotated-frame note
    await page.goto(`${BASE}/match/${MATCH_A}?p=8`);
    await waitVideoReady(page);
    await sleep(1200);
    await page.evaluate(() => {
      const el = [...document.querySelectorAll("h3")].find(
        (h) => h.textContent.trim() === "Notes"
      );
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    await sleep(3200);
  },

  /** Drawing on a frame, live. */
  annotate: async (page) => {
    await page.goto(`${BASE}/match/${MATCH_A}?p=3`);
    await waitVideoReady(page);
    await sleep(1500);
    await page.evaluate(() => {
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent.includes("Draw on this frame"))
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    await sleep(1400);
    await page.evaluate(() => {
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent.includes("Draw on this frame"))
        ?.click();
    });
    await page.waitForSelector("canvas");
    await sleep(900);
    // draw an arc with the mouse (real pointer events, so it renders live)
    const canvas = await page.$("canvas");
    const box = await canvas.boundingBox();
    const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
    await page.mouse.move(...at(0.3, 0.62));
    await page.mouse.down();
    for (let i = 0; i <= 16; i++) {
      await page.mouse.move(
        ...at(0.3 + i * 0.017, 0.62 - Math.sin((i / 16) * Math.PI) * 0.15),
        { steps: 2 }
      );
      await sleep(28);
    }
    await page.mouse.up();
    await sleep(500);
    await page.evaluate(() => {
      document.querySelector('button[aria-label="Arrow"]')?.click();
    });
    await sleep(400);
    await page.mouse.move(...at(0.58, 0.34));
    await page.mouse.down();
    await page.mouse.move(...at(0.8, 0.56), { steps: 14 });
    await page.mouse.up();
    await sleep(900);
    await page.evaluate(() => {
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent.trim() === "Save")
        ?.click();
    });
    await page.waitForSelector(
      'img[alt="Annotated frame, attached to this note"]',
      { timeout: 20000 }
    );
    await sleep(2200);
    // leave without posting a second note. The pendingImage "Remove" is
    // the LAST button with that text — the point toolbar's "Remove"
    // (which deletes the point!) comes earlier in the DOM.
    await page.evaluate(() => {
      [...document.querySelectorAll("button")]
        .filter((b) => b.textContent.trim() === "Remove")
        .pop()
        ?.click();
    });
    await sleep(400);
  },

  /** Scoring: watch player -> Keep score -> a couple of taps. */
  score: async (page) => {
    await page.goto(`${BASE}/match/${MATCH_A}`);
    await page.waitForSelector('[aria-label="Play the full video"]');
    await sleep(1200);
    await page.click('[aria-label="Play the full video"]');
    await waitVideoReady(page);
    await sleep(3800);
    await page.evaluate(() => {
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent.trim() === "Keep score")
        ?.click();
    });
    await sleep(4200);
  },
};

// ----------------------------------------------------------------- main

const wanted = process.argv.slice(2);
const names = wanted.length ? wanted : Object.keys(flows);
mkdirSync(RAW_DIR, { recursive: true });
const record = makeRecorder(RAW_DIR);

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  // Headless screencast captures the raster surface at 1x regardless of
  // emulated deviceScaleFactor — force the surface itself to 2x so the
  // frames are retina-sharp.
  args: ["--force-device-scale-factor=2"],
});

for (const name of names) {
  if (!flows[name]) {
    console.error(`unknown flow: ${name}`);
    continue;
  }
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    reducedMotion: "no-preference",
  });
  const page = await ctx.newPage();
  // session: the magic link is single-use, so mint per context
  await page.goto(await magicLink());
  await page.waitForURL("**/dashboard", { timeout: 20000 }).catch(() => {});
  await sleep(600);

  console.log(`recording ${name}…`);
  try {
    const out = await record(page, name, flows[name]);
    console.log(`  -> ${out}`);
  } catch (e) {
    console.error(`flow ${name} failed:`, e.message);
  }
  await ctx.close();
}

await browser.close();
console.log("done");
