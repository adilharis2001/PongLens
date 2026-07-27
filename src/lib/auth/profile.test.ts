import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOnboardingPath,
  displayNameError,
  displayNameFromMetadata,
  needsNameOnboarding,
  normalizeDisplayName,
  onboardingPathForProtectedRequest,
  safePostOnboardingPath,
} from "./profile.ts";

test("reads a usable full name before provider name", () => {
  assert.equal(
    displayNameFromMetadata({ full_name: "Ada Lovelace", name: "Ada" }),
    "Ada Lovelace",
  );
});

test("treats missing and whitespace-only names as onboarding", () => {
  assert.equal(needsNameOnboarding({}), true);
  assert.equal(needsNameOnboarding({ full_name: "   " }), true);
  assert.equal(needsNameOnboarding({ name: "Grace Hopper" }), false);
});

test("normalizes repeated Unicode whitespace", () => {
  assert.equal(normalizeDisplayName("  María   José  "), "María José");
});

test("validates empty and overlong names", () => {
  assert.equal(displayNameError("   "), "Enter your name to continue.");
  assert.equal(
    displayNameError("a".repeat(81)),
    "Keep your name to 80 characters or fewer.",
  );
  assert.equal(displayNameError("Lin"), null);
});

test("keeps only safe non-recursive post-onboarding destinations", () => {
  assert.equal(
    safePostOnboardingPath("/match/123?point=4"),
    "/match/123?point=4",
  );
  for (const unsafe of [
    "https://example.com",
    "//example.com",
    "/\\example.com",
    "/login",
    "/auth/callback",
    "/onboarding?next=/dashboard",
  ]) {
    assert.equal(safePostOnboardingPath(unsafe), "/dashboard");
  }
});

test("builds an encoded onboarding destination", () => {
  assert.equal(
    buildOnboardingPath("/match/123?point=4"),
    "/onboarding?next=%2Fmatch%2F123%3Fpoint%3D4",
  );
});

test("gates only missing-name users on protected destinations", () => {
  assert.equal(
    onboardingPathForProtectedRequest({}, "/account?section=sharing"),
    "/onboarding?next=%2Faccount%3Fsection%3Dsharing",
  );
  assert.equal(
    onboardingPathForProtectedRequest(
      { full_name: "Ada Lovelace" },
      "/dashboard",
    ),
    null,
  );
});
