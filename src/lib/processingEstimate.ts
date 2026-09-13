/** Presentation only. All workload and queue arithmetic belongs to the server. */
export interface ProcessingEstimate {
  state: "range" | "queue_only" | "unknown" | "overdue";
  observed_at: string;
  expires_at: string;
  ready_earliest_at: string | null;
  ready_latest_at: string | null;
  start_earliest_at: string | null;
  start_latest_at: string | null;
  basis: string | null;
  reason: string | null;
}

export function formatProcessingEstimate(value: unknown, context: {
  now?: number; jobStatus: string | null; serviceState: string | undefined;
}): { summary: string; detail: string } | null {
  if (context.serviceState !== "available" || !["queued", "processing"].includes(context.jobStatus ?? "")
      || !value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const now = context.now ?? Date.now();
  const date = (v: unknown) => typeof v === "string" ? Date.parse(v) : NaN;
  const observed = date(row.observed_at), expires = date(row.expires_at);
  if (!Number.isFinite(observed) || !Number.isFinite(expires) || observed > now + 30_000
      || now - observed > 90_000 || expires <= now || expires <= observed) return null;
  const overdue = { summary: "Processing is taking longer than estimated.", detail: "Your video is still in the processing queue. You can check back later." };
  if (row.state === "overdue") return overdue;
  if (row.state !== "range" && row.state !== "queue_only") return null;
  const queuedOnly = row.state === "queue_only";
  const low = date(queuedOnly ? row.start_earliest_at : row.ready_earliest_at);
  const high = date(queuedOnly ? row.start_latest_at : row.ready_latest_at);
  if (!Number.isFinite(low) || !Number.isFinite(high) || low > high) return null;
  if (high <= now) return queuedOnly ? null : overdue;
  const lower = Math.max(0, Math.floor((low - now) / 300_000) * 5);
  const upper = Math.max(5, Math.ceil((high - now) / 300_000) * 5);
  const range = lower === 0 ? `within about ${upper} minutes`
    : lower === upper ? `in about ${upper} minutes` : `in about ${lower}–${upper} minutes`;
  return queuedOnly ? {
    summary: `Estimated wait before processing: ${range.replace(/^in /, "")}.`,
    detail: row.reason === "metadata_unknown" ? "Processing time will be estimated after the video check."
      : "Processing time is not available yet.",
  } : {
    summary: `Estimated ready ${range}.`,
    detail: "This is a rough estimate based on recent processing.",
  };
}
