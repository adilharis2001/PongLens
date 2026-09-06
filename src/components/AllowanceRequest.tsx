"use client";

import { useEffect, useState } from "react";
import type { AllowanceResource } from "@/lib/commerce/allowances";
import { createClient } from "@/lib/supabase/client";

export function AllowanceRequest({ resource, compact = false, refreshToken = 0 }: { resource: AllowanceResource; compact?: boolean; refreshToken?: number }) {
  const [pending, setPending] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const supabase = createClient();
    void supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data, error } = await supabase.from("quota_requests").select("id")
        .eq("user_id", user.id).eq("resource", resource).eq("status", "pending").limit(1);
      if (!error) setPending(Boolean(data?.length));
      else { setPending(false); setError("Could not check your requests. You can try again."); }
    });
  }, [resource, refreshToken]);
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/allowances/request", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ resource, message }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.code === "request_limit" ? "Please wait until tomorrow before making another request." : "Could not send your request. Try again.");
        return;
      }
      setPending(true); setOpen(false);
    } catch { setError("Could not send your request. Check your connection and try again."); }
    finally { setBusy(false); }
  };
  const label = resource === "storage" ? "storage" : "minutes";
  const pill = "inline-flex min-h-11 w-full items-center justify-center rounded-full border border-edge px-4 py-2.5 text-sm text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white disabled:opacity-50 sm:w-auto";
  const primary = "glow-cta inline-flex min-h-11 w-full items-center justify-center rounded-full bg-cyan-glow px-6 py-2.5 text-sm font-semibold text-ink disabled:opacity-50 sm:w-auto";
  return (
    <div className={compact ? "" : "mt-4"}>
      {pending ? (
        <p role="status" className="text-sm text-zinc-300">Request sent. We will notify you when it has been reviewed.</p>
      ) : open ? (
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="space-y-3">
          <label className="block text-sm text-zinc-300">
            Anything you would like us to know? (optional)
            <textarea autoFocus value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000} rows={3}
              className="mt-2 block w-full rounded-xl border border-edge bg-ink p-3 text-sm text-zinc-100 focus:border-cyan-glow focus:outline-none" />
          </label>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <button disabled={busy} className={primary}>
              {busy ? "Sending…" : "Send request"}
            </button>
            <button type="button" onClick={() => setOpen(false)} disabled={busy} className={pill}>Cancel</button>
          </div>
        </form>
      ) : (
        <>
          <p className="mb-3 text-sm text-zinc-400">{compact ? `PongLens is in beta. You can request more ${label === "minutes" ? "processing minutes" : label} for free.` : "PongLens is in beta. Enjoying the app and need more storage or processing minutes? You can request a free allowance increase."}</p>
          <button disabled={pending === null} onClick={() => setOpen(true)} className={compact ? primary : pill}>Request more {label}</button>
        </>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}
