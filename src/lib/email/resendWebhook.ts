import { svixTimestampFresh, verifySvixSignature } from "./svix.ts";

type WebhookDependencies = {
  secret: string | undefined;
  apply(
    id: string,
    event: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
  reconcile(requestId: string): Promise<void>;
};

async function defaultDependencies(): Promise<WebhookDependencies> {
  const [{ createAdminClient }, { reconcileIosBetaCancellations }] =
    await Promise.all([
      import("../supabase/admin"),
      import("./iosBetaEmails.ts"),
    ]);
  return {
    secret: process.env.RESEND_WEBHOOK_SECRET,
    apply: (id, event) =>
      createAdminClient().rpc("apply_resend_beta_event", {
        p_event_id: id,
        p_event: event,
      }),
    async reconcile(id) {
      if (!(await reconcileIosBetaCancellations(id)))
        throw new Error("Beta cancellation incomplete");
    },
  };
}

/** Signature, suppression, evidence and dedupe are one retry-safe operation.
 * SQL preserves the existing permanent-bounce/complaint rules for all mail.
 * Provider cancellation happens after commit and may request a webhook retry.
 */
export async function handleResendWebhook(
  req: Request,
  provided?: WebhookDependencies,
): Promise<Response> {
  const dependencies = provided ?? (await defaultDependencies());
  if (!dependencies.secret)
    return new Response("not configured", { status: 500 });
  const id = req.headers.get("svix-id");
  const stamp = req.headers.get("svix-timestamp");
  const signature = req.headers.get("svix-signature");
  if (!id || !stamp || !signature)
    return new Response("missing signature headers", { status: 400 });
  const body = await req.text();
  if (
    !svixTimestampFresh(stamp) ||
    !verifySvixSignature(dependencies.secret, id, stamp, body, signature)
  )
    return new Response("bad signature", { status: 400 });
  let event: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return new Response("bad body", { status: 400 });
    event = parsed as Record<string, unknown>;
  } catch {
    return new Response("bad body", { status: 400 });
  }
  try {
    const { data, error } = await dependencies.apply(id, event);
    if (error) throw new Error("Webhook transaction failed");
    if (Array.isArray(data))
      for (const requestId of new Set(data)) {
        if (typeof requestId === "string")
          await dependencies.reconcile(requestId);
      }
    return new Response("ok", { status: 200 });
  } catch {
    return new Response("processing failed", { status: 500 });
  }
}
