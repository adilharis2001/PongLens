import assert from "node:assert/strict";
import test from "node:test";

import {
  repairAuthConfirmPath,
  buildEmailConfirmRedirect,
  canonicalOrigin,
  isProtectedAppPath,
  loginPathForDestination,
  loginErrorMessage,
  safeNextPath,
} from "./paths.ts";

test("safeNextPath accepts a local application path", () => {
  assert.equal(safeNextPath("/match/123?tab=notes"), "/match/123?tab=notes");
});

test("safeNextPath rejects absolute and protocol-relative destinations", () => {
  assert.equal(safeNextPath("https://evil.example"), "/dashboard");
  assert.equal(safeNextPath("//evil.example"), "/dashboard");
  assert.equal(safeNextPath(undefined), "/dashboard");
});

test("buildEmailConfirmRedirect carries an encoded destination", () => {
  assert.equal(
    buildEmailConfirmRedirect("https://www.ponglens.com", "/match/123?tab=notes"),
    "https://www.ponglens.com/auth/confirm?next=%2Fmatch%2F123%3Ftab%3Dnotes",
  );
});

test("canonicalOrigin pins every non-local host to production", () => {
  assert.equal(
    canonicalOrigin("https://ponglens-git-landing-v2-x.vercel.app"),
    "https://www.ponglens.com",
  );
  assert.equal(canonicalOrigin("https://ponglens.com"), "https://www.ponglens.com");
  assert.equal(canonicalOrigin("not a url"), "https://www.ponglens.com");
});

test("canonicalOrigin leaves localhost alone for dev sign-in", () => {
  assert.equal(canonicalOrigin("http://localhost:3000"), "http://localhost:3000");
  assert.equal(canonicalOrigin("http://127.0.0.1:3000"), "http://127.0.0.1:3000");
});

test("protected routes return to the exact local destination after sign-in", () => {
  assert.equal(
    loginPathForDestination("/research/fused-labeling?point=7"),
    "/login?next=%2Fresearch%2Ffused-labeling%3Fpoint%3D7",
  );
});

test("all signed-in destinations use the central protection gate", () => {
  for (const path of [
    "/journal",
    "/improve",
    "/stats",
    "/starred",
    "/matches",
  ]) {
    assert.equal(isProtectedAppPath(path), true);
  }
  assert.equal(isProtectedAppPath("/"), false);
  assert.equal(isProtectedAppPath("/privacy"), false);
});

test("the private workspaces need a session before their own gate runs", () => {
  // requireTesting() and its siblings answer notFound() to someone who is
  // signed in but unauthorised. That only reads as "no such page" if the
  // signed-OUT case never reaches them, which is this list's job.
  for (const path of [
    "/research",
    "/marketing",
    "/testing",
    "/testing/bugs",
    "/testing/library",
    "/testing/report",
  ]) {
    assert.equal(isProtectedAppPath(path), true, `${path} is unprotected`);
  }
});

test("loginErrorMessage explains an expired email link", () => {
  assert.equal(
    loginErrorMessage("email-link"),
    "That sign-in link is invalid or has expired. Request a new one below.",
  );
  assert.equal(loginErrorMessage(undefined), null);
});

test("a malformed app email link is repaired into a real query", () => {
  // The exact shape every app-requested email carried: RedirectTo had no
  // query, so the template's "&token_hash" landed inside the path.
  assert.deepEqual(
    repairAuthConfirmPath("/auth/confirm&token_hash=abc123&type=email"),
    { pathname: "/auth/confirm", search: "?token_hash=abc123&type=email" },
  );
});

test("well-formed and unrelated paths are left alone", () => {
  // A correct link never enters the repair: token_hash rides the query,
  // so the pathname is exactly /auth/confirm.
  assert.equal(repairAuthConfirmPath("/auth/confirm"), null);
  assert.equal(repairAuthConfirmPath("/auth/callback"), null);
  assert.equal(repairAuthConfirmPath("/match/abc"), null);
  // A path that merely shares the prefix without the "&" is not ours to
  // touch either.
  assert.equal(repairAuthConfirmPath("/auth/confirmation"), null);
});
