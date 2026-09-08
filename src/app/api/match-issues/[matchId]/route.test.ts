import assert from "node:assert/strict";
import test from "node:test";

import {
  handleMatchIssueRequest,
  type MatchIssueRequestDependencies,
} from "../../../../lib/matchIssues/request.ts";

const MATCH = "66666666-6666-4666-8666-666666666606";
const ISSUE = "77777777-7777-4777-8777-777777777707";
const KEY = "12345678-1234-4234-8234-123456789abc";

const issue = {
  id: ISSUE,
  matchId: MATCH,
  kind: "refund" as const,
  status: "pending" as const,
  message: "Bad cut",
  refundableMinutes: 11,
  createdAt: "2026-09-07T12:00:00Z",
  updatedAt: "2026-09-07T12:00:00Z",
};

const state = {
  activeProcessingVersionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  role: "owner" as const,
  matchStatus: "ready" as const,
  activeIssue: null,
  events: [],
  refundableMinutes: 11,
  canPositive: true,
  canProblem: true,
  canReprocess: true,
  canRefund: true,
};

test("GET delivers the publication identity and actual failure refund receipt without account-balance inference", async () => {
  const receipt = { minutes: 11, receiptIds: ["9007199254740993"] };
  const response = await handleMatchIssueRequest(request("GET"), MATCH, dependencies({
    async loadState() { return { data: { ...state, matchStatus: "failed", refundableMinutes: 0, automaticRefund: receipt }, error: null }; },
  }));
  const payload = await response.json();
  assert.equal(payload.state.activeProcessingVersionId, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  assert.deepEqual(payload.state.automaticRefund, receipt);
});

function dependencies(
  overrides: Partial<MatchIssueRequestDependencies> = {},
): MatchIssueRequestDependencies {
  return {
    async authenticate() {
      return "owner-id";
    },
    async loadState() {
      return { data: state, error: null };
    },
    async submit() {
      return { data: issue, error: null };
    },
    async cancel() {
      return { data: { ...issue, status: "cancelled" }, error: null };
    },
    async sendPendingEmail() {},
    reportError() {},
    ...overrides,
  };
}

function request(method: string, body?: unknown): Request {
  return new Request(`https://www.ponglens.com/api/match-issues/${MATCH}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

test("signed-out requests fail before match data is read", async () => {
  let reads = 0;
  const response = await handleMatchIssueRequest(
    request("GET"),
    MATCH,
    dependencies({
      async authenticate() {
        return null;
      },
      async loadState() {
        reads += 1;
        return { data: state, error: null };
      },
    }),
  );
  assert.equal(response.status, 401);
  assert.equal(reads, 0);
});

test("GET returns the server-owned eligibility and refund amount", async () => {
  const response = await handleMatchIssueRequest(
    request("GET"),
    MATCH,
    dependencies(),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await body(response), { state });
});

test("invalid match ids and submission bodies never reach the database", async () => {
  let writes = 0;
  const deps = dependencies({
    async submit() {
      writes += 1;
      return { data: issue, error: null };
    },
  });
  const invalidMatch = await handleMatchIssueRequest(request("GET"), "no", deps);
  const invalidBody = await handleMatchIssueRequest(
    request("POST", { kind: "problem", message: "", idempotencyKey: KEY }),
    MATCH,
    deps,
  );
  assert.equal(invalidMatch.status, 400);
  assert.equal(invalidBody.status, 400);
  assert.equal(writes, 0);
});

test("database authorization and lifecycle conflicts retain their statuses", async () => {
  for (const [code, status] of [
    ["42501", 403],
    ["23514", 400],
    ["P0001", 409],
    ["P0002", 404],
  ] as const) {
    const response = await handleMatchIssueRequest(
      request("POST", { kind: "refund", message: "Bad cut", idempotencyKey: KEY }),
      MATCH,
      dependencies({
        async submit() {
          return { data: null, error: { code, message: "database detail" } };
        },
      }),
    );
    assert.equal(response.status, status);
    assert.deepEqual(await body(response), {
      ok: false,
      code: status === 403 ? "not_allowed" : status === 404 ? "not_found" : status === 409 ? "conflict" : "invalid_request",
    });
  }
});

test("a saved submission succeeds even when its notification email fails", async () => {
  let reported = "";
  const response = await handleMatchIssueRequest(
    request("POST", { kind: "refund", message: " Bad cut ", idempotencyKey: KEY }),
    MATCH,
    dependencies({
      async sendPendingEmail() {
        throw new Error("provider unavailable");
      },
      reportError(message) {
        reported = message;
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await body(response), { issue });
  assert.match(reported, /provider unavailable/);
});

test("DELETE validates and cancels only the named issue", async () => {
  let cancelled = "";
  const invalid = await handleMatchIssueRequest(
    request("DELETE", { issueId: "bad" }),
    MATCH,
    dependencies(),
  );
  const valid = await handleMatchIssueRequest(
    request("DELETE", { issueId: ISSUE }),
    MATCH,
    dependencies({
      async cancel(issueId) {
        cancelled = issueId;
        return { data: { ...issue, status: "cancelled" }, error: null };
      },
    }),
  );
  assert.equal(invalid.status, 400);
  assert.equal(valid.status, 200);
  assert.equal(cancelled, ISSUE);
});
