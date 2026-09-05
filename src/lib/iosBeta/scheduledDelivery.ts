import type { BetaDeliveryState } from "./delivery.ts";
import { randomUUID } from "node:crypto";

export type BetaJob = {
  id: string;
  request_id: string;
  kind: "invite" | "admin_adil" | "admin_anton";
  recipient: string;
  state: BetaDeliveryState;
  provider_email_id: string | null;
  idempotency_key: string;
  create_payload: string | null;
  first_attempt_at: string | null;
  error_code: string | null;
  early_target_at: string | null;
  early_applied_at: string | null;
  cancel_requested: boolean;
};
export type ProviderResult = {
  state: BetaDeliveryState;
  id?: string;
  scheduledAt?: string | null;
  error?: string;
};
export type BetaProvider = {
  create(payload: string, key: string): Promise<ProviderResult>;
  retrieve(id: string): Promise<ProviderResult>;
  update(id: string, scheduledAt: string): Promise<ProviderResult>;
  cancel(id: string): Promise<ProviderResult>;
};
export type ScheduledDeliveryDependencies = {
  now(): number;
  lease(id: string, token: string): Promise<BetaJob | null>;
  read(id: string): Promise<BetaJob | null>;
  prepare(job: BetaJob, token: string, payload: string): Promise<BetaJob>;
  finish(job: BetaJob, token: string, result: ProviderResult): Promise<boolean>;
  payload(job: BetaJob): Promise<string>;
  isSuppressed(recipient: string): Promise<boolean>;
  provider: BetaProvider;
};

const TERMINAL = new Set<BetaDeliveryState>([
  "sent",
  "delivered",
  "suppressed",
  "bounced",
  "complained",
  "canceled",
]);

export async function runBetaDelivery(
  id: string,
  dependencies: ScheduledDeliveryDependencies,
): Promise<BetaDeliveryState> {
  const token = randomUUID();
  let job: BetaJob | null = null;
  const finish = async (result: ProviderResult): Promise<BetaDeliveryState> => {
    if (!job || !(await dependencies.finish(job, token, result)))
      return "unknown";
    // A signed event may have beaten the POST response. Read the merged state.
    return (await dependencies.read(id))?.state ?? "unknown";
  };
  try {
    job = await dependencies.lease(id, token);
    if (!job) return (await dependencies.read(id))?.state ?? "unknown";
    if (
      TERMINAL.has(job.state) ||
      (job.state === "failed" && job.provider_email_id) ||
      job.error_code === "legacy_unconfirmed"
    ) {
      return await finish({
        state: job.state,
        error: job.error_code ?? undefined,
      });
    }
    let suppressed =
      job.cancel_requested || (await dependencies.isSuppressed(job.recipient));
    if (!job.provider_email_id) {
      if (suppressed)
        return await finish({
          state: job.first_attempt_at ? "needs_attention" : "suppressed",
          error: job.first_attempt_at
            ? "suppressed_unknown_acceptance"
            : undefined,
        });
      if (
        job.first_attempt_at &&
        // Leave room for network transit before Resend's 24-hour key expiry.
        dependencies.now() - Date.parse(job.first_attempt_at) >= 86_340_000
      ) {
        return await finish({
          state: "needs_attention",
          error: "idempotency_expired",
        });
      }
      const payload = job.create_payload ?? (await dependencies.payload(job));
      job = await dependencies.prepare(job, token, payload);
      const created = await dependencies.provider.create(
        payload,
        job.idempotency_key,
      );
      if (!created.id) return await finish(created);
      job = {
        ...job,
        ...(await dependencies.read(id)),
        provider_email_id: created.id,
      };
      suppressed =
        job.cancel_requested ||
        (await dependencies.isSuppressed(job.recipient));
      // The immutable original create may be replayed after an early-send request.
      // Keep that original provider ID and bring it forward, never replace it.
      if ((!job.early_target_at && !suppressed) || created.state === "sent")
        return await finish(created);
    }
    const providerId = job.provider_email_id;
    if (!providerId)
      return await finish({ state: "unknown", error: "provider_unconfirmed" });
    const observed = await dependencies.provider.retrieve(providerId);
    if (TERMINAL.has(observed.state) || observed.state === "failed") {
      return await finish({
        ...observed,
        id: providerId,
        state:
          suppressed && observed.state === "canceled"
            ? "suppressed"
            : observed.state,
      });
    }
    if (suppressed) {
      const canceled = await dependencies.provider.cancel(providerId);
      return await finish({
        ...canceled,
        id: providerId,
        state: canceled.state === "canceled" ? "suppressed" : "unknown",
        error: canceled.state === "canceled" ? undefined : "cancel_unconfirmed",
      });
    }
    if (observed.state !== "scheduled" && observed.state !== "sending")
      return await finish({ ...observed, id: providerId });
    if (job.early_target_at && !job.early_applied_at) {
      const existing = observed.scheduledAt
        ? Date.parse(observed.scheduledAt)
        : NaN;
      const target = Date.parse(job.early_target_at);
      // Do not move an already-imminent automatic schedule later. A retry of an
      // accepted PATCH is recognized by retrieval, even if its local stamp failed.
      if (
        Number.isFinite(existing) &&
        (existing <= target || existing <= dependencies.now() + 60_000)
      ) {
        return await finish({ state: "sending", id: providerId });
      }
      const nearImmediate = new Date(
        Math.max(target, dependencies.now() + 60_000),
      ).toISOString();
      return await finish({
        ...(await dependencies.provider.update(providerId, nearImmediate)),
        id: providerId,
      });
    }
    return await finish({
      ...observed,
      id: providerId,
      state: job.early_applied_at ? "sending" : observed.state,
    });
  } catch {
    // No provider exception proves non-acceptance. Leave the persisted payload
    // and first attempt intact; a failed DB finish simply lets the lease expire.
    if (job) {
      try {
        await dependencies.finish(job, token, {
          state: "unknown",
          id: job.provider_email_id ?? undefined,
          error: "operation_unconfirmed",
        });
      } catch {
        /* next recovery owns the lease */
      }
    }
    return "unknown";
  }
}
