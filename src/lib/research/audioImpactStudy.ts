export const AUDIO_IMPACT_PHASES = [
  "development_a",
  "development_b",
  "frozen",
  "sealed_labeling",
  "scored",
] as const;

export type AudioImpactStudyPhase = (typeof AUDIO_IMPACT_PHASES)[number];
export type AudioImpactStudyRound = "A" | "B" | "C";

export function visibleAudioImpactRounds(
  phase: AudioImpactStudyPhase,
): AudioImpactStudyRound[] {
  if (phase === "development_a") return ["A"];
  if (phase === "development_b" || phase === "frozen") return ["A", "B"];
  return ["A", "B", "C"];
}

export function isAudioImpactRoundUnlocked(
  phase: AudioImpactStudyPhase,
  round: AudioImpactStudyRound,
): boolean {
  return visibleAudioImpactRounds(phase).includes(round);
}
