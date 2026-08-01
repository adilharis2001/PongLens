import assert from "node:assert/strict";
import test from "node:test";
import { isProtectedAppPath } from "../../lib/auth/paths.ts";
import {
  RESEARCH_PAGES,
  hasResearchDashboardAccess,
} from "./researchDashboard.ts";

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
    ],
  );
  assert.equal(new Set(RESEARCH_PAGES.map((page) => page.href)).size, 4);
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
