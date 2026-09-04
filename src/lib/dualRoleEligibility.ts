export interface DualRoleEvidence {
  coachFlag: boolean;
  coachProfile: boolean;
  acceptedCoachLink: boolean;
  coachRoster: boolean;
  playerSetupDoneAt: string | null | undefined;
}

/** One completed player side plus any established coach side. */
export function dualRoleEligible(evidence: DualRoleEvidence): boolean {
  const coachSide =
    evidence.coachFlag ||
    evidence.coachProfile ||
    evidence.acceptedCoachLink ||
    evidence.coachRoster;
  return coachSide && Boolean(evidence.playerSetupDoneAt);
}
