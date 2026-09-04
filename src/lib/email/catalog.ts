import type { EmailMessage } from "./message.ts";

const VERSION = 1;

export function confirmAccountEmail(facts: { confirmationUrl: string; code: string }): EmailMessage {
  return {
    templateId: "auth.confirm-account", templateVersion: VERSION, category: "auth", audience: "player",
    subject: "Confirm your email for PongLens",
    preheader: "Your confirmation link and code expire in one hour.",
    heading: "Confirm your email",
    blocks: [
      { type: "paragraph", text: "Use the button below to finish setting up PongLens. This link and the six-digit code expire in one hour and can only be used once." },
      { type: "details", rows: [{ label: "iPhone app code", value: facts.code }] },
    ],
    action: { label: "Confirm email", url: facts.confirmationUrl },
    reason: "If you did not request this, you can ignore this email. Your account remains unchanged.",
    support: true,
  };
}

export function magicLinkEmail(facts: { confirmationUrl: string; code: string }): EmailMessage {
  return {
    templateId: "auth.magic-link", templateVersion: VERSION, category: "auth", audience: "player",
    subject: "Your PongLens sign-in link",
    preheader: "Sign in securely. This link expires in one hour.",
    heading: "Sign in to PongLens",
    blocks: [
      { type: "paragraph", text: "Use this secure link to return to your matches. It expires in one hour and can only be used once." },
      { type: "details", rows: [{ label: "iPhone app code", value: facts.code }] },
    ],
    action: { label: "Sign in to PongLens", url: facts.confirmationUrl },
    reason: "If you did not request this, you can ignore this email. Your account remains unchanged.",
    support: true,
  };
}

export function betaInvitationEmail(testFlightUrl: string): EmailMessage {
  return {
    templateId: "beta.invitation", templateVersion: VERSION, category: "beta", audience: "tester",
    subject: "Your PongLens iPhone beta is ready",
    preheader: "Install PongLens through TestFlight in a few taps.",
    eyebrow: "PongLens for iPhone",
    heading: "PongLens is ready for your iPhone",
    blocks: [
      { type: "paragraph", text: "Open the invitation on your iPhone to install PongLens through TestFlight." },
      { type: "steps", items: [
        "Install TestFlight from the App Store if you do not have it.",
        "Open this invitation on the iPhone where you want PongLens.",
        "Tap Accept, then Install.",
      ] },
    ],
    action: { label: "Install PongLens beta", url: testFlightUrl },
    reason: "You requested the PongLens iPhone beta. Beta access and essential beta notices only. No marketing.",
    support: true,
  };
}

export function betaAdminNoticeEmail(facts: { email: string; requestedAt: string }): EmailMessage {
  return {
    templateId: "beta.admin-notice", templateVersion: VERSION, category: "beta", audience: "admin",
    subject: `${facts.email} joined the iPhone beta`,
    preheader: "Their TestFlight invitation was sent automatically.",
    eyebrow: "iPhone beta",
    heading: "A player requested beta access",
    blocks: [{ type: "details", rows: [
      { label: "Email", value: facts.email },
      { label: "Requested", value: facts.requestedAt },
    ] }],
    reason: "The invitation and setup instructions were sent automatically. No action is required.",
    support: false,
  };
}

export type ReviewMessageKind =
  | "order_paid" | "order_submitted" | "order_accepted"
  | "clarification_requested" | "clarification_answered"
  | "review_delivered" | "order_refunded" | "followup_received" | "invite_back";

export type ReviewEmailFacts = {
  coachName: string; studentName: string; offeringTitle: string;
  turnaroundDays: number; coachUrl: string; studentUrl: string;
};

export function reviewLifecycleEmail(kind: ReviewMessageKind, facts: ReviewEmailFacts): EmailMessage {
  const days = `${facts.turnaroundDays} ${facts.turnaroundDays === 1 ? "day" : "days"}`;
  const shared = { templateVersion: VERSION, category: "coaching" as const, support: true };
  switch (kind) {
    case "order_paid": return {
      ...shared, templateId: "coaching.booking-new", audience: "coach",
      subject: `${facts.studentName} booked ${facts.offeringTitle}`,
      preheader: "We will let you know when their match is ready.", eyebrow: "New booking",
      heading: `${facts.studentName} booked a review`,
      blocks: [{ type: "paragraph", text: `They booked ${facts.offeringTitle}. No action is needed yet. We will email you when their match is ready to review.` }],
      action: { label: "View booking", url: facts.coachUrl },
      reason: "You received this because a player booked one of your reviews.",
    };
    case "order_submitted": return {
      ...shared, templateId: "coaching.match-submitted", audience: "coach",
      subject: `${facts.studentName}'s match is ready for review`,
      preheader: `Accepting starts your ${days} turnaround.`, eyebrow: "Match review",
      heading: `${facts.studentName} sent their match`,
      blocks: [{ type: "paragraph", text: `${facts.offeringTitle} is ready when you are. Accepting the review starts your ${days} turnaround.` }],
      action: { label: "Open review request", url: facts.coachUrl },
      reason: "You received this because a player sent a match for your review.",
    };
    case "order_accepted": return {
      ...shared, templateId: "coaching.review-started", audience: "player",
      subject: `${facts.coachName} started your review`, preheader: "Your review is now in progress.",
      eyebrow: "Match review", heading: "Your review is underway",
      blocks: [{ type: "paragraph", text: `${facts.coachName} started ${facts.offeringTitle}. It is expected within ${days}, and we will email you when it is ready.` }],
      action: { label: "Track your review", url: facts.studentUrl },
      reason: "You received this because your coach started your review.",
    };
    case "clarification_requested": return {
      ...shared, templateId: "coaching.clarification-requested", audience: "player",
      subject: `${facts.coachName} has a question about your review`, preheader: "Your answer will help them continue.",
      eyebrow: "Match review", heading: `${facts.coachName} needs your answer`,
      blocks: [{ type: "paragraph", text: `Your coach has a question before they can finish ${facts.offeringTitle}. The question itself is not included in this email or its lock-screen preview.` }],
      action: { label: `Answer ${facts.coachName}`, url: facts.studentUrl },
      reason: "You received this because your coach needs information to continue.",
    };
    case "clarification_answered": return {
      ...shared, templateId: "coaching.clarification-answered", audience: "coach",
      subject: `${facts.studentName} answered your question`, preheader: "Their answer is waiting on the review.",
      eyebrow: "Match review", heading: `${facts.studentName} answered`,
      blocks: [{ type: "paragraph", text: `Their answer is on ${facts.offeringTitle}, so you can continue the review.` }],
      action: { label: "Continue the review", url: facts.coachUrl },
      reason: "You received this because the player answered your question.",
    };
    case "review_delivered": return {
      ...shared, templateId: "coaching.review-delivered", audience: "player",
      subject: `Your review from ${facts.coachName} is ready`, preheader: "Watch the points your coach selected.",
      eyebrow: "Match review", heading: "Your review is ready",
      blocks: [{ type: "paragraph", text: `${facts.coachName} finished ${facts.offeringTitle}. The points and feedback they selected are ready to watch.` }],
      action: { label: "Watch your review", url: facts.studentUrl },
      reason: "You received this because your coach delivered your review.",
    };
    case "followup_received": return {
      ...shared, templateId: "coaching.followup-received", audience: "coach",
      subject: `${facts.studentName} has a follow-up question`, preheader: "Reply on the review to close the loop.",
      eyebrow: "Match review", heading: `${facts.studentName} followed up`,
      blocks: [{ type: "paragraph", text: `They have a question about ${facts.offeringTitle}. The question itself is not included in the email preview.` }],
      action: { label: `Reply to ${facts.studentName}`, url: facts.coachUrl },
      reason: "You received this because a player followed up on your review.",
    };
    case "invite_back": return {
      ...shared, templateId: "coaching.invite-back", audience: "player",
      subject: `${facts.coachName} invited you to send another match`, preheader: "Book another review whenever you are ready.",
      eyebrow: "From your coach", heading: `${facts.coachName} is ready for your next match`,
      blocks: [{ type: "paragraph", text: `Book another ${facts.offeringTitle} whenever you have a match you want them to review.` }],
      action: { label: "Book another review", url: facts.studentUrl },
      reason: "You received this because your coach invited you back.",
    };
    case "order_refunded": return {
      ...shared, templateId: "coaching.refund-issued", audience: "player",
      subject: "Your refund is on the way", preheader: `The full amount for ${facts.offeringTitle} was returned.`,
      eyebrow: "Refund", heading: "Your refund has been issued",
      blocks: [{ type: "paragraph", text: `The full amount for ${facts.offeringTitle} was returned to your original payment method. Your bank determines when it appears on your statement.` }],
      action: { label: "View refund details", url: facts.studentUrl },
      reason: "You received this because your match review was refunded.",
    };
  }
}

type PurchaseBase = { title: string; amount: string; purchaseDate: string; paymentReference?: string };
export type PurchaseEmailFacts =
  | (PurchaseBase & { kind: "minute_pack"; minutes: number })
  | (PurchaseBase & { kind: "storage"; gigabytes: number; months: number })
  | (PurchaseBase & { kind: "review_credits"; credits: number });

export function purchaseReceiptEmail(facts: PurchaseEmailFacts): EmailMessage {
  let templateId: string;
  let body: string;
  let action: { label: string; url: string };
  if (facts.kind === "minute_pack") {
    templateId = "billing.receipt-minutes";
    body = `${facts.minutes} processing minutes are on your account and ready for your next match. They never expire.`;
    action = { label: "See your minutes", url: "https://www.ponglens.com/account" };
  } else if (facts.kind === "storage") {
    templateId = "billing.receipt-storage";
    const term = facts.months === 12 ? "the next year" : `${facts.months} months`;
    body = `${facts.gigabytes} GB of storage is on your account for ${term}. Existing uploads are not deleted when space runs low.`;
    action = { label: "See your storage", url: "https://www.ponglens.com/account" };
  } else {
    templateId = "billing.receipt-review-credits";
    body = `${facts.credits} sponsored reviews are ready to use. Create a review link and send it to a student. They pay nothing.`;
    action = { label: "Use your review credits", url: "https://www.ponglens.com/coaching/sponsored" };
  }
  const rows = [
    { label: "Item", value: facts.title }, { label: "Amount", value: facts.amount },
    { label: "Purchased", value: facts.purchaseDate },
  ];
  if (facts.paymentReference) rows.push({ label: "Payment reference", value: facts.paymentReference });
  return {
    templateId, templateVersion: VERSION, category: "billing", audience: "player",
    subject: `Receipt for ${facts.title}`, preheader: `${facts.title} · ${facts.amount}`,
    eyebrow: "Purchase confirmed", heading: `${facts.title} is on your account`,
    blocks: [{ type: "paragraph", text: body }, { type: "details", rows }], action,
    reason: "You received this receipt because you made a purchase on PongLens. Contact support if you do not recognize it.",
    support: true,
  };
}

