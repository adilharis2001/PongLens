/**
 * Dump the on-screen elements of a route, so a flow targets things that
 * actually exist at the size they actually are.
 *
 *   SERVICE_KEY=... node scripts/demos/tutorial/probe.mjs <course> <account> <path> [step ...]
 *
 * Steps run before the dump, and are either `click:<text>` (first button
 * whose text starts with it), `aria:<label>` (first matching aria-label),
 * or `wait:<ms>`. Everything measured is in the same 390x844 CSS pixels the
 * cue track uses, so numbers here can be read straight into a flow.
 *
 * This exists because guessing selectors cost two bad renders: a size floor
 * matched an ancestor twice and the box outlined the wrong thing.
 */

import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { catalogChapters } from "./course-paths.mjs";

const SUPABASE = "https://pdycinmyfnritemrsfjf.supabase.co";
const PROBE_USAGE = "usage: SERVICE_KEY=... probe.mjs <player|coach> <email> <path> [click:X|aria:X|scroll:X|wait:500 ...]";

export function parseProbeArgs(args) {
  const [course, account, routePath, ...steps] = args;
  try {
    catalogChapters(course);
  } catch (error) {
    throw new Error(`${PROBE_USAGE}\n${error.message}`);
  }
  const validAccount = typeof account === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(account);
  const validPath = typeof routePath === "string" && routePath.startsWith("/") && !routePath.startsWith("//");
  const validSteps = steps.every((step) => {
    const [kind, ...rest] = step.split(":");
    const value = rest.join(":");
    if (!["click", "aria", "scroll", "wait"].includes(kind) || !value) return false;
    return kind !== "wait" || /^\d+$/.test(value);
  });
  if (!validAccount || !validPath || !validSteps) throw new Error(PROBE_USAGE);
  return { course, account, routePath, steps };
}

export async function runProbe(args) {
const { account, routePath, steps } = parseProbeArgs(args);
const base = process.env.BASE ?? "https://www.ponglens.com";
const serviceKey = process.env.SERVICE_KEY;
if (!serviceKey) throw new Error("SERVICE_KEY env var required (supabase service role key)");

const res = await fetch(`${SUPABASE}/auth/v1/admin/generate_link`, {
  method: "POST",
  headers: {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ type: "magiclink", email: account }),
});
const { hashed_token } = await res.json();

const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
await page.goto(
  `${base}/auth/confirm?token_hash=${hashed_token}&type=email&next=${encodeURIComponent(routePath)}`
);
await page.waitForTimeout(6000);

for (const step of steps) {
  const [kind, ...rest] = step.split(":");
  const arg = rest.join(":");
  if (kind === "wait") await page.waitForTimeout(Number(arg));
  else if (kind === "scroll")
    await page.evaluate((t) => {
      [...document.querySelectorAll("h1, h2, h3")]
        .find((h) => h.textContent.trim().toLowerCase().startsWith(t.toLowerCase()))
        ?.scrollIntoView({ block: "start" });
      window.scrollBy(0, -70);
    }, arg);
  else if (kind === "click")
    await page.evaluate((t) => {
      [...document.querySelectorAll("button, a, [role=button]")]
        .find((b) => b.textContent.trim().toLowerCase().startsWith(t.toLowerCase()))
        ?.click();
    }, arg);
  else if (kind === "aria")
    await page.evaluate((t) => {
      document.querySelector(`[aria-label*="${t}"]`)?.click();
    }, arg);
  await page.waitForTimeout(1400);
}

const dump = await page.evaluate(() => {
  const out = { url: location.pathname, aria: [], text: [], media: [] };
  const R = (e) => {
    const r = e.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const onScreen = (r) => r.w > 6 && r.h > 6 && r.y < 900 && r.y + r.h > -50;

  document.querySelectorAll("[aria-label]").forEach((e) => {
    const r = R(e);
    if (onScreen(r)) out.aria.push({ label: e.getAttribute("aria-label").slice(0, 46), ...r });
  });
  document.querySelectorAll("h1,h2,h3,button,p,span").forEach((e) => {
    const t = e.textContent.trim();
    const r = R(e);
    if (t && t.length < 34 && onScreen(r) && r.w > 20) {
      out.text.push({ tag: e.tagName, t: t.slice(0, 32), ...r });
    }
  });
  document.querySelectorAll("video, svg, canvas, img").forEach((e) => {
    const r = R(e);
    if (onScreen(r) && r.w > 60) out.media.push({ tag: e.tagName, ...r });
  });
  return out;
});

console.log(JSON.stringify(dump, null, 1));
await browser.close();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runProbe(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
