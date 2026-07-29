/**
 * Learn-hub screenshots — the captures the /learn guides need that the
 * showcase set (shots.mjs) doesn't have. Same approach: the staged demo
 * account, mobile 390x844@2x and desktop 1440x900@2x, real screens.
 *
 *   SERVICE_KEY=... BASE=http://localhost:3000 node scripts/demos/learn_shots.mjs [name ...]
 *   (SERVICE_KEY defaults from Keychain: ponglens-service-role / openclaw)
 *
 * Written to public/learn/<name>.jpg. Read-only against the demo data:
 * sheets are opened, nothing is created, scored, or saved.
 */

import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE ?? "http://localhost:3000";
const SUPABASE = "https://pdycinmyfnritemrsfjf.supabase.co";
const DEMO_EMAIL = "uploader-test@example.com";
// Same demo match + face-safe game-2 seek point as shots.mjs.
const MATCH_A = "efff9208-abf2-4a20-a498-18cc5a5130b3";
const GAME2_T = 166;

const SERVICE_KEY =
  process.env.SERVICE_KEY ??
  execFileSync(
    "security",
    ["find-generic-password", "-a", "openclaw", "-s", "ponglens-service-role", "-w"],
    { encoding: "utf8" }
  ).trim();

const OUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "public",
  "learn"
);

if (!SERVICE_KEY) {
  console.error("SERVICE_KEY env var or Keychain item required");
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

async function pauseVideos(page) {
  await page.evaluate(() => {
    document.querySelectorAll("video").forEach((v) => v.pause());
  });
  await sleep(300);
}

const clickButton = (page, text) =>
  page.evaluate((t) => {
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent.trim() === t || b.textContent.includes(t))
      ?.click();
  }, text);

/** Open the full-video takeover, seeked into game 2 with chrome showing. */
async function openPlayer(page) {
  await page.goto(`${BASE}/match/${MATCH_A}`);
  await page.click('[aria-label="Play the full video"]');
  await waitVideoReady(page);
  await sleep(1500);
  await page.evaluate((t) => {
    const v = document.querySelector("video");
    if (v) v.currentTime = t;
  }, GAME2_T);
  await sleep(1200);
  // A tap on the video toggles the chrome; make sure it is visible for
  // the shot, then freeze the frame.
  await page.evaluate(() => {
    const v = document.querySelector("video");
    v?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  });
  await sleep(600);
  await pauseVideos(page);
}

const shots = {
  // Import from YouTube: the upload page scrolled to the import card.
  "youtube-d": {
    viewport: "d",
    run: async (page) => {
      await page.goto(`${BASE}/upload`);
      await page.waitForSelector("text=YouTube", { timeout: 15000 });
      await sleep(1200);
      await page.evaluate(() => {
        const el = [...document.querySelectorAll("h2,h3,p,span")].find((e) =>
          e.textContent.trim().startsWith("Import from YouTube")
        );
        el?.scrollIntoView({ block: "start" });
      });
      await sleep(1000);
    },
  },
  "youtube-m": {
    viewport: "m",
    run: async (page) => {
      await page.goto(`${BASE}/upload`);
      await page.waitForSelector("text=YouTube", { timeout: 15000 });
      await sleep(1200);
      await page.evaluate(() => {
        const el = [...document.querySelectorAll("h2,h3,p,span")].find((e) =>
          e.textContent.trim().startsWith("Import from YouTube")
        );
        el?.scrollIntoView({ block: "start" });
      });
      await sleep(1000);
    },
  },

  // The watch player with its controls up.
  "player-d": {
    viewport: "d",
    run: openPlayer,
  },
  "player-m": {
    viewport: "m",
    run: openPlayer,
  },

  // The tag picker on a point (read-only: nothing is applied).
  "tagpicker-m": {
    viewport: "m",
    run: async (page) => {
      await page.goto(`${BASE}/match/${MATCH_A}?p=39`);
      await waitVideoReady(page);
      await sleep(1500);
      await pauseVideos(page);
      await page.evaluate(() => {
        document.querySelector('[aria-label="Tag this point"]')?.click();
      });
      await sleep(1200);
    },
  },

  // /stats: the cross-match "My stats" view.
  "mystats-d": {
    viewport: "d",
    run: async (page) => {
      await page.goto(`${BASE}/stats`);
      await page.waitForSelector("text=Tactics", { timeout: 15000 });
      await sleep(2500);
    },
  },
  "mystats-m": {
    viewport: "m",
    run: async (page) => {
      await page.goto(`${BASE}/stats`);
      await page.waitForSelector("text=Tactics", { timeout: 15000 });
      await sleep(2500);
    },
  },

  // The export sheet (opened, nothing rendered or downloaded).
  "export-d": {
    viewport: "d",
    run: async (page) => {
      await page.goto(`${BASE}/match/${MATCH_A}`);
      await page.waitForSelector("text=Export", { timeout: 15000 });
      await sleep(1000);
      await clickButton(page, "Export");
      await sleep(1500);
    },
  },
  "export-m": {
    viewport: "m",
    run: async (page) => {
      await page.goto(`${BASE}/match/${MATCH_A}`);
      await page.waitForSelector("text=Export", { timeout: 15000 });
      await sleep(1000);
      await clickButton(page, "Export");
      await sleep(1500);
    },
  },

  // The coach invite sheet (no link is created).
  "coachinvite-m": {
    viewport: "m",
    run: async (page) => {
      await page.goto(`${BASE}/match/${MATCH_A}`);
      await page.waitForSelector("text=Coach", { timeout: 15000 });
      await sleep(1000);
      await clickButton(page, "Coach");
      await sleep(1500);
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
    console.log(`  -> public/learn/${name}.jpg`);
  } catch (e) {
    console.error(`shot ${name} failed:`, e.message);
  }
  await ctx.close();
}

await browser.close();
console.log("done");
