/**
 * "How did you hear about us?" — the last question in onboarding.
 *
 * The answers are a fixed list so they can be counted; the free-text half
 * exists because the answer that matters most is a person. A coach telling a
 * student is the channel this product actually runs on, so "A coach" and "A
 * friend or another player" both open a name field, and so does "My club".
 *
 * The list is written down once, in `ios/Tests/fixtures/signup-sources.json`,
 * and this file and `ios/PongLens/PongLens/Core/SignupSource.swift` are both
 * tested against it. Two ports of one list is exactly the shape that drifted
 * on placement, so neither side is the original: the JSON is.
 *
 * Every part is optional. A skipped question and a picked answer with no name
 * both write what they know and move on, because a required attribution
 * question buys worse data and a worse first minute.
 */

export type SignupSource =
  | "coach"
  | "player"
  | "club"
  | "search"
  | "youtube"
  | "instagram"
  | "tiktok"
  | "forum"
  | "event"
  | "other";

export interface SignupSourceOption {
  value: SignupSource;
  label: string;
  /** The follow-up field's label. Absent when the answer names itself. */
  detailLabel?: string;
  detailPlaceholder?: string;
}

/** Order is part of the spec: the answers that name a person come first. */
export const SIGNUP_SOURCES: SignupSourceOption[] = [
  {
    value: "coach",
    label: "A coach",
    detailLabel: "Your coach's name",
    detailPlaceholder: "Alex",
  },
  {
    value: "player",
    label: "A friend or another player",
    detailLabel: "Their name",
    detailPlaceholder: "Alex",
  },
  {
    value: "club",
    label: "My club",
    detailLabel: "Which club?",
    detailPlaceholder: "Your club's name",
  },
  { value: "search", label: "Google or another search" },
  { value: "youtube", label: "YouTube" },
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "forum", label: "Reddit or a forum" },
  { value: "event", label: "A tournament or event" },
  {
    value: "other",
    label: "Other",
    detailLabel: "Where was it?",
    detailPlaceholder: "A podcast, a shop, a newsletter",
  },
];

/**
 * Matches the column's `char_length(detail) <= 120`. Counted in code points,
 * which is what Postgres counts, so anything this lets through is something
 * the column accepts.
 */
export const SIGNUP_DETAIL_MAX_LENGTH = 120;

export function signupSourceOption(
  value: string | null | undefined,
): SignupSourceOption | null {
  return SIGNUP_SOURCES.find((option) => option.value === value) ?? null;
}

/** What the admin list shows for an answer. Unknown values render as-is
 *  rather than as a blank, so a value this file has not caught up with is
 *  visible instead of silently missing. */
export function signupSourceLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return signupSourceOption(value)?.label ?? value;
}

/** True when picking this answer should open the name field. */
export function asksForDetail(value: string | null | undefined): boolean {
  return signupSourceOption(value)?.detailLabel !== undefined;
}

/**
 * Trims, collapses runs of whitespace, and cuts to the column's limit.
 * Returns null for an answer that is nothing, so a blank field and an
 * untouched one are stored the same way.
 */
export function normalizeSignupDetail(
  value: string | null | undefined,
): string | null {
  const collapsed = (value ?? "").trim().replace(/\s+/gu, " ");
  if (!collapsed) return null;
  const points = Array.from(collapsed);
  return points.length > SIGNUP_DETAIL_MAX_LENGTH
    ? points.slice(0, SIGNUP_DETAIL_MAX_LENGTH).join("")
    : collapsed;
}
