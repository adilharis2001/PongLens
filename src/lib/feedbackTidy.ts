/**
 * The tidy step behind /api/feedback/assist, kept free of Next and Supabase
 * so the prompt can be run against real messages from a script
 * (scripts/feedback-tidy-check.mjs) and the parser tested with node --test.
 *
 * One message in, one or more board posts out. Each post has a short title
 * and a one-sentence summary in clean English; the author's own words stay
 * on the row as the body and are never rewritten.
 */

// Chosen on the sample set in scripts/feedback-tidy-check.mjs (2026-09-22):
// nano only ever wrote titles, gpt-5-mini kept adding screens and remedies
// the author never mentioned, gpt-5 was as good as Luna but has no rate in
// cost_rates (its calls would price at zero) and took three times as long.
export const TIDY_MODEL = "gpt-5.6-luna";

/** More than this and a message is a list, not feedback; the rest stay in
 *  the original text every part carries. Mirrors the RPC's limit. */
export const MAX_PARTS = 5;

// Compact app context so the model can tell bugs from ideas from
// account/support issues, and name screens the way the app does.
const APP_CONTEXT = `PongLens: match analysis for table tennis players. Users upload a match video and get:
- a cut of the match with the dead time between points removed ("the cut video"); the uploaded file is "the original video"
- the match broken into per-point clips, listed on the Points screen
- per-point notes (text and voice) and a scorecard: who won each point and how it ended
- "Score the Match": a screen for scoring the match point by point with one tap per point
- serve rotation ("Who served first?") decides who served each point
- placement maps showing where serves landed
- coach sharing, public share links, starred points and highlight reels
- account page: storage, processing minutes, share links`;

export const TIDY_SYSTEM_PROMPT = `You prepare player feedback for PongLens's public feedback board, where other players read and upvote it.

${APP_CONTEXT}

Turn one message into one or more posts. Return:

- posts: one entry per separate request or problem. Split when the message asks for things that could be built or fixed independently (a numbered list of three requests is three posts). Do not split one request into its steps, and do not split a problem from its context. Most messages are one post. Always at least one, even for a vague message (title it from its own words). At most ${MAX_PARTS}.
  Each post has:
  - title: names the request or problem, 3 to 7 words, sentence case, no trailing period. Plain words a player would use ("Undo a deleted point"), not jargon or marketing.
  - summary: ONE sentence, 10 to 25 words, that tells someone new to the board what is being asked for or what goes wrong, and why it matters to the player when the message says so. Rewrite in your own clean words; never copy the author's phrasing, never use "I", "we", "you" or "the user", and never address PongLens. Name the part of the app when the message makes it clear (for example "while scoring a match" or "in the original video"). Do not add anything the author did not say or clearly imply: no platforms, devices, screens, reasons or numbers of your own, and no remarks about what is unclear. If the author is unsure whether something is a bug, keep that uncertainty.
  - type: "bug" (something broken or wrong), "idea" (a new capability), "improvement" (an existing thing should work better), or "private".
  Always write title and summary in English, whatever language the message is in.
- visibility: "board" for product feedback other players could upvote; "private" when the message is about the author's own account, trouble getting into their own account, billing, storage or minutes requests, contains personal details, or only makes sense for this one person. If any part is private, the whole message is private.
- questions: almost always []. Ask one question only when the message is so vague that no title naming a part of the app can be written for it (for example "it did not work" or "it did not remove anything"). Never when there is one clear request or problem, never to ask for preferences or priorities, never when there is more than one post. Under 15 words.
- similar_item_id: only when there is exactly one post and it is clearly the same request as one of the existing board items listed, that item's id. Otherwise null. Related but different is null.`;

export const TIDY_RESPONSE_SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "feedback_tidy",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        posts: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string" },
              summary: { type: "string" },
              type: { type: "string", enum: ["bug", "idea", "improvement", "private"] },
            },
            required: ["title", "summary", "type"],
          },
        },
        visibility: { type: "string", enum: ["board", "private"] },
        questions: { type: "array", items: { type: "string" } },
        similar_item_id: { type: ["string", "null"] },
      },
      required: ["posts", "visibility", "questions", "similar_item_id"],
    },
  },
} as const;

export type TidyPart = {
  title: string;
  summary: string;
  type: "bug" | "idea" | "improvement" | "private";
};

export type Tidy = {
  parts: TidyPart[];
  visibility: "board" | "private";
  questions: string[];
  similarItemId: string | null;
};

const TYPES = new Set(["bug", "idea", "improvement", "private"]);

export function tidyUserMessage(
  body: string,
  known: { id: string; title: string }[],
): string {
  return `Message:\n"""\n${body.slice(0, 4000)}\n"""\n\nExisting board items:\n${
    known.length ? known.map((i) => `- ${i.id}: ${i.title}`).join("\n") : "(none)"
  }`;
}

function clean(s: unknown, max: number): string {
  return String(s ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * Validate what the model returned. Anything missing or malformed falls
 * back to fewer parts rather than failing: a part without a title is
 * dropped, and a result with no usable part is null, which leaves the post
 * exactly as the author sent it.
 */
export function parseTidy(raw: unknown, knownIds: string[]): Tidy | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const posts = Array.isArray(r.posts) ? r.posts : [];
  const parts: TidyPart[] = [];
  for (const p of posts) {
    if (!p || typeof p !== "object") continue;
    const q = p as Record<string, unknown>;
    const title = clean(q.title, 120).replace(/[.!]+$/, "");
    if (!title) continue;
    const summary = clean(q.summary, 400);
    const type = TYPES.has(String(q.type)) ? (String(q.type) as TidyPart["type"]) : "idea";
    parts.push({ title, summary, type });
    if (parts.length === MAX_PARTS) break;
  }
  if (parts.length === 0) return null;
  const visibility = r.visibility === "private" ? "private" : "board";
  const questions =
    parts.length === 1 && Array.isArray(r.questions)
      ? r.questions.map((x) => String(x).trim()).filter(Boolean).slice(0, 2)
      : [];
  const similar = typeof r.similar_item_id === "string" ? r.similar_item_id : null;
  return {
    parts,
    visibility,
    questions,
    // Only trust an id we actually offered, and only for a single post.
    similarItemId: parts.length === 1 && similar && knownIds.includes(similar) ? similar : null,
  };
}
