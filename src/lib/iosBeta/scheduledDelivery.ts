import type { BetaDeliveryState } from "./delivery.ts";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

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
export type BetaPreparedJob = BetaJob & { create_allowed: boolean };
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
  prepare(
    job: BetaJob,
    token: string,
    payload: string,
  ): Promise<BetaPreparedJob>;
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

export function isBetaDeliveryComplete(
  job: Pick<BetaJob, "state" | "provider_email_id">,
): boolean {
  return (
    TERMINAL.has(job.state) ||
    (job.state === "failed" && !!job.provider_email_id)
  );
}

export async function runBetaDelivery(
  id: string,
  dependencies: ScheduledDeliveryDependencies,
): Promise<BetaDeliveryState> {
  // An admin can persist intent while an ordinary reconciliation holds the
  // lease, including after its final intent read. Reacquire only for unapplied
  // intent on a confirmed schedule; never retry ambiguous provider I/O here.
  for (let attempt = 0; attempt < 4; attempt++) {
    const state = await runBetaDeliveryAttempt(id, dependencies);
    if (state !== "scheduled") return state;
    try {
      const current = await dependencies.read(id);
      if (!current) return "unknown";
      if (
        current.state !== "scheduled" ||
        !current.early_target_at ||
        current.early_applied_at
      )
        return current.state;
      if (attempt < 3) {
        await delay(250);
        const latest = await dependencies.read(id);
        if (!latest) return "unknown";
        if (latest.state !== "scheduled" || latest.early_applied_at)
          return latest.state;
      }
    } catch {
      return "unknown";
    }
  }
  // Still scheduled is not send-now success. The admin can retry without
  // changing the durable intent, provider identity or original POST bytes.
  return "scheduled";
}

async function runBetaDeliveryAttempt(
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
      isBetaDeliveryComplete(job) ||
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
      const prepared = await dependencies.prepare(job, token, payload);
      job = prepared;
      if (!prepared.create_allowed) {
        // The prepare lock may see evidence or suppression that arrived after
        // our lease snapshot. Its decision, not that snapshot, authorizes POST.
        if (isBetaDeliveryComplete(job)) {
          return await finish({
            state: job.state,
            id: job.provider_email_id ?? undefined,
            error: job.error_code ?? undefined,
          });
        }
        suppressed =
          job.cancel_requested ||
          (await dependencies.isSuppressed(job.recipient));
        if (!job.provider_email_id) {
          return await finish({
            state: suppressed
              ? job.first_attempt_at
                ? "needs_attention"
                : "suppressed"
              : job.state,
            error:
              suppressed && job.first_attempt_at
                ? "suppressed_unknown_acceptance"
                : (job.error_code ?? undefined),
          });
        }
      } else {
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
        // A replay retains its original provider ID, including early-send intent.
        if ((!job.early_target_at && !suppressed) || created.state === "sent")
          return await finish(created);
      }
    }
    const providerId = job.provider_email_id;
    if (!providerId)
      return await finish({ state: "unknown", error: "provider_unconfirmed" });
    const observed = await dependencies.provider.retrieve(providerId);
    job = {
      ...job,
      ...(await dependencies.read(id)),
      provider_email_id: providerId,
    };
    if (isBetaDeliveryComplete(job))
      return await finish({
        state: job.state,
        id: providerId,
        error: job.error_code ?? undefined,
      });
    suppressed =
      job.cancel_requested || (await dependencies.isSuppressed(job.recipient));
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
