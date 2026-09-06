import type {
  BetaDeliveryResult,
  BetaDeliveryState,
} from "../iosBeta/delivery.ts";
import {
  isBetaDeliveryComplete,
  runBetaDelivery,
} from "../iosBeta/scheduledDelivery.ts";
import {
  betaEmailDependencies,
  type BetaEmailDependencies,
} from "../iosBeta/storage.ts";

export async function deliverIosBetaRequest(
  requestId: string,
  provided?: BetaEmailDependencies,
): Promise<BetaDeliveryResult | null> {
  const dependencies = provided ?? (await betaEmailDependencies());
  const jobs = await dependencies.jobs(requestId);
  if (!jobs.length) return null;
  const results = await Promise.all(
    jobs.map(async (job) => ({
      kind: job.kind,
      state: await runBetaDelivery(job.id, dependencies.delivery),
    })),
  );
  return {
    invite: results.find((x) => x.kind === "invite")?.state ?? "unknown",
    admin: results
      .filter((x) => x.kind === "admin_adil" || x.kind === "admin_anton")
      .every((x) => ["sent", "delivered", "suppressed"].includes(x.state))
      ? "sent"
      : "failed",
  };
}

export async function scheduleIosBetaRequest(
  requestId: string,
): Promise<boolean> {
  const result = await deliverIosBetaRequest(requestId);
  return (
    !!result &&
    [
      "scheduled",
      "sending",
      "sent",
      "delivered",
      "already_sent",
      "suppressed",
      "bounced",
      "complained",
    ].includes(result.invite)
  );
}

export async function sendIosBetaInviteNow(
  requestId: string,
  actor: string,
  provided?: BetaEmailDependencies,
): Promise<BetaDeliveryState | null> {
  const dependencies = provided ?? (await betaEmailDependencies());
  if (!(await dependencies.requestEarly(requestId, actor))) return null;
  const job = (await dependencies.jobs(requestId)).find(
    (x) => x.kind === "invite",
  );
  return job ? runBetaDelivery(job.id, dependencies.delivery) : null;
}

export async function reconcileIosBetaRequest(
  requestId: string,
): Promise<BetaDeliveryState | null> {
  return (await deliverIosBetaRequest(requestId))?.invite ?? null;
}

export async function reconcileIosBetaCancellations(
  requestId: string,
  provided?: BetaEmailDependencies,
): Promise<boolean> {
  const dependencies = provided ?? (await betaEmailDependencies());
  const pending = (await dependencies.jobs(requestId)).filter(
    (job) => job.cancel_requested && !isBetaDeliveryComplete(job),
  );
  await Promise.all(
    pending.map((job) => runBetaDelivery(job.id, dependencies.delivery)),
  );
  return (await dependencies.jobs(requestId)).every(
    (job) => !job.cancel_requested || isBetaDeliveryComplete(job),
  );
}

// The existing review sweep now reconciles this same durable outbox. Scheduled
// rows only retrieve/update the existing ID; they never use the old sender.
export async function sendPendingIosBetaEmails(): Promise<void> {
  try {
    const dependencies = await betaEmailDependencies();
    for (const requestId of await dependencies.pending()) {
      await deliverIosBetaRequest(requestId, dependencies);
    }
  } catch {
    console.error("iOS beta email recovery failed");
  }
}
