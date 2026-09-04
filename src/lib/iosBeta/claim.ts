import { createHmac } from "node:crypto";

export type BetaClaim = {
  id: string | null;
  email: string | null;
  requestedAt: string | null;
  inviteNeeded: boolean;
  adminNoticeNeeded: boolean;
  rateLimited: boolean;
};

type RpcResult = {
  data: unknown;
  error: { message?: string } | null;
};

export type BetaClaimClient = {
  rpc(
    name: string,
    params: { p_email: string; p_ip_hash: string },
  ): PromiseLike<RpcResult>;
};

type ClaimRow = {
  request_id: string | null;
  request_email: string | null;
  requested_at: string | null;
  invite_needed: boolean;
  admin_notice_needed: boolean;
  rate_limited: boolean;
};

export function hashBetaSource(source: string, secret: string): string {
  return createHmac("sha256", secret).update(source).digest("hex");
}

function isClaimRow(value: unknown): value is ClaimRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  const nullableStrings = [
    row.request_id,
    row.request_email,
    row.requested_at,
  ].every((entry) => entry === null || typeof entry === "string");
  return (
    nullableStrings &&
    typeof row.invite_needed === "boolean" &&
    typeof row.admin_notice_needed === "boolean" &&
    typeof row.rate_limited === "boolean"
  );
}

export async function claimIosBetaRequest(
  email: string,
  ipHash: string,
  client?: BetaClaimClient,
): Promise<BetaClaim> {
  let rpcClient = client;
  if (!rpcClient) {
    const { createAdminClient } = await import("../supabase/admin");
    rpcClient = createAdminClient() as unknown as BetaClaimClient;
  }

  const { data, error } = await rpcClient.rpc("claim_ios_beta_request", {
    p_email: email,
    p_ip_hash: ipHash,
  });
  if (error) throw new Error(error.message || "iOS beta claim failed");

  const row = Array.isArray(data) ? data[0] : data;
  if (!isClaimRow(row)) throw new Error("Malformed iOS beta claim response");
  if (
    !row.rate_limited &&
    (!row.request_id || !row.request_email || !row.requested_at)
  ) {
    throw new Error("Malformed iOS beta claim response");
  }

  return {
    id: row.request_id,
    email: row.request_email,
    requestedAt: row.requested_at,
    inviteNeeded: row.invite_needed,
    adminNoticeNeeded: row.admin_notice_needed,
    rateLimited: row.rate_limited,
  };
}
