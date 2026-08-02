/**
 * Dump the on-screen elements of a route, so a flow targets things that
 * actually exist at the size they actually are.
 *
 *   SERVICE_KEY=... node scripts/demos/tutorial/probe.mjs <account> <path> [step ...]
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

const [account, routePath, ...steps] = process.argv.slice(2);
const BASE = process.env.BASE ?? "https://www.ponglens.com";
const SERVICE_KEY = process.env.SERVICE_KEY;
const SUPABASE = "https://pdycinmyfnritemrsfjf.supabase.co";

if (!SERVICE_KEY || !account || !routePath) {
  console.error("usage: SERVICE_KEY=... probe.mjs <email> <path> [click:X|aria:X|wait:500 ...]");
  process.exit(1);
}

const res = await fetch(`${SUPABASE}/auth/v1/admin/generate_link`, {
  method: "POST",
  headers: {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
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
  `${BASE}/auth/confirm?token_hash=${hashed_token}&type=email&next=${encodeURIComponent(routePath)}`
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
