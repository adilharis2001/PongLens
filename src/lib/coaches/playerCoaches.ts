/**
 * The player's own list of coaches (164), and the rules for reading it.
 *
 * A journal entry is attributed to a `player_coaches` row rather than to a
 * user id, because the ask was explicitly "invited or accepted" and an
 * invited coach has nobody behind their link yet. The row exists from the
 * moment the player names someone; the account binds to it later, or
 * never.
 *
 * Pure and testable: no React, no Supabase. The three surfaces that need
 * these rules — the journal composer, the entry editor and the Coaches
 * section — must agree, and they drifted the first time they were written
 * twice.
 */

/** How far along a coach is, derived server-side from coach_links.
 *  - connected: an accepted link, so they can read what is shared now
 *  - invited:   an invite sent, waiting to be accepted
 *  - past:      you were connected and are not any more, on either side
 *  - offline:   named by the player, never on PongLens
 *
 *  past and offline are deliberately separate. Offline may be invited
 *  later; past is a relationship that ended, and the row only survives
 *  because the lessons did. */
export type PlayerCoachStatus = "connected" | "invited" | "past" | "offline";

/** One row of player_coaches_list(). */
export interface PlayerCoach {
  id: string;
  coach_id: string | null;
  display_name: string;
  coach_email: string | null;
  /** The pending invite this row is waiting on, when the player named a
   *  coach while creating one. Lets the Coaches section put their name on
   *  a waiting invite instead of "Invite link". */
  invite_id: string | null;
  status: PlayerCoachStatus;
  entry_count: number;
  shared_count: number;
}

/**
 * Whether sharing an entry with this coach can ever reach them.
 *
 * "invited" counts. student_shared_lessons() requires an accepted link as
 * well as a shared entry, so a share set while an invite is outstanding
 * simply waits and starts working the day they accept. Asking the player
 * to come back and re-share every entry at that moment would be the worse
 * product, and the grant is never live before the link is.
 */
export function canReceiveEntries(status: PlayerCoachStatus): boolean {
  return status === "connected" || status === "invited";
}

/**
 * The line under the share control. Never says "he" or "she": the app does
 * not know, and a wrong guess about a real person is worse than the
 * neutral word.
 */
export function shareHint(status: PlayerCoachStatus): string | null {
  if (status === "connected") {
    return "They can read it in their coaching workspace.";
  }
  if (status === "invited") {
    return "They can read it once they accept your invite.";
  }
  return null;
}

/** What the row says under the name in a list. */
export function statusLabel(coach: PlayerCoach): string {
  if (coach.status === "invited") return "Invite sent";
  if (coach.status === "past") return "No longer connected";
  if (coach.status === "offline") return "Not on PongLens";
  return coach.shared_count > 0
    ? `${coach.shared_count} of ${coach.entry_count} entries shared`
    : entryCountLabel(coach.entry_count);
}

export function entryCountLabel(n: number): string {
  if (n === 0) return "No entries yet";
  return `${n} ${n === 1 ? "entry" : "entries"}`;
}

/** Connected first, then invited, then offline; alphabetical inside each.
 *  The coach you are working with today is the one you are about to pick. */
export function sortCoaches(rows: PlayerCoach[]): PlayerCoach[] {
  const rank: Record<PlayerCoachStatus, number> = {
    connected: 0,
    invited: 1,
    offline: 2,
    // Last: they taught you, and that is all they are now.
    past: 3,
  };
  return [...rows].sort(
    (a, b) =>
      rank[a.status] - rank[b.status] ||
      a.display_name.localeCompare(b.display_name),
  );
}

export function normalizeCoachName(value: string): string {
  return value.trim().replace(/\s+/gu, " ").slice(0, 80);
}

/**
 * An existing row for this name, case- and space-insensitively.
 *
 * Typing "jonathan" when Jonathan is already in the list must reuse the
 * row rather than start a second one, because a second row is the whole
 * defect this feature exists to fix, just with better spelling.
 */
export function findCoachByName(
  rows: PlayerCoach[],
  name: string,
): PlayerCoach | undefined {
  const key = normalizeCoachName(name).toLowerCase();
  if (!key) return undefined;
  return rows.find((c) => c.display_name.trim().toLowerCase() === key);
}

/**
 * Which rows a merge may fold together, for "Same as an existing coach".
 *
 * Two bound accounts are two different people, so they are never offered:
 * folding them would hand one coach the other's entries. One of the pair
 * must be a row the player typed that nobody has claimed.
 */
export function mergeCandidates(
  rows: PlayerCoach[],
  target: PlayerCoach,
): PlayerCoach[] {
  return rows.filter(
    (c) =>
      c.id !== target.id &&
      (target.coach_id === null || c.coach_id === null),
  );
}

/** What a bulk move is about to do, in a sentence, before it does it. */
export function moveSummary(
  count: number,
  coachName: string,
  share: boolean,
): string {
  const entries = `${count} ${count === 1 ? "entry" : "entries"}`;
  return share
    ? `Move ${entries} to ${coachName} and share them.`
    : `Move ${entries} to ${coachName}.`;
}
