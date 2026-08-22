/**
 * Turning whatever a tester has in the clipboard into a match id.
 *
 * The field started life as a bare uuid box with the hint "it is in the
 * address bar". The first report filed against a video came back as
 * "Could not save that. Try again." — Postgres had refused a non-uuid and
 * the form said nothing about which field or why, so trying again was
 * never going to work. The value pasted was an opaque token from a
 * network request, which is a perfectly reasonable thing to reach for if
 * you do not already know what a match id looks like.
 *
 * So: accept every shape a real address gives you, name the two wrong
 * things that look right, and say what to do instead.
 */

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A uuid anywhere in a /match/ path, with or without an origin. */
const MATCH_PATH_RE =
  /\/match\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

/** A share link. It resolves to a match, but it does not carry the id. */
const SHARE_PATH_RE = /\/s\/[A-Za-z0-9_-]{8,}/;

export type MatchRef =
  | { ok: true; id: string | null }
  | { ok: false; message: string };

/**
 * Empty means "not about a match", which is the honest answer for a bug
 * in upload or sign in and should never be an error.
 */
export function parseMatchRef(raw: string): MatchRef {
  const text = raw.trim();
  if (!text) return { ok: true, id: null };

  if (UUID_RE.test(text)) return { ok: true, id: text.toLowerCase() };

  const inPath = text.match(MATCH_PATH_RE);
  if (inPath) return { ok: true, id: inPath[1].toLowerCase() };

  if (SHARE_PATH_RE.test(text)) {
    return {
      ok: false,
      message:
        "A share link does not carry the match id. Open the match while " +
        "signed in and copy that address instead, or pick it from the list.",
    };
  }

  return {
    ok: false,
    message:
      "That is not a match id. Pick the match from the list above, or open " +
      "the match and paste its whole address.",
  };
}

/**
 * How a match reads in a picker. Date first because that is what a tester
 * remembers about the file they just uploaded; the opponent second because
 * plenty of matches have no name on them at all.
 */
export function matchOptionLabel(m: {
  played_at: string | null;
  created_at: string;
  opponent_name: string | null;
  status: string | null;
}): string {
  const when = m.played_at || m.created_at;
  const date = when
    ? new Date(when).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : "";
  const who = (m.opponent_name ?? "").trim();
  const head = [date, who].filter(Boolean).join(" · ") || "Match";
  return m.status && m.status !== "ready" ? `${head} (${m.status})` : head;
}
