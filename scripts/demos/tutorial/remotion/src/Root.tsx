import React from "react";
import { Composition } from "remotion";
import { Chapter, INTRO_FRAMES, OUTRO_FRAMES } from "./Chapter";
import cues from "./cues.json";
import { CANVAS } from "./theme";

const FPS = 30;

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Chapter"
    component={Chapter}
    durationInFrames={INTRO_FRAMES + Math.ceil(cues.duration * FPS) + OUTRO_FRAMES}
    fps={FPS}
    width={CANVAS.w}
    height={CANVAS.h}
  />
);
