/**
 * Runs the V3 / Body detector page component in a simulated browser and works
 * it: load a match, click a row-call button, check what the click did.
 *
 * The research pages are admin-only and imperative, so nothing else executes
 * them before a deploy. Two defects reached production on 2026-09-08 that
 * `next build` and the unit tests could not see: a temporal-dead-zone
 * ReferenceError at effect start, and a shared button handler that lit every
 * row-call button and deleted the serve call for the row. This catches both
 * kinds: an exception while the page loads, and a click that posts to the
 * wrong route or paints the wrong buttons.
 *
 *   node scripts/research-smoke.mjs            the component in the tree
 *   SMOKE_ENTRY=<path> node scripts/...        another copy of it (a regression check)
 *
 * Fixtures are the committed payloads under public/research/ for one match,
 * so the test needs no network and no sign-in.
 */
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const ENTRY = path.resolve(process.env.SMOKE_ENTRY || "src/app/research/v3-serve-detector/V3ServeDetector.tsx");
const PAGE = "/research/body-detector";
const ASSETS = "/research/v3-serve-detector";
const index = JSON.parse(readFileSync(path.join(ROOT, "public", PAGE, "index.json"), "utf8"));
const meta = index.find((m) => m.match === "10322849") || index[0];
if (!meta) throw new Error("no match in the body-detector manifest");

// ---- 1. bundle the component with a stub for next/link -------------------
const tmp = mkdtempSync(path.join(os.tmpdir(), "research-smoke-"));
writeFileSync(path.join(tmp, "link.tsx"), `
import { createElement } from "react";
export default function Link(props: any) { const { href, children, ...rest } = props; return createElement("a", { href: String(href), ...rest }, children); }
`);
writeFileSync(path.join(tmp, "entry.tsx"), `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { V3ServeDetector } from ${JSON.stringify(ENTRY)};
export function mount(el: any, props: any) { const root = createRoot(el); root.render(createElement(V3ServeDetector, props)); return root; }
`);
const bundle = path.join(tmp, "bundle.mjs");
await build({
  entryPoints: [path.join(tmp, "entry.tsx")],
  bundle: true, format: "esm", platform: "browser", jsx: "automatic", outfile: bundle, logLevel: "silent",
  define: { "process.env.NODE_ENV": '"development"' },
  alias: { "next/link": path.join(tmp, "link.tsx") },
  nodePaths: [path.join(ROOT, "node_modules")],
});

// ---- 2. a browser ---------------------------------------------------------
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
  url: `https://www.ponglens.com${PAGE}`, pretendToBeVisual: true,
});
const { window } = dom;
for (const k of Object.getOwnPropertyNames(window)) if (!(k in globalThis)) { try { globalThis[k] = window[k]; } catch { /* read-only */ } }
for (const [k, v] of [["window", window], ["document", window.document], ["navigator", window.navigator]]) {
  try { Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true }); } catch { /* Node keeps its own */ }
}
// a canvas context that accepts anything and returns something usable
const ctx = new Proxy({}, {
  get: (t, p) => (p in t ? t[p] : p === "measureText" ? () => ({ width: 10 }) : () => ctx),
  set: (t, p, v) => ((t[p] = v), true),
});
window.HTMLCanvasElement.prototype.getContext = () => ctx;
window.HTMLMediaElement.prototype.play = () => Promise.resolve();
window.HTMLMediaElement.prototype.pause = () => {};
window.HTMLMediaElement.prototype.load = () => {};
window.HTMLElement.prototype.scrollIntoView = () => {};

// ---- 3. the network: committed payloads, and a record of every POST -------
const posts = [];
const errors = [];
const file = (rel) => path.join(ROOT, "public", rel);
window.fetch = globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
  if (init.method === "POST") {
    posts.push({ url: u, body: init.body ? JSON.parse(String(init.body)) : null });
    if (u === "/api/admin/media-url") return json({ url: "" });
    return json({ ok: true });
  }
  if (u.startsWith("/research/")) {
    const p = file(u);
    if (!existsSync(p)) return new Response("not found", { status: 404 });
    return new Response(readFileSync(p), { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response("not found", { status: 404 });
};
window.addEventListener("error", (e) => errors.push(String(e.error || e.message)));
process.on("uncaughtException", (e) => errors.push(String(e && e.stack || e)));
process.on("unhandledRejection", (e) => errors.push(String(e && e.stack || e)));
const consoleErrors = [];
const origErr = console.error;
console.error = (...a) => { consoleErrors.push(a.map(String).join(" ")); };

// ---- 4. mount and wait for the rows ---------------------------------------
const { mount } = await import(pathToFileURL(bundle).href);
mount(window.document.getElementById("root"), {
  matches: [meta], initialVerdicts: [], initialRowVerdicts: [],
  dataBase: PAGE, assetBase: ASSETS, heading: "smoke",
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let rows = [];
for (let i = 0; i < 100 && rows.length === 0; i++) { await sleep(50); rows = Array.from(window.document.querySelectorAll("#tbody tr")); }
console.error = origErr;

const fail = (msg) => { console.log("SMOKE FAIL: " + msg); if (errors.length) console.log("  errors:\n   " + errors.join("\n   ")); if (consoleErrors.length) console.log("  console.error:\n   " + consoleErrors.slice(0, 5).join("\n   ")); process.exit(1); };
if (errors.length) fail("an exception while the page loaded");
if (!rows.length) fail("no rows rendered after 5 s");

// ---- 5. work a row --------------------------------------------------------
const row = rows.find((tr) => tr.querySelector('.rc button[data-rv="fine"]') && tr.querySelector(".vd button[data-v]"));
if (!row) fail("no row carries both a row-call strip and a serve-call strip");
const fine = row.querySelector('.rc button[data-rv="fine"]');
const before = posts.length;
fine.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await sleep(50);
const pressed = (sel) => Array.from(row.querySelectorAll(sel)).map((b) => b.getAttribute("aria-pressed"));
const rc = pressed(".rc button"), sv = pressed(".vd button[data-v]");
const newPosts = posts.slice(before);
const toRow = newPosts.filter((p) => p.url === "/api/research/row-verdict");
const toServe = newPosts.filter((p) => p.url === "/api/research/v3-verdict");
if (rc.join() !== "true,false,false") fail(`row-call buttons after clicking fine read ${rc.join(",")}, expected true,false,false`);
if (sv.some((x) => x === "true")) fail(`the serve-call buttons changed: ${sv.join(",")}`);
if (toRow.length !== 1 || toRow[0].body.verdict !== "fine" || toRow[0].body.page !== "body-detector") fail(`expected one row-verdict post with verdict fine, got ${JSON.stringify(toRow)}`);
if (toServe.length) fail(`the click also posted to the serve-call route: ${JSON.stringify(toServe)}`);
// clicking again clears
fine.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await sleep(50);
const last = posts[posts.length - 1];
if (pressed(".rc button").join() !== "false,false,false" || last.url !== "/api/research/row-verdict" || last.body.verdict !== null) fail("a second click did not clear the call");
if (errors.length) fail("an exception while working the row");
console.log(`SMOKE OK: ${rows.length} rows, ${meta.title}; a row call posts once to its own route, paints one button, and clears on the second click.`);
process.exit(0);
