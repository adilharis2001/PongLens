/**
 * Tutorial chapter capture driver.
 *
 *   SERVICE_KEY=... BASE=http://localhost:3000 \
 *     node scripts/demos/tutorial/capture.mjs <chapter>
 *
 * Signs the demo account in, hands the page to flows/<chapter>.mjs, and
 * records both the picture and an annotation cue track (record-cues.mjs).
 * Beat timings come from voice/<chapter>.json — narration is generated
 * first and the flow waits exactly as long as each line takes to speak.
 *
 * A flow that has to write (Keep score taps a winner) declares `guard`
 * with the match id; the driver snapshots those rows first and restores
 * them in a `finally`, so an interrupted run still leaves the demo account
 * as it found it.
 *
 * Output: raw/tut-<chapter>.mp4 + raw/tut-<chapter>.cues.json
 */

import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeCueRecorder } from "./record-cues.mjs";
import { snapshot, restore } from "./guard.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
/**
 * Where voice/, flows/ and raw/ live. Defaults to this pipeline's own
 * folder; the landing video passes its own so the two productions keep
 * separate scripts and footage while sharing the clock, which is the part
 * that has to behave identically for both.
 *
 *   node capture.mjs mobile ../landing
 */
const WORK = process.argv[3] ? path.resolve(DIR, process.argv[3]) : DIR;
const RAW = path.join(WORK, "raw");
/**
 * Viewport. The tutorial chapters are all phone-sized; the landing video is
 * shot twice, once at each size, so it comes from the environment rather
 * than being baked in.
 */
const VIEWPORT = {
  width: Number(process.env.SHOT_W ?? 390),
  height: Number(process.env.SHOT_H ?? 844),
  dsf: Number(process.env.SHOT_DSF ?? 2),
};
const BASE = process.env.BASE ?? "http://localhost:3000";
const SERVICE_KEY = process.env.SERVICE_KEY;
const SUPABASE = "https://pdycinmyfnritemrsfjf.supabase.co";
const DEMO_EMAIL = "uploader-test@example.com";
const CHAPTER = process.argv[2] ?? "upload";
/** Which account a chapter is shot from. Flows override with `account`
 *  (chapters using real match data run from the owner's own account). */
let ACCOUNT = DEMO_EMAIL;

if (!SERVICE_KEY) {
  console.error("SERVICE_KEY env var required (supabase service role key)");
  process.exit(1);
}

/**
 * Which narration to time against. Normally the chapter's own, but the
 * landing video is shot twice from one script — flows/mobile.mjs and
 * flows/desktop.mjs both run against voice/landing.json — so the two can
 * be named apart.
 */
const VOICE = process.env.SHOT_VOICE ?? CHAPTER;
const voice = JSON.parse(
  readFileSync(path.join(WORK, "voice", `${VOICE}.json`), "utf8")
);
const chapter = await import(path.join(WORK, "flows", `${CHAPTER}.mjs`));
if (chapter.account) ACCOUNT = chapter.account;

/** Beat window: when its narration line starts and ends. */
const beat = (id) => {
  const l = voice.lines.find((x) => x.beat === id);
  if (!l) throw new Error(`no narration line for beat ${id}`);
  return { start: l.start, end: l.start + l.dur, dur: l.dur };
};

async function magicLink(next) {
  const res = await fetch(`${SUPABASE}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "magiclink", email: ACCOUNT }),
  });
  const data = await res.json();
  if (!data.hashed_token) {
    throw new Error(`magic link failed: ${JSON.stringify(data)}`);
  }
  return `${BASE}/auth/confirm?token_hash=${data.hashed_token}&type=email&next=${encodeURIComponent(
    next
  )}`;
}

/** Element lookup shared by every flow and by the recorder's rect helper. */
const PICKER = () => {
  window.__pick = (spec) => {
    // Scope FIRST. A point sheet is an overlay drawn on top of the match
    // page, so the document contains two of several things — two <video>
    // elements, two "Notes" headings. Document order then hands back the
    // one BEHIND the sheet, which is a valid on-screen rect pointing at
    // entirely the wrong element.
    const root = spec.within ? window.__pick(spec.within) : document;
    if (!root) return null;
    const q = (sel) => [...root.querySelectorAll(sel)];
    if (spec.aria) {
      // Scoped like every other branch: the match page underneath a sheet
      // carries its own copy of controls like the voice-note mic, and the
      // unscoped lookup returned the one thousands of pixels down the page.
      return (
        root.querySelector(`[aria-label="${spec.aria}"]`) ??
        q("[aria-label]").find((el) =>
          el.getAttribute("aria-label").includes(spec.aria)
        ) ??
        null
      );
    }
    if (spec.sectionOf) {
      // The <section> a heading belongs to: bounded by the real element,
      // not by "wherever the next heading happens to be".
      const h = q("h1, h2, h3").find((el) =>
        el.textContent.trim().toLowerCase().startsWith(spec.sectionOf.toLowerCase())
      );
      return h?.closest("section") ?? h?.parentElement ?? null;
    }
    if (spec.after) {
      // The block a section heading introduces — Home is a stack of
      // "heading, then the thing", so a highlight wants both.
      const head = q("h1, h2, h3").find((el) =>
        el.textContent.trim().toLowerCase().startsWith(spec.after.toLowerCase())
      );
      return head?.nextElementSibling ?? null;
    }
    // A size floor alone is dangerous: text matching walks every ancestor
    // too, and the first element big enough is often the CARD, not the row.
    // `max` bounds it from the other side.
    const fits = (el) => {
      const r = el.getBoundingClientRect();
      // `visible` matters for repeated rows: a size filter alone returns the
      // FIRST li in the document, which on a long list is scrolled far above
      // the fold. A valid rect for an element nobody can see.
      // Fully inside, not merely touching: a row straddling the top edge has
      // a valid rect that the cue validator then rejects for hanging off the
      // screen, which is the same highlight lost either way.
      if (spec.visible) {
        if (r.top < 4 || r.bottom > window.innerHeight - 4) return false;
        if (r.left < 0 || r.right > window.innerWidth) return false;
      }
      if (spec.min && (r.width < (spec.min.w ?? 0) || r.height < (spec.min.h ?? 0)))
        return false;
      if (spec.max && (r.width > (spec.max.w ?? 1e9) || r.height > (spec.max.h ?? 1e9)))
        return false;
      return true;
    };
    if (spec.sel) {
      const all = q(spec.sel);
      if (spec.min || spec.max) return all.find(fits) ?? null;
      return all[spec.nth ?? 0] ?? null;
    }
    const tags = spec.tag ?? "button, a, h1, h2, h3, p, div";
    // Case-insensitive: plenty of labels are sentence case in the DOM and
    // uppercased by CSS ("Keep scoring" renders as "KEEP SCORING"), which
    // is invisible on screen and fails a strict match every time.
    const want = spec.text.toLowerCase();
    return (
      q(tags).find(
        (el) =>
          el.textContent.trim().toLowerCase().startsWith(want) && fits(el)
      ) ?? null
    );
  };
};

/** The Next dev-tools badge is not part of the product. Added after load,
 *  not as an init script: a <style> parked on <html> before hydration gets
 *  dropped when React takes over the document. */
const HIDE_DEV_CHROME =
  "nextjs-portal,[data-nextjs-toast],#__next-build-watcher{display:none !important}";

/**
 * Close an overlay and PROVE it closed.
 *
 * The first Keep score take left the Why sheet open for the last 17 seconds
 * because the flow pressed Escape and moved on — Escape does not close that
 * sheet, it has a Skip control. Every overlay a flow opens goes out through
 * here, and a sheet that will not close fails the capture instead of
 * quietly ruining the rest of it.
 */
export const dismiss = async (page, { click, gone, timeout = 4000 }) => {
  const stillOpen = async () =>
    page.evaluate((s) => Boolean(window.__pick(s)), gone);
  const settle = async () => {
    try {
      await page.waitForFunction((s) => !window.__pick(s), gone, { timeout });
      return true;
    } catch {
      return false;
    }
  };

  // If the target is not there at entry, the gone-spec is wrong — every
  // caller has just opened something. Returning quietly here is how the Why
  // sheet got left open a second time: a mistyped selector became a no-op
  // instead of an error.
  if (!(await stillOpen())) {
    throw new Error(
      `nothing matched the gone-spec, so nothing was dismissed: ${JSON.stringify(gone)}`
    );
  }
  if (click) {
    const hit = await page.evaluate((s) => {
      const el = window.__pick(s);
      el?.click();
      return Boolean(el);
    }, click);
    if (hit && (await settle())) return;
  }
  // The named control is the right way, but it can miss: the panel may be
  // mid-animation, or the point may have advanced under it. Escape is the
  // fallback, and only after BOTH fail is the capture wrong enough to stop.
  await page.keyboard.press("Escape");
  if (await settle()) return;
  throw new Error(`overlay did not close: ${JSON.stringify(gone)}`);
};

/**
 * The rect of a whole page SECTION, from its heading down to the next one.
 *
 * `nextElementSibling` is not good enough on Home: a heading usually sits
 * in a flex row with a "View all" link beside it, so the heading's sibling
 * is that link, and the highlight comes out as a 28px sliver. Measuring
 * heading-to-next-heading gets the thing a viewer would call the section.
 * Clamped to the viewport so a long section does not draw off-screen.
 */
export const sectionRect = async (page, text) =>
  page.evaluate((t) => {
    const heads = [...document.querySelectorAll("h1, h2, h3")];
    const i = heads.findIndex((h) =>
      h.textContent.trim().toLowerCase().startsWith(t.toLowerCase())
    );
    if (i < 0) return null;
    const r = heads[i].getBoundingClientRect();
    const next = heads[i + 1]?.getBoundingClientRect();
    const bottom =
      next && next.top > r.bottom + 8 ? next.top - 20 : r.bottom + 220;
    // Clear the sticky app header (56px on mobile). A section scrolled to
    // the top of the document sits UNDER that bar, so a box measured from
    // its heading draws its top edge and its label chip across the logo.
    const top = Math.max(r.top - 8, 62);
    return {
      x: 14,
      y: top,
      w: window.innerWidth - 28,
      h: Math.min(bottom, window.innerHeight - 10) - top,
    };
  }, text);

/** Smallest rect covering several — a heading AND its blurb, a whole row. */
export const union = (...rects) => {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return {
    x,
    y,
    w: Math.max(...rects.map((r) => r.x + r.w)) - x,
    h: Math.max(...rects.map((r) => r.y + r.h)) - y,
  };
};

/**
 * Phone or desktop, and it is not just the viewport size.
 *
 * Every capture used to claim to be an iPhone regardless of width, which was
 * fine while every chapter was phone-sized and quietly wrong the moment a
 * desktop cut existed: `hasTouch` makes the browser report `pointer: coarse`,
 * and the Score Keeper pad only detaches into its draggable card behind
 * `(min-width: 1024px) and (pointer: fine)`. So a 1440-wide capture with
 * touch on is a 1440-wide phone, and production correctly served it the
 * phone layout. The footage was new every time; the device was wrong.
 *
 * Default follows the viewport; SHOT_TOUCH forces it either way.
 */
const TOUCH =
  process.env.SHOT_TOUCH !== undefined
    ? process.env.SHOT_TOUCH === "1"
    : VIEWPORT.width < 1024;

// --force-device-scale-factor, or everything below is decoration. Headless
// Chrome rasterises at 1x no matter what deviceScaleFactor the context
// emulates, and Page.startScreencast can only hand over the pixels that
// exist: both landing cuts were captured at CSS resolution (the phone at
// 390 wide, the 1440-wide desktop at 800) and then upscaled into a 1080p
// canvas at render. Nothing about that is visible until you watch the file.
const browser = await chromium.launch({
  channel: "chrome",
  args: [`--force-device-scale-factor=${VIEWPORT.dsf}`],
});
const context = await browser.newContext({
  viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
  deviceScaleFactor: VIEWPORT.dsf,
  isMobile: TOUCH,
  hasTouch: TOUCH,
  ...(TOUCH
    ? {
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      }
    : {}),
});
console.log(`device: ${TOUCH ? "touch (phone)" : "mouse (desktop)"} at ${VIEWPORT.width}x${VIEWPORT.height}`);
await context.addInitScript(PICKER);
const page = await context.newPage();

// The snapshot goes to disk BEFORE anything is recorded. The in-memory copy
// covers a thrown error; the file covers the case the `finally` cannot —
// the process being killed outright — so the demo account is always
// recoverable with `node guard.mjs restore <file>`.
const snapPath = path.join(RAW, `.guard-${CHAPTER}.json`);
let snap = null;
try {
  if (chapter.guard) {
    // A chapter may span more than one match (chapter 4 shows the answers on
    // one and a real traced rally on another), so the guard takes a list.
    const ids = [].concat(chapter.guard);
    console.log("snapshotting demo data…");
    snap = await Promise.all(ids.map((id) => snapshot(SERVICE_KEY, id)));
    mkdirSync(RAW, { recursive: true });
    writeFileSync(snapPath, JSON.stringify(snap));
  }

  // Staging runs AFTER the snapshot on purpose: anything it creates counts
  // as "new" and is removed by the delete pass, so a chapter can set up the
  // content it needs to show without leaving it behind.
  if (chapter.stage) {
    console.log("staging…");
    await chapter.stage(SERVICE_KEY);
  }

  console.log("signing in…");
  await page.goto(await magicLink(chapter.entry));
  await page.waitForURL(new RegExp(chapter.entry.split("?")[0].replace(/\//g, "\\/")), {
    timeout: 30000,
  });
  await page.addStyleTag({ content: HIDE_DEV_CHROME });
  if (chapter.prepare) await chapter.prepare(page);

  mkdirSync(RAW, { recursive: true });
  const record = makeCueRecorder(RAW);
  console.log(`recording tut-${CHAPTER}…`);
  const { out, cues, duration } = await record(page, `tut-${CHAPTER}`, (p, clock) =>
    chapter.flow(p, clock, {
      beat, voice, union, dismiss, sectionRect,
      serviceKey: SERVICE_KEY, base: BASE,
    })
  );

  writeFileSync(
    path.join(RAW, `tut-${CHAPTER}.cues.json`),
    `${JSON.stringify(
      {
        chapter: CHAPTER,
        video: path.basename(out),
        viewport: { w: VIEWPORT.width, h: VIEWPORT.height, dsf: VIEWPORT.dsf },
        duration: Number(duration.toFixed(3)),
        cues,
      },
      null,
      2
    )}\n`
  );
  console.log(`-> ${out}  (${duration.toFixed(1)}s, ${cues.length} cues)`);
} finally {
  await browser.close();
  if (snap) {
    console.log("restoring demo data…");
    for (const one of snap) await restore(SERVICE_KEY, one);
    rmSync(snapPath, { force: true });
  }
  // Chapters that create rows the guard cannot model (a queued job, a match
  // that does not exist yet) tear their own work down here.
  if (chapter.cleanup) {
    console.log("cleaning up…");
    await chapter.cleanup(SERVICE_KEY).catch((e) => console.error("  " + e.message));
  }
}
