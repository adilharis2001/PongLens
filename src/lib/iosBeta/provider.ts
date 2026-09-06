import type { BetaProvider, ProviderResult } from "./scheduledDelivery.ts";
import type { EmailMessage } from "../email/message.ts";
import { renderEmail } from "../email/render.ts";
import { EMAIL_FROM, EMAIL_REPLY_TO } from "../email/send.ts";

export function betaApiKey(env: Record<string, string | undefined>): string {
  // Scheduled-message management needs ongoing full access. Never borrow the
  // ordinary sending-only key when this dedicated server secret is missing.
  return env.RESEND_BETA_API_KEY?.trim() ?? "";
}

export function betaProviderPayload(input: {
  to: string;
  message: EmailMessage;
  deliveryId: string;
  scheduledAt?: string;
}): string {
  const rendered = renderEmail(input.message);
  return JSON.stringify({
    from: EMAIL_FROM,
    to: [input.to],
    reply_to: EMAIL_REPLY_TO,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    headers: {
      "X-PongLens-Template-Id": rendered.templateId,
      "X-PongLens-Template-Version": String(rendered.templateVersion),
    },
    tags: [{ name: "beta_delivery_id", value: input.deliveryId }],
    ...(input.scheduledAt ? { scheduled_at: input.scheduledAt } : {}),
  });
}

export function createBetaProvider(dependencies: {
  apiKey: string;
  fetch: typeof fetch;
  record(id: string, payload: string): Promise<void>;
}): BetaProvider {
  async function call(
    method: string,
    path: string,
    body?: string,
    key?: string,
  ): Promise<{
    response?: Response;
    data?: Record<string, unknown>;
    error?: string;
  }> {
    if (!dependencies.apiKey) return { error: "provider_not_configured" };
    try {
      const response = await dependencies.fetch(
        `https://api.resend.com/emails${path}`,
        {
          method,
          headers: {
            Authorization: `Bearer ${dependencies.apiKey}`,
            "Content-Type": "application/json",
            ...(key ? { "Idempotency-Key": key } : {}),
          },
          ...(body === undefined ? {} : { body }),
          signal: AbortSignal.timeout(8_000),
        },
      );
      const data: unknown = await response.json().catch(() => null);
      return {
        response,
        data:
          data && typeof data === "object" && !Array.isArray(data)
            ? (data as Record<string, unknown>)
            : undefined,
      };
    } catch {
      return { error: "provider_unconfirmed" };
    }
  }
  function failure(
    result: Awaited<ReturnType<typeof call>>,
    create = false,
  ): ProviderResult {
    // A 409 may describe an in-progress idempotent operation, not a rejection.
    const definitive =
      create &&
      (result.error === "provider_not_configured" ||
        [400, 401, 403, 404, 422, 429].includes(result.response?.status ?? 0));
    return {
      state: definitive ? "failed" : "unknown",
      error:
        result.error ??
        (result.response?.ok
          ? "provider_missing_id"
          : `provider_http_${result.response?.status ?? "unknown"}`),
    };
  }
  return {
    async create(payload, key) {
      if (!key || key.length > 256)
        return { state: "failed", error: "invalid_idempotency_key" };
      const result = await call("POST", "", payload, key);
      const id = result.data?.id;
      if (!result.response?.ok || typeof id !== "string" || !id)
        return failure(result, true);
      try {
        await dependencies.record(id, payload);
      } catch {
        /* metering must not turn accepted mail into an unknown send */
      }
      return {
        state: JSON.parse(payload).scheduled_at ? "scheduled" : "sent",
        id,
      };
    },
    async retrieve(id) {
      const result = await call("GET", `/${encodeURIComponent(id)}`);
      if (!result.response?.ok || result.data?.id !== id)
        return failure(result);
      const state = result.data.last_event;
      const supported = [
        "scheduled",
        "sent",
        "delivered",
        "failed",
        "bounced",
        "complained",
        "canceled",
      ] as const;
      // Unknown newer event types are not permission to dispatch again.
      if (!supported.includes(state as (typeof supported)[number]))
        return { state: "unknown", id, error: "provider_unknown_event" };
      return {
        state: state as (typeof supported)[number],
        id,
        scheduledAt:
          typeof result.data.scheduled_at === "string"
            ? result.data.scheduled_at
            : null,
      };
    },
    async update(id, scheduledAt) {
      const result = await call(
        "PATCH",
        `/${encodeURIComponent(id)}`,
        JSON.stringify({ scheduled_at: scheduledAt }),
      );
      return result.response?.ok && result.data?.id === id
        ? { state: "sending", id }
        : failure(result);
    },
    async cancel(id) {
      const result = await call("POST", `/${encodeURIComponent(id)}/cancel`);
      return result.response?.ok && result.data?.id === id
        ? { state: "canceled", id }
        : failure(result);
    },
  };
}
