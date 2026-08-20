/**
 * The conversation on a bug, and the trail of how its status moved.
 *
 * Both live in one table (migration 127) and render as one list, because
 * the two only mean something together: "marked fixed", then "still
 * happens, here is a recording", then "reopened" is a story, and splitting
 * it into a comment list beside a history list makes the reader stitch it
 * back together by timestamp.
 */

import type { BugStatus } from "./bugs.ts";
import { STATUS_META } from "./bugs.ts";

export interface BugMessage {
  id: string;
  bug_id: string;
  /** Null for an entry nobody typed: a status change with no session behind it. */
  author_id: string | null;
  kind: "comment" | "status";
  body: string;
  from_status: BugStatus | null;
  to_status: BugStatus | null;
  created_at: string;
}

/** How an author signs their messages in the thread. */
export type Who = "you" | "owner" | "tester" | "system";

/**
 * Keyed off the bug's own reporter rather than the admin's user id, which
 * the browser would otherwise have to be told. A bug has exactly two
 * sides: whoever filed it, and the owner.
 */
export function whoWrote(
  message: BugMessage,
  viewerId: string,
  reporterId: string,
): Who {
  if (message.author_id === null) return "system";
  if (message.author_id === viewerId) return "you";
  return message.author_id === reporterId ? "tester" : "owner";
}

export const WHO_LABEL: Record<Who, string> = {
  you: "You",
  owner: "Adil",
  tester: "QA",
  // A status change with no session behind it: a CSV import, a scheduled
  // job, or the owner working through an agent rather than the browser.
  system: "PongLens",
};

/**
 * A status entry as a sentence. Uses the same labels the status control
 * shows, so the trail and the dropdown never disagree about what a state
 * is called ("Ready to verify", not the raw "fixed").
 *
 * A null `from_status` means the entry has no predecessor recorded, which
 * happens two ways and they must not read alike. A bug sitting at `open`
 * genuinely was filed that way. A bug that reached any other state before
 * this table existed was backfilled from its current status alone, and
 * the step that got it there is simply not known: saying "filed as Ready
 * to verify" about a bug filed as Open and fixed a week later is a
 * confident lie about its own history.
 */
export function statusLine(message: BugMessage): string {
  const to = message.to_status ? STATUS_META[message.to_status].label : "";
  if (!message.from_status) {
    return message.to_status === "open" ? "Filed" : `Set to ${to}`;
  }
  const from = STATUS_META[message.from_status].label;
  return `${from} to ${to}`;
}

/**
 * Oldest first, and never on created_at alone. Several entries can share a
 * transaction (a status change beside a comment, or a batch posted by an
 * agent); the id is the tiebreaker that keeps the order stable between
 * renders rather than letting two equal timestamps swap places.
 */
export function inOrder(messages: BugMessage[]): BugMessage[] {
  return [...messages].sort((a, b) => {
    const byTime = a.created_at.localeCompare(b.created_at);
    return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
  });
}
