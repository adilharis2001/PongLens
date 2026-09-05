// Pure rules shared by the upload and import limit states.
export function uploadAllowanceResource(message: string | null): "storage" | null {
  return message?.startsWith("Storage is full.") ? "storage" : null;
}

export function allowanceRecoveryMode(purchasesEnabled: boolean | null): "loading" | "request" | "purchase" {
  return purchasesEnabled === null ? "loading" : purchasesEnabled ? "purchase" : "request";
}

export function importNeedsMinutes(match: { status: string; duration_s: number | null } | null, balance: number | null, autoProcess: boolean): boolean {
  return autoProcess && match?.status === "uploaded" && match.duration_s != null && balance != null
    && Math.max(1, Math.ceil(match.duration_s / 60)) > balance;
}
