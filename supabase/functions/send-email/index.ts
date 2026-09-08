import { confirmAccountEmail, magicLinkEmail } from "../../../src/lib/email/catalog.ts";
import { renderEmail } from "../../../src/lib/email/render.ts";

const FROM = "PongLens <support@ponglens.com>";
const REPLY_TO = "support@ponglens.com";
const CANONICAL_CONFIRM_URL = "https://www.ponglens.com/auth/confirm";
const ALLOWED_REDIRECT_HOSTS = new Set(["ponglens.com", "www.ponglens.com"]);

export type AuthHookPayload = {
  user: { email?: string | null; new_email?: string | null };
  email_data: {
    token?: string;
    token_hash?: string;
    redirect_to?: string;
    email_action_type?: string;
    token_new?: string;
    token_hash_new?: string;
  };
};

export type AuthEmailDelivery = {
  from: string;
  replyTo: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
  idempotencyKey: string;
};

type HookRequest = {
  method: string;
  rawBody: string;
  headers: Record<string, string>;
};

type HookDependencies = {
  verify: (
    rawBody: string,
    headers: Record<string, string>,
  ) => AuthHookPayload | Promise<AuthHookPayload>;
  deliver: (delivery: AuthEmailDelivery) => Promise<void>;
};

function errorResponse(status: number, message: string): Response {
  return Response.json({ error: { http_code: status, message } }, { status });
}

function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const target = name.toLowerCase();
  return Object.entries(headers).find(([key]) => key.toLowerCase() === target)?.[1];
}

function confirmationUrl(redirectTo: string | undefined, tokenHash: string): string {
  let url: URL;
  try {
    url = new URL(redirectTo || CANONICAL_CONFIRM_URL);
  } catch {
    url = new URL(CANONICAL_CONFIRM_URL);
  }
  if (
    url.protocol !== "https:" ||
    !ALLOWED_REDIRECT_HOSTS.has(url.hostname) ||
    url.pathname !== "/auth/confirm"
  ) {
    url = new URL(CANONICAL_CONFIRM_URL);
  }
  url.searchParams.set("token_hash", tokenHash);
  // PongLens deliberately verifies both first-time and returning passwordless
  // mail with Supabase's generic email OTP type. This matches the checked-in
  // SMTP rollback templates and the web/iOS confirmation route.
  url.searchParams.set("type", "email");
  return url.toString();
}

export async function handleSendEmailHook(
  request: HookRequest,
  dependencies: HookDependencies,
): Promise<Response> {
  if (request.method !== "POST") {
    return errorResponse(405, "Method not allowed.");
  }

  let payload: AuthHookPayload;
  try {
    payload = await dependencies.verify(request.rawBody, request.headers);
  } catch {
    return errorResponse(401, "Invalid webhook signature.");
  }

  const action = payload.email_data?.email_action_type;
  if (action !== "signup" && action !== "magiclink") {
    return errorResponse(400, "This authentication email type is not enabled.");
  }

  const to = payload.user?.email?.trim();
  const token = payload.email_data?.token?.trim();
  const tokenHash = payload.email_data?.token_hash?.trim();
  const idempotencyKey = headerValue(request.headers, "webhook-id")?.trim();
  if (!to || !token || !tokenHash || !idempotencyKey) {
    return errorResponse(400, "The authentication email payload is incomplete.");
  }

  const facts = {
    code: token,
    confirmationUrl: confirmationUrl(payload.email_data.redirect_to, tokenHash),
  };
  const message = action === "signup"
    ? confirmAccountEmail(facts)
    : magicLinkEmail(facts);
  const rendered = renderEmail(message);

  try {
    await dependencies.deliver({
      from: FROM,
      replyTo: REPLY_TO,
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      headers: {
        "X-PongLens-Template-Id": rendered.templateId,
        "X-PongLens-Template-Version": String(rendered.templateVersion),
      },
      idempotencyKey,
    });
  } catch {
    return errorResponse(502, "The authentication email could not be sent.");
  }

  return Response.json({}, { status: 200 });
}

if ((import.meta as ImportMeta & { main?: boolean }).main) {
  const secret = Deno.env.get("SEND_EMAIL_HOOK_SECRET");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!secret || !resendKey) {
    throw new Error("SEND_EMAIL_HOOK_SECRET and RESEND_API_KEY are required");
  }

  const { Webhook } = await import("https://esm.sh/standardwebhooks@1.0.0");
  const webhook = new Webhook(secret.replace(/^v1,whsec_/, ""));

  Deno.serve(async (incoming: Request) => {
    const rawBody = await incoming.text();
    const headers = Object.fromEntries(incoming.headers.entries());
    return handleSendEmailHook(
      { method: incoming.method, rawBody, headers },
      {
        verify: (body, signedHeaders) =>
          webhook.verify(body, signedHeaders) as AuthHookPayload,
        deliver: async (delivery) => {
          const response = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${resendKey}`,
              "Content-Type": "application/json",
              "Idempotency-Key": delivery.idempotencyKey,
            },
            body: JSON.stringify({
              from: delivery.from,
              reply_to: delivery.replyTo,
              to: [delivery.to],
              subject: delivery.subject,
              html: delivery.html,
              text: delivery.text,
              headers: delivery.headers,
            }),
          });
          if (!response.ok) {
            throw new Error(`Resend rejected auth email with ${response.status}`);
          }
        },
      },
    );
  });
}
