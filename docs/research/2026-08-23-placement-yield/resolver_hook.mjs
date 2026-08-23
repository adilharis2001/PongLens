// Resolve the repo's extensionless and @/ imports the way Next.js does,
// so the probe can load the real modules instead of a re-implementation.
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
const ROOT = "/Users/adil/Desktop/Projects/PongLens/src/";
export async function resolve(spec, ctx, next) {
  if (spec.startsWith("@/")) {
    for (const ext of [".ts", ".tsx", "/index.ts", ""]) {
      const p = ROOT + spec.slice(2) + ext;
      if (existsSync(p)) return { url: pathToFileURL(p).href, shortCircuit: true };
    }
  }
  if (spec.startsWith(".") && ctx.parentURL) {
    const base = new URL(spec, ctx.parentURL);
    for (const ext of [".ts", ".tsx", "/index.ts"]) {
      const p = decodeURIComponent(base.pathname) + ext;
      if (existsSync(p)) return { url: pathToFileURL(p).href, shortCircuit: true };
    }
  }
  return next(spec, ctx);
}
