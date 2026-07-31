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

The question is the whole point, so it has strict rules:
- It must leave something to recall. Never state the cue, or any part of it,
  inside the question.
- Never ask a yes/no question. Start with What, Where, When, Which, How, or
  Why.
- Name the situation, then ask what to do in it. "What should you do with
  your swing when the ball after your opener sits low?" is right.
  "Can I shorten my swing on the next ball?" is wrong, because it answers
  itself.
- A player who has forgotten the cue must not be able to guess it from the
  question alone.

Set importance honestly, and use the whole range:
- 0.9-1.0: the coach repeated it, or called it the main thing to fix.
- 0.6-0.8: a clear, specific one-time correction.
- below 0.5: not worth interrupting the player. Return no candidate instead.

Return only JSON:
{"candidates":[{"id":string,"question":string,"cue":string,"topic_key":string,"category":string,"evidence":string,"importance":number}]}`;

const VALIDATION_PROMPT = `You are the conservative quality gate for private sports reminders.

Every candidate carries "evidence": the exact words from the source it was built from. That source is speech-to-text of a live lesson and is often garbled. Read the evidence first, then the cue.

Reject the candidate when:
- the evidence is too garbled to be sure what the coach meant, even if the cue itself reads cleanly. A tidy cue built out of noise is the failure this gate exists to catch;
- the cue states something the evidence does not actually say, or adds specifics the evidence does not contain;
- the question gives away its own answer, is answerable yes/no, or could be answered without remembering anything;
- the point is vague, incidental, or not worth interrupting a player to recall;
- the question or cue does not read as clear, natural, standalone guidance.

Do not repair a weak candidate in this pass. A zero-result answer is correct when quality is weak.

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
        // Both passes are judgement calls over garbled speech, and both run
        // at most a handful of times per saved entry. Low effort was cheap
        // and produced cue-shaped text out of noise.
        reasoning_effort: "medium",
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
      candidates: args.candidates.map((candidate) => ({
        id: candidate.id,
        question: candidate.question,
        cue: candidate.cue,
        topic_key: candidate.topicKey,
        category: candidate.category,
        // The gate cannot judge faithfulness without the words the cue came
        // from. Missing evidence means an older buffer, not a clean source.
        evidence: candidate.evidence ?? null,
      })),
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
