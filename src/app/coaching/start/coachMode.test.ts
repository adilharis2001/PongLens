import assert from "node:assert/strict";
import test from "node:test";

import { activateCoachMode } from "./coachMode.ts";

test("coach mode is remembered only after the account update succeeds", async () => {
  const events: string[] = [];

  await activateCoachMode("coach-1", {
    updateAccount: async () => {
      events.push("account");
    },
    rememberWorkspace: (userId, workspace) => {
      events.push(`${workspace}:${userId}`);
    },
  });

  assert.deepEqual(events, ["account", "coach:coach-1"]);
});

test("a failed account update does not remember coach mode", async () => {
  let remembered = false;

  await assert.rejects(
    activateCoachMode("coach-1", {
      updateAccount: async () => {
        throw new Error("update failed");
      },
      rememberWorkspace: () => {
        remembered = true;
      },
    }),
    /update failed/,
  );

  assert.equal(remembered, false);
});
