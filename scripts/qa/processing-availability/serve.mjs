// Local-only actual-component fixture; no app route, production credentials or writes.
import { build } from "esbuild";
import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const bundle = await build({
  entryPoints: [resolve(here, "fixture.tsx")], bundle: true, write: false,
  format: "iife", platform: "browser", jsx: "automatic", logLevel: "warning",
  define: { "process.env.NODE_ENV": '"development"' },
  alias: { "@": resolve(repo, "src"), "@/lib/supabase/client": resolve(here, "fixture-client.ts"), "@uppy/core": resolve(here, "fixture-upload.ts"), "@uppy/aws-s3": resolve(here, "fixture-upload.ts") },
  plugins: [{ name: "fixture-next-router", setup(b) {
    b.onResolve({ filter: /^next\/(navigation|link)$/ }, (args) => ({ path: args.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({ contents: args.path.endsWith("navigation")
      ? "export const useRouter=()=>({refresh(){},push(){},replace(){}}); export const usePathname=()=>'/match/fixture'; export const useSearchParams=()=>new URLSearchParams();"
      : "import React from 'react'; export default function Link({href,children,...props}){return React.createElement('a',{...props,href},children)}",
      resolveDir: repo, loader: "js" }));
  } }],
});
const cssRoot = resolve(repo, ".next/static/css");
const css = readdirSync(cssRoot).filter((f) => f.endsWith(".css")).map((f) => readFileSync(resolve(cssRoot, f))).join("\n");
createServer((req, res) => {
  const path = new URL(req.url, "http://127.0.0.1").pathname;
  if (path === "/bundle.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bundle.outputFiles[0].contents); }
  else if (path === "/review") { res.setHeader("Content-Type", "text/html"); res.end(readFileSync(resolve(here, "review.html"))); }
  else if (/^\/review-images\/[a-z0-9-]+\.png$/.test(path)) { res.setHeader("Content-Type", "image/png"); try { res.end(readFileSync(resolve("/private/tmp/ponglens-availability-review", path.split("/").pop()))); } catch { res.writeHead(404); res.end(); } }
  else if (path === "/style.css") { res.setHeader("Content-Type", "text/css"); res.end(css); }
  else if (/^\/media\/[a-zA-Z0-9_.-]+\.woff2$/.test(path)) { res.setHeader("Content-Type", "font/woff2"); try { res.end(readFileSync(resolve(repo, ".next/static", path.slice(1)))); } catch { res.writeHead(404); res.end(); } }
  else { res.setHeader("Content-Type", "text/html"); res.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; media-src 'self' blob:"); res.end('<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Processing availability preview</title><link rel="stylesheet" href="/style.css"></head><body style="background:#09090d;color:#fafafa"><div id="root"></div><script src="/bundle.js"></script></body></html>'); }
}).listen(8774, "127.0.0.1", () => console.log("Preview: http://127.0.0.1:8774 (local fixtures, no production requests)"));
