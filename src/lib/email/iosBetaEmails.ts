import "server-only";

import { ADMIN_EMAIL } from "@/lib/config";
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
  adminEmailMessage,
  parseTestFlightUrl,
  testerEmailMessage,
} from "@/lib/iosBeta/model";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTransactionalEmail } from "./send";

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
  const testFlightUrl = parseTestFlightUrl(process.env.IOS_TESTFLIGHT_URL);
  if (!testFlightUrl) return "failed";

  const to = kind === "invite" ? request.email : ADMIN_EMAIL;
  const message =
    kind === "invite"
      ? testerEmailMessage(testFlightUrl)
      : adminEmailMessage(request.email, request.requestedAt);
  return sendTransactionalEmail({
    to,
    message,
    idempotencyKey: betaIdempotencyKey(request.id, kind),
    operation: `ios_beta_${kind}_email`,
  });
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
