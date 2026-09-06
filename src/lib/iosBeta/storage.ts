import type {
  BetaJob,
  BetaPreparedJob,
  ScheduledDeliveryDependencies,
} from "./scheduledDelivery.ts";
import { betaApiKey, betaProviderPayload, createBetaProvider } from "./provider.ts";
import { betaAdminNoticeEmail, betaInvitationEmail } from "../email/catalog.ts";
import { parseTestFlightUrl } from "./model.ts";
import {
  PLAYER_INTERESTS,
  COACH_INTERESTS,
  FEEDBACK_OPTIONS,
} from "./questionnaire.ts";

export type BetaEmailDependencies = {
  jobs(requestId: string): Promise<BetaJob[]>;
  pending(): Promise<string[]>;
  requestEarly(requestId: string, actor: string): Promise<boolean>;
  delivery: ScheduledDeliveryDependencies;
};

export async function betaEmailDependencies(): Promise<BetaEmailDependencies> {
  const [
    { createAdminClient },
    { skipIfSuppressed },
    { recordUsage, resendEmailEvent },
  ] = await Promise.all([
    import("../supabase/admin"),
    import("../email/suppression"),
    import("../costs/meter"),
  ]);
  const db = createAdminClient();
  const apiKey = betaApiKey(process.env);
  async function rpc<T>(
    name: string,
    params: Record<string, unknown>,
  ): Promise<T> {
    const { data, error } = await db.rpc(name, params);
    if (error) throw new Error("Beta storage operation failed");
    return data as T;
  }
  const delivery: ScheduledDeliveryDependencies = {
    now: Date.now,
    lease: (id, token) =>
      rpc<BetaJob | null>("lease_ios_beta_delivery", {
        p_id: id,
        p_token: token,
      }),
    async read(id) {
      const { data, error } = await db
        .from("ios_beta_deliveries")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error("Beta storage read failed");
      return data as BetaJob | null;
    },
    prepare: (job, token, payload) =>
      rpc<BetaPreparedJob>("prepare_ios_beta_delivery", {
        p_id: job.id,
        p_token: token,
        p_payload: payload,
      }),
    finish: (job, token, result) =>
      rpc<boolean>("finish_ios_beta_delivery", {
        p_id: job.id,
        p_token: token,
        p_state: result.state,
        p_provider_id: result.id ?? null,
        p_error: result.error ?? null,
      }),
    isSuppressed: (recipient) =>
      skipIfSuppressed(recipient, "ios_beta_delivery"),
    async payload(job) {
      // Configuration failure before prepare does not start an idempotency clock.
      if (!apiKey)
        throw new Error("Beta provider not configured");
      const { data: request, error } = await db
        .from("ios_beta_requests")
        .select(
          "id,email,created_at,scheduled_at,role,interests,feedback_choice,feedback_channels",
        )
        .eq("id", job.request_id)
        .single();
      if (error || !request) throw new Error("Beta request unavailable");
      if (job.kind === "invite") {
        const url = parseTestFlightUrl(process.env.IOS_TESTFLIGHT_URL);
        if (!url) throw new Error("Beta invitation not configured");
        // Historic pending requests are quarantined in the migration. A genuinely
        // unattempted new request recovered after its deadline is sent in a minute,
        // while the original deadline remains unchanged in the request record.
        const target = job.early_target_at ?? request.scheduled_at;
        const at = new Date(
          Math.max(Date.parse(target), Date.now() + 60_000),
        ).toISOString();
        return betaProviderPayload({
          to: job.recipient,
          deliveryId: job.id,
          message: betaInvitationEmail(url),
          scheduledAt: at,
        });
      }
      const interests = [...PLAYER_INTERESTS, ...COACH_INTERESTS]
        .filter((x) => request.interests.includes(x.value))
        .map((x) => x.label);
      const feedback =
        request.feedback_choice === "declined"
          ? "No feedback contact requested"
          : request.feedback_choice === "opted_in"
            ? FEEDBACK_OPTIONS.filter((x) =>
                request.feedback_channels.includes(x.value),
              )
                .map((x) => x.label)
                .join(", ")
            : "Not provided";
      return betaProviderPayload({
        to: job.recipient,
        deliveryId: job.id,
        message: betaAdminNoticeEmail({
          email: request.email,
          requestedAt: request.created_at,
          scheduledAt: request.scheduled_at,
          role: request.role
            ? { player: "Player", coach: "Coach", both: "Both" }[
                request.role as "player" | "coach" | "both"
              ]
            : undefined,
          interests,
          feedback,
          requestId: request.id,
        }),
      });
    },
    provider: createBetaProvider({
      apiKey,
      fetch,
      async record(id, payload) {
        const parsed = JSON.parse(payload);
        const template = parsed.headers?.["X-PongLens-Template-Id"];
        const version = parsed.headers?.["X-PongLens-Template-Version"];
        const event = resendEmailEvent({
          messageId: id,
          operation: `ios_beta_email:${template}:v${version}`,
        });
        await recordUsage(event ? [event] : []);
      },
    }),
  };
  return {
    delivery,
    async jobs(requestId) {
      const { data, error } = await db
        .from("ios_beta_deliveries")
        .select("*")
        .eq("request_id", requestId)
        .order("kind");
      if (error) throw new Error("Beta jobs unavailable");
      return (data ?? []) as BetaJob[];
    },
    async pending() {
      const { data, error } = await db
        .from("ios_beta_deliveries")
        .select("request_id")
        .not(
          "state",
          "in",
          "(sent,delivered,suppressed,bounced,complained,canceled)",
        )
        .order("updated_at")
        .limit(150);
      if (error) throw new Error("Beta pending jobs unavailable");
      return [...new Set((data ?? []).map((row) => row.request_id as string))];
    },
    requestEarly: (requestId, actor) =>
      rpc<boolean>("request_ios_beta_early_send", {
        p_request_id: requestId,
        p_actor: actor,
      }),
  };
}
