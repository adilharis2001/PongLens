import assert from "node:assert/strict";
import test from "node:test";

import { renderEmail } from "../email/render.ts";
import {
  matchIssueResolutionEmail,
  matchIssueSubmissionEmail,
} from "../email/matchIssueEmails.ts";

test("reprocessing requests lead support directly to the private admin issue", () => {
  const rendered = renderEmail(
    matchIssueSubmissionEmail({
      issueId: "issue-1",
      matchId: "match-1",
      reporterName: "Maya Chen",
      reporterEmail: "maya@example.com",
      reporterRole: "owner",
      kind: "reprocess",
      message: "The last two rallies are missing.",
      adminUrl: "https://www.ponglens.com/admin/issues/issue-1",
    }),
  );

  assert.equal(rendered.subject, "Match reprocessing requested");
  assert.match(rendered.text, /Maya Chen \(maya@example\.com\)/);
  assert.match(rendered.text, /The last two rallies are missing\./);
  assert.match(rendered.text, /Review issue\nhttps:\/\/www\.ponglens\.com\/admin\/issues\/issue-1/);
});

test("untrusted request text is escaped in HTML and remains readable in text", () => {
  const rendered = renderEmail(
    matchIssueSubmissionEmail({
      issueId: "issue-2",
      matchId: "match-2",
      reporterName: "Coach",
      reporterEmail: "coach@example.com",
      reporterRole: "coach",
      kind: "problem",
      message: "<script>alert('x')</script>",
      adminUrl: "https://www.ponglens.com/admin/issues/issue-2",
    }),
  );

  assert.doesNotMatch(rendered.html, /<script>/);
  assert.match(rendered.html, /&lt;script&gt;/);
  assert.match(rendered.text, /<script>alert\('x'\)<\/script>/);
});

test("refund resolution states the exact server amount and the match remains available", () => {
  const rendered = renderEmail(
    matchIssueResolutionEmail({
      kind: "refund",
      minutes: 11,
      playerNote: "We reviewed the cut and returned the processing time.",
      matchUrl: "https://www.ponglens.com/match/match-1",
    }),
  );

  assert.equal(rendered.subject, "Your processing minutes were returned");
  assert.match(rendered.text, /11 processing minutes/);
  assert.match(rendered.text, /Your match and everything added to it are still available\./);
  assert.match(rendered.text, /Open match\nhttps:\/\/www\.ponglens\.com\/match\/match-1/);
});

test("reprocess, keep-current, decline, and failure use distinct calm outcomes", () => {
  const cases = [
    ["reprocessed", "A new cut is ready"],
    ["kept_current", "We kept your current cut"],
    ["declined", "Your request was reviewed"],
    ["execution_failed", "We could not prepare a new cut"],
  ] as const;

  for (const [kind, subject] of cases) {
    const rendered = renderEmail(
      matchIssueResolutionEmail({
        kind,
        minutes: 0,
        playerNote: "Here is what we found.",
        matchUrl: "https://www.ponglens.com/match/match-1",
      }),
    );
    assert.equal(rendered.subject, subject);
  }
});
