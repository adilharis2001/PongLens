import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Review lifecycle emails, sent from the web app via the Resend REST API.
 * First Resend use outside the worker; same visual shell as the worker's
 * emails (480px card, cyan pill CTA, hidden preheader). Everything here is
 * best-effort — a missing key or a Resend hiccup logs and moves on, and an
 * Idempotency-Key of <orderId>-<kind> makes accidental double-sends safe.
 */

const FROM = "PongLens <noreply@ponglens.com>";
const APP_URL = "https://www.ponglens.com";

export type ReviewEmailKind =
  | "order_paid"
  | "order_submitted"
  | "order_accepted"
  | "clarification_requested"
  | "review_delivered"
  | "order_refunded"
  | "followup_received";

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
}

async function orderFacts(orderId: string): Promise<OrderEmailFacts | null> {
  const admin = createAdminClient();
  const { data: order, error } = await admin
    .from("review_orders")
    .select("id, coach_id, student_id, turnaround_days, offerings ( title )")
    .eq("id", orderId)
    .maybeSingle();
  if (error || !order) return null;

  const [coach, student] = await Promise.all([
    admin.auth.admin.getUserById(order.coach_id),
    admin.auth.admin.getUserById(order.student_id),
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
    coachName: name(coach) || "Your coach",
    studentName: name(student) || "A player",
    coachEmail: coach.data.user?.email ?? null,
    studentEmail: student.data.user?.email ?? null,
    offeringTitle: offering?.title ?? "Match review",
    turnaroundDays: order.turnaround_days,
  };
}

function card(opts: {
  preheader: string;
  heading: string;
  body: string;
  cta: string;
  ctaUrl: string;
}): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f5f7;">
<div style="display:none;max-height:0;overflow:hidden;">${opts.preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:16px;padding:32px;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
<tr><td align="center" style="padding-bottom:24px;">
<img src="${APP_URL}/img/email-logo.png" width="120" alt="PongLens" style="display:block;">
</td></tr>
<tr><td style="font-size:18px;font-weight:600;color:#111827;padding-bottom:8px;">${opts.heading}</td></tr>
<tr><td style="font-size:14px;line-height:1.6;color:#4b5563;padding-bottom:24px;">${opts.body}</td></tr>
<tr><td align="center">
<a href="${opts.ctaUrl}" style="display:inline-block;background:#0891b2;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 28px;border-radius:999px;">${opts.cta}</a>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Fire-and-forget; call with `void` or await inside a try. */
export async function sendReviewEmail(
  kind: ReviewEmailKind,
  orderId: string,
): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const facts = await orderFacts(orderId);
  if (!facts) return;

  const student = esc(facts.studentName);
  const coach = esc(facts.coachName);
  const title = esc(facts.offeringTitle);
  const coachUrl = `${APP_URL}/coaching/orders/${facts.orderId}`;
  const studentUrl = `${APP_URL}/orders/${facts.orderId}`;

  let to: string | null;
  let subject: string;
  let html: string;

  switch (kind) {
    case "order_paid":
      to = facts.coachEmail;
      subject = `${facts.studentName} bought a review`;
      html = card({
        preheader: "A new order is waiting on their match.",
        heading: `${student} bought ${title}`,
        body: "The order starts once they send you a match. You'll hear again when it does.",
        cta: "See the order",
        ctaUrl: coachUrl,
      });
      break;
    case "order_submitted":
      to = facts.coachEmail;
      subject = `${facts.studentName} sent their match`;
      html = card({
        preheader: "Ready for your review.",
        heading: `${student} sent their match`,
        body: `${title} is ready when you are. Accepting starts your ${facts.turnaroundDays}-day turnaround.`,
        cta: "Open the order",
        ctaUrl: coachUrl,
      });
      break;
    case "order_accepted":
      to = facts.studentEmail;
      subject = `${facts.coachName} started your review`;
      html = card({
        preheader: "Your review is in progress.",
        heading: `${coach} started your review`,
        body: `They usually deliver within ${facts.turnaroundDays} ${
          facts.turnaroundDays === 1 ? "day" : "days"
        }. You'll get an email the moment it's ready.`,
        cta: "See your order",
        ctaUrl: studentUrl,
      });
      break;
    case "clarification_requested":
      to = facts.studentEmail;
      subject = `${facts.coachName} has a question`;
      html = card({
        preheader: "They need an answer to finish your review.",
        heading: `${coach} has a question`,
        body: "They need an answer before they can finish your review.",
        cta: "Answer it",
        ctaUrl: studentUrl,
      });
      break;
    case "review_delivered":
      to = facts.studentEmail;
      subject = "Your review is ready";
      html = card({
        preheader: `${facts.coachName} finished your review.`,
        heading: "Your review is ready",
        body: `${coach} finished ${title}. The points they picked out are ready to watch.`,
        cta: "Read your review",
        ctaUrl: studentUrl,
      });
      break;
    case "order_refunded":
      to = facts.studentEmail;
      subject = "Your refund is on the way";
      html = card({
        preheader: "This order was cancelled.",
        heading: "Your refund is on the way",
        body: `${title} was cancelled. The full amount goes back to the card you paid with, usually within a few days.`,
        cta: "See the order",
        ctaUrl: studentUrl,
      });
      break;
    case "followup_received":
      to = facts.coachEmail;
      subject = `${facts.studentName} asked a follow-up`;
      html = card({
        preheader: "A question about the review you delivered.",
        heading: `${student} asked a follow-up`,
        body: "A quick reply closes the loop on this review.",
        cta: "Reply",
        ctaUrl: coachUrl,
      });
      break;
  }

  if (!to) return;
  if (!key) {
    console.log(`reviewEmails: no RESEND_API_KEY, skipped ${kind} to ${to}`);
    return;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `review-${orderId}-${kind}`,
      },
      body: JSON.stringify({ from: FROM, to: [to], subject, html }),
    });
    if (!res.ok) {
      console.error(`reviewEmails: Resend ${res.status} for ${kind}`);
    }
  } catch (e) {
    console.error(`reviewEmails: ${kind} failed:`, e);
  }
}
