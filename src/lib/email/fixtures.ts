import { betaAdminNoticeEmail, betaInvitationEmail, confirmAccountEmail, magicLinkEmail, purchaseReceiptEmail, reviewLifecycleEmail, type ReviewMessageKind } from "./catalog.ts";
import type { EmailMessage } from "./message.ts";

export type EmailFixture = { id: string; label: string; message: EmailMessage };

const reviewFacts = {
  coachName: "Miguel Santos", studentName: "Maya Chen", offeringTitle: "Match breakdown",
  turnaroundDays: 3, coachUrl: "https://www.ponglens.com/coaching/orders/preview",
  studentUrl: "https://www.ponglens.com/orders/preview",
} as const;

const reviewKinds: readonly ReviewMessageKind[] = [
  "order_paid", "order_submitted", "order_accepted", "clarification_requested",
  "clarification_answered", "review_delivered", "order_refunded", "followup_received", "invite_back",
];

export function typescriptEmailFixtures(): EmailFixture[] {
  const confirmationUrl = "https://www.ponglens.com/auth/confirm?token_hash=preview&type=magiclink";
  const fixtures: EmailFixture[] = [
    { id: "auth.confirm-account", label: "Confirm account", message: confirmAccountEmail({ confirmationUrl: confirmationUrl.replace("magiclink", "signup"), code: "248613" }) },
    { id: "auth.magic-link", label: "Magic-link sign in", message: magicLinkEmail({ confirmationUrl, code: "248613" }) },
    { id: "beta.invitation", label: "iPhone beta invitation", message: betaInvitationEmail("https://testflight.apple.com/join/H9XdnySg") },
    { id: "beta.admin-notice", label: "iPhone beta admin notice", message: betaAdminNoticeEmail({ email: "maya.chen@example.com", requestedAt: "September 4, 2026 at 2:30 PM ET" }) },
  ];
  for (const kind of reviewKinds) {
    const message = reviewLifecycleEmail(kind, reviewFacts);
    fixtures.push({ id: message.templateId, label: kind, message });
  }
  fixtures.push(
    { id: "billing.receipt-minutes", label: "Processing minutes receipt", message: purchaseReceiptEmail({ kind: "minute_pack", title: "120 processing minutes", amount: "$12", purchaseDate: "September 4, 2026", paymentReference: "pi_preview_minutes", minutes: 120 }) },
    { id: "billing.receipt-storage", label: "Storage receipt", message: purchaseReceiptEmail({ kind: "storage", title: "25 GB storage", amount: "$24", purchaseDate: "September 4, 2026", paymentReference: "pi_preview_storage", gigabytes: 25, months: 12 }) },
    { id: "billing.receipt-review-credits", label: "Sponsored review credits receipt", message: purchaseReceiptEmail({ kind: "review_credits", title: "3 sponsored reviews", amount: "$45", purchaseDate: "September 4, 2026", paymentReference: "pi_preview_reviews", credits: 3 }) },
  );
  return fixtures;
}

