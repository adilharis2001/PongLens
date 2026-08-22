import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isProtectedAppPath } from "../../lib/auth/paths.ts";
import {
  RESEARCH_PAGES,
  hasResearchDashboardAccess,
} from "./researchDashboardModel.ts";

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

test("the research catalog contains every current research page", () => {
  assert.deepEqual(
    RESEARCH_PAGES.map(({ title, href }) => ({ title, href })),
    [
      { title: "Fused labeling", href: "/research/fused-labeling" },
      {
        title: "Placement calibration",
        href: "/research/placement-calibration",
      },
      { title: "Serve detection", href: "/research/serve-detection" },
      {
        title: "Point-ending research",
        href: "/research/winner-constrained-endings",
      },
      {
        title: "Updated serve detector",
        href: "/research/serve-detector",
      },
      { title: "Serve calls", href: "/research/serves" },
      { title: "Full-match signals", href: "/research/fullmatch" },
      { title: "End-on cards", href: "/research/endon" },
      { title: "Side-on cameras", href: "/research/sidecam" },
      { title: "Point recall", href: "/research/recall" },
      { title: "Crossing review", href: "/research/crossing-review" },
      { title: "Table calibration", href: "/research/table-calibration" },
      {
        title: "Table calibration holdout",
        href: "/research/table-calibration/holdout",
      },
    ],
  );
  assert.equal(new Set(RESEARCH_PAGES.map((page) => page.href)).size, 13);
  for (const page of RESEARCH_PAGES) {
    assert.ok(page.category.length > 0);
    assert.ok(page.description.length > 0);
  }
});

test("research access is limited to admins and active reviewers", () => {
  assert.equal(hasResearchDashboardAccess(true, false), true);
  assert.equal(hasResearchDashboardAccess(false, true), true);
  assert.equal(hasResearchDashboardAccess(false, false), false);
});

test("the central auth gate protects the research dashboard", () => {
  assert.equal(isProtectedAppPath("/research"), true);
});

test("the dashboard route is private and fail-closed", () => {
  const page = read("./page.tsx");
  assert.match(page, /auth\.getUser\(\)/);
  assert.match(page, /redirect\("\/login\?next=\/research"\)/);
  assert.match(page, /\.from\("research_reviewers"\)/);
  assert.match(page, /\.eq\("user_id", user\.id\)/);
  assert.match(page, /supabase\.rpc\("is_admin"\)/);
  assert.match(page, /!reviewerResult\.error/);
  assert.match(page, /hasResearchDashboardAccess/);
  assert.match(page, /notFound\(\)/);
  assert.match(
    page,
    /robots: \{ index: false, follow: false, nocache: true \}/,
  );
});

test("the dashboard renders every catalog item as a large destination link", () => {
  const view = read("./ResearchDashboard.tsx");
  assert.match(view, /<Logo href="\/dashboard"/);
  assert.match(view, /<h1[^>]*>[\s\S]*Research[\s\S]*<\/h1>/);
  assert.match(view, /pages\.map/);
  assert.match(view, /href=\{page\.href\}/);
  assert.match(view, /aria-label=\{`Open \$\{page\.title\}`\}/);
  assert.match(view, /group\/card/);
});

test("public and signed-in navigation do not advertise research", () => {
  for (const path of [
    "../page.tsx",
    "../../components/SiteHeader.tsx",
    "../../components/SiteFooter.tsx",
    "../../components/AppNav.tsx",
  ]) {
    assert.doesNotMatch(read(path), /href=[{\"']+\/research/);
  }
});
