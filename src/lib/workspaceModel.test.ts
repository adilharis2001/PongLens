import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatWorkspaceCookie,
  parseWorkspaceCookie,
  resolveWorkspace,
  routeTerritory,
  signInDestination,
} from "./workspaceModel.ts";

test("cookie round-trips for its own user and refuses another's", () => {
  const raw = formatWorkspaceCookie("u1", "coach");
  assert.equal(parseWorkspaceCookie(raw, "u1"), "coach");
  assert.equal(parseWorkspaceCookie(raw, "u2"), null);
  assert.equal(parseWorkspaceCookie(undefined, "u1"), null);
  assert.equal(parseWorkspaceCookie("u1:elsewhere", "u1"), null);
  assert.equal(parseWorkspaceCookie("coach", "u1"), null);
});

test("route territory: coach rooms, player rooms, shared ground", () => {
  assert.equal(routeTerritory("/coaching/students"), "coach");
  assert.equal(routeTerritory("/coaching/orders/abc"), "coach");
  assert.equal(routeTerritory("/coaching"), null);
  assert.equal(routeTerritory("/coaching/"), null);
  assert.equal(routeTerritory("/dashboard"), "player");
  assert.equal(routeTerritory("/journal?entry=1"), "player");
  assert.equal(routeTerritory("/orders/abc"), "player");
  assert.equal(routeTerritory("/match/abc"), null);
  assert.equal(routeTerritory("/account"), null);
  assert.equal(routeTerritory("/s/token"), null);
});

test("resolution order: route, then cookie, then flag, then player", () => {
  const cookie = formatWorkspaceCookie("u1", "coach");
  assert.deepEqual(
    resolveWorkspace({ path: "/journal", cookie, userId: "u1", isCoach: true }),
    { workspace: "player", byRoute: true },
  );
  assert.deepEqual(
    resolveWorkspace({ path: "/match/x", cookie, userId: "u1", isCoach: false }),
    { workspace: "coach", byRoute: false },
  );
  assert.deepEqual(
    resolveWorkspace({ path: "/match/x", cookie, userId: "u2", isCoach: true }),
    { workspace: "coach", byRoute: false },
  );
  assert.deepEqual(
    resolveWorkspace({ path: "/match/x", cookie: null, userId: "u2", isCoach: false }),
    { workspace: "player", byRoute: false },
  );
});

test("sign-in lands on the remembered side only for the default destination", () => {
  const cookie = formatWorkspaceCookie("u1", "coach");
  assert.equal(
    signInDestination({ requested: "/dashboard", cookie, userId: "u1", isCoach: false }),
    "/coaching",
  );
  assert.equal(
    signInDestination({ requested: "/dashboard", cookie: null, userId: "u1", isCoach: true }),
    "/coaching",
  );
  assert.equal(
    signInDestination({ requested: "/dashboard", cookie: null, userId: "u1", isCoach: false }),
    "/dashboard",
  );
  assert.equal(
    signInDestination({ requested: "/join/abc", cookie, userId: "u1", isCoach: true }),
    "/join/abc",
  );
});
