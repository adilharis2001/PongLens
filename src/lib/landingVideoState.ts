export type LandingVideoPresentation = {
  showIdleCover: boolean;
  showPlayControl: boolean;
  showNativeControls: boolean;
  videoOpacity: 0 | 1;
  playTop: string;
};

/** Pure presentation state shared by the player and coach walkthroughs. */
export function landingVideoPresentation(playing: boolean): LandingVideoPresentation {
  return {
    showIdleCover: !playing,
    showPlayControl: !playing,
    showNativeControls: playing,
    videoOpacity: playing ? 1 : 0,
    playTop: "50%",
  };
}
