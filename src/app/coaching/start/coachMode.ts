export type CoachModeDependencies = {
  updateAccount: () => Promise<void>;
  rememberWorkspace: (userId: string, workspace: "coach") => void;
};

export async function activateCoachMode(
  userId: string,
  dependencies: CoachModeDependencies,
) {
  await dependencies.updateAccount();
  dependencies.rememberWorkspace(userId, "coach");
}
