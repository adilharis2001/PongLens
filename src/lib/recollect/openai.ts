import {
  openAIUsageEvents,
  recordUsage,
  type UsageEvent,
} from "../costs/meter.ts";
import {
  parseExtractionResult,
  parseValidationResult,
} from "./candidates.ts";
import {
  RECOLLECT_MODEL,
  type BufferedCandidate,
  type ExistingRecollectItem,
  type ExtractedCandidate,
  type RecollectSegment,
  type ValidatedCandidate,
} from "./types.ts";

const EXTRACTION_PROMPT = `You extract genuinely useful table-tennis reminders from one segment of a player's lesson or practice note.

Return an empty candidates array when there is nothing specific and valuable to remember. Incidental details (such as paddle color), scheduling, payment, travel, small talk, generic praise, and vague observations are not reminders.

Allowed categories: technique, tactics, positioning, serve_receive, practice, mental.

Rules:
- Use only guidance supported by this segment. Never add outside advice.
- The source may be noisy speech-to-text. Correct an obvious transcription
  slip only when the intended table-tennis meaning is unambiguous; otherwise
  omit the candidate.
- Every candidate needs a short mental-recall question and a short faithful
  cue that read as clear, natural, standalone language.
- Include a verbatim evidence fragment copied exactly from the segment.
- Prefer situation and outcome cues over unnecessary body mechanics.
- Return at most three candidates. Fewer is better.
- Give every candidate a unique short id.

Return only JSON:
{"candidates":[{"id":string,"question":string,"cue":string,"topic_key":string,"category":string,"evidence":string,"importance":number}]}`;

const VALIDATION_PROMPT = `You are the conservative quality gate for private sports reminders.

Review only the compact proposed candidates. Reject anything vague, incidental, unsupported, repetitive without value, or not worth interrupting a player to recall. Also reject speech-to-text garbling, awkward or ambiguous phrasing, and any question or cue that does not read as clear, natural, standalone guidance. Do not repair a weak candidate in this pass. A zero-result answer is correct when quality is weak.

Existing reminders are supplied only to identify genuine duplicates. Mark duplicate only when the condition and coaching action mean the same thing; otherwise keep them separate.

Return only JSON:
{"decisions":[{"candidate_id":string,"decision":"accept"|"duplicate"|"reject","duplicate_of":string|null}]}`;

type FetchLike = typeof fetch;
type RecordUsageLike = (events: UsageEvent[]) => Promise<void>;

async function callOpenAI(args: {
  apiKey: string;
  system: string;
  user: string;
  fetchImpl: FetchLike;
}): Promise<{ id: string; usage: unknown; content: unknown }> {
  const response = await args.fetchImpl(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: RECOLLECT_MODEL,
        reasoning_effort: "low",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: args.system },
          { role: "user", content: args.user },
        ],
      }),
      signal: AbortSignal.timeout(50_000),
    },
  );
  if (!response.ok) {
    throw new Error(`OpenAI Recollect request failed (${response.status})`);
  }
  const data = await response.json();
  const raw = data?.choices?.[0]?.message?.content;
  let content: unknown;
  try {
    content = JSON.parse(String(raw ?? ""));
  } catch {
    throw new Error("OpenAI Recollect response was invalid");
  }
  return { id: String(data?.id ?? crypto.randomUUID()), usage: data?.usage, content };
}

export async function extractRecollectCandidates(args: {
  segment: RecollectSegment;
  apiKey?: string;
  fetchImpl?: FetchLike;
  recordUsageImpl?: RecordUsageLike;
}): Promise<ExtractedCandidate[]> {
  const apiKey = args.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OpenAI is not configured");
  const result = await callOpenAI({
    apiKey,
    system: EXTRACTION_PROMPT,
    user: args.segment.text,
    fetchImpl: args.fetchImpl ?? fetch,
  });
  await (args.recordUsageImpl ?? recordUsage)(
    openAIUsageEvents({
      usage: result.usage,
      model: RECOLLECT_MODEL,
      operation: "recollect_extraction",
      idempotencyKey: `openai:${result.id}:recollect-extraction:${args.segment.index}`,
    }),
  );
  return parseExtractionResult(result.content, args.segment);
}

export async function validateRecollectCandidates(args: {
  candidates: BufferedCandidate[];
  existing: ExistingRecollectItem[];
  apiKey?: string;
  fetchImpl?: FetchLike;
  recordUsageImpl?: RecordUsageLike;
}): Promise<ValidatedCandidate[]> {
  if (args.candidates.length === 0) return [];
  const apiKey = args.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OpenAI is not configured");
  const result = await callOpenAI({
    apiKey,
    system: VALIDATION_PROMPT,
    user: JSON.stringify({
      candidates: args.candidates,
      existing_reminders: args.existing,
    }),
    fetchImpl: args.fetchImpl ?? fetch,
  });
  await (args.recordUsageImpl ?? recordUsage)(
    openAIUsageEvents({
      usage: result.usage,
      model: RECOLLECT_MODEL,
      operation: "recollect_validation",
      idempotencyKey: `openai:${result.id}:recollect-validation`,
    }),
  );
  return parseValidationResult(
    result.content,
    args.candidates,
    new Set(args.existing.map((item) => item.id)),
  );
}
