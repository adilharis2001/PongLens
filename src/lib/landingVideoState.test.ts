import assert from "node:assert/strict";
import test from "node:test";

import { landingVideoPresentation } from "./landingVideoState.ts";

test("an idle landing video is a black play surface, not its branded poster", () => {
  assert.deepEqual(landingVideoPresentation(false), {
    showIdleCover: true,
    showIdleScrim: false,
    showPlayControl: true,
    showNativeControls: false,
    videoOpacity: 0,
    playTop: "50%",
  });
});

test("a product-frame poster shows while idle, under a scrim, with the play control", () => {
  assert.deepEqual(landingVideoPresentation(false, { posterIdle: true }), {
    showIdleCover: false,
    showIdleScrim: true,
    showPlayControl: true,
    showNativeControls: false,
    videoOpacity: 1,
    playTop: "50%",
  });
});

test("starting playback reveals the video and removes the idle controls", () => {
  for (const posterIdle of [false, true]) {
    assert.deepEqual(landingVideoPresentation(true, { posterIdle }), {
      showIdleCover: false,
      showIdleScrim: false,
      showPlayControl: false,
      showNativeControls: true,
      videoOpacity: 1,
      playTop: "50%",
    });
  }
});
