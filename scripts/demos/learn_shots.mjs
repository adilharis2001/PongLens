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
const COACH_EMAIL = "miguel-demo@example.com";
const ACCOUNTS = { player: DEMO_EMAIL, coach: COACH_EMAIL };
const PLACEMENT_RETRY_MATCH = process.env.PLACEMENT_RETRY_MATCH;
const PLACEMENT_RETRY_ACCOUNT = process.env.PLACEMENT_RETRY_ACCOUNT;
const ORIGINAL_MATCH = process.env.ORIGINAL_MATCH;
const ORIGINAL_ACCOUNT = process.env.ORIGINAL_ACCOUNT;
const RESTORE_RALLY_MATCH = process.env.RESTORE_RALLY_MATCH;
const RESTORE_RALLY_ACCOUNT = process.env.RESTORE_RALLY_ACCOUNT;
const READ_ONLY_RPCS = new Set([
  "coach_players",
  "coach_shared_entries",
  "current_billing_mode",
  "is_admin",
  "match_note_authors",
  "match_owner_name",
  "my_processing_state",
  "my_storage_state",
  "note_feed",
  "player_coach_links",
  "tag_stats",
  "tagged_points",
]);
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

const scrollToText = (page, needle, block = "start") =>
  page.evaluate(
    ([text, position]) => {
      const element = [...document.querySelectorAll("h1,h2,h3,p,span")].find(
        (candidate) => candidate.textContent.trim().startsWith(text)
      );
      element?.scrollIntoView({ block: position });
    },
    [needle, block]
  );

async function openCoachStudent(page, name) {
  await page.goto(`${BASE}/coaching/students`);
  const row = page
    .locator('a[href^="/coaching/students/"]', { hasText: name })
    .first();
  await row.waitFor({ timeout: 15000 });
  const href = await row.getAttribute("href");
  if (!href) throw new Error(`student row missing: ${name}`);
  await page.goto(`${BASE}${href}`);
  await page.waitForSelector("text=Journal", { timeout: 15000 });
}

/**
 * Screenshot actions are deliberately incapable of changing product data.
 * The one POST they need signs an already-existing media object for the
 * Original-video takeover. Everything else must be GET/HEAD or it is aborted.
 */
async function installReadOnlyGuard(page) {
  await page.route("**/*", async (route) => {
    const request = route.request();
    const method = request.method();
    if (method === "GET" || method === "HEAD") return route.continue();

    const url = new URL(request.url());
    const allowedMediaLookup =
      url.origin === new URL(BASE).origin && url.pathname === "/api/media-url";
    if (method === "POST" && allowedMediaLookup) return route.continue();

    const rpcName = url.pathname.match(/^\/rest\/v1\/rpc\/([^/]+)$/)?.[1];
    if (method === "POST" && rpcName && READ_ONLY_RPCS.has(rpcName)) {
      return route.continue();
    }

    console.warn(`blocked non-read request: ${method} ${url.pathname}`);
    return route.abort("blockedbyclient");
  });
}

/** Open the full-video takeover, seeked into game 2 with chrome showing. */
async function openPlayer(page, matchId = MATCH_A) {
  await page.goto(`${BASE}/match/${matchId}`);
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
  // The Learn-only Playing/Coaching selector. Miguel is a staged dual-role
  // account, so this shows the control without changing his active workspace.
  "audience-switch-d": {
    viewport: "d",
    as: "coach",
    run: async (page) => {
      await page.goto(`${BASE}/learn`);
      await page.getByRole("navigation", { name: "Learn audience" }).waitFor();
      await page.waitForSelector("text=Paid reviews", { timeout: 15000 });
      await sleep(800);
    },
  },
  "audience-switch-m": {
    viewport: "m",
    as: "coach",
    run: async (page) => {
      await page.goto(`${BASE}/learn`);
      await page.getByRole("navigation", { name: "Learn audience" }).waitFor();
      await page.waitForSelector("text=Lesson entries", { timeout: 15000 });
      await sleep(800);
    },
  },

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

  // The source-file route, opened without changing the match.
  "original-d": {
    viewport: "d",
    manualOnly: true,
    email: ORIGINAL_ACCOUNT,
    run: async (page) => {
      if (!ORIGINAL_MATCH || !ORIGINAL_ACCOUNT) {
        throw new Error(
          "ORIGINAL_MATCH and ORIGINAL_ACCOUNT must name a staged match with a retained source"
        );
      }
      await page.goto(`${BASE}/match/${ORIGINAL_MATCH}`);
      await page.getByRole("button", { name: "Original", exact: true }).click();
      await page.getByRole("dialog", { name: "Original video" }).waitFor();
      await waitVideoReady(page);
      await pauseVideos(page);
    },
  },
  "original-m": {
    viewport: "m",
    manualOnly: true,
    email: ORIGINAL_ACCOUNT,
    run: async (page) => {
      if (!ORIGINAL_MATCH || !ORIGINAL_ACCOUNT) {
        throw new Error(
          "ORIGINAL_MATCH and ORIGINAL_ACCOUNT must name a staged match with a retained source"
        );
      }
      await page.goto(`${BASE}/match/${ORIGINAL_MATCH}`);
      await page.getByRole("button", { name: "Original", exact: true }).click();
      await page.getByRole("dialog", { name: "Original video" }).waitFor();
      await waitVideoReady(page);
      await pauseVideos(page);
    },
  },

  // The automatic highlight chooser. No render/download action is taken.
  "highlights-d": {
    viewport: "d",
    run: async (page) => {
      await page.goto(`${BASE}/match/${MATCH_A}`);
      await page.getByRole("button", { name: /^Highlights/ }).click();
      await page.waitForSelector("text=Short highlight", { timeout: 15000 });
      await sleep(700);
    },
  },
  "highlights-m": {
    viewport: "m",
    run: async (page) => {
      await page.goto(`${BASE}/match/${MATCH_A}`);
      await page.getByRole("button", { name: /^Highlights/ }).click();
      await page.waitForSelector("text=Short highlight", { timeout: 15000 });
      await sleep(700);
    },
  },

  // Open the insertion tool on a real gap, but never choose Add rally.
  "restore-rally-m": {
    viewport: "m",
    manualOnly: true,
    email: RESTORE_RALLY_ACCOUNT,
    run: async (page) => {
      if (!RESTORE_RALLY_MATCH || !RESTORE_RALLY_ACCOUNT) {
        throw new Error(
          "RESTORE_RALLY_MATCH and RESTORE_RALLY_ACCOUNT must name a staged match with a real gap"
        );
      }
      await openPlayer(page, RESTORE_RALLY_MATCH);
      const offer = page.locator('[aria-label*="Add a missing rally"]').first();
      await offer.waitFor({ timeout: 15000 });
      await offer.click();
      await page.waitForSelector("text=Add a missing rally", { timeout: 15000 });
      await waitVideoReady(page);
      await pauseVideos(page);
    },
  },

  // Requires an explicitly designated staged owner. The live database has
  // retryable rows, but this harness never guesses that unknown footage is
  // safe to photograph. Opening the sheet is read-only; the guard blocks its
  // Try placement again action even if a selector changes accidentally.
  "placement-retry-m": {
    viewport: "m",
    manualOnly: true,
    email: PLACEMENT_RETRY_ACCOUNT,
    run: async (page) => {
      if (!PLACEMENT_RETRY_MATCH || !PLACEMENT_RETRY_ACCOUNT) {
        throw new Error(
          "PLACEMENT_RETRY_MATCH and PLACEMENT_RETRY_ACCOUNT must name a staged retryable match"
        );
      }
      await page.goto(`${BASE}/match/${PLACEMENT_RETRY_MATCH}`);
      await page.getByRole("button", { name: /^Placement maps/ }).click();
      await page.waitForSelector("text=Try placement again?", { timeout: 15000 });
      await sleep(900);
    },
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

  // Journal discovery tools. Ask is captured closed; Recollect is opened
  // only far enough to show its staged topics and never reveals/adds a cue.
  "journal-ask-m": {
    viewport: "m",
    run: async (page) => {
      await page.goto(`${BASE}/journal`);
      await page
        .getByRole("searchbox", { name: "Search or ask your journal" })
        .fill("What should I work on next?");
      await page.waitForSelector("text=Ask your journal", { timeout: 20000 });
      await scrollToText(page, "Ask your journal", "center");
      await sleep(900);
    },
  },
  "journal-recollect-m": {
    viewport: "m",
    run: async (page) => {
      await page.goto(`${BASE}/journal`);
      await page.getByRole("button", { name: "Recollect", exact: true }).click();
      await page.getByText("Serve", { exact: true }).last().waitFor({
        timeout: 20000,
      });
      await sleep(700);
    },
  },

  // A coach's match-level note surface on an already shared student match.
  "coach-overall-feedback-d": {
    viewport: "d",
    as: "coach",
    run: async (page) => {
      await openCoachStudent(page, "John Miller");
      const match = page.locator('a[href^="/match/"]').first();
      const href = await match.getAttribute("href");
      if (!href) throw new Error("shared student match missing");
      await page.goto(`${BASE}${href}`);
      await page.waitForSelector("text=Overall notes", { timeout: 20000 });
      await scrollToText(page, "Overall notes", "center");
      await sleep(1000);
    },
  },
  "coach-overall-feedback-m": {
    viewport: "m",
    as: "coach",
    run: async (page) => {
      await openCoachStudent(page, "John Miller");
      const match = page.locator('a[href^="/match/"]').first();
      const href = await match.getAttribute("href");
      if (!href) throw new Error("shared student match missing");
      await page.goto(`${BASE}${href}`);
      await page.waitForSelector("text=Overall notes", { timeout: 20000 });
      await scrollToText(page, "Overall notes", "center");
      await sleep(1000);
    },
  },
};

const VIEWPORTS = {
  m: { width: 390, height: 844 },
  d: { width: 1440, height: 900 },
};

const wanted = process.argv.slice(2);
const names = wanted.length
  ? wanted
  : Object.entries(shots)
      .filter(([, spec]) => !spec.manualOnly)
      .map(([name]) => name);
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
  await installReadOnlyGuard(page);
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = "nextjs-portal{display:none!important}";
      document.head.appendChild(style);
    });
    try {
      window.localStorage.setItem("ponglensGestureHintsSeen", "1");
    } catch {}
  });
  await page.goto(
    await magicLink(spec.email ?? ACCOUNTS[spec.as ?? "player"])
  );
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
