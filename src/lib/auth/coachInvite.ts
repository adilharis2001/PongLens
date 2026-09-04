const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CoachInviteScope = {
  scope_match_id: string | null;
  /** Whose matches these are. The roster row is looked up from it. */
  player_id?: string | null;
};

export type CoachInviteCompletionDependencies = {
  acceptInvite(token: string): Promise<string | null>;
  findAcceptedLink(linkId: string): Promise<CoachInviteScope | null>;
  /** The accepting coach's roster row for that player, when there is
   *  one. Written by coach_links_roster_sync inside the accept, so it
   *  exists by the time this runs — but it is optional, and a miss
   *  simply falls back to the coaching home. */
  findRosterRow?(playerId: string): Promise<string | null>;
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

  // A coach invite lands on the COACHING side, never the player's Home.
  // It used to return /dashboard, which is player territory, so the nav
  // remembered "player" (rememberLanding) and a coach who had never set
  // up a playing side was dropped into one — Adil, 2026-09-04. A
  // match-scoped invite still opens its match, because that is the thing
  // the player sent; the workspace cookie is stamped by the caller so the
  // bar around it is the coach's.
  if (link.scope_match_id) return `/match/${link.scope_match_id}`;

  // The student themselves, not the coaching home (Adil, 2026-09-04).
  // That page already holds their matches, anything they have shared from
  // their journal, and room to write — the home is a list you then have to
  // click through. It is also unambiguous coach territory, so standing on
  // it settles the workspace by route rather than by cookie.
  if (link.player_id && dependencies.findRosterRow) {
    const rosterId = await dependencies.findRosterRow(link.player_id);
    if (rosterId) return `/coaching/students/${rosterId}`;
  }
  return "/coaching";
}
