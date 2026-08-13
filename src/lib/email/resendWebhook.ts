import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeAddress } from "./suppression";

/**
 * The Resend webhook handler, whole (104). The route is one line, the same
 * split payments already uses for Stripe.
 *
 * Resend signs deliveries with Svix. Verification is done here by hand
 * rather than by pulling in the svix package, because it is an HMAC over
 * three concatenated strings and this codebase already talks to Resend
 * with raw fetch instead of their SDK. One fewer dependency on the path
 * that can accept writes from the internet.
 *
 * The signature covers `<svix-id>.<svix-timestamp>.<raw body>`, so the
 * body must be read as text and never re-serialised — JSON.parse followed
 * by JSON.stringify reorders keys and the signature stops matching.
 *
 * Handled:
 *   email.bounced    -> suppress, but only when the bounce is permanent
 *   email.complained -> suppress, always
 *
 * Everything else is acknowledged and dropped. Svix retries any non-2xx,
 * so an unrecognised event type must not 400 or it retries forever.
 *
 * Status contract, matching the Stripe handler: 400 only for a bad
 * signature or unparseable body, 200 for everything that verified.
 */

const TOLERANCE_SECONDS = 5 * 60;

type ResendEvent = {
  type?: string;
  data?: {
    email_id?: string;
    to?: string[];
    bounce?: { type?: string; subType?: string; message?: string };
    complaint?: { type?: string; message?: string };
  };
};

function verifySignature(
  secret: string,
  svixId: string,
  svixTimestamp: string,
  body: string,
  signatureHeader: string,
): boolean {
  const raw = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  const keyBytes = Buffer.from(raw, "base64");
  if (keyBytes.length === 0) return false;

  const expected = createHmac("sha256", keyBytes)
    .update(`${svixId}.${svixTimestamp}.${body}`)
    .digest("base64");
  const expectedBuf = Buffer.from(expected);

  // The header carries a space-separated list so Svix can rotate secrets:
  // "v1,<sig> v1,<older sig>". Any one matching is a pass.
  return signatureHeader
    .split(" ")
    .filter((part) => part.startsWith("v1,"))
    .map((part) => Buffer.from(part.slice("v1,".length)))
    .some(
      (given) =>
        given.length === expectedBuf.length && timingSafeEqual(given, expectedBuf),
    );
}

/** A replayed delivery from an hour ago is not a delivery. */
function timestampFresh(svixTimestamp: string): boolean {
  const sent = Number(svixTimestamp);
  if (!Number.isFinite(sent)) return false;
  return Math.abs(Date.now() / 1000 - sent) <= TOLERANCE_SECONDS;
}

/**
 * Resend follows SES bounce semantics: Permanent means the address is
 * gone, Transient means a full mailbox or a server having a bad afternoon.
 * Suppressing on a transient bounce would cut off a paying customer over
 * something that fixes itself, so only Permanent counts.
 */
function isPermanentBounce(event: ResendEvent): boolean {
  return (event.data?.bounce?.type ?? "").toLowerCase() === "permanent";
}

export async function handleResendWebhook(req: Request): Promise<Response> {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.error("resendWebhook: RESEND_WEBHOOK_SECRET missing");
    return new Response("not configured", { status: 500 });
  }

  const svixId = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) {
    return new Response("missing signature headers", { status: 400 });
  }

  const body = await req.text();
  if (!timestampFresh(svixTimestamp)) {
    return new Response("stale timestamp", { status: 400 });
  }
  if (!verifySignature(secret, svixId, svixTimestamp, body, svixSignature)) {
    return new Response("bad signature", { status: 400 });
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(body) as ResendEvent;
  } catch {
    return new Response("bad body", { status: 400 });
  }

  const type = event.type ?? "unknown";
  const supabase = createAdminClient();

  // Seen-set first, the same order the Stripe handler uses: a duplicate
  // delivery is acknowledged without touching anything.
  const { data: seen } = await supabase
    .from("resend_events")
    .select("event_id")
    .eq("event_id", svixId)
    .maybeSingle();
  if (seen) return new Response("ok", { status: 200 });

  const recipients = (event.data?.to ?? [])
    .map(normalizeAddress)
    .filter((address) => address.length > 0);
  const messageId = event.data?.email_id ?? null;

  try {
    if (type === "email.complained" && recipients.length > 0) {
      // A complaint outranks anything already recorded, so this one
      // overwrites: someone who pressed the spam button after a soft
      // bounce should end up marked as a complaint, not a bounce.
      const detail = event.data?.complaint?.message ?? null;
      await supabase.from("email_suppressions").upsert(
        recipients.map((address) => ({
          address,
          reason: "complained",
          detail,
          message_id: messageId,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: "address" },
      );
      console.log(`resendWebhook: complaint suppressed ${recipients.length}`);
    } else if (type === "email.bounced" && recipients.length > 0) {
      if (isPermanentBounce(event)) {
        const b = event.data?.bounce;
        const detail = [b?.type, b?.subType, b?.message]
          .filter(Boolean)
          .join(" / ");
        // ignoreDuplicates so a later bounce never downgrades an existing
        // complaint, and never resets the original created_at.
        await supabase.from("email_suppressions").upsert(
          recipients.map((address) => ({
            address,
            reason: "bounced",
            detail: detail || null,
            message_id: messageId,
          })),
          { onConflict: "address", ignoreDuplicates: true },
        );
        console.log(`resendWebhook: hard bounce suppressed ${recipients.length}`);
      } else {
        console.log(
          `resendWebhook: soft bounce ignored (${event.data?.bounce?.type ?? "no type"})`,
        );
      }
    }
  } catch (err) {
    // Let Svix retry rather than marking the event handled.
    console.error("resendWebhook: processing failed:", err);
    return new Response("processing failed", { status: 500 });
  }

  await supabase
    .from("resend_events")
    .upsert({ event_id: svixId, type }, { onConflict: "event_id" });

  return new Response("ok", { status: 200 });
}
