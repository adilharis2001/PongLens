import assert from "node:assert/strict";
import test from "node:test";
import {
  resolvePendingCoachInviteDestination,
  type CoachInviteCompletionDependencies,
} from "./coachInvite.ts";

const INVITE_TOKEN = "11111111-1111-4111-8111-111111111111";
const LINK_ID = "22222222-2222-4222-8222-222222222222";
const MATCH_ID = "33333333-3333-4333-8333-333333333333";

function dependencies(
  overrides: Partial<CoachInviteCompletionDependencies> = {},
): CoachInviteCompletionDependencies {
  return {
    acceptInvite: async () => LINK_ID,
    findAcceptedLink: async () => ({ scope_match_id: MATCH_ID }),
    ...overrides,
  };
}

test("resolves a match invite through the accepted link id", async () => {
  let requestedLinkId: string | null = null;
  const destination = await resolvePendingCoachInviteDestination(
    INVITE_TOKEN,
    `/coach-invite/${INVITE_TOKEN}`,
    dependencies({
      findAcceptedLink: async (linkId) => {
        requestedLinkId = linkId;
        return { scope_match_id: MATCH_ID };
      },
    }),
  );

  assert.equal(requestedLinkId, LINK_ID);
  assert.equal(destination, `/match/${MATCH_ID}`);
});

test("sends an all-matches invite to the dashboard", async () => {
  const destination = await resolvePendingCoachInviteDestination(
    INVITE_TOKEN,
    `/coach-invite/${INVITE_TOKEN}`,
    dependencies({
      findAcceptedLink: async () => ({ scope_match_id: null }),
    }),
  );

  assert.equal(destination, "/dashboard");
});

test("preserves the requested destination when acceptance fails", async () => {
  let queried = false;
  const fallback = `/coach-invite/${INVITE_TOKEN}`;
  const destination = await resolvePendingCoachInviteDestination(
    INVITE_TOKEN,
    fallback,
    dependencies({
      acceptInvite: async () => null,
      findAcceptedLink: async () => {
        queried = true;
        return { scope_match_id: MATCH_ID };
      },
    }),
  );

  assert.equal(queried, false);
  assert.equal(destination, fallback);
});

test("preserves the requested destination when the accepted link is unavailable", async () => {
  const fallback = `/coach-invite/${INVITE_TOKEN}`;
  const destination = await resolvePendingCoachInviteDestination(
    INVITE_TOKEN,
    fallback,
    dependencies({ findAcceptedLink: async () => null }),
  );

  assert.equal(destination, fallback);
});

test("ignores an invalid pending invite token", async () => {
  let accepted = false;
  const destination = await resolvePendingCoachInviteDestination(
    "not-a-token",
    "/dashboard",
    dependencies({
      acceptInvite: async () => {
        accepted = true;
        return LINK_ID;
      },
    }),
  );

  assert.equal(accepted, false);
  assert.equal(destination, "/dashboard");
});
