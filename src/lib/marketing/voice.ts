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

/**
 * The opener is the only part that changes per person, and it changes for
 * an honest reason: claiming to have followed someone for a while is a lie
 * to a coach with two thousand followers, and they will know it.
 */
export const FAMOUS_FOLLOWERS = 20_000;

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

export function opener(coach: VoiceCoach): string {
  const name = displayName(coach);
  const greeting = name ? `hey ${name},` : "hey,";
  if (coach.entity_type === "club") {
    return `${greeting} came across your page looking through table tennis clubs and academies.`;
  }
  if (coach.entity_type === "pro") {
    return `${greeting} came across your coaching page.`;
  }
  if (coach.followers >= FAMOUS_FOLLOWERS) {
    return `${greeting} i came across your channel a little while ago and have been following your breakdowns since.`;
  }
  return `${greeting} came across your account looking for table tennis coaches and went through some of your posts.`;
}

const CREDENTIALS =
  "i'm a competitive table tennis player, been playing over five years on " +
  "the side, and i'm also a software engineer, so one of the things i've " +
  "been really into is building high quality table tennis software that " +
  "actually helps players.";

const WHAT_IT_IS =
  "i started building PongLens, a collaborative workspace where players " +
  "and coaches work on match footage together. i built a few visual models " +
  "that cut the dead space out between points, so a player can score a " +
  "match in about ten minutes rather than a whole evening, and it gives " +
  "you heat maps and placement maps to study off.";

const ASKS: Record<"coach" | "club" | "pro", string> = {
  coach:
    "i've also tried to make it as easy as possible for coaches and " +
    "students to work through a match when they aren't in the same room, " +
    "and there's a way for coaches to earn from the professional reviews " +
    "they do. i'd be thrilled if you had a look and told me whether it's a " +
    "fit for anything you do with your students, honest feedback is what " +
    "i'm after most. no pressure, i know this is a cold message and you " +
    "probably get a few of them.",
  club:
    "what i wanted to ask about is a club setup, your members on it " +
    "uploading their own matches and sharing them straight through to your " +
    "coaches. that part isn't built yet, so i'd rather build it around what " +
    "a club like yours actually needs than guess at it. i'd be thrilled if " +
    "you had a look and told me whether it's something you could use, " +
    "honest feedback is what i'm after most. no pressure, and i know this " +
    "is a cold message.",
  // No earning line: a well known player is not looking for review income,
  // and offering it reads as not knowing who you are writing to.
  pro:
    "you've been round this sport a lot longer than i have, so what i'd " +
    "really value is your read on whether the analysis part holds up or " +
    "whether it's missing something obvious. i'd be thrilled if you had a " +
    "look. no pressure, and i know this is a cold message.",
};

/**
 * Two paragraphs: who you are, then what it is and what you want. No link,
 * because offering to send one gives them something to say yes to and a
 * link is the thing that gets a first message filtered.
 */
export function draftMessage(coach: VoiceCoach): string {
  const kind = coach.entity_type === "club" || coach.entity_type === "pro"
    ? coach.entity_type
    : "coach";
  const first = `${opener(coach)} ${CREDENTIALS}`;
  const second = `${WHAT_IT_IS} ${ASKS[kind]}`;
  return cleanVoice(`${first}\n\n${second}`);
}
