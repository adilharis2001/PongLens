/**
 * How an outreach message is made to sound like Adil rather than like a
 * model doing an impression of him.
 *
 * Two halves. The templates below are his own words, rewritten by him and
 * kept here rather than in a prompt, because a template that a model
 * paraphrases each time drifts. The model only fills the blanks.
 *
 * Then a deterministic pass, lifted from the WDIMT Reddit bot where it has
 * been running for months: dashes become commas and the first character is
 * lowercased. It runs last, so it fixes anything the model reintroduced.
 *
 * The things this exists to prevent, all of which shipped in a draft at
 * some point and were rejected by name:
 *
 *  - Asking a question nobody cares about to bait a reply. Say what you
 *    want instead.
 *  - Narrating the reader's pain back at them ("you record an hour, most of
 *    it is people picking the ball up"). Nobody wants to read that.
 *  - "no pitch", "i just want a real opinion", and the rest of the tells.
 *  - Four evenly sized paragraphs. Real messages run to two, and the second
 *    one is longer.
 */

/** The bits of a coach a message needs. Deliberately narrow: this module
 *  must be importable by the worker scripts as well as the app. */
export interface VoiceCoach {
  handle: string;
  full_name: string | null;
  followers: number;
  entity_type: "coach" | "club" | "pro" | "unknown";
}

/** Words and phrases that read as a machine trying to sound casual. */
const TELLS = [
  /\bno pitch\b/i,
  /\bjust want a real opinion\b/i,
  /\bquick question\b/i,
  /\breach out\b.*\bsee if\b.*\bmakes sense\b/i,
  /\bspinning your wheels\b/i,
  /\bvibe\b/i,
  /\bgame.?changer\b/i,
  /\bcircle back\b/i,
  /\bdive in\b/i,
  /\bunpack\b/i,
];

/**
 * The last thing that touches a message. Same two rules as the Reddit bot:
 * every kind of dash becomes a comma, and the first character is lowercased
 * so it opens like something typed rather than something composed.
 */
export function cleanVoice(text: string | null | undefined): string {
  let cleaned = String(text ?? "").trim();
  // The surrounding spaces have to go with the dash. Replacing the
  // character alone turns "this — it" into "this , it", which is a worse
  // tell than the dash was. The WDIMT original has this flaw; do not copy
  // it back in.
  cleaned = cleaned.replace(/\s*[—–]\s*/g, ", ");
  cleaned = cleaned.replace(/\s*--\s*/g, ", ");
  // A comma landing next to punctuation it does not belong beside.
  cleaned = cleaned.replace(/\s*,\s*,/g, ",");
  cleaned = cleaned.replace(/,\s*([.!?])/g, "$1");
  cleaned = cleaned.replace(/[ \t]+/g, " ");
  cleaned = cleaned.replace(/ +\n/g, "\n");
  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toLowerCase() + cleaned.slice(1);
  }
  return cleaned;
}

/** What a draft must not contain before Adil ever sees it. */
export function voiceProblems(text: string): string[] {
  const problems: string[] = [];
  if (/—|–|--/.test(text)) problems.push("contains a dash");
  for (const tell of TELLS) {
    const hit = text.match(tell);
    if (hit) problems.push(`reads as a tell: "${hit[0]}"`);
  }
  const paragraphs = text.trim().split(/\n\s*\n/).filter(Boolean);
  if (paragraphs.length > 2) {
    problems.push(`${paragraphs.length} paragraphs, two is the most he writes`);
  }
  if (/\bAI\b/.test(text)) problems.push("says AI");
  return problems;
}

/** Words that are a role rather than a name. "hey Coach," reads as a mailshot. */
const TITLES = /^(coach|mr|mrs|ms|miss|dr|prof|sir|master|the)$/i;

/**
 * What to call them.
 *
 * A club wants its whole name, because "888 Table Tennis Center" cut to its
 * first word is "hey 888". A person wants their first name only, because
 * their profile name is usually "Craig Bryant | Table Tennis Coach | Serve
 * Specialist" and greeting all of that is worse than greeting none of it.
 *
 * Returns null when there is nothing usable, and the opener then greets
 * them without a name. A handle in the greeting ("hey pingpongcoach38")
 * announces that a script wrote the message.
 */
export function displayName(coach: VoiceCoach): string | null {
  const raw = (coach.full_name ?? "").trim();
  if (!raw) return null;
  // Everything after a separator is a job title, not part of the name.
  const head = raw.split(/[|·•]|\s[-–—]\s/)[0];
  const clean = head
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return null;

  if (coach.entity_type === "club") {
    return clean.length > 45 ? null : clean;
  }

  const words = clean.split(" ").filter(Boolean);
  const first = TITLES.test(words[0] ?? "") ? words[1] : words[0];
  // A single letter after a title ("Coach V") is not a name to greet.
  if (!first || first.length < 2 || !/\p{L}|\p{N}/u.test(first)) return null;
  return first;
}

export function greeting(coach: VoiceCoach): string {
  const name = displayName(coach);
  return name ? `hey ${name},` : "hey,";
}

/**
 * The line that says how he found them, used only when he has not written
 * a real one himself.
 *
 * Deliberately plain. A manufactured compliment ("loved your incredible
 * post about forehand technique") is now worse than no personalisation at
 * all, because everyone can spot it. This says the true, boring thing.
 */
export function foundYou(coach: VoiceCoach): string {
  if (coach.entity_type === "club") return "came across your club page";
  if (coach.entity_type === "pro") return "came across your coaching page";
  return "came across your coaching page";
}

/**
 * Message one. Its job is a reply, not a sale.
 *
 * No pitch, no features, no link, no calendar, no claim to understand
 * their problems. Just who he is and permission to continue. The long
 * explanation is message two and only goes out once they say yes, because
 * a full pitch in a first DM is what five thousand founder messages look
 * like.
 *
 * It names what PongLens is rather than saying "something I'm building".
 * "Something" tells a coach nothing and makes them work out whether it is
 * worth their attention; "a match analysis tool" is the category in their
 * own language and costs three words. It does not repeat "table tennis",
 * because the clause before it already said he is a table tennis player
 * and saying it twice in one sentence reads as padding.
 *
 * It closes on feedback rather than on the question alone. The ask is
 * permission, but saying what he wants back from them is what makes the
 * permission worth granting.
 *
 * `note` is something real he noticed and typed himself. It cannot be
 * generated: a specific detail invented by a machine is the exact thing
 * that reads as fake. When it is empty the message simply does without.
 */
export function firstMessage(coach: VoiceCoach, note?: string | null): string {
  const trimmed = (note ?? "").trim().replace(/[.\s]+$/, "");
  const context = trimmed ? trimmed : foundYou(coach);
  const useful =
    coach.entity_type === "club"
      ? "thought it might be useful for the coaches you have there"
      : "thought it might actually be useful for the way you work with students";
  return cleanVoice(
    `${greeting(coach)} i'm a table tennis player and i've been building a ` +
      `match analysis tool called PongLens on my own. ` +
      `${context}, and ${useful}. would you mind if i sent you what i'm ` +
      `building? i'd love to get your feedback on it.`,
  );
}

/**
 * Message two, once they have answered. Now the explanation is welcome,
 * and the link goes with it.
 *
 * It states a hypothesis rather than their pain. He does not yet know
 * whether coaches find this painful, which is the thing he is trying to
 * learn, so claiming to know it would be both untrue and obvious.
 */
export function secondMessage(coach: VoiceCoach): string {
  const audience =
    coach.entity_type === "club"
      ? "a few clubs actually using it with their coaches"
      : "a few coaches actually using it with students";
  const offer =
    coach.entity_type === "club"
      ? "i'd be happy to set it up for a couple of your coaches and their students"
      : "i'd be happy to give you access and let you try it with a couple of students";
  return cleanVoice(
    "basically i've been building PongLens to make match footage more " +
      "useful for competitive players. one part i've been working on " +
      "specifically is for coaches. a student uploads a match, PongLens " +
      "breaks it down point by point, and the coach and student can review " +
      "it together instead of working through a long raw video.\n\n" +
      `i'm trying to get ${audience} rather than guessing what coaches ` +
      `want, so if you're open to it ${offer}, and you can tell me where ` +
      "i'm wrong. ponglens.com",
  );
}

/** One nudge, days later, then leave them alone. */
export function followUpMessage(coach: VoiceCoach): string {
  return cleanVoice(
    `${greeting(coach)} no worries if this isn't for you, just wanted to ` +
      "check you saw the message. happy to send it over if you're curious.",
  );
}

export const MESSAGE_KINDS = [
  { key: "first", label: "First message", hint: "asks permission, no link" },
  { key: "second", label: "After they reply", hint: "the explanation and the link" },
  { key: "followup", label: "Follow up once", hint: "days later, then stop" },
] as const;

export type MessageKind = (typeof MESSAGE_KINDS)[number]["key"];

export function messageFor(
  kind: MessageKind,
  coach: VoiceCoach,
  note?: string | null,
): string {
  if (kind === "second") return secondMessage(coach);
  if (kind === "followup") return followUpMessage(coach);
  return firstMessage(coach, note);
}
