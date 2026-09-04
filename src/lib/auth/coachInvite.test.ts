import assert from "node:assert/strict";
import test from "node:test";
import {
  resolvePendingCoachInviteDestination,
  type CoachInviteCompletionDependencies,
} from "./coachInvite.ts";
import { routeTerritory } from "../workspaceModel.ts";

const INVITE_TOKEN = "11111111-1111-4111-8111-111111111111";
const LINK_ID = "22222222-2222-4222-8222-222222222222";
const MATCH_ID = "33333333-3333-4333-8333-333333333333";
const PLAYER_ID = "44444444-4444-4444-8444-444444444444";
const ROSTER_ID = "55555555-5555-4555-8555-555555555555";

function dependencies(
  overrides: Partial<CoachInviteCompletionDependencies> = {},
): CoachInviteCompletionDependencies {
  return {
    acceptInvite: async () => LINK_ID,
    findAcceptedLink: async () => ({
      scope_match_id: MATCH_ID,
      player_id: PLAYER_ID,
    }),
    findRosterRow: async () => ROSTER_ID,
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

// A coach invite never lands on the player's Home: /dashboard is player
// territory, so the nav remembered "player" and a coach with no playing
// side of their own was left in one.
// A coach invite never lands on the player's Home, and never stops at a
// list either: the student's own page already holds their matches and
// anything they have shared from their journal.
test("sends a wider invite to the student's page", async () => {
  let askedFor: string | null = null;
  const destination = await resolvePendingCoachInviteDestination(
    INVITE_TOKEN,
    `/coach-invite/${INVITE_TOKEN}`,
    dependencies({
      findAcceptedLink: async () => ({
        scope_match_id: null,
        player_id: PLAYER_ID,
      }),
      findRosterRow: async (playerId) => {
        askedFor = playerId;
        return ROSTER_ID;
      },
    }),
  );

  assert.equal(askedFor, PLAYER_ID);
  assert.equal(destination, `/coaching/students/${ROSTER_ID}`);
  // Unambiguous coach territory, so the workspace settles by route.
  assert.equal(routeTerritory(destination), "coach");
});

test("falls back to the coaching home when there is no roster row", async () => {
  const destination = await resolvePendingCoachInviteDestination(
    INVITE_TOKEN,
    `/coach-invite/${INVITE_TOKEN}`,
    dependencies({
      findAcceptedLink: async () => ({
        scope_match_id: null,
        player_id: PLAYER_ID,
      }),
      findRosterRow: async () => null,
    }),
  );

  assert.equal(destination, "/coaching");
  assert.equal(routeTerritory(destination), null);
});

// The client path used to be the only caller and passed no lookup at all.
test("a caller with no roster lookup still lands on the coaching side", async () => {
  const destination = await resolvePendingCoachInviteDestination(
    INVITE_TOKEN,
    `/coach-invite/${INVITE_TOKEN}`,
    {
      acceptInvite: async () => LINK_ID,
      findAcceptedLink: async () => ({
        scope_match_id: null,
        player_id: PLAYER_ID,
      }),
    },
  );

  assert.equal(destination, "/coaching");
});

test("a match invite still opens its match", async () => {
  let rosterAsked = false;
  const destination = await resolvePendingCoachInviteDestination(
    INVITE_TOKEN,
    `/coach-invite/${INVITE_TOKEN}`,
    dependencies({
      findAcceptedLink: async () => ({
        scope_match_id: MATCH_ID,
        player_id: PLAYER_ID,
      }),
      findRosterRow: async () => {
        rosterAsked = true;
        return ROSTER_ID;
      },
    }),
  );

  // The match is the thing the player sent; nothing else is looked up.
  assert.equal(rosterAsked, false);

  // Shared ground, so nothing flips the workspace back to the player
  // side behind the coach's back; the caller stamps it to "coach".
  assert.equal(destination, `/match/${MATCH_ID}`);
  assert.equal(routeTerritory(destination), null);
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
