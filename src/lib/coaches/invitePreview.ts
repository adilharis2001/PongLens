/**
 * What an invite link says when it is pasted into a message (169).
 *
 * One place, because the page's meta tags and the OG image both render it
 * and a preview whose picture and title disagree looks broken. Pure, so
 * the wording is testable without a browser.
 *
 * The voice is the invite page's own, deliberately: somebody who taps
 * through should find the sentence they were shown, not a livelier
 * version of it that the page then fails to live up to.
 */

export type CoachInviteScope = "match" | "all" | "selected";

export interface InvitePreviewCopy {
  /** The person being invited, when the inviter named them. Drawn above
   *  the headline; absent is the ordinary case, not a failure. */
  eyebrow: string | null;
  headline: string;
  /** One line on what they get. Doubles as the meta description. */
  detail: string;
  /** The full <title>, which reads on its own in a browser tab. */
  title: string;
}

function withEyebrow(eyebrow: string | null, headline: string): string {
  return eyebrow ? `${eyebrow}, ${lowerFirst(headline)}` : headline;
}

/** "Adil Haris added…" after a name becomes "…, Adil Haris added…" — the
 *  sentence carries on rather than restarting, but a NAME keeps its
 *  capital, so only lowercase a word that is not one. */
function lowerFirst(text: string): string {
  const [first] = text.split(" ");
  if (!first) return text;
  // A proper noun looks like Xxx; a common word like "you" does not.
  const isName = /^[A-Z][a-z]/.test(first) && first.length > 1;
  return isName ? text : text.charAt(0).toLowerCase() + text.slice(1);
}

/** A player inviting a coach. */
export function coachInvitePreview(input: {
  inviterName: string;
  invitedName: string | null;
  scope: CoachInviteScope;
}): InvitePreviewCopy {
  const who = input.inviterName.trim() || "A player";
  const eyebrow = input.invitedName?.trim() || null;
  // The invite page's own three sentences, word for word.
  const headline =
    input.scope === "all"
      ? `${who} shared their matches with you`
      : input.scope === "match"
        ? `${who} shared a match with you`
        : `${who} added you as their coach`;
  const detail =
    input.scope === "match"
      ? "Watch it point by point and leave notes."
      : "Watch their matches point by point and leave notes.";
  return {
    eyebrow,
    headline,
    detail,
    title: withEyebrow(eyebrow, headline),
  };
}

/** A coach inviting a student. */
export function studentInvitePreview(input: {
  inviterName: string;
  invitedName: string | null;
}): InvitePreviewCopy {
  const who = input.inviterName.trim() || "A coach";
  const eyebrow = input.invitedName?.trim() || null;
  const headline = `${who} invited you as their student`;
  const detail = "Your matches and their lesson notes, in one place.";
  return {
    eyebrow,
    headline,
    detail,
    title: withEyebrow(eyebrow, headline),
  };
}

/** The card everything falls back to: a link that is spent, revoked, or
 *  never existed says nothing about anybody. */
export const GENERIC_INVITE: InvitePreviewCopy = {
  eyebrow: null,
  headline: "You're invited to PongLens",
  detail: "Watch a player's matches point by point and leave notes.",
  title: "Coach invite",
};
