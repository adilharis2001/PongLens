import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isProtectedAppPath } from "../../lib/auth/paths.ts";
import {
  MARKETING_SPACES,
  hasMarketingAccess,
} from "./marketingDashboardModel.ts";

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

test("the catalog lists every marketing space once, with real copy", () => {
  assert.deepEqual(
    MARKETING_SPACES.map(({ title, href }) => ({ title, href })),
    [{ title: "Coach outreach", href: "/marketing/coach-outreach" }],
  );
  assert.equal(
    new Set(MARKETING_SPACES.map((space) => space.href)).size,
    MARKETING_SPACES.length,
  );
  for (const space of MARKETING_SPACES) {
    assert.ok(space.category.length > 0);
    assert.ok(space.description.length > 0);
  }
});

test("marketing access is the admin or the marketing role, nobody else", () => {
  assert.equal(hasMarketingAccess(true, false), true);
  assert.equal(hasMarketingAccess(false, true), true);
  assert.equal(hasMarketingAccess(false, false), false);
});

test("the central auth gate protects the marketing hub", () => {
  assert.equal(isProtectedAppPath("/marketing"), true);
  assert.equal(isProtectedAppPath("/marketing/coach-outreach"), true);
});

test("the shared gate is private and fail-closed", () => {
  const gate = read("./requireMarketing.ts");
  assert.match(gate, /auth\.getUser\(\)/);
  assert.match(gate, /redirect\(`\/login\?next=\$\{encodeURIComponent\(next\)\}`\)/);
  assert.match(gate, /supabase\.rpc\("is_admin"\)/);
  assert.match(gate, /supabase\.rpc\("is_marketing"\)/);
  assert.match(gate, /adminResult\.data === true/);
  assert.match(gate, /marketingResult\.data === true/);
  assert.match(gate, /hasMarketingAccess/);
  assert.match(gate, /notFound\(\)/);
});

test("every marketing route runs the gate and stays out of the index", () => {
  for (const page of ["./page.tsx", "./coach-outreach/page.tsx"]) {
    const source = read(page);
    assert.match(source, /requireMarketing\(/);
    assert.match(
      source,
      /robots: \{ index: false, follow: false, nocache: true \}/,
    );
  }
});

test("only the owner is handed the access list", () => {
  const page = read("./page.tsx");
  assert.match(page, /isAdmin\s*\?[\s\S]*admin_list_marketing/);
  assert.match(page, /:\s*null;/);
  const view = read("./MarketingDashboard.tsx");
  assert.match(view, /accounts !== null && <MarketingAccessSection/);
});

test("the hub renders live spaces as links and planned ones as cards", () => {
  const view = read("./MarketingDashboard.tsx");
  assert.match(view, /<Logo href="\/dashboard"/);
  assert.match(view, /<h1[^>]*>[\s\S]*Marketing[\s\S]*<\/h1>/);
  assert.match(view, /spaces\.map/);
  assert.match(view, /href=\{space\.href\}/);
  assert.match(view, /aria-label=\{`Open \$\{space\.title\}`\}/);
  assert.match(view, /group\/card/);
  // A planned space has no page yet, so it must not render a link.
  assert.match(view, /if \(planned\) \{[\s\S]*?<div/);
});

test("granting access goes through the admin-gated RPC", () => {
  const section = read("./MarketingAccessSection.tsx");
  assert.match(section, /rpc\("admin_set_marketing"/);
  assert.match(section, /p_enabled: enabled/);
  // Removal is two presses, never one.
  assert.match(section, /Confirm remove/);
  assert.doesNotMatch(section, /text-xs[^"]*"\s*>\s*(Remove|Give access)/);
});

test("public and signed-in navigation do not advertise marketing", () => {
  for (const path of [
    "../page.tsx",
    "../../components/SiteHeader.tsx",
    "../../components/SiteFooter.tsx",
    "../../components/AppNav.tsx",
  ]) {
    assert.doesNotMatch(read(path), /href=[{"']+\/marketing/);
  }
});

test("the marketing role is a value the app_roles constraint allows", () => {
  const migration = read(
    "../../../supabase/migrations/100_marketing_role.sql",
  );
  assert.match(migration, /check \(role in \('qa', 'marketing'\)\)/);
  assert.match(migration, /function public\.is_marketing/);
  // Every entry point re-checks the owner in the database.
  for (const fn of ["admin_list_marketing", "admin_set_marketing"]) {
    const body = migration.slice(migration.indexOf(`function public.${fn}`));
    assert.match(body.slice(0, 900), /if not public\.is_admin\(\) then/);
  }
  assert.doesNotMatch(migration, /grant execute[^;]*to anon/);
});
