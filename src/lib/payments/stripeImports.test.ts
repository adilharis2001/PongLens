import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import test from "node:test";

/**
 * Money moves through one seam: only src/lib/payments may import the
 * stripe package. This is what keeps billing_mode routing (092) — the QA
 * test bypass — impossible to sidestep from a new payment surface. The
 * eslint rule in eslint.config.mjs says the same thing; this test says it
 * in a way `npm run test:reviews` enforces without a lint pass.
 */

const SRC = join(process.cwd(), "src");
const ALLOWED = join("src", "lib", "payments") + sep;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

test("stripe is only imported inside src/lib/payments", () => {
  const offenders: string[] = [];
  for (const file of walk(SRC)) {
    const rel = relative(process.cwd(), file);
    if (rel.startsWith(ALLOWED)) continue;
    const text = readFileSync(file, "utf8");
    if (
      /from\s+["']stripe["']/.test(text) ||
      /require\(\s*["']stripe["']\s*\)/.test(text) ||
      /import\(\s*["']stripe["']\s*\)/.test(text)
    ) {
      offenders.push(rel);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `stripe imported outside src/lib/payments: ${offenders.join(", ")} — ` +
      "route it through the gateway instead",
  );
});
