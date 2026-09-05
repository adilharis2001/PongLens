import assert from "node:assert/strict";
import test from "node:test";

import {
  purchaseReceiptEmail,
  reviewLifecycleEmail,
} from "./catalog.ts";
import { typescriptEmailFixtures } from "./fixtures.ts";
import { renderEmail } from "./render.ts";

test("fixture catalog covers every TypeScript email state with unique identities", () => {
  const fixtures = typescriptEmailFixtures();
  assert.equal(fixtures.length, 17);
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
