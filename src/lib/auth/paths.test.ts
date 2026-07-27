import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEmailConfirmRedirect,
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
    buildEmailConfirmRedirect("https://ponglens.com", "/match/123?tab=notes"),
    "https://ponglens.com/auth/confirm?next=%2Fmatch%2F123%3Ftab%3Dnotes",
  );
});

test("loginErrorMessage explains an expired email link", () => {
  assert.equal(
    loginErrorMessage("email-link"),
    "That sign-in link is invalid or has expired. Request a new one below.",
  );
  assert.equal(loginErrorMessage(undefined), null);
});
