/**
 * Paid coach reviews — client-side shapes.
 *
 * Mirrors migration 073. Money fields are integer cents, USD. Status
 * strings are the database vocabulary; the UI translates them to plain
 * language in one place (orderStatusLabel below) so a state name never
 * leaks into copy.
 */

export type ReviewOrderStatus =
  | "awaiting_payment"
  | "awaiting_submission"
  | "submitted"
  | "in_review"
  | "clarification"
  | "delivered"
  | "completed"
  | "declined"
  | "cancelled";

/**
 * Template keys. "serve" and "receive" are retired but still sit on
 * offerings created before 085, so the union keeps them: a stored key is
 * history, not a menu.
 */
export type OfferingTemplateKey =
  | "first_look"
  | "full_match"
  | "serve_receive"
  | "opponent"
  | "style"
  | "custom"
  | "serve"
  | "receive";

export interface IntakeQuestion {
  id: string;
  label: string;
  optional?: boolean;
}

export interface IntakeAnswer {
  id: string;
  label: string;
  answer: string;
}

export interface ReviewSectionDef {
  key: string;
  label: string;
}

/** One section of the written review; body is plain text. */
export interface ReviewSectionContent {
  key: string;
  label: string;
  body: string;
}

/** A link to the coach's play: any URL, or a minted match share link. */
export interface CoachSample {
  label: string;
  url: string;
}

export interface CoachProfileRow {
  user_id: string;
  handle: string;
  display_name: string;
  headline: string;
  bio: string;
  credentials: string[];
  photo_path: string | null;
  samples: CoachSample[];
  stripe_account_id: string | null;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  accepting_orders: boolean;
  max_active_orders: number | null;
  published: boolean;
  created_at: string;
  updated_at: string;
}

export interface OfferingRow {
  id: string;
  coach_id: string;
  template_key: OfferingTemplateKey | string;
  title: string;
  description: string;
  includes: string[];
  price_cents: number;
  turnaround_days: number;
  intake_questions: IntakeQuestion[];
  review_sections: ReviewSectionDef[];
  /** Pattern names shown to this coach in the workspace. Never to a student. */
  suggested_patterns: string[];
  followup_rounds: number;
  /** 'stock:<key>' (shipped art) or an r2:// upload under offer/<uid>/. */
  image: string | null;
  active: boolean;
  sort: number;
  created_at: string;
  updated_at: string;
}

/** The /img/offerings/<key>.webp url for a 'stock:' image value. */
export function stockImageUrl(image: string | null): string | null {
  if (!image?.startsWith("stock:")) return null;
  const key = image.slice("stock:".length);
  if (!/^[a-z0-9-]+$/.test(key)) return null;
  return `/img/offerings/${key}.webp`;
}

/** What coach_page() returns for the public storefront. */
export interface CoachPage {
  handle: string;
  display_name: string;
  headline: string;
  bio: string;
  credentials: string[];
  photo_path: string | null;
  samples: CoachSample[];
  completed_count: number;
  has_sample_review: boolean;
  available: boolean;
  /** Featured quotes from completed orders: body + student first name. */
  testimonials: Array<{ body: string; name: string; at: string }>;
  offerings: Array<{
    id: string;
    title: string;
    description: string;
    includes: string[];
    price_cents: number;
    turnaround_days: number;
    followup_rounds: number;
    image: string | null;
  }>;
}

/** One row of coach_queue(). */
export interface CoachQueueItem {
  id: string;
  status: ReviewOrderStatus;
  offering_title: string;
  student_name: string;
  price_cents: number;
  coach_share_cents: number;
  match_id: string | null;
  promised_by: string | null;
  review_viewed_at: string | null;
  created_at: string;
  submitted_at: string | null;
  delivered_at: string | null;
}

/** One row of student_review_orders(). */
export interface StudentOrderItem {
  id: string;
  status: ReviewOrderStatus;
  offering_title: string;
  coach_name: string;
  price_cents: number;
  match_id: string | null;
  promised_by: string | null;
  created_at: string;
  delivered_at: string | null;
}

/** review_order_detail() — the full order for either party. */
export interface ReviewOrderDetail {
  id: string;
  status: ReviewOrderStatus;
  offering_title: string;
  offering_description: string;
  includes: string[];
  coach_id: string;
  student_id: string;
  coach_name: string;
  coach_handle: string | null;
  student_name: string;
  match_id: string | null;
  price_cents: number;
  fee_cents: number;
  coach_share_cents: number;
  turnaround_days: number;
  followup_rounds: number;
  intake_questions: IntakeQuestion[];
  intake_answers: IntakeAnswer[];
  review_sections: ReviewSectionDef[];
  /** Read live off the offering, coach only. Absent on pre-085 rows. */
  suggested_patterns?: string[];
  promised_by: string | null;
  decline_message: string | null;
  sample_consent: "none" | "requested" | "approved" | "declined";
  review_viewed_at: string | null;
  testimonial: string | null;
  testimonial_at: string | null;
  testimonial_featured: boolean;
  invited_back_at: string | null;
  paid_at: string | null;
  submitted_at: string | null;
  accepted_at: string | null;
  delivered_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
}

export interface ReviewFindingRow {
  id: string;
  order_id: string;
  title: string;
  body: string;
  audio_path: string | null;
  image_path: string | null;
  /** Which point the drawing's frame came from (081); captions it. */
  image_point_id: string | null;
  sort: number;
  created_at: string;
}

export interface ReviewAttachmentRow {
  id: string;
  order_id: string;
  r2_key: string;
  filename: string;
  size_bytes: number;
  content_type: string;
  created_at: string;
}

export interface ReviewMessageRow {
  id: string;
  order_id: string;
  author_id: string;
  kind: "clarification" | "followup";
  body: string;
  created_at: string;
}

export interface CoachReviewStats {
  active_count: number;
  completed_count: number;
  earned_cents: number;
}

/**
 * Plain language for each state, per audience. The student and the coach
 * are waiting on different things, so the words differ.
 */
export function orderStatusLabel(
  status: ReviewOrderStatus,
  audience: "student" | "coach",
): string {
  switch (status) {
    case "awaiting_payment":
      return "Payment not finished";
    case "awaiting_submission":
      return audience === "student"
        ? "Waiting for your match"
        : "Waiting for their match";
    case "submitted":
      return audience === "student" ? "Sent to your coach" : "New order";
    case "in_review":
      return audience === "student" ? "In review" : "In progress";
    case "clarification":
      return audience === "student"
        ? "Your coach has a question"
        : "Waiting on their answer";
    case "delivered":
      return "Review delivered";
    case "completed":
      return "Completed";
    case "declined":
      return "Declined and refunded";
    case "cancelled":
      return "Cancelled and refunded";
  }
}

/** Statuses that count against a coach's max active orders. */
export const ACTIVE_ORDER_STATUSES: ReviewOrderStatus[] = [
  "awaiting_submission",
  "submitted",
  "in_review",
  "clarification",
  "delivered",
];

/** A student may cancel an accepted order this long after the promise. */
export const OVERDUE_GRACE_DAYS = 7;

export function isOverdueCancellable(
  status: ReviewOrderStatus,
  promisedBy: string | null,
  now: Date = new Date(),
): boolean {
  if (status !== "in_review" && status !== "clarification") return false;
  if (!promisedBy) return false;
  const cutoff =
    new Date(promisedBy).getTime() + OVERDUE_GRACE_DAYS * 24 * 3600 * 1000;
  return now.getTime() > cutoff;
}
