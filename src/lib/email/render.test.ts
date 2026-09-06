import assert from "node:assert/strict";
import test from "node:test";

import type { EmailMessage } from "./message.ts";
import {
  EMAIL_COLORS,
  isAllowedEmailUrl,
  renderEmail,
} from "./render.ts";

const sample: EmailMessage = {
  templateId: "test.sample",
  templateVersion: 1,
  category: "match",
  audience: "player",
  subject: "Player <script> has a match",
  preheader: "A safe preview",
  eyebrow: "Match review",
  heading: "Player <script>",
  blocks: [
    { type: "paragraph", text: "A&B is ready." },
    { type: "steps", items: ["First step", "Second step"] },
    {
      type: "details",
      rows: [{ label: "File", value: "match <final>.mov" }],
    },
    {
      type: "items",
      heading: "Updates",
      items: [
        {
          title: "One <change>",
          description: "A useful explanation.",
          meta: "Today",
          url: "https://www.ponglens.com/match/sample",
        },
      ],
    },
    { type: "diagnostic", text: "stage=render\nerror=<none>" },
  ],
  action: {
    label: "Open your match",
    url: "https://www.ponglens.com/match/sample",
  },
  reason: "You received this because a sample completed.",
  support: true,
};

test("renderer preserves the message when images and theme CSS are unavailable", () => {
  const rendered = renderEmail(sample);

  assert.equal(rendered.subject, "Player <script> has a match");
  assert.match(rendered.html, /<html lang="en" dir="ltr">/);
  assert.match(rendered.html, /color-scheme: light dark/);
  assert.match(rendered.html, /prefers-color-scheme:\s*dark/);
  assert.match(rendered.html, /role="presentation"/);
  assert.match(
    rendered.html,
    /<img src="https:\/\/www\.ponglens\.com\/img\/icon-192\.png"[^>]*alt=""/,
  );
  assert.match(rendered.html, /aria-label="PongLens"/);
  assert.match(rendered.html, /max-width:560px/);
  assert.equal(rendered.html.match(/<h1\b/g)?.length, 1);
  assert.match(rendered.html, /Player &lt;script&gt;/);
  assert.doesNotMatch(rendered.html, /Player <script>/);
  assert.match(rendered.html, /match &lt;final&gt;\.mov/);
  assert.match(rendered.html, /min-height:44px/);
  assert.match(rendered.text, /Open your match\nhttps:\/\/www\.ponglens\.com\/match\/sample/);
  assert.match(rendered.text, /1\. First step\n2\. Second step/);
  assert.match(rendered.text, /stage=render\nerror=<none>/);
  assert.match(rendered.text, /support@ponglens\.com/);
});

test("renderer refuses actions and item links outside approved destinations", () => {
  assert.equal(isAllowedEmailUrl("https://ponglens.com/account"), true);
  assert.equal(isAllowedEmailUrl("https://www.ponglens.com/orders/1"), true);
  assert.equal(
    isAllowedEmailUrl("https://testflight.apple.com/join/H9XdnySg"),
    true,
  );
  for (const url of [
    "http://www.ponglens.com/account",
    "https://ponglens.com.evil.example/account",
    "https://example.com",
    "javascript:alert(1)",
  ]) {
    assert.equal(isAllowedEmailUrl(url), false);
    assert.throws(
      () =>
        renderEmail({
          ...sample,
          action: { label: "Open", url },
        }),
      /approved email destination/,
    );
  }
});

function channel(value: number): number {
  const ratio = value / 255;
  return ratio <= 0.04045 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(value.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort(
    (a, b) => b - a,
  );
  return (light + 0.05) / (dark + 0.05);
}

test("authored text and action token pairs meet normal-text contrast", () => {
  for (const theme of [EMAIL_COLORS.light, EMAIL_COLORS.dark]) {
    assert.ok(contrast(theme.primary, theme.surface) >= 4.5);
    assert.ok(contrast(theme.secondary, theme.surface) >= 4.5);
    assert.ok(contrast(theme.muted, theme.surface) >= 4.5);
  }
  assert.ok(contrast(EMAIL_COLORS.actionText, EMAIL_COLORS.accent) >= 4.5);
});
