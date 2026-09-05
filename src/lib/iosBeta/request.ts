import type { BetaClaim } from "./claim.ts";
import { hashBetaSource } from "./claim.ts";
import type { BetaDeliveryResult } from "./delivery.ts";
import { normalizeBetaEmail, parseTestFlightUrl } from "./model.ts";
import { parseBetaAnswers, type BetaAnswers } from "./questionnaire.ts";

export type BetaRequestHandlerDependencies = {
  testFlightUrl: string | undefined;
  serviceSecret: string | undefined;
  claim(
    email: string,
    ipHash: string,
    answers?: BetaAnswers,
  ): Promise<BetaClaim>;
  deliver(requestId: string): Promise<BetaDeliveryResult | null>;
};

type RequestBody = { email?: unknown; company?: unknown; answers?: unknown };

function json(code: string | null, status: number): Response {
  return Response.json(code ? { ok: false, code } : { ok: true }, { status });
}

function requestSource(request: Request): string {
  const forwarded = request.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function handleIosBetaRequest(
  request: Request,
  dependencies: BetaRequestHandlerDependencies,
): Promise<Response> {
  let body: RequestBody;
  try {
    const reader = request.body?.getReader();
    if (!reader) return json("invalid_request", 400);
    let length = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 16_384) {
        await reader.cancel();
        return json("invalid_request", 413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return json("invalid_request", 400);
    }
    body = parsed as RequestBody;
  } catch {
    return json("invalid_request", 400);
  }

  // A filled hidden field identifies commodity form bots. Quiet success keeps
  // the endpoint from teaching the bot how it was detected.
  if (typeof body.company === "string" && body.company.trim()) {
    return json(null, 200);
  }

  const email = normalizeBetaEmail(body.email);
  if (!email) return json("invalid_email", 400);
  const answers = Object.hasOwn(body, "answers")
    ? parseBetaAnswers(body.answers)
    : undefined;
  if (answers === null) return json("invalid_answers", 400);

  if (
    !parseTestFlightUrl(dependencies.testFlightUrl) ||
    !dependencies.serviceSecret
  ) {
    return json("temporarily_unavailable", 503);
  }

  try {
    const ipHash = hashBetaSource(
      requestSource(request),
      dependencies.serviceSecret,
    );
    const claim = await dependencies.claim(email, ipHash, answers);
    if (claim.rateLimited) return json("rate_limited", 429);
    if (!claim.id) return json("temporarily_unavailable", 503);

    const delivery = await dependencies.deliver(claim.id);
    if (!delivery) return json("temporarily_unavailable", 503);
    if (
      delivery.invite !== "sent" &&
      delivery.invite !== "already_sent" &&
      delivery.invite !== "scheduled" &&
      delivery.invite !== "sending" &&
      delivery.invite !== "delivered" &&
      delivery.invite !== "suppressed" &&
      delivery.invite !== "bounced" &&
      delivery.invite !== "complained"
    ) {
      return json("delivery_failed", 503);
    }
    return json(null, 200);
  } catch (error) {
    console.error("iOS beta request failed:", error);
    return json("temporarily_unavailable", 503);
  }
}
