import type { EmailMessage } from "../email/message.ts";
import {
  matchIssueResolutionEmail,
  matchIssueSubmissionEmail,
  type MatchIssueResolutionEmailKind,
} from "../email/matchIssueEmails.ts";
import { transactionalEmailPayload, type EmailSendReceipt } from "../email/send.ts";
import type { MatchIssueKind, MatchIssueStatus } from "./types.ts";

export type MatchIssueEmailDelivery = {
  id: string;
  issueId: string;
  eventId: string;
  template: "submission" | "resolution";
  recipientEmail: string;
};

export type MatchIssueEmailContext = {
  delivery: MatchIssueEmailDelivery;
  issue: {
    matchId: string;
    reporterId: string;
    ownerId: string;
    reporterRole: "owner" | "coach";
    kind: MatchIssueKind;
    message: string;
    refundableMinutes: number;
    status: MatchIssueStatus;
  };
  event: {
    kind?: string;
    playerNote: string;
    metadata: Record<string, unknown>;
  };
  reporter: { name: string; email: string };
  owner: { name: string; email: string };
};

type SendInput = {
  to: string;
  message: EmailMessage;
  idempotencyKey: string;
  operation: string;
  tags?: { name: string; value: string }[];
  preparedPayload?: string;
};

export type MatchIssueEmailDependencies = {
  list(issueId?: string): Promise<MatchIssueEmailDelivery[]>;
  load(delivery: MatchIssueEmailDelivery): Promise<MatchIssueEmailContext | null>;
  claim(deliveryId: string, payload: string): Promise<string | null>;
  send(input: SendInput): Promise<EmailSendReceipt>;
  finish(
    deliveryId: string,
    state: "accepted" | "suppressed" | "failed",
    error?: string,
    providerEmailId?: string,
  ): Promise<void>;
  reportError(message: string): void;
};

function resolutionKind(context: MatchIssueEmailContext): MatchIssueResolutionEmailKind | null {
  switch (context.event.kind) {
    case "refunded": return "refund";
    case "published": return "reprocessed";
    case "restored": return "restored";
    case "kept_current": return "kept_current";
    case "execution_failed": return "execution_failed";
    case "declined": return "declined";
    default: return null;
  }
}

function messageFor(context: MatchIssueEmailContext): EmailMessage | null {
  if (context.delivery.template === "submission") {
    if (context.issue.kind === "positive") return null;
    return matchIssueSubmissionEmail({
      issueId: context.delivery.issueId,
      matchId: context.issue.matchId,
      reporterName: context.reporter.name,
      reporterEmail: context.reporter.email,
      reporterRole: context.issue.reporterRole,
      kind: context.issue.kind,
      message: context.issue.message,
      adminUrl: `https://www.ponglens.com/admin/issues/${context.delivery.issueId}`,
    });
  }

  const eventMinutes = context.event.metadata.minutes;
  const kind = resolutionKind(context);
  if (!kind) return null;
  if (kind === "refund" && (typeof eventMinutes !== "number" || eventMinutes <= 0)) {
    throw new Error("Refund event has no exact returned amount");
  }
  return matchIssueResolutionEmail({
    kind,
    minutes: typeof eventMinutes === "number" ? eventMinutes : 0,
    playerNote: context.event.playerNote,
    matchUrl: `https://www.ponglens.com/match/${context.issue.matchId}`,
  });
}

export async function deliverPendingMatchIssueEmails(
  dependencies: MatchIssueEmailDependencies,
  issueId?: string,
): Promise<void> {
  const deliveries = await dependencies.list(issueId);
  for (const delivery of deliveries) {
    const context = await dependencies.load(delivery);
    if (!context) {
      await dependencies.finish(delivery.id, "failed", "Missing email context");
      continue;
    }
    let message: EmailMessage | null;
    try {
      message = messageFor(context);
    } catch (error) {
      await dependencies.finish(delivery.id, "failed", error instanceof Error ? error.message : "Invalid email event");
      continue;
    }
    if (!message) {
      await dependencies.finish(delivery.id, "suppressed");
      continue;
    }
    const input: SendInput = {
      to: delivery.recipientEmail,
      message,
      idempotencyKey: `match-issue-${delivery.id}`,
      operation: `match_issue_${delivery.template}`,
      tags: [{ name: "match_issue_delivery_id", value: delivery.id }],
    };
    const preparedPayload = await dependencies.claim(delivery.id, transactionalEmailPayload(input));
    if (preparedPayload === null) continue;
    let result: EmailSendReceipt;
    try {
      result = await dependencies.send({ ...input, preparedPayload });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown error";
      dependencies.reportError(`Match issue email ${delivery.id} failed: ${detail}`);
      await dependencies.finish(delivery.id, "failed", detail.slice(0, 1000));
      continue;
    }
    try {
      await dependencies.finish(
        delivery.id,
        result.state === "sent" ? "accepted" : result.state,
        result.state === "failed" ? "Email provider acceptance was not confirmed" : undefined,
        result.providerEmailId,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown error";
      // Do not turn a confirmed accepted send into a retryable failure. The
      // signed tagged webhook can recover the receipt even before this write.
      dependencies.reportError(`Match issue email ${delivery.id} bookkeeping failed: ${detail}`);
    }
  }
}

function displayName(user: {
  email?: string | null;
  user_metadata?: Record<string, unknown>;
}): string {
  const metadata = user.user_metadata ?? {};
  const name = metadata.full_name ?? metadata.name;
  return typeof name === "string" && name.trim()
    ? name.trim()
    : user.email ?? "PongLens user";
}

export async function sendPendingMatchIssueEmails(issueId?: string): Promise<void> {
  const [{ createAdminClient }, { sendTransactionalEmailWithReceipt }] = await Promise.all([
    import("../supabase/admin.ts"),
    import("../email/send.ts"),
  ]);
  const admin = createAdminClient();

  await deliverPendingMatchIssueEmails(
    {
      async list(filterIssueId) {
        let query = admin
          .from("match_issue_email_deliveries")
          .select("id,issue_id,event_id,template,recipient_email")
          .in("state", ["prepared", "failed", "sending"])
          .is("provider_email_id", null)
          .or(`lease_until.is.null,lease_until.lt.${new Date().toISOString()}`)
          .order("created_at")
          .limit(20);
        if (filterIssueId) query = query.eq("issue_id", filterIssueId);
        const { data, error } = await query;
        if (error) throw new Error("Could not read match issue email queue");
        return (data ?? []).map((row) => ({
          id: row.id,
          issueId: row.issue_id,
          eventId: row.event_id,
          template: row.template as "submission" | "resolution",
          recipientEmail: row.recipient_email,
        }));
      },
      async load(delivery) {
        const [{ data: issue }, { data: event }] = await Promise.all([
          admin
            .from("match_processing_feedback")
            .select("match_id,reporter_id,owner_id,reporter_role,kind,message,refundable_minutes,status")
            .eq("id", delivery.issueId)
            .maybeSingle(),
          admin
            .from("match_processing_feedback_events")
            .select("kind,player_note,metadata")
            .eq("id", delivery.eventId)
            .maybeSingle(),
        ]);
        if (!issue || !event) return null;
        const [reporterResult, ownerResult] = await Promise.all([
          admin.auth.admin.getUserById(issue.reporter_id),
          admin.auth.admin.getUserById(issue.owner_id),
        ]);
        const reporter = reporterResult.data.user;
        const owner = ownerResult.data.user;
        if (!reporter?.email || !owner?.email) return null;
        return {
          delivery,
          issue: {
            matchId: issue.match_id,
            reporterId: issue.reporter_id,
            ownerId: issue.owner_id,
            reporterRole: issue.reporter_role as "owner" | "coach",
            kind: issue.kind as MatchIssueKind,
            message: issue.message,
            refundableMinutes: issue.refundable_minutes,
            status: issue.status as MatchIssueStatus,
          },
          event: {
            kind: event.kind,
            playerNote: event.player_note,
            metadata: (event.metadata ?? {}) as Record<string, unknown>,
          },
          reporter: { name: displayName(reporter), email: reporter.email },
          owner: { name: displayName(owner), email: owner.email },
        };
      },
      async claim(deliveryId, payload) {
        const { data, error } = await admin.rpc("claim_match_issue_email_delivery", {
          p_delivery_id: deliveryId, p_payload: payload,
        });
        if (error) throw new Error("Could not claim match issue email delivery");
        return typeof data === "string" ? data : null;
      },
      send: sendTransactionalEmailWithReceipt,
      async finish(deliveryId, state, error, providerEmailId) {
        const { error: finishError } = await admin.rpc(
          "finish_match_issue_email_attempt",
          { p_delivery_id: deliveryId, p_state: state, p_error: error ?? "", p_provider_id: providerEmailId ?? null },
        );
        if (finishError) throw new Error("Could not record match issue email delivery");
      },
      reportError(message) {
        console.error(message);
      },
    },
    issueId,
  );
}
