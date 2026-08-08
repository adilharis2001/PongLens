/**
 * The tells, removed by hand after the fact.
 *
 * A model asked to tidy a coach's writing will still reach for the house
 * style it was trained on, and a coach's review that reads like a chatbot
 * wrote it is worth less than the rough version they typed. Prompting
 * against it helps and does not hold, so nothing reaches the coach without
 * passing through here first.
 *
 * Two families, both chosen because they are unmistakable and neither is
 * something a table tennis coach types:
 *
 *   1. The em dash, the en dash used as punctuation, and the double
 *      hyphen. The project bans them in its own copy for the same reason.
 *   2. The "not X, it's Y" sentence. It reads as insight and carries none;
 *      keeping only the affirmative half loses nothing and sounds human.
 *
 * Pure string work, so it is tested rather than trusted.
 */

/** A dash used as punctuation becomes a comma. Hyphenated words survive. */
function dashes(text: string): string {
  return (
    text
      // " — " and "—" between words, plus the typed "--" that stands in
      // for one. A hyphen inside a word (cross-court, three-ball) has no
      // spaces around it and is left alone.
      .replace(/\s*[—–]\s*/g, ", ")
      .replace(/(\S)\s*--\s*(\S)/g, "$1, $2")
      // ", ," from a dash next to existing punctuation.
      .replace(/,\s*,/g, ",")
      .replace(/\s+,/g, ",")
      .replace(/,\s*([.!?])/g, "$1")
  );
}

/**
 * "It's not a technique problem, it's a footwork problem."
 *   -> "It's a footwork problem."
 *
 * Only fires when the affirmative half is actually there: the pattern
 * needs a subject, a negation, a comma, and a restatement. A plain "It is
 * not a footwork problem." is a real thing a coach might write and is left
 * exactly as typed.
 */
function negations(text: string): string {
  // Built from parts because the contractions are the whole difficulty:
  // "it's not", "this isn't", "that is not" and "there wasn't" are the
  // same sentence wearing four different hats.
  const SUBJ = "(?:it|this|that|there)";
  const NEG =
    "(?:\\s*(?:'|\u2019)s\\s+not|\\s+is\\s+not|\\s+isn(?:'|\u2019)t|\\s+was\\s+not|" +
    "\\s+wasn(?:'|\u2019)t|\\s+are\\s+not|\\s+aren(?:'|\u2019)t)";
  const QUAL = "(?:\\s+(?:just|only|simply|merely|really|quite))*";
  const COP = "(?:\\s*(?:'|\u2019)s|\\s+is|\\s+was|\\s+are)";
  const pattern = new RegExp(
    `\\b${SUBJ}${NEG}${QUAL}\\s+[^,.;!?]{1,90},\\s*(?:but\\s+)?(${SUBJ})${COP}\\s+`,
    "gi",
  );

  let out = text.replace(pattern, (_m, second: string) => {
    const s = second.toLowerCase();
    return `${s.charAt(0).toUpperCase()}${s.slice(1)} is `;
  });

  // "not only X but also Y" -> "Y": the same move without the pronouns.
  out = out.replace(
    /\bnot\s+only\s+[^,.;!?]{1,90},?\s+but\s+(?:also\s+)?/gi,
    "",
  );
  return out;
}

/** Collapse the whitespace a substitution can leave behind. */
function tidyWhitespace(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Everything above, in order. Safe to run twice. */
export function scrub(text: string): string {
  if (!text) return text;
  return tidyWhitespace(negations(dashes(text)));
}

/**
 * What the scrub would still object to. Used by the tests and by the
 * route's own assertion, so a future model quirk fails loudly rather than
 * shipping to a student.
 */
export function tells(text: string): string[] {
  const found: string[] = [];
  if (/[—–]/.test(text)) found.push("dash");
  if (/\S\s*--\s*\S/.test(text)) found.push("double hyphen");
  if (
    /\b(it|this|that)\s*(?:'s|’s| is)?\s+not\s+[^,.;!?]{1,90},\s*(?:but\s+)?(it|this|that)\s*(?:'s|’s| is)/i.test(
      text,
    )
  ) {
    found.push("negation");
  }
  if (/\bnot\s+only\s+[^,.;!?]{1,90},?\s+but\s+/i.test(text)) {
    found.push("not only");
  }
  return found;
}
