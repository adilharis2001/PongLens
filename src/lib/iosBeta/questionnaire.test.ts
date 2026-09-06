import assert from "node:assert/strict";
import test from "node:test";

import {
  optionsForRole,
  parseBetaAnswers,
} from "./questionnaire.ts";

test("role options hide choices for the other role while Both exposes each group", () => {
  const values = (role: "player" | "coach" | "both") =>
    optionsForRole(role).map((option) => option.value);

  assert.equal(values("player").includes("iphone_recording"), true);
  assert.equal(values("player").includes("coach_profile"), false);
  assert.equal(values("coach").includes("iphone_recording"), false);
  assert.equal(values("coach").includes("coach_profile"), true);
  assert.equal(values("both").includes("iphone_recording"), true);
  assert.equal(values("both").includes("coach_profile"), true);
});

test("valid answers preserve selected interests and optional feedback", () => {
  const cases = [
    {
      formVersion: 2,
      role: "player",
      interests: ["iphone_recording", "placement_maps"],
      feedback: ["email", "audio_call"],
    },
    {
      formVersion: 2,
      role: "coach",
      interests: ["coach_students"],
      feedback: [],
    },
    {
      formVersion: 2,
      role: "both",
      interests: ["training_journal", "coach_shared_journal"],
      feedback: ["not_now"],
    },
  ];

  for (const answers of cases) {
    assert.deepEqual(parseBetaAnswers(answers), answers);
  }
});

test("answers reject interests hidden by the selected role", () => {
  assert.equal(parseBetaAnswers({
    formVersion: 2,
    role: "player",
    interests: ["coach_profile"],
    feedback: [],
  }), null);
  assert.equal(parseBetaAnswers({
    formVersion: 2,
    role: "coach",
    interests: ["iphone_recording"],
    feedback: [],
  }), null);
});

test("answers reject unknown or duplicate choices and require an interest", () => {
  const invalid = [
    { formVersion: 2, role: "player", interests: [], feedback: [] },
    { formVersion: 2, role: "player", interests: ["unknown"], feedback: [] },
    { formVersion: 2, role: "player", interests: ["iphone_recording", "iphone_recording"], feedback: [] },
    { formVersion: 2, role: "player", interests: ["iphone_recording"], feedback: ["unknown"] },
    { formVersion: 2, role: "player", interests: ["iphone_recording"], feedback: ["email", "email"] },
  ];

  for (const answers of invalid) {
    assert.equal(parseBetaAnswers(answers), null);
  }
});

test("Not right now is exclusive from feedback contact channels", () => {
  assert.equal(parseBetaAnswers({
    formVersion: 2,
    role: "player",
    interests: ["iphone_recording"],
    feedback: ["not_now", "email"],
  }), null);
});

test("answers reject malformed shapes, invalid roles and other versions", () => {
  const invalid = [
    null,
    [],
    { formVersion: 1, role: "player", interests: ["iphone_recording"], feedback: [] },
    { formVersion: 2, role: "spectator", interests: ["iphone_recording"], feedback: [] },
    { formVersion: 2, role: "player", interests: "iphone_recording", feedback: [] },
    { formVersion: 2, role: "player", interests: ["iphone_recording"], feedback: "email" },
    { formVersion: 2, role: "player", interests: [12], feedback: [] },
  ];

  for (const answers of invalid) {
    assert.equal(parseBetaAnswers(answers), null);
  }
});
