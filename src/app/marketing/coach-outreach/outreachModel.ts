export type ChannelKind =
  | "instagram"
  | "email"
  | "whatsapp"
  | "telegram"
  | "website"
  | "youtube"
  | "phone"
  | "form";

export type Stage =
  | "found"
  | "qualified"
  | "ready"
  | "contacted"
  | "replied"
  | "not_a_fit"
  | "no_reply"
  | "signed_up"
  | "do_not_contact";

export interface OutreachChannel {
  kind: ChannelKind;
  value: string;
  source: string;
}

export interface OutreachCoach {
  id: string;
  handle: string;
  full_name: string | null;
  bio: string | null;
  followers: number;
  language: string | null;
  country: string | null;
  english: boolean;
  profile_url: string | null;
  avatar_url: string | null;
  fit_note: string | null;
  discovered_via: string | null;
  stage: Stage;
  notes: string | null;
  outreach_channels: OutreachChannel[];
}

/**
 * The stages a coach moves through, in order. The four after "Replied" are
 * where a coach comes to rest; the list separates them so a glance at the
 * filter says how much of the pipeline is still live.
 */
export const STAGES: readonly { value: Stage; label: string; done: boolean }[] = [
  { value: "found", label: "Found", done: false },
  { value: "qualified", label: "Qualified", done: false },
  { value: "ready", label: "Ready", done: false },
  { value: "contacted", label: "Contacted", done: false },
  { value: "replied", label: "Replied", done: false },
  { value: "signed_up", label: "Signed up", done: true },
  { value: "not_a_fit", label: "Not a fit", done: true },
  { value: "no_reply", label: "No reply", done: true },
  { value: "do_not_contact", label: "Do not contact", done: true },
];

export function stageLabel(stage: Stage): string {
  return STAGES.find((s) => s.value === stage)?.label ?? stage;
}

export const CHANNEL_LABEL: Record<ChannelKind, string> = {
  instagram: "Instagram",
  email: "Email",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  website: "Website",
  youtube: "YouTube",
  phone: "Phone",
  form: "Contact form",
};

/**
 * Where a channel actually opens. Instagram gets the message deep link
 * rather than the profile, because the whole point is that Adil writes from
 * his own account; the profile is a second link beside it.
 */
export function channelHref(kind: ChannelKind, value: string): string {
  switch (kind) {
    case "instagram":
      return `https://ig.me/m/${value}`;
    case "email":
      return `mailto:${value}`;
    case "whatsapp":
      return `https://wa.me/${value.replace(/\D/g, "")}`;
    case "telegram":
      return `https://t.me/${value.replace(/^@/, "")}`;
    case "phone":
      return `tel:${value}`;
    default:
      return value.startsWith("http") ? value : `https://${value}`;
  }
}

export function profileHref(coach: Pick<OutreachCoach, "handle" | "profile_url">): string {
  return coach.profile_url || `https://www.instagram.com/${coach.handle}`;
}

/**
 * The letter in the avatar circle.
 *
 * Not `charAt(0)`: plenty of these names open with an emoji, and a table
 * tennis bat is a surrogate pair, so taking one UTF-16 unit yields half a
 * character that the server and the browser disagree about. That
 * disagreement is a hydration failure. Iterating the string walks code
 * points, and skipping to the first letter or digit means "🏓 coach ahmed
 * helmy 🏓" shows a C rather than a broken glyph.
 */
export function initialFor(
  coach: Pick<OutreachCoach, "full_name" | "handle">,
): string {
  for (const ch of `${coach.full_name ?? ""} ${coach.handle}`) {
    if (/\p{L}|\p{N}/u.test(ch)) return ch.toUpperCase();
  }
  return "?";
}

/** 12500 reads as 12.5k. Exact counts below a thousand. */
export function formatFollowers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** One channel of each kind, in the order the buttons should appear. */
export function channelsFor(coach: OutreachCoach): OutreachChannel[] {
  const order: ChannelKind[] = [
    "email",
    "whatsapp",
    "telegram",
    "website",
    "youtube",
    "phone",
    "form",
  ];
  const seen = new Set<string>();
  return order
    .flatMap((kind) => coach.outreach_channels.filter((c) => c.kind === kind))
    .filter((c) => {
      if (seen.has(c.kind)) return false;
      seen.add(c.kind);
      return true;
    });
}

export interface OutreachFilter {
  stage: Stage | "all" | "live";
  englishOnly: boolean;
  withEmailOnly: boolean;
  query: string;
}

export const EMPTY_FILTER: OutreachFilter = {
  stage: "all",
  englishOnly: false,
  withEmailOnly: false,
  query: "",
};

export function filterCoaches(
  coaches: readonly OutreachCoach[],
  filter: OutreachFilter,
): OutreachCoach[] {
  const q = filter.query.trim().toLowerCase();
  const live = new Set(STAGES.filter((s) => !s.done).map((s) => s.value));
  return coaches.filter((coach) => {
    if (filter.stage === "live" && !live.has(coach.stage)) return false;
    if (filter.stage !== "all" && filter.stage !== "live" && coach.stage !== filter.stage) {
      return false;
    }
    if (filter.englishOnly && !coach.english) return false;
    if (
      filter.withEmailOnly &&
      !coach.outreach_channels.some((c) => c.kind === "email")
    ) {
      return false;
    }
    if (q) {
      const hay = [coach.handle, coach.full_name, coach.bio, coach.country]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export interface OutreachSummary {
  total: number;
  english: number;
  withEmail: number;
  contacted: number;
  replied: number;
}

export function summarise(coaches: readonly OutreachCoach[]): OutreachSummary {
  return {
    total: coaches.length,
    english: coaches.filter((c) => c.english).length,
    withEmail: coaches.filter((c) =>
      c.outreach_channels.some((ch) => ch.kind === "email"),
    ).length,
    contacted: coaches.filter((c) =>
      ["contacted", "replied", "signed_up", "no_reply"].includes(c.stage),
    ).length,
    replied: coaches.filter((c) => ["replied", "signed_up"].includes(c.stage))
      .length,
  };
}
