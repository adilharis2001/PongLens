import type {
  OutreachRow,
  PersonRow,
  TouchRow,
  QueueKey,
  OutreachStatus,
  PlayerKind,
} from "./outreachView.ts";
import {
  isStuck,
  queueFor,
  personQueueFor,
  CHANNEL_COPY,
} from "./outreachView.ts";
export type BetaOutreachRow = {
  id: string;
  email: string;
  created_at: string;
  role: "player" | "coach" | "both" | null;
  interests: string[];
  feedback_choice: "unanswered" | "declined" | "opted_in";
  feedback_channels: string[];
  scheduled_at: string;
  delivery_state: string;
  delivery_error_code: string | null;
  early_send_requested_at: string | null;
  status: OutreachStatus;
  follow_up_on: string | null;
};
export type UnifiedOutreachRow = {
  key: string;
  name: string;
  email: string | null;
  account?: OutreachRow;
  person?: PersonRow;
  beta?: BetaOutreachRow;
  people: PersonRow[];
  status: OutreachStatus;
  follow_up_on: string | null;
  touches: TouchRow[];
  ambiguous: boolean;
  followUps: { source: string; on: string }[];
};
const normalized = (email: string | null) =>
  email?.trim().toLowerCase() || null;

// Resend's official delivery-test mailboxes are never real applicants. This
// mirrors _outreach_members; it does not change account roles or permissions.
export function outreachKind(row: UnifiedOutreachRow): PlayerKind {
  if (normalized(row.beta?.email ?? row.email)?.endsWith("@resend.dev"))
    return "test";
  return row.account?.kind ?? "real";
}

export function pendingOutreachInvitations(
  rows: UnifiedOutreachRow[],
  kind: PlayerKind | "all",
): UnifiedOutreachRow[] {
  // Invitation delivery is an operational queue, not a feedback-contact queue.
  // In the default Real view include Team requests even if the account is hidden.
  // Keep provider tests out unless Test or All is explicitly selected.
  return rows.filter(row => row.beta && pendingInvitation(row.beta) && (
    kind === "all" || (kind === "real" ? outreachKind(row) !== "test" : outreachKind(row) === kind)
  )).sort((a,b) => a.beta!.scheduled_at.localeCompare(b.beta!.scheduled_at));
}

/** Mirrors the private SQL resolver. Matching is for outreach only, never auth. */
export function unifyOutreach(
  accounts: OutreachRow[],
  people: PersonRow[],
  betas: BetaOutreachRow[],
  touches: TouchRow[],
): UnifiedOutreachRow[] {
  const usedPeople = new Set<string>();
  const usedBetas = new Set<string>();
  const result: UnifiedOutreachRow[] = [];
  function add(
    account?: OutreachRow,
    person?: PersonRow,
    beta?: BetaOutreachRow,
  ) {
    const email = normalized(
      account?.email ?? person?.email ?? beta?.email ?? null,
    );
    const matches = email
      ? people.filter((p) => normalized(p.email) === email)
      : [];
    const linked = person ? [person] : matches.length === 1 ? matches : [];
    for (const p of linked) usedPeople.add(p.id);
    if (beta) usedBetas.add(beta.id);
    const states = [account, ...linked, beta].filter(
      (v): v is OutreachRow | PersonRow | BetaOutreachRow => !!v,
    );
    const status = states.find((v) => v.status !== "new")?.status ?? "new";
    const followUps = states.flatMap((v) =>
      v.follow_up_on
        ? [
            {
              source:
                "user_id" in v
                  ? "Account"
                  : "created_by" in v
                    ? "Manual contact"
                    : "iPhone beta",
              on: v.follow_up_on,
            },
          ]
        : [],
    );
    const history = touches
      .filter(
        (t) =>
          (account && t.user_id === account.user_id) ||
          linked.some((p) => p.id === t.person_id) ||
          (beta && t.beta_request_id === beta.id),
      )
      .sort((a, b) => b.at.localeCompare(a.at));
    result.push({
      key: account
        ? `user:${account.user_id}`
        : person
          ? `person:${person.id}`
          : `beta:${beta!.id}`,
      name: account?.name || account?.email || person?.name || beta!.email,
      email: account?.email ?? person?.email ?? beta?.email ?? null,
      account,
      person,
      beta,
      people: linked,
      status,
      follow_up_on: followUps.map((f) => f.on).sort()[0] ?? null,
      touches: history,
      ambiguous: matches.length > 1,
      followUps,
    });
  }
  for (const account of accounts)
    add(
      account,
      undefined,
      betas.find(
        (b) =>
          normalized(b.email) === normalized(account.email) &&
          !usedBetas.has(b.id),
      ),
    );
  for (const person of people) {
    if (usedPeople.has(person.id)) continue;
    const unambiguous =
      people.filter(
        (p) =>
          normalized(p.email) &&
          normalized(p.email) === normalized(person.email),
      ).length === 1;
    add(
      undefined,
      person,
      unambiguous
        ? betas.find(
            (b) =>
              normalized(b.email) === normalized(person.email) &&
              !usedBetas.has(b.id),
          )
        : undefined,
    );
  }
  for (const beta of betas)
    if (!usedBetas.has(beta.id)) add(undefined, undefined, beta);
  return result;
}
export function unifiedQueueFor(
  row: UnifiedOutreachRow,
  now: Date,
): QueueKey | null {
  if (row.account?.hidden || row.status === "closed") return null;
  if (row.beta && row.beta.feedback_choice !== "opted_in")
    return row.account && isStuck(row.account) ? "stuck" : null;
  if (row.account)
    return queueFor(
      { ...row.account, status: row.status, follow_up_on: row.follow_up_on },
      now,
    );
  return personQueueFor(
    { status: row.status, follow_up_on: row.follow_up_on } as PersonRow,
    now,
  );
}
export function feedbackLabel(beta: BetaOutreachRow): string {
  if (beta.feedback_choice === "declined")
    return "No feedback contact requested";
  if (beta.feedback_choice !== "opted_in") return "Not provided";
  return beta.feedback_channels
    .map((c) => CHANNEL_COPY[c as keyof typeof CHANNEL_COPY] ?? c)
    .join(", ");
}
export const pendingInvitation = (beta: BetaOutreachRow) =>
  ![
    "sent",
    "delivered",
    "suppressed",
    "bounced",
    "complained",
    "canceled",
  ].includes(beta.delivery_state);
export function effectiveInvitationState(
  beta: BetaOutreachRow,
  now: Date,
): string {
  const state = beta.delivery_state;
  if (
    pendingInvitation(beta) &&
    (new Date(beta.scheduled_at).getTime() < now.getTime() ||
      (["failed", "unknown", "needs_attention"].includes(state) &&
        new Date(beta.scheduled_at).getTime() - now.getTime() <= 3600000))
  )
    return "needs_attention";
  return state;
}

export function invitationLabel(beta: BetaOutreachRow, now: Date): string {
  const labels: Record<string, string> = {
    pending: "Pending",
    scheduled: "Scheduled",
    sending: "Sending…",
    sent: "Sent",
    delivered: "Delivered",
    failed: "Failed",
    unknown: "Unknown",
    needs_attention: "Needs attention",
    suppressed: "Suppressed",
    bounced: "Bounced",
    complained: "Complaint",
    canceled: "Canceled",
  };
  return labels[effectiveInvitationState(beta, now)] ?? "Unknown";
}
