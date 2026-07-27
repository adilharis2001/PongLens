const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CoachInviteScope = {
  scope_match_id: string | null;
};

export type CoachInviteCompletionDependencies = {
  acceptInvite(token: string): Promise<string | null>;
  findAcceptedLink(linkId: string): Promise<CoachInviteScope | null>;
};

export async function resolvePendingCoachInviteDestination(
  pendingInvite: string | null | undefined,
  fallbackDestination: string,
  dependencies: CoachInviteCompletionDependencies,
): Promise<string> {
  if (!pendingInvite || !UUID_RE.test(pendingInvite)) {
    return fallbackDestination;
  }

  const linkId = await dependencies.acceptInvite(pendingInvite);
  if (!linkId) {
    return fallbackDestination;
  }

  const link = await dependencies.findAcceptedLink(linkId);
  if (!link) {
    return fallbackDestination;
  }

  return link.scope_match_id
    ? `/match/${link.scope_match_id}`
    : "/dashboard";
}
