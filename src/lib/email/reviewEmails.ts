import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  reviewLifecycleEmail,
  type ReviewMessageKind,
} from "./catalog";
import { sendTransactionalEmail } from "./send";

/**
 * Review lifecycle emails, sent from the web app via the Resend REST API.
 * First Resend use outside the worker; same visual shell as the worker's
 * emails (480px card, cyan pill CTA, hidden preheader). Everything here is
 * best-effort — a missing key or a Resend hiccup logs and moves on, and an
 * Idempotency-Key of <orderId>-<kind> makes accidental double-sends safe.
 */

const APP_URL = "https://www.ponglens.com";

export type ReviewEmailKind = ReviewMessageKind;

interface OrderEmailFacts {
  orderId: string;
  coachId: string;
  studentId: string;
  coachName: string;
  studentName: string;
  coachEmail: string | null;
  studentEmail: string | null;
  offeringTitle: string;
  turnaroundDays: number;
  /** billing_mode = 'test' (092): both parties are QA, subject says so. */
  test: boolean;
}

async function orderFacts(orderId: string): Promise<OrderEmailFacts | null> {
  const admin = createAdminClient();
  const { data: order, error } = await admin
    .from("review_orders")
    .select(
      "id, coach_id, student_id, turnaround_days, billing_mode, offerings ( title )",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (error || !order) return null;

  const [coach, student, { data: coachProfile }] = await Promise.all([
    admin.auth.admin.getUserById(order.coach_id),
    admin.auth.admin.getUserById(order.student_id),
    admin
      .from("coach_profiles")
      .select("display_name")
      .eq("user_id", order.coach_id)
      .maybeSingle(),
  ]);
  const name = (u: typeof coach) =>
    ((u.data.user?.user_metadata?.full_name as string | undefined) ??
      (u.data.user?.user_metadata?.name as string | undefined) ??
      "").trim();
  const offering = Array.isArray(order.offerings)
    ? order.offerings[0]
    : order.offerings;
  return {
    orderId: order.id,
    coachId: order.coach_id,
    studentId: order.student_id,
    // Students bought from the storefront name; auth is the fallback.
    coachName:
      coachProfile?.display_name?.trim() || name(coach) || "Your coach",
    studentName: name(student) || "A player",
    coachEmail: coach.data.user?.email ?? null,
    studentEmail: student.data.user?.email ?? null,
    offeringTitle: offering?.title ?? "Match review",
    turnaroundDays: order.turnaround_days,
    test: order.billing_mode === "test",
  };
}

/** Fire-and-forget; call with `void` or await inside a try. */
export async function sendReviewEmail(
  kind: ReviewEmailKind,
  orderId: string,
): Promise<void> {
  const facts = await orderFacts(orderId);
  if (!facts) return;

  const coachUrl = `${APP_URL}/coaching/orders/${facts.orderId}`;
  const studentUrl = `${APP_URL}/orders/${facts.orderId}`;
  const coachKinds: readonly ReviewEmailKind[] = [
    "order_paid",
    "order_submitted",
    "clarification_answered",
    "followup_received",
  ];
  const to = coachKinds.includes(kind) ? facts.coachEmail : facts.studentEmail;
  if (!to) return;
  let message = reviewLifecycleEmail(kind, {
    coachName: facts.coachName,
    studentName: facts.studentName,
    offeringTitle: facts.offeringTitle,
    turnaroundDays: facts.turnaroundDays,
    coachUrl,
    studentUrl,
  });
  // Test orders exist only between QA accounts, so these go to real QA
  // inboxes — sent normally so the email flow is testable, marked so
  // nobody mistakes one for money.
  if (facts.test) {
    message = { ...message, subject: `[Test] ${message.subject}` };
  }
  await sendTransactionalEmail({
    to,
    message,
    idempotencyKey: `review-${orderId}-${kind}`,
    operation: `review_email_${kind}`,
  });
}

/**
 * Orders that submitted themselves inside the DB (the match finished
 * processing after the student attached it) carry an outbox flag instead
 * of an email — no server code ran at flip time. Claim the flags
 * atomically, then send: a lost send costs one email, never a duplicate.
 * Called from both sweeps (coach page load and the daily cron).
 */
export async function sendPendingSubmitEmails(): Promise<void> {
  const admin = createAdminClient();
  const { data: claimed, error } = await admin
    .from("review_orders")
    .update({ submit_email_pending: false })
    .eq("submit_email_pending", true)
    .select("id");
  if (error) {
    // Before migration 080 the column does not exist; nothing to send.
    return;
  }
  for (const row of claimed ?? []) {
    try {
      await sendReviewEmail("order_submitted", row.id);
    } catch (e) {
      console.error("pending submit email:", row.id, e);
    }
  }
}
