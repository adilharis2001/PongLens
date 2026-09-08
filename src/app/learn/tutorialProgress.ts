import type { LearnAudience } from "./catalogTypes";

type TutorialMetadata = Record<string, unknown> | null | undefined;

export function tutorialProgressKey(audience: LearnAudience) {
  return `${audience}_tutorial_started` as const;
}

export function tutorialWasStarted(
  metadata: TutorialMetadata,
  audience: LearnAudience,
) {
  if (audience === "player") {
    return (
      metadata?.player_tutorial_started === true || metadata?.tutorial_started === true
    );
  }

  return metadata?.coach_tutorial_started === true;
}
