import assert from "node:assert/strict";
import test from "node:test";

import { landingVideoPresentation } from "./landingVideoState.ts";

test("an idle landing video is a black play surface, not its branded poster", () => {
  assert.deepEqual(landingVideoPresentation(false), {
    showIdleCover: true,
    showPlayControl: true,
    showNativeControls: false,
    videoOpacity: 0,
    playTop: "50%",
  });
});

test("starting playback reveals the video and removes the idle controls", () => {
  assert.deepEqual(landingVideoPresentation(true), {
    showIdleCover: false,
    showPlayControl: false,
    showNativeControls: true,
    videoOpacity: 1,
    playTop: "50%",
  });
});
