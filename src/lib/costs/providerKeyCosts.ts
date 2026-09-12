/**
 * What OpenAI says each API key cost, per day.
 *
 * Deliberately NOT in the worker, though the rest of provider reconciliation
 * is. The worker runs from a sealed release, so anything living there only
 * starts working at the next release — and this needs nothing the worker
 * has. It needs an admin key and a database, both of which a cron route
 * already holds. Coupling a cost report to the processing pipeline's release
 * cycle is what made this data stale in the first place.
 */

const COSTS_URL = "https://api.openai.com/v1/organization/costs";

export interface ProviderKeyCostRow {
  provider: string;
  key_id: string;
  day: string;
  cost_usd: number;
}

/**
 * OpenAI restates a day's cost for some hours after it ends, so each run
 * re-reads a few days rather than only yesterday. The write is an upsert
 * keyed on (provider, key_id, day), so re-reading corrects rather than
 * duplicates.
 */
export const LOOKBACK_DAYS = 4;

export function parseKeyCosts(payloads: unknown[]): ProviderKeyCostRow[] {
  const rows: ProviderKeyCostRow[] = [];
  for (const raw of payloads) {
    const payload = (raw ?? {}) as { data?: unknown };
    for (const bucketRaw of Array.isArray(payload.data) ? payload.data : []) {
      const bucket = (bucketRaw ?? {}) as {
        start_time?: unknown;
        results?: unknown;
      };
      const started = Number(bucket.start_time);
      if (!Number.isFinite(started)) continue;
      const day = new Date(started * 1000).toISOString().slice(0, 10);
      for (const resultRaw of Array.isArray(bucket.results) ? bucket.results : []) {
        const result = (resultRaw ?? {}) as {
          api_key_id?: unknown;
          amount?: { value?: unknown };
        };
        const keyId = typeof result.api_key_id === "string" ? result.api_key_id : "";
        const value = Number(result.amount?.value);
        // A key with no id cannot be attributed to anything, and a zero is
        // not worth a row. Both are dropped rather than stored as noise.
        if (!keyId || !Number.isFinite(value) || value <= 0) continue;
        rows.push({
          provider: "OpenAI",
          key_id: keyId.slice(0, 120),
          day,
          cost_usd: value,
        });
      }
    }
  }
  return rows;
}

export async function fetchOpenAIKeyCosts(args: {
  adminKey: string;
  startTime: number;
  endTime?: number;
  fetchImpl?: typeof fetch;
}): Promise<ProviderKeyCostRow[]> {
  const doFetch = args.fetchImpl ?? fetch;
  const payloads: unknown[] = [];
  let page: string | null = null;
  // Bounded: a runaway pagination loop in a cron route is a bill, not a bug
  // report.
  for (let guard = 0; guard < 10; guard += 1) {
    const params = new URLSearchParams({
      start_time: String(args.startTime),
      bucket_width: "1d",
      group_by: "api_key_id",
      limit: "31",
    });
    if (args.endTime) params.set("end_time", String(args.endTime));
    if (page) params.set("page", page);
    const response = await doFetch(`${COSTS_URL}?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${args.adminKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      throw new Error(`OpenAI costs request failed with ${response.status}`);
    }
    const payload = (await response.json()) as {
      has_more?: boolean;
      next_page?: string;
    };
    payloads.push(payload);
    if (!payload.has_more || !payload.next_page) break;
    page = payload.next_page;
  }
  return parseKeyCosts(payloads);
}
