import assert from "node:assert/strict";
import test from "node:test";
import { workingOnMicPresentation } from "./workingOnMic.ts";

test("idle microphone invites dictation", () => {
  assert.deepEqual(workingOnMicPresentation("idle"), {
    label: "Dictate",
    ariaLabel: "Speak the cue",
    disabled: false,
  });
});

test("recording microphone becomes a stop control", () => {
  assert.deepEqual(workingOnMicPresentation("recording"), {
    label: "Stop",
    ariaLabel: "Stop recording",
    disabled: false,
  });
});

test("transcribing microphone reports work and disables input", () => {
  assert.deepEqual(workingOnMicPresentation("writing"), {
    label: "Writing…",
    ariaLabel: "Transcribing cue",
    disabled: true,
  });
});
