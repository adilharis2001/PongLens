"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AllowanceResource } from "@/lib/commerce/allowances";
import { allowanceRecoveryMode } from "@/lib/commerce/allowanceRecovery";
import { AllowanceRequest } from "./AllowanceRequest";

/** A limit is recoverable in place. Never discard the caller's video or draft. */
export function AllowanceRecovery({ resource, onRetry, retryLabel }: {
  resource: AllowanceResource;
  onRetry: () => void | Promise<void>;
  retryLabel: string;
}) {
  const [purchasesEnabled, setPurchasesEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const load = useCallback(async () => {
    const { data, error } = await createClient().from("app_config").select("value")
      .eq("key", "purchases_enabled").maybeSingle();
    if (error || !data) { setPurchasesEnabled(null); setError("Could not check your options. Please try again."); return; }
    setError(null);
    setPurchasesEnabled(data.value === "true");
  }, []);
  useEffect(() => {
    void load();
    const refresh = () => { void load(); setRevision((n) => n + 1); };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [load]);
  const mode = allowanceRecoveryMode(purchasesEnabled);
  const pill = "rounded-full border border-edge px-4 py-2 text-sm text-zinc-200 disabled:opacity-50";
  return (
    <div className="mt-4 rounded-xl border border-edge bg-surface p-4 text-left" aria-label={`${resource === "storage" ? "Storage" : "Processing minutes"} allowance`}>
      {mode === "request" && <AllowanceRequest refreshToken={revision} resource={resource} compact />}
      {mode === "purchase" && <a href={`/account#${resource}`} className={pill}>Get more {resource}</a>}
      {mode === "loading" && !error && <p role="status" className="text-sm text-zinc-400">Checking your options…</p>}
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      <button type="button" disabled={busy} className={`${pill} mt-3`} onClick={async () => {
        setBusy(true);
        try {
          await load();
          if (mode !== "loading") await onRetry();
          setRevision((n) => n + 1);
        } catch { setError("Could not check your allowance. Please try again."); }
        finally { setBusy(false); }
      }}>{busy ? "Checking…" : mode === "loading" ? "Try again" : retryLabel}</button>
    </div>
  );
}
