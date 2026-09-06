import assert from "node:assert/strict";
import { test } from "node:test";
import { allowanceInput, allowanceRequestEmail } from "./allowances.ts";
import { renderEmail } from "../email/render.ts";

test("request validation accepts only the two resources and bounded optional text", () => {
  assert.deepEqual(allowanceInput({ resource: "minutes" }), { resource: "minutes", message: "" });
  assert.deepEqual(allowanceInput({ resource: "storage", message: " Tournament " }), { resource: "storage", message: "Tournament" });
  for (const value of [null, {}, { resource: "money" }, { resource: "storage", message: 1 }, { resource: "minutes", message: "x".repeat(1001) }]) {
    assert.equal(allowanceInput(value), null);
  }
});

test("admin notice uses shared branding and escapes player text", () => {
  const rendered = renderEmail(allowanceRequestEmail({
    name: "Test Player", email: "player@example.com", resource: "minutes", message: "<script>alert(1)</script>",
  }));
  assert.match(rendered.subject, /processing minutes/);
  assert.match(rendered.text, /admin\/commerce#requests/);
  assert.ok(!rendered.html.includes("<script>"));
  assert.match(rendered.html, /&lt;script&gt;/);
});
