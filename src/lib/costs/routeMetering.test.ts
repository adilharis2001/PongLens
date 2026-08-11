import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routes = [
  ["lesson", "lesson_summary"],
  ["journal-ocr", "journal_ocr"],
  ["entry-image", "entry_image_validation"],
  ["feedback/assist", "feedback_triage"],
  ["journal-ask", "journal_ask"],
  ["offerings/draft", "offering_draft"],
] as const;

for (const [route, operation] of routes) {
  test(`${route} records successful OpenAI response usage`, () => {
    const source = readFileSync(
      new URL(`../../app/api/${route}/route.ts`, import.meta.url),
      "utf8",
    );
    assert.match(
      source,
      /import \{ openAIUsageEvents, recordUsage \} from "@\/lib\/costs\/meter"/,
    );
    assert.match(source, new RegExp(`operation: "${operation}"`));
    assert.match(source, /usage: data\.usage/);
    // Whitespace-tolerant: the longer routes wrap the call across lines,
    // and a formatting choice should not decide whether spend is tracked.
    assert.match(source, /await recordUsage\(\s*openAIUsageEvents\(/);
  });
}

test("the journal ask meters its retry as well as its first call", () => {
  // The retry is a second billable call on a ~21k-token corpus. Metering
  // only the first would under-report every question that needed one.
  const source = readFileSync(
    new URL("../../app/api/journal-ask/route.ts", import.meta.url),
    "utf8",
  );
  const metered = source.match(/operation: "journal_ask"/g) ?? [];
  assert.equal(
    metered.length,
    2,
    "expected both the first call and the retry to meter",
  );
  assert.match(source, /usage: retry\.usage/);
});

test("the coach write-up tools meter both actions", () => {
  const source = readFileSync(
    new URL("../../app/api/reviews/assist/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /operation: `review_\$\{action\}`/);
  assert.match(source, /await recordUsage\(\s*openAIUsageEvents\(/);
});

test("Stripe fees are metered where Stripe reports them", () => {
  // The webhook handler lives behind the payments seam (092), not in the
  // route file — the route is one line by design.
  const webhook = readFileSync(
    new URL("../payments/stripeWebhook.ts", import.meta.url),
    "utf8",
  );
  // The expand is the whole trick: no balance transaction, no real fee.
  assert.match(webhook, /expand: \["latest_charge\.balance_transaction"\]/);
  assert.match(webhook, /stripeChargeFeeEvent/);

  const money = readFileSync(
    new URL("../payments/orderMoney.ts", import.meta.url),
    "utf8",
  );
  assert.match(money, /stripePayoutFeeEvent/);
  assert.match(money, /stripeConnectAccountFeeEvent/);
});

test("review lifecycle emails are metered", () => {
  const source = readFileSync(
    new URL("../email/reviewEmails.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /resendEmailEvent/);
  assert.match(source, /operation: `review_email_\$\{kind\}`/);
});

test("Recollect meters extraction and validation as separate operations", () => {
  const source = readFileSync(
    new URL("../recollect/openai.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /operation: "recollect_extraction"/);
  assert.match(source, /operation: "recollect_validation"/);
  assert.match(source, /openAIUsageEvents/);
  assert.match(source, /recordUsage/);
});
