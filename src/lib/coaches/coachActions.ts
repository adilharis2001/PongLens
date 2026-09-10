/**
 * What a player may do about a coach, and what the app says while doing it.
 *
 * Pure: no React, no Supabase, no platform. The twin is
 * `ios/PongLens/PongLens/Core/CoachActions.swift`, and
 * `ios/Tests/fixtures/coach-actions.json` is generated from THIS file's own
 * output so a state added on one platform fails the other platform's test.
 * That fixture is the only thing here that works without anyone remembering
 * it, which is why these rules live in one module rather than in the four
 * screens that ask them.
 *
 * The rule that put this file here: on 2026-09-10 the owner opened a new
 * account, wrote down a coach called Kory, and lost the only invite button in
 * the product. It was gated on `coaches.length === 0`, written twice in prose,
 * on two platforms. `coachingTabDoor` is that gate, written once.
 */

import {
  type PlayerCoach,
  type PlayerCoachStatus,
  findCoachByName,
} from "@/lib/coaches/playerCoaches";

/**
 * How the coach list was last read.
 *
 * `failed` is not decoration. Both clients used to coerce a dropped request
 * into an empty array and call it loaded, so one bad connection told a player
 * with six coaches that they had none, and re-hid the invite door in exactly
 * the way this work exists to stop.
 */
export type CoachListState = "loading" | "ready" | "failed";

/** What the Coaching tab shows where the coaches live. */
export type CoachingTabDoor = "loading" | "empty" | "row" | "error";

/**
 * The one gate. Exactly one of the first-run card and the permanent row is on
 * screen once the list has been read, in every state.
 *
 * Pending invites count. A player whose only artefact is an invite nobody has
 * named would otherwise get the first-run card and still have no way to reach
 * the link they already sent.
 */
export function coachingTabDoor(
  coachCount: number,
  pendingInviteCount: number,
  state: CoachListState,
): CoachingTabDoor {
  if (state === "loading") return "loading";
  if (state === "failed") return "error";
  return coachCount + pendingInviteCount > 0 ? "row" : "empty";
}

/** The trailing note on that row, or null when nothing is waiting. */
export function invitesWaitingLabel(pendingInviteCount: number): string | null {
  if (pendingInviteCount <= 0) return null;
  return pendingInviteCount === 1
    ? "1 invite waiting"
    : `${pendingInviteCount} invites waiting`;
}

/**
 * Whether this coach can be sent an invite.
 *
 * Offline is the obvious one. Past matters just as much: `nameCoachInvite`
 * filters on `coach_id === null`, so inviting a coach you used to work with
 * used to mint a SECOND row with the same name that only healed if they
 * accepted. Binding the invite onto the row they already have is what makes
 * one coach one row for good.
 */
export function canSendInvite(coach: PlayerCoach): boolean {
  return coach.status === "offline" || coach.status === "past";
}

/** Whether ending access is a thing that can be done to this coach. */
export function canEndAccess(coach: PlayerCoach): boolean {
  return coach.status === "connected";
}

/**
 * What typing a name into the invite composer should tell the player.
 *
 * The `invited` case is the sharpest hazard in this area: typing a name that
 * already has an invite out used to adopt the row and overwrite `invite_id`,
 * leaving the first invite pending, unnamed, and holding a queue of matches
 * nobody could reach. Recognition closes it at the front door, and the shared
 * naming helper refuses it at the back one.
 */
export type DuplicateNotice = {
  /** The row the player is really talking about. */
  coach: PlayerCoach;
  /** One line under the name field. */
  line: string;
  /** What the sheet's primary button should do about it. */
  action: "invite-this-row" | "open-their-page";
};

export function duplicateNotice(
  rows: PlayerCoach[],
  typed: string,
): DuplicateNotice | null {
  const coach = findCoachByName(rows, typed);
  if (!coach) return null;
  const name = coach.display_name;
  switch (coach.status) {
    case "invited":
      return {
        coach,
        line: `${name} already has an invite waiting.`,
        action: "open-their-page",
      };
    case "connected":
      return {
        coach,
        line: `${name} is already connected.`,
        action: "open-their-page",
      };
    default:
      return {
        coach,
        line: `${name} is already on your list. This invite goes to them.`,
        action: "invite-this-row",
      };
  }
}

/** Title and body for a confirmation, so both platforms ask the same thing. */
export type Confirm = { title: string; body: string; confirmLabel: string };

/**
 * Removing a coach.
 *
 * "Your lessons keep their name" replaces the older "Your lessons are kept".
 * What a player is afraid of losing is the name on the card, not the card, and
 * the promise the database actually makes is about the name: `coach_name`
 * survives an archive, `shared_with_coach_at` does not.
 */
export function removeConfirm(coach: PlayerCoach): Confirm {
  const title = `Remove ${coach.display_name} from your list?`;
  const confirmLabel = "Remove";
  switch (coach.status) {
    case "connected":
      return {
        title,
        confirmLabel,
        body: "They stop seeing your matches and the entries you shared with them. Your lessons keep their name.",
      };
    case "invited":
      return {
        title,
        confirmLabel,
        body: "The invite stops working and cannot be restarted. Your lessons keep their name.",
      };
    default:
      return {
        title,
        confirmLabel,
        body: "Your lessons keep their name.",
      };
  }
}

/** Ending access, which is not removal and must not read like it. */
export function endAccessConfirm(coach: PlayerCoach): Confirm {
  return {
    title: "End their access?",
    confirmLabel: "End access",
    body: `${coach.display_name} stops seeing your matches and the entries you shared with them. They stay on your list and your lessons keep their name.`,
  };
}

/**
 * What a restored coach needs told, or null when the standing line says it.
 *
 * Removal revokes an outstanding invite, and putting the coach back does not
 * revive it: `player_coaches_list` needs a PENDING link to read "Invite
 * waiting", so an invited coach comes back reading "Not on PongLens" with no
 * explanation of where their link went. This is that explanation.
 */
export function restoreNotice(status: PlayerCoachStatus): string | null {
  return status === "offline"
    ? "The invite you sent them was cancelled. Send a new one."
    : null;
}

/**
 * The line under a coach's name in a list.
 *
 * One rule, because it was two: web suppressed the access half for a coach
 * with no account and the phone did not, so the phone printed "Not on
 * PongLens · Not connected", saying one fact twice, one tap from a screen that
 * said it once.
 */
export function coachAccessLine(
  coach: PlayerCoach,
  access: string | null,
): string {
  const standing = coachStandingWords(coach.status);
  if (!coach.coach_id || !access) return standing;
  return `${standing} · ${access}`;
}

/** The standing, in the words a player reads. */
export function coachStandingWords(status: PlayerCoachStatus): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "invited":
      return "Invite waiting";
    case "past":
      return "No longer connected";
    default:
      return "Not on PongLens";
  }
}

/**
 * The sentence under an invite link.
 *
 * Two variants because the box now appears in three places and only one of
 * them has a Revoke under it. It used to name a destination, and named a
 * different one on each platform ("from Coaching" on the web, "from Account"
 * on the phone) for a screen that manages none of this.
 */
export function inviteWaitingLine(revokeIsHere: boolean): string {
  return revokeIsHere
    ? "It is waiting until they open it. You can revoke it any time."
    : "It is waiting until they open it. You can revoke it from their page under Your coaches.";
}
