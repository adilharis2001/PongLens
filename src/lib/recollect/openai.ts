import {
  openAIUsageEvents,
  recordUsage,
  type UsageEvent,
} from "../costs/meter.ts";
import { parseSortedPoints, themePoints } from "./sorting.ts";
import {
  RECOLLECT_MODEL,
  RECOLLECT_TOPICS,
  type ClaimedRecollectJob,
  type ExistingRecollectPoint,
  type SortedPoint,
} from "./types.ts";

const TOPIC_LIST = RECOLLECT_TOPICS.map(
  (topic) => `- ${topic.key}: ${topic.label}`,
).join("\n");

const SORT_PROMPT = `You file a table-tennis player's own coaching notes onto a fixed set of topics.

Topics, and the only values allowed for topic_key:
${TOPIC_LIST}

You are filing, not writing. The hard rules:
- Copy each point's text EXACTLY as given. Do not reword, shorten, expand, merge, fix grammar, or change punctuation. The text you return must match the input character for character.
- Never invent a point. Never add advice that was not in the input.
- Assign each point to the single topic it fits best. A point about where to stand is footwork; a point about weight and balance is stance; a point about moving between wings is transitions; a point about what to play when is tactics.
- Drop a point that fits no topic on the list. Returning fewer points is correct.
- Mark duplicate: true when a point says the same thing as one of the existing points already filed under that topic. Same coaching action in the same situation means duplicate, even in different words. Do not mark it duplicate just because it concerns the same stroke.

Return only JSON:
{"points":[{"topic_key":string,"text":string,"theme_name":string,"duplicate":boolean}]}`;

const SPLIT_PROMPT = `You file a table-tennis player's own practice note onto a fixed set of topics.

Topics, and the only values allowed for topic_key:
${TOPIC_LIST}

The note is short and was written by the player for themselves. Split it into the separate things worth remembering, and file each one.

- Each point is one short, self-contained sentence in the player's own words. Stay as close to what they wrote as you can.
- Never invent advice, and never pad. A note holding one idea yields one point.
- Skip logistics, dates, scores, and anything that is not about how to play.
- Drop anything that fits no topic on the list. Returning nothing is correct for a note with no coaching content in it.
- Mark duplicate: true when a point says the same thing as one of the existing points already filed under that topic.

Return only JSON:
{"points":[{"topic_key":string,"text":string,"theme_name":string,"duplicate":boolean}]}`;

type FetchLike = typeof fetch;
type RecordUsageLike = (events: UsageEvent[]) => Promise<void>;

export async function sortRecollectPoints(args: {
  job: ClaimedRecollectJob;
  existing: ExistingRecollectPoint[];
  apiKey?: string;
  fetchImpl?: FetchLike;
  recordUsageImpl?: RecordUsageLike;
}): Promise<SortedPoint[]> {
  const apiKey = args.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OpenAI is not configured");

  const distilled = themePoints(args.job.themes);
  const body = args.job.body?.trim() ?? "";
  if (distilled.length === 0 && !body) return [];

  const fetchImpl = args.fetchImpl ?? fetch;
  const response = await fetchImpl(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: RECOLLECT_MODEL,
        reasoning_effort: "low",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: distilled.length > 0 ? SORT_PROMPT : SPLIT_PROMPT,
          },
          {
            role: "user",
            content: JSON.stringify(
              distilled.length > 0
                ? {
                    themes: args.job.themes,
                    existing_points: args.existing,
                  }
                : { note: body, existing_points: args.existing },
            ),
          },
        ],
      }),
      // One short call over already-distilled text. Nothing here reads a raw
      // transcript, which is what used to push these past the route budget.
      signal: AbortSignal.timeout(45_000),
    },
  );
  if (!response.ok) {
    throw new Error(`OpenAI Recollect request failed (${response.status})`);
  }

  const data = await response.json();
  await (args.recordUsageImpl ?? recordUsage)(
    openAIUsageEvents({
      usage: data?.usage,
      model: RECOLLECT_MODEL,
      operation: "recollect_topics",
      idempotencyKey: `openai:${String(
        data?.id ?? crypto.randomUUID(),
      )}:recollect-topics`,
    }),
  );

  let content: unknown;
  try {
    content = JSON.parse(String(data?.choices?.[0]?.message?.content ?? ""));
  } catch {
    throw new Error("OpenAI Recollect response was invalid");
  }
  return parseSortedPoints(content, distilled);
}
