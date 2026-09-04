import type { BetaClaim } from "./claim.ts";
import { hashBetaSource } from "./claim.ts";
import type { BetaDeliveryResult } from "./delivery.ts";
import { normalizeBetaEmail, parseTestFlightUrl } from "./model.ts";

export type BetaRequestHandlerDependencies = {
  testFlightUrl: string | undefined;
  serviceSecret: string | undefined;
  claim(email: string, ipHash: string): Promise<BetaClaim>;
  deliver(requestId: string): Promise<BetaDeliveryResult | null>;
};

type RequestBody = { email?: unknown; company?: unknown };

function json(code: string | null, status: number): Response {
  return Response.json(code ? { ok: false, code } : { ok: true }, { status });
}

function requestSource(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function handleIosBetaRequest(
  request: Request,
  dependencies: BetaRequestHandlerDependencies,
): Promise<Response> {
  let body: RequestBody;
  try {
    const parsed = (await request.json()) as unknown;
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
    const claim = await dependencies.claim(email, ipHash);
    if (claim.rateLimited) return json("rate_limited", 429);
    if (!claim.id) return json("temporarily_unavailable", 503);

    const delivery = await dependencies.deliver(claim.id);
    if (!delivery) return json("temporarily_unavailable", 503);
    if (
      delivery.invite !== "sent" &&
      delivery.invite !== "already_sent"
    ) {
      return json("delivery_failed", 503);
    }
    return json(null, 200);
  } catch (error) {
    console.error("iOS beta request failed:", error);
    return json("temporarily_unavailable", 503);
  }
}
