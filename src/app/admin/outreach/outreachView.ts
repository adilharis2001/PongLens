/**
 * Pure logic for /admin/outreach: which queue a user belongs in, and the
 * labels the page prints. The roster comes from admin_outreach_roster()
 * (162), which since 177 returns every account with the kind attached
 * rather than excluding fixture domains by hand — the page filters on
 * the kind instead, so a demo account is one tab away rather than
 * invisible. Hiding an individual is still per-row state.
 */

import type { PlayerKind } from "../players/playersView";

export type { PlayerKind };

export type OutreachStatus = "new" | "contacted" | "in_touch" | "closed";

export interface OutreachRow {
  user_id: string;
  email: string;
  name: string | null;
  signed_up: string;
  last_seen: string | null;
  matches: number;
  matches_scored: number;
  matches_failed: number;
  last_upload_at: string | null;
  points: number;
  notes: number;
  journal_entries: number;
  share_links: number;
  is_coach: boolean;
  /** What this account is (176), shared with the Players page: marking
   *  somebody in one place moves them in the other. */
  kind: PlayerKind;
  status: OutreachStatus;
  follow_up_on: string | null;
  hidden: boolean;
  last_outreach_at: string | null;
  last_feedback_at: string | null;
  touches: number;
}

export type TouchKind = "outreach" | "feedback" | "note";
export type TouchChannel = "email" | "dm" | "in_person";

/** A touch is about exactly one of a platform user or a hand-added person. */
export interface TouchRow {
  id: string;
  user_id: string | null;
  person_id: string | null;
  kind: TouchKind;
  channel: TouchChannel | null;
  body: string;
  author: string;
  at: string;
}

/** Someone Anton added by hand: no account, so no product stats. */
export interface PersonRow {
  id: string;
  name: string;
  email: string | null;
  status: OutreachStatus;
  follow_up_on: string | null;
  created_by: string;
  created_at: string;
  last_outreach_at: string | null;
  last_feedback_at: string | null;
  touches: number;
}

export const STATUS_COPY: Record<OutreachStatus, string> = {
  new: "New",
  contacted: "Reached out",
  in_touch: "In touch",
  closed: "Closed",
};

export const STATUSES: readonly OutreachStatus[] = [
  "new",
  "contacted",
  "in_touch",
  "closed",
];

export const KIND_COPY: Record<TouchKind, string> = {
  outreach: "Reached out",
  feedback: "They said",
  note: "Note",
};

export const CHANNEL_COPY: Record<TouchChannel, string> = {
  email: "Email",
  dm: "DM",
  in_person: "In person",
};

export type QueueKey = "due" | "stuck" | "to_contact" | "quiet";

export const QUEUE_ORDER: readonly QueueKey[] = [
  "due",
  "stuck",
  "to_contact",
  "quiet",
];

export const QUEUE_COPY: Record<QueueKey, string> = {
  due: "Follow-up due",
  stuck: "Tried and got stuck",
  to_contact: "To contact",
  quiet: "Went quiet",
};

/** Days after which a contacted user with no activity counts as quiet. */
export const QUIET_AFTER_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The user's most recent sign of life we can see. */
export function lastActivityAt(row: OutreachRow): number {
  const times = [row.signed_up, row.last_seen, row.last_upload_at]
    .filter((iso): iso is string => !!iso)
    .map((iso) => new Date(iso).getTime())
    .filter((t) => !Number.isNaN(t));
  return times.length ? Math.max(...times) : 0;
}

/**
 * A user who uploaded and has nothing to show for it: a failed upload, or
 * matches on the shelf with no points scored on any of them. The most
 * valuable call to make, because this person tried.
 */
export function isStuck(row: OutreachRow): boolean {
  return row.matches_failed > 0 || (row.matches > 0 && row.points === 0);
}

/**
 * Which queue the user belongs in, or null for the plain roster. One
 * queue per user, most actionable first: an overdue follow-up beats
 * everything, a stuck user beats a merely new one, and quiet only applies
 * once contact exists (a never-contacted user stays in "to contact"
 * however old the signup).
 */
export function queueFor(row: OutreachRow, now: Date): QueueKey | null {
  if (row.hidden || row.status === "closed") return null;
  if (row.follow_up_on) {
    // Dates compare as strings in ISO form; the reminder is a plain date.
    const today = now.toISOString().slice(0, 10);
    if (row.follow_up_on <= today) return "due";
  }
  if (isStuck(row)) return "stuck";
  if (row.status === "new") return "to_contact";
  const last = lastActivityAt(row);
  if (last > 0 && now.getTime() - last > QUIET_AFTER_DAYS * DAY_MS) {
    return "quiet";
  }
  return null;
}

/**
 * A hand-added person has no activity to be stuck or quiet about, so only
 * two queues can claim one: a due follow-up, or never contacted.
 */
export function personQueueFor(p: PersonRow, now: Date): QueueKey | null {
  if (p.status === "closed") return null;
  if (p.follow_up_on && p.follow_up_on <= now.toISOString().slice(0, 10)) {
    return "due";
  }
  if (p.status === "new") return "to_contact";
  return null;
}

export function buildPersonQueues(
  people: PersonRow[],
  now: Date
): Record<QueueKey, PersonRow[]> {
  const queues: Record<QueueKey, PersonRow[]> = {
    due: [],
    stuck: [],
    to_contact: [],
    quiet: [],
  };
  for (const p of people) {
    const key = personQueueFor(p, now);
    if (key) queues[key].push(p);
  }
  queues.due.sort((a, b) =>
    (a.follow_up_on ?? "").localeCompare(b.follow_up_on ?? "")
  );
  queues.to_contact.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return queues;
}

export function buildQueues(
  rows: OutreachRow[],
  now: Date
): Record<QueueKey, OutreachRow[]> {
  const queues: Record<QueueKey, OutreachRow[]> = {
    due: [],
    stuck: [],
    to_contact: [],
    quiet: [],
  };
  for (const row of rows) {
    const key = queueFor(row, now);
    if (key) queues[key].push(row);
  }
  // Newest signup first where nothing better orders the queue; overdue
  // follow-ups oldest first, since the oldest is the most overdue.
  queues.due.sort((a, b) => (a.follow_up_on ?? "").localeCompare(b.follow_up_on ?? ""));
  for (const key of ["stuck", "to_contact", "quiet"] as const) {
    queues[key].sort((a, b) => b.signed_up.localeCompare(a.signed_up));
  }
  return queues;
}

/** The one-line reason a user is sitting in a queue. */
export function queueReason(row: OutreachRow, key: QueueKey): string {
  switch (key) {
    case "due":
      return `Follow up planned for ${dateLabel(row.follow_up_on)}`;
    case "stuck":
      if (row.matches_failed > 0) {
        return `${countLabel(row.matches_failed, "upload")} failed`;
      }
      return `${countLabel(row.matches, "match", "matches")} uploaded, no points scored`;
    // The right-hand column already says "Never contacted"; the reason
    // only needs the date.
    case "to_contact":
      return `Signed up ${dateLabel(row.signed_up)}`;
    case "quiet": {
      return "No activity in over two weeks";
    }
  }
}

export function countLabel(
  n: number,
  singular: string,
  plural = `${singular}s`
): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** "Sep 1", or "Sep 1, 2025" outside the current year. */
export function dateLabel(iso: string | null): string {
  if (!iso) return "?";
  const date = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(date.getTime())) return "?";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: iso.length === 10 ? "UTC" : undefined,
    year:
      date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

/** The activity summary under a roster row. */
export function activityLine(row: OutreachRow): string {
  const parts = [countLabel(row.matches, "match", "matches")];
  if (row.points > 0) parts.push(countLabel(row.points, "point"));
  if (row.notes > 0) parts.push(countLabel(row.notes, "note"));
  if (row.journal_entries > 0) {
    parts.push(countLabel(row.journal_entries, "journal entry", "journal entries"));
  }
  if (row.share_links > 0) parts.push(countLabel(row.share_links, "share"));
  if (row.is_coach) parts.push("coach side");
  return parts.join(" · ");
}

/** The contact summary: last touch either way, or never contacted. */
export function touchLine(row: {
  last_outreach_at: string | null;
  last_feedback_at: string | null;
}): string {
  if (row.last_feedback_at && row.last_outreach_at) {
    const feedback = new Date(row.last_feedback_at).getTime();
    const outreach = new Date(row.last_outreach_at).getTime();
    return feedback >= outreach
      ? `They replied ${dateLabel(row.last_feedback_at)}`
      : `Reached out ${dateLabel(row.last_outreach_at)}`;
  }
  if (row.last_feedback_at) {
    return `They replied ${dateLabel(row.last_feedback_at)}`;
  }
  if (row.last_outreach_at) {
    return `Reached out ${dateLabel(row.last_outreach_at)}`;
  }
  return "Never contacted";
}
