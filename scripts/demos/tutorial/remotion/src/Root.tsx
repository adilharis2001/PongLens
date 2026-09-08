import React from "react";
import { Composition } from "remotion";
import { Chapter, BODY_FRAMES, INTRO_FRAMES, OUTRO_FRAMES } from "./Chapter";
import { Landing, CANVAS as LANDING_CANVAS, TOTAL_FRAMES as LANDING_FRAMES } from "./Landing";
import { CANVAS } from "./theme";

const FPS = 30;

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="Chapter"
      component={Chapter}
      durationInFrames={INTRO_FRAMES + BODY_FRAMES + OUTRO_FRAMES}
      fps={FPS}
      width={CANVAS.w}
      height={CANVAS.h}
    />
    {/* The landing video derives its own canvas from the recorded viewport,
        so the same composition renders the phone cut and the desktop one. */}
    <Composition
      id="Landing"
      component={Landing}
      durationInFrames={LANDING_FRAMES}
      fps={FPS}
      width={LANDING_CANVAS.w}
      height={LANDING_CANVAS.h}
    />
  </>
);
