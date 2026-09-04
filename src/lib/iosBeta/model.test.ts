import assert from "node:assert/strict";
import test from "node:test";

import {
  adminEmailContent,
  normalizeBetaEmail,
  parseTestFlightUrl,
  testerEmailContent,
} from "./model.ts";

test("email normalization accepts ordinary addresses without preserving accidental casing or spaces", () => {
  assert.equal(
    normalizeBetaEmail("  Player.Name+beta@Example.COM "),
    "player.name+beta@example.com",
  );
});

test("email validation rejects values that cannot receive an invitation", () => {
  for (const value of [
    null,
    undefined,
    42,
    "",
    "not-an-email",
    "two@@example.com",
    "space here@example.com",
    `${"a".repeat(245)}@example.com`,
  ]) {
    assert.equal(normalizeBetaEmail(value), null);
  }
});

test("TestFlight configuration accepts only a secure Apple public invitation", () => {
  assert.equal(
    parseTestFlightUrl("https://testflight.apple.com/join/Ab12Cd34"),
    "https://testflight.apple.com/join/Ab12Cd34",
  );
  for (const value of [
    undefined,
    "",
    "http://testflight.apple.com/join/Ab12Cd34",
    "https://example.com/join/Ab12Cd34",
    "https://testflight.apple.com.evil.example/join/Ab12Cd34",
    "not a URL",
  ]) {
    assert.equal(parseTestFlightUrl(value), null);
  }
});

test("tester email gives one safe invitation action and complete installation instructions", () => {
  const content = testerEmailContent(
    "https://testflight.apple.com/join/Ab12Cd34",
  );

  assert.equal(content.subject, "Your PongLens iPhone beta is ready");
  assert.match(content.html, /Install PongLens beta/);
  assert.match(content.html, /Install TestFlight/);
  assert.match(content.html, /Tap Accept/);
  assert.match(content.html, /Beta access and essential beta notices only/);
  assert.match(content.text, /No marketing/);
  assert.equal(
    content.html.match(/https:\/\/testflight\.apple\.com\/join\/Ab12Cd34/g)
      ?.length,
    1,
  );
});

test("admin email escapes requester data before rendering it", () => {
  const content = adminEmailContent(
    "player+<tag>@example.com",
    "2026-09-04T14:30:00.000Z",
  );

  assert.equal(
    content.subject,
    "player+<tag>@example.com joined the iPhone beta",
  );
  assert.doesNotMatch(content.html, /player\+<tag>/);
  assert.match(content.html, /player\+&lt;tag&gt;@example\.com/);
  assert.match(content.html, /2026-09-04T14:30:00\.000Z/);
});
