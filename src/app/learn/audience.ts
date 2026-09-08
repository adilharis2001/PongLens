import type { LearnAudience } from "./catalogTypes.ts";

export function resolveLearnAudience(input: {
  active: LearnAudience;
  requested: string | undefined;
  canSwitch: boolean;
}): LearnAudience {
  if (
    input.canSwitch &&
    (input.requested === "player" || input.requested === "coach")
  ) {
    return input.requested;
  }
  return input.active;
}
