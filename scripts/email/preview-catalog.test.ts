import assert from "node:assert/strict";
import test from "node:test";

import { allEmailPreviews } from "./preview-catalog.ts";
import {
  assertApprovedPreviewRecipient,
  previewDelivery,
} from "./send-preview-catalog.ts";

const EXPECTED_IDS = [
  "auth.confirm-account",
  "auth.magic-link",
  "beta.admin-notice",
  "beta.invitation",
  "billing.receipt-minutes",
  "billing.receipt-review-credits",
  "billing.receipt-storage",
  "coaching.booking-new",
  "coaching.clarification-answered",
  "coaching.clarification-requested",
  "coaching.followup-received",
  "coaching.invite-back",
  "coaching.match-submitted",
  "coaching.refund-issued",
  "coaching.review-delivered",
  "coaching.review-started",
  "digest.feedback",
  "digest.qa",
  "match.export-ready",
  "match.import-failed",
  "match.ready",
  "match.upload-failed",
  "ops.coach-outreach.failed",
  "ops.coach-outreach.succeeded",
  "ops.cost-alert",
  "ops.job-failed",
];

test("the preview catalog contains every current email state exactly once", () => {
  const previews = allEmailPreviews();
  assert.deepEqual(previews.map((preview) => preview.id), EXPECTED_IDS);
  assert.equal(new Set(previews.map((preview) => preview.id)).size, previews.length);
  for (const preview of previews) {
    assert.ok(preview.subject);
    assert.match(preview.html, /<html lang="en" dir="ltr">/);
    assert.ok(preview.text);
    assert.ok(preview.templateId);
    assert.ok(preview.templateVersion >= 1);
  }
});

test("the sender refuses addresses outside the checked-in admin list", () => {
  assert.doesNotThrow(() => assertApprovedPreviewRecipient("adilharis2001@gmail.com"));
  assert.throws(
    () => assertApprovedPreviewRecipient("someone@example.com"),
    /approved administrator/,
  );
});

test("sample sends are clearly marked and use batch-scoped idempotency", () => {
  const previews = allEmailPreviews();
  const first = previewDelivery(
    previews[0],
    0,
    previews.length,
    "batch_20260904",
    "adilharis2001@gmail.com",
  );
  const last = previewDelivery(
    previews.at(-1)!,
    previews.length - 1,
    previews.length,
    "batch_20260904",
    "adilharis2001@gmail.com",
  );
  assert.match(first.subject, /^\[Preview 1\/26\] /);
  assert.match(last.subject, /^\[Preview 26\/26\] /);
  assert.equal(first.idempotencyKey, "ponglens-preview/batch_20260904/auth.confirm-account");
  assert.notEqual(first.idempotencyKey, last.idempotencyKey);
  assert.equal(first.to, "adilharis2001@gmail.com");
  assert.equal(first.headers["X-PongLens-Preview"], "true");
});
