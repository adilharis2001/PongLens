"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Pending invite requests from the gate page. Approve grants access on
 * the spot (admin_decide_access inserts the app_access row); deny parks
 * the request so the gate stops offering the button to that account.
 */

interface AccessRequest {
  id: string;
  user_id: string;
  email: string;
  name: string | null;
  created_at: string;
}

function when(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function AccessRequestsSection() {
  const [requests, setRequests] = useState<AccessRequest[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.rpc("admin_access_requests");
    if (data) setRequests(data as AccessRequest[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (r: AccessRequest, approve: boolean) => {
    setBusy(r.id);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("admin_decide_access", {
      p_request_id: r.id,
      p_approve: approve,
    });
    setBusy(null);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    await load();
  };

  return (
    <section>
      <h2 className="text-lg font-semibold">Requests</h2>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

      {requests === null ? null : requests.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">No pending requests.</p>
      ) : (
        <ul className="mt-4 divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface">
          {requests.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-200">
                  {r.name || r.email}
                </p>
                <p className="truncate text-xs text-zinc-500">
                  {r.email} · {when(r.created_at)}
                </p>
              </div>
              <button
                type="button"
                disabled={busy === r.id}
                onClick={() => void decide(r, true)}
                className="rounded-full bg-cyan-glow px-4 py-1.5 text-sm font-semibold text-ink disabled:opacity-60"
              >
                Approve
              </button>
              <button
                type="button"
                disabled={busy === r.id}
                onClick={() => void decide(r, false)}
                className="rounded-full border border-red-500/40 px-4 py-1.5 text-sm text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-60"
              >
                Deny
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
