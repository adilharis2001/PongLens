export type LandingVideoPresentation = {
  /** A solid ink cover over the picture while idle. */
  showIdleCover: boolean;
  /** A translucent scrim over a visible poster while idle, so the play
   *  control reads against a bright frame. */
  showIdleScrim: boolean;
  showPlayControl: boolean;
  showNativeControls: boolean;
  videoOpacity: 0 | 1;
  playTop: string;
};

/**
 * Pure presentation state shared by the player and coach walkthroughs.
 *
 * Idle comes in two kinds. The coach walkthrough's poster is a title card,
 * and a title card behind a play button is a box with a logo in it, so
 * that one hides the picture until it plays. The player walkthrough's
 * poster is a frame of the product, which is worth showing before anyone
 * presses anything, so that one shows it under a light scrim.
 */
export function landingVideoPresentation(
  playing: boolean,
  { posterIdle = false }: { posterIdle?: boolean } = {},
): LandingVideoPresentation {
  const idle = !playing;
  return {
    showIdleCover: idle && !posterIdle,
    showIdleScrim: idle && posterIdle,
    showPlayControl: idle,
    showNativeControls: playing,
    videoOpacity: playing || posterIdle ? 1 : 0,
    playTop: "50%",
  };
}
