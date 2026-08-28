import type { CostUnit } from "./types.ts";

export interface UsageEvent {
  occurredAt?: string;
  provider: string;
  service: string;
  operation: string;
  sku: string;
  quantity: number;
  unit: CostUnit;
  source?: "internal" | "provider" | "backfill" | "assumed";
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

interface NormalizedUsageEvent extends Omit<UsageEvent, "metadata"> {
  metadata: Record<string, string | number | boolean>;
}

export interface OpenAIUsageArgs {
  usage: unknown;
  model: string;
  operation: string;
  idempotencyKey: string;
  occurredAt?: string;
  source?: UsageEvent["source"];
}

export interface DeepgramUsageArgs {
  response: unknown;
  operation: string;
  occurredAt?: string;
  /**
   * Whether the request carried keyterm prompts. Deepgram bills those as a
   * per-minute add-on on top of the model, so a request with them costs more
   * than one without and the ledger has to be able to tell them apart.
   */
  keyterms?: boolean;
}

type UsageTransport = (events: NormalizedUsageEvent[]) => Promise<void>;

const ALLOWED_METADATA = new Set([
  "confidence",
  "storage_class",
  "stage",
  "request_count",
  "cached_tokens",
  "status",
  "billing_mode",
]);

let warnedMissingConfig = false;

function object(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function positive(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function boundedText(value: string, max: number): string {
  return value.trim().slice(0, max);
}

export function normalizeUsageEvent(
  event: UsageEvent,
): NormalizedUsageEvent | null {
  const provider = boundedText(event.provider, 80);
  const service = boundedText(event.service, 100);
  const operation = boundedText(event.operation, 120);
  const sku = boundedText(event.sku, 120);
  const idempotencyKey = boundedText(event.idempotencyKey, 240);
  const quantity = positive(event.quantity);
  if (
    !provider ||
    !service ||
    !operation ||
    !sku ||
    !idempotencyKey ||
    quantity === 0
  ) {
    return null;
  }

  const metadata: Record<string, string | number | boolean> = {};
  for (const [key, raw] of Object.entries(event.metadata ?? {})) {
    if (!ALLOWED_METADATA.has(key)) continue;
    if (
      typeof raw === "string" ||
      typeof raw === "boolean" ||
      (typeof raw === "number" && Number.isFinite(raw))
    ) {
      metadata[key] = raw;
    }
  }

  return {
    occurredAt: event.occurredAt,
    provider,
    service,
    operation,
    sku,
    quantity,
    unit: event.unit,
    source: event.source ?? "internal",
    idempotencyKey,
    metadata,
  };
}

// OpenAI reports cache HITS in a usage payload and says nothing about what
// the misses cost. On the GPT-5.6 family a miss above the caching floor is
// billed at 1.25x input on a separate "cache writes" line, so pricing every
// miss as plain input understates the bill by a quarter on exactly the
// prompts large enough to be cached. Measured against the organization
// billing API for 2026-08-01..16, gpt-5.6-luna billed $0.122 of cache writes
// against $0.007 of plain input: nearly every miss on a real prompt is a
// write. gpt-5-mini and gpt-5-nano carry no write premium and stay on
// input_token. Mirrors _charges_for_cache_writes in worker/cost_meter.py.
const CACHE_WRITE_SKU_PREFIXES = ["gpt-5.6-"];
const CACHE_WRITE_MIN_PROMPT_TOKENS = 1024;

function chargesForCacheWrites(model: string, totalInput: number): boolean {
  const sku = String(model ?? "").trim().toLowerCase();
  return (
    totalInput >= CACHE_WRITE_MIN_PROMPT_TOKENS &&
    CACHE_WRITE_SKU_PREFIXES.some((prefix) => sku.startsWith(prefix))
  );
}

export function openAIUsageEvents(args: OpenAIUsageArgs): UsageEvent[] {
  const usage = object(args.usage);
  const details = object(
    usage.prompt_tokens_details ?? usage.input_tokens_details,
  );
  const totalInput = positive(usage.prompt_tokens ?? usage.input_tokens);
  const cachedInput = Math.min(
    totalInput,
    positive(details.cached_tokens),
  );
  const noncachedInput = totalInput - cachedInput;
  const output = positive(
    usage.completion_tokens ?? usage.output_tokens,
  );
  const base = {
    occurredAt: args.occurredAt,
    provider: "OpenAI",
    service: "AI",
    operation: args.operation,
    sku: args.model,
    source: args.source,
  };
  const candidates: UsageEvent[] = [
    {
      ...base,
      quantity: noncachedInput,
      unit: chargesForCacheWrites(args.model, totalInput)
        ? "cache_write_token"
        : "input_token",
      idempotencyKey: `${args.idempotencyKey}:input`,
    },
    {
      ...base,
      quantity: cachedInput,
      unit: "cached_input_token",
      idempotencyKey: `${args.idempotencyKey}:cached-input`,
    },
    {
      ...base,
      quantity: output,
      unit: "output_token",
      idempotencyKey: `${args.idempotencyKey}:output`,
    },
  ];
  return candidates.filter((event) => event.quantity > 0);
}

/**
 * Keyterm prompting is priced as its own line rather than folded into a
 * higher nova-3 rate. Deepgram bills it that way ($0.0013/min on top of the
 * $0.0077/min model), and so should the dashboard: the base rate stays equal
 * to Deepgram's published price for the model, and what the table-tennis
 * vocabulary costs is a number someone can actually read, rather than a
 * silent 17% on the transcription line.
 */
const DEEPGRAM_KEYTERM_SKU = "nova-3-keyterm";

export function deepgramUsageEvents(args: DeepgramUsageArgs): UsageEvent[] {
  const response = object(args.response);
  const metadata = object(response.metadata);
  const duration = positive(metadata.duration);
  const requestId = boundedText(
    String(metadata.request_id ?? crypto.randomUUID()),
    120,
  );
  const operationKey = args.operation
    .replace(/_transcription$/, "")
    .replaceAll("_", "-");
  const base = {
    occurredAt: args.occurredAt,
    provider: "Deepgram",
    service: "Transcription",
    operation: args.operation,
    sku: "nova-3",
  };
  if (duration > 0) {
    const events: UsageEvent[] = [
      {
        ...base,
        quantity: duration,
        unit: "audio_second",
        idempotencyKey: `deepgram:${requestId}:${operationKey}:audio`,
      },
    ];
    // The add-on is billed over the same seconds as the model, so it rides
    // the same duration under its own sku.
    if (args.keyterms) {
      events.push({
        ...base,
        sku: DEEPGRAM_KEYTERM_SKU,
        quantity: duration,
        unit: "audio_second",
        idempotencyKey: `deepgram:${requestId}:${operationKey}:keyterm`,
      });
    }
    return events;
  }
  // No duration means Deepgram told us nothing to price, so this branch
  // counts requests rather than inventing seconds. The keyterm add-on is
  // per-minute too, so there is nothing to bill it against either; adding a
  // second unpriced row would only make the same gap look like two.
  return [
    {
      ...base,
      quantity: 1,
      unit: "request",
      source: "assumed",
      idempotencyKey: `deepgram:${requestId}:${operationKey}:request`,
      metadata: { confidence: "duration_missing" },
    },
  ];
}

/**
 * One sent email, matching the worker's Resend accounting (cost_meter.py)
 * so both senders roll up under the same provider and sku.
 *
 * Resend's variable rate is seeded at $0 with the plan carried as a fixed
 * cost item, so this does not move the total today. It is metered anyway:
 * the review lifecycle is the app's chattiest email path by far, and
 * volume is the number that decides when the plan needs upgrading — which
 * is a cost question the dashboard should be able to answer before the
 * bill does.
 *
 * `messageId` is Resend's own id, so a retried send records once.
 */
export function resendEmailEvent(args: {
  messageId: string;
  operation: string;
  recipients?: number;
  occurredAt?: string;
}): UsageEvent | null {
  const recipients = Math.max(0, Math.round(args.recipients ?? 1));
  if (!args.messageId || recipients === 0) return null;
  return {
    occurredAt: args.occurredAt,
    provider: "Resend",
    service: "Email",
    operation: args.operation,
    sku: "resend-email",
    quantity: recipients,
    unit: "email_recipient",
    idempotencyKey: `resend:${args.messageId}`,
  };
}

async function supabaseTransport(
  events: NormalizedUsageEvent[],
): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    if (!warnedMissingConfig) {
      warnedMissingConfig = true;
      console.warn(
        "cost meter disabled: SUPABASE_SERVICE_ROLE_KEY is not configured",
      );
    }
    return;
  }
  const response = await fetch(`${url}/rest/v1/rpc/record_cost_usage`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_events: events.map((event) => ({
        occurred_at: event.occurredAt,
        provider: event.provider,
        service: event.service,
        operation: event.operation,
        sku: event.sku,
        quantity: event.quantity,
        unit: event.unit,
        source: event.source,
        idempotency_key: event.idempotencyKey,
        metadata: event.metadata,
      })),
    }),
    signal: AbortSignal.timeout(2000),
  });
  if (!response.ok) {
    throw new Error(`cost meter RPC failed with ${response.status}`);
  }
}

export async function recordUsage(
  events: UsageEvent[],
  transport: UsageTransport = supabaseTransport,
): Promise<void> {
  const normalized = events
    .map(normalizeUsageEvent)
    .filter((event): event is NormalizedUsageEvent => event != null)
    .slice(0, 100);
  if (normalized.length === 0) return;
  try {
    await transport(normalized);
  } catch (error) {
    console.error(
      "cost meter write failed:",
      error instanceof Error ? error.message : "unknown error",
    );
  }
}
