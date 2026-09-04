import "server-only";

import { ADMIN_EMAIL } from "@/lib/config";
import { recordUsage, resendEmailEvent } from "@/lib/costs/meter";
import {
  betaIdempotencyKey,
  deliverBetaRecord,
  type BetaDeliveryResult,
  type BetaDeliveryStamp,
  type BetaMessageKind,
  type BetaRequestRecord,
  type BetaSendState,
} from "@/lib/iosBeta/delivery";
import {
  adminEmailContent,
  parseTestFlightUrl,
  testerEmailContent,
} from "@/lib/iosBeta/model";
import { createAdminClient } from "@/lib/supabase/admin";
import { EMAIL_FROM, EMAIL_REPLY_TO } from "./reviewEmails";
import { skipIfSuppressed } from "./suppression";

type BetaRequestRow = {
  id: string;
  email: string;
  created_at: string;
  invite_sent_at: string | null;
  invite_suppressed_at: string | null;
  admin_notified_at: string | null;
  admin_suppressed_at: string | null;
};

function toRecord(row: BetaRequestRow): BetaRequestRecord {
  return {
    id: row.id,
    email: row.email,
    requestedAt: row.created_at,
    inviteNeeded: !row.invite_sent_at && !row.invite_suppressed_at,
    adminNoticeNeeded: !row.admin_notified_at && !row.admin_suppressed_at,
  };
}

async function sendMessage(
  kind: BetaMessageKind,
  request: BetaRequestRecord,
): Promise<BetaSendState> {
  const apiKey = process.env.RESEND_API_KEY;
  const testFlightUrl = parseTestFlightUrl(process.env.IOS_TESTFLIGHT_URL);
  if (!apiKey || !testFlightUrl) return "failed";

  const to = kind === "invite" ? request.email : ADMIN_EMAIL;
  if (await skipIfSuppressed(to, `iOS beta ${kind}`)) return "suppressed";

  const content =
    kind === "invite"
      ? testerEmailContent(testFlightUrl)
      : adminEmailContent(request.email, request.requestedAt);

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": betaIdempotencyKey(request.id, kind),
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [to],
        reply_to: EMAIL_REPLY_TO,
        subject: content.subject,
        html: content.html,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      console.error(`iOS beta email: Resend ${response.status} for ${kind}`);
      return "failed";
    }

    const body = (await response.json().catch(() => null)) as {
      id?: string;
    } | null;
    if (body?.id) {
      await recordUsage(
        [
          resendEmailEvent({
            messageId: body.id,
            operation: `ios_beta_${kind}_email`,
          }),
        ].filter((event) => event !== null),
      );
    }
    return "sent";
  } catch (error) {
    console.error(`iOS beta email: ${kind} failed:`, error);
    return "failed";
  }
}

async function stampDelivery(
  stamp: BetaDeliveryStamp,
  requestId: string,
): Promise<void> {
  const column: Record<BetaDeliveryStamp, string> = {
    invite_sent: "invite_sent_at",
    invite_suppressed: "invite_suppressed_at",
    admin_sent: "admin_notified_at",
    admin_suppressed: "admin_suppressed_at",
  };
  const { error } = await createAdminClient()
    .from("ios_beta_requests")
    .update({ [column[stamp]]: new Date().toISOString() })
    .eq("id", requestId);
  if (error) throw new Error(error.message);
}

export async function deliverIosBetaRequest(
  requestId: string,
): Promise<BetaDeliveryResult | null> {
  const { data, error } = await createAdminClient()
    .from("ios_beta_requests")
    .select(
      "id, email, created_at, invite_sent_at, invite_suppressed_at, admin_notified_at, admin_suppressed_at",
    )
    .eq("id", requestId)
    .maybeSingle<BetaRequestRow>();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return deliverBetaRecord(toRecord(data), {
    send: sendMessage,
    stamp: stampDelivery,
  });
}

export async function sendPendingIosBetaEmails(): Promise<void> {
  const { data, error } = await createAdminClient()
    .from("ios_beta_requests")
    .select("id")
    .or(
      "and(admin_notified_at.is.null,admin_suppressed_at.is.null),and(invite_sent_at.is.null,invite_suppressed_at.is.null)",
    )
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) {
    // Allows deploy ordering to remain safe while migration 169 rolls out.
    console.error("iOS beta email sweep:", error.message);
    return;
  }
  for (const row of data ?? []) {
    await deliverIosBetaRequest(row.id);
  }
}
