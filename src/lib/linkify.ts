/**
 * Turning a web address inside plain text into something you can tap.
 *
 * Journal and coach entries are stored as plain text and always will be:
 * rendering them as markdown would let the visible words of a link say
 * one thing while the destination says another, and a student trusts
 * their coach. So links are found in the text and built from what was
 * actually written — what you see is always where you go.
 *
 * The rule is GitHub's extended autolink specification
 * (https://github.github.com/gfm/#autolinks-extension-) rather than
 * anything hand-rolled, because the cases that break quietly are the
 * boring ones: a full stop at the end of a sentence, a link written
 * inside brackets, a query string that ends in something entity-shaped.
 * A written-down rule already answers all three, and it is what people
 * are used to from every other product of this class.
 *
 * The deliberate consequence: a bare `youtube.com/watch` with no `www.`
 * and no scheme does NOT become a link. The looser rule starts
 * underlining ordinary sentences that happen to contain a dot, and a
 * share sheet always hands over the full address anyway.
 *
 * `Core/Linkify.swift` is the same rule in Swift, and both are checked
 * against `ios/Tests/fixtures/linkify-cases.json` so the two platforms
 * cannot drift.
 */

export type LinkSegment =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; href: string };

/** GFM: an autolink may only start at the beginning, after whitespace, or
 *  after one of these delimiters. */
const OPENERS = new Set([" ", "\t", "\n", "\r", "\f", "\v", "*", "_", "~", "("]);

/** Trailing characters that are punctuation of the sentence, not the link. */
const TRAILING = new Set(["?", "!", ".", ",", ":", "*", "_", "~"]);

const CANDIDATE =
  /(?:https?:\/\/|www\.)[^\s<]*|[A-Za-z0-9._+-]+@[A-Za-z0-9._-]+/gi;

/**
 * Segments of a domain: alphanumerics, hyphens and underscores, at least
 * one dot, and no underscore in either of the last two segments (which is
 * what stops `foo_bar.baz` from reading as a host).
 */
function validDomain(host: string): boolean {
  const segments = host.split(".");
  if (segments.length < 2) return false;
  for (const segment of segments) {
    if (!/^[A-Za-z0-9_-]+$/.test(segment)) return false;
  }
  return !segments.slice(-2).some((segment) => segment.includes("_"));
}

/** The host part of a candidate, with any port dropped before checking. */
function hostOf(candidate: string): string | null {
  const afterScheme = candidate.replace(/^https?:\/\//i, "");
  const host = afterScheme.split(/[/?#]/, 1)[0] ?? "";
  const [name] = host.split(":");
  return name || null;
}

/**
 * Give back the sentence's punctuation. Three passes, repeated until the
 * address stops shrinking, because they interact: `(www.a.com/b).` needs
 * the full stop gone before the bracket rule can see the bracket.
 */
function trimTrailing(link: string): string {
  let out = link;
  for (;;) {
    const before = out;

    while (out.length > 0 && TRAILING.has(out[out.length - 1])) {
      out = out.slice(0, -1);
    }

    // A closing bracket belongs to the link only if its opener is inside
    // the link too, so a link written inside parentheses stays whole.
    while (out.endsWith(")")) {
      const opens = (out.match(/\(/g) ?? []).length;
      const closes = (out.match(/\)/g) ?? []).length;
      if (closes <= opens) break;
      out = out.slice(0, -1);
    }

    // A trailing `&nbsp;`-shaped run is an entity in the prose around the
    // link, not part of the address.
    if (out.endsWith(";")) {
      const amp = out.lastIndexOf("&");
      if (amp >= 0 && /^[A-Za-z0-9]+$/.test(out.slice(amp + 1, -1))) {
        out = out.slice(0, amp);
      }
    }

    if (out === before) return out;
  }
}

/** Emails carry no path, so only their own tail characters come off. */
function trimEmail(link: string): string {
  let out = link;
  while (out.length > 0 && ".-_".includes(out[out.length - 1])) {
    out = out.slice(0, -1);
  }
  return out;
}

/**
 * Split text into runs of plain words and runs that are addresses. Text
 * with no address in it comes back as a single text segment, which is the
 * common case and costs nothing to render.
 */
export function linkify(text: string): LinkSegment[] {
  const out: LinkSegment[] = [];
  let cursor = 0;

  CANDIDATE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CANDIDATE.exec(text)) !== null) {
    const start = match.index;
    const before = start === 0 ? " " : text[start - 1];
    if (!OPENERS.has(before)) continue;

    const isEmail = !/^(?:https?:\/\/|www\.)/i.test(match[0]);
    const link = isEmail ? trimEmail(match[0]) : trimTrailing(match[0]);
    if (!link) continue;

    let href: string | null = null;
    if (isEmail) {
      const at = link.indexOf("@");
      const local = link.slice(0, at);
      const host = link.slice(at + 1);
      if (local && validDomain(host)) href = `mailto:${link}`;
    } else {
      const host = hostOf(link);
      // `https://` on a bare `www.` address, not `http://`: every
      // destination worth sending someone to serves it, and the redirect
      // a plain http link relies on is a round trip we can skip.
      if (host && validDomain(host)) {
        href = /^https?:\/\//i.test(link) ? link : `https://${link}`;
      }
    }
    if (!href) continue;

    if (start > cursor) {
      out.push({ kind: "text", text: text.slice(cursor, start) });
    }
    out.push({ kind: "link", text: link, href });
    cursor = start + link.length;
    CANDIDATE.lastIndex = cursor;
  }

  if (cursor < text.length) {
    out.push({ kind: "text", text: text.slice(cursor) });
  }
  return out;
}

/** Whether the text carries an address at all, without building segments. */
export function hasLink(text: string): boolean {
  return linkify(text).some((s) => s.kind === "link");
}
