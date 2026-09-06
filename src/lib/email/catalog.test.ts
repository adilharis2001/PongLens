import assert from "node:assert/strict";
import test from "node:test";

import {
  purchaseReceiptEmail,
  betaAdminNoticeEmail,
  reviewLifecycleEmail,
} from "./catalog.ts";
import { typescriptEmailFixtures } from "./fixtures.ts";
import { renderEmail } from "./render.ts";
import * as catalog from "./catalog.ts";

test("admin subjects identify the applicant instead of grouping every beta request together", () => {
  const rendered = renderEmail(betaAdminNoticeEmail({ email: "aharisib@tepper.cmu.edu", requestedAt: "2026-09-06T01:20:12Z" }));
  assert.match(rendered.subject, /aharisib@tepper\.cmu\.edu/);
  assert.doesNotMatch(rendered.subject, /[\r\n]/);
});

test("beta receipt confirms the request without giving access early", () => {
  assert.equal(typeof catalog.betaRequestReceivedEmail, "function");
  const rendered = renderEmail(catalog.betaRequestReceivedEmail());
  assert.match(rendered.text, /within 24 hours/);
  assert.match(rendered.text, /received your request/i);
  assert.doesNotMatch(rendered.html + rendered.text, /testflight\.apple\.com\/join/);
  assert.match(rendered.html, /img\/icon-192\.png/);
});

test("beta admin notice describes a request, not an installation or completed invitation", () => {
  const message = betaAdminNoticeEmail({ email: "tester@example.com", requestedAt: "2026-09-05T12:00:00Z", scheduledAt: "2026-09-06T11:00:00Z", role: "Coach", interests: ["Recording lessons as audio or video"], feedback: "Audio call", requestId: "50aa4d45-9570-4d9b-90d6-79768994ce80" });
  const rendered = renderEmail(message);
  assert.doesNotMatch(rendered.subject + rendered.text, /joined|was sent|were sent|installed/i);
  assert.match(rendered.text, /2026-09-06T11:00:00Z/);
  assert.match(rendered.text, /Audio call/);
  assert.equal(message.action?.url, "https://www.ponglens.com/admin/outreach?beta=50aa4d45-9570-4d9b-90d6-79768994ce80");
});

test("fixture catalog covers every TypeScript email state with unique identities", () => {
  const fixtures = typescriptEmailFixtures();
  assert.equal(fixtures.length, 18);
  assert.equal(
    new Set(fixtures.map((fixture) => fixture.message.templateId)).size,
    fixtures.length,
  );
  for (const fixture of fixtures) {
    assert.doesNotThrow(() => renderEmail(fixture.message), fixture.id);
  }
});

test("coaching messages are person-first and never leak private questions", () => {
  const facts = {
    coachName: "Miguel Santos",
    studentName: "Maya Chen",
    offeringTitle: "Match breakdown",
    turnaroundDays: 3,
    coachUrl: "https://www.ponglens.com/coaching/orders/sample",
    studentUrl: "https://www.ponglens.com/orders/sample",
  } as const;
  const booking = reviewLifecycleEmail("order_paid", facts);
  assert.equal(booking.subject, "Maya Chen booked Match breakdown");
  assert.match(booking.heading, /Maya Chen/);

  const clarification = reviewLifecycleEmail("clarification_requested", facts);
  const rendered = renderEmail(clarification);
  assert.match(clarification.subject, /Miguel Santos/);
  assert.doesNotMatch(rendered.html, /private question text/i);
  assert.match(rendered.text, /question itself is not included/i);
});

test("purchase variants explain the grant the receipt actually added", () => {
  const base = {
    title: "PongLens purchase",
    amount: "$12",
    purchaseDate: "September 4, 2026",
    paymentReference: "pi_sample",
  } as const;
  const minutes = renderEmail(
    purchaseReceiptEmail({ ...base, kind: "minute_pack", minutes: 120 }),
  ).text;
  const storage = renderEmail(
    purchaseReceiptEmail({
      ...base,
      kind: "storage",
      gigabytes: 25,
      months: 12,
    }),
  ).text;
  const reviews = renderEmail(
    purchaseReceiptEmail({ ...base, kind: "review_credits", credits: 3 }),
  ).text;

  assert.match(minutes, /120 processing minutes/);
  assert.match(minutes, /never expire/i);
  assert.match(storage, /25 GB/);
  assert.match(storage, /next year/i);
  assert.match(reviews, /3 sponsored reviews/);
});

test("the TestFlight sample contains one approved Apple invitation", () => {
  const beta = typescriptEmailFixtures().find(
    (fixture) => fixture.id === "beta.invitation",
  );
  assert.ok(beta);
  const rendered = renderEmail(beta.message);
  assert.equal(
    rendered.html.match(/https:\/\/testflight\.apple\.com\/join\/H9XdnySg/g)
      ?.length,
    1,
  );
  assert.match(rendered.text, /Install TestFlight/);
  assert.match(rendered.text, /Tap Accept, then Install/);
});
