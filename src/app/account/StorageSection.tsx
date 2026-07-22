"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PAYMENTS_ENABLED } from "@/lib/flags";
import type { StorageState } from "@/lib/quota";

const GB = 1024 ** 3;

function gb(n: number, decimals = 1) {
  const v = n / GB;
  const rounded = v.toFixed(decimals);
  return rounded.endsWith(".0") ? rounded.slice(0, -2) : rounded;
}

export function StorageSection({ userId }: { userId: string }) {
  const [state, setState] = useState<StorageState | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.rpc("my_storage_state").single();
    if (data) setState(data as StorageState);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitRequest() {
    setSubmitting(true);
    setSubmitError(null);
    const supabase = createClient();
    const { error } = await supabase.from("quota_requests").insert({
      user_id: userId,
      message: message.trim().slice(0, 500),
    });
    setSubmitting(false);
    if (error) {
      setSubmitError("Could not send the request. Try again.");
      return;
    }
    setFormOpen(false);
    setMessage("");
    await load();
  }

  const used = state?.used_bytes ?? 0;
  const limit = state?.storage_limit_bytes ?? 2 * GB;
  const full = state !== null && used >= limit;
  const pct = Math.min(100, Math.round((used / limit) * 100));

  return (
    <section className="rounded-2xl border border-edge bg-surface p-5">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-semibold text-zinc-200">Storage</h2>
        {state && (
          <p className={`text-sm ${full ? "text-red-400" : "text-zinc-400"}`}>
            {gb(used)} of {gb(limit)} GB used
          </p>
        )}
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${
            full ? "bg-red-500" : "bg-cyan-glow"
          }`}
          style={{ width: state ? `${pct}%` : "0%" }}
        />
      </div>
      {full && (
        <p className="mt-2 text-xs text-red-400">
          Storage is full. Delete a match or request more space.
        </p>
      )}

      {state?.pending_request ? (
        <p className="mt-4 text-sm text-zinc-400">
          Request sent. You will hear back soon.
        </p>
      ) : formOpen ? (
        <div className="mt-4">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="What do you need the space for? (optional)"
            rows={3}
            className="w-full rounded-xl border border-edge bg-surface-2/40 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-cyan-glow/60 focus:outline-none"
          />
          {submitError && (
            <p className="mt-2 text-xs text-red-400">{submitError}</p>
          )}
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              onClick={() => void submitRequest()}
              disabled={submitting}
              className="glow-cta rounded-full bg-cyan-glow px-5 py-2 text-sm font-semibold text-ink disabled:opacity-60"
            >
              {submitting ? "Sending…" : "Send request"}
            </button>
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              disabled={submitting}
              className="rounded-full border border-edge px-5 py-2 text-sm text-zinc-300 transition-colors hover:text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          className="mt-4 rounded-full border border-edge px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white"
        >
          Request more space
        </button>
      )}

      {/* Plan management mounts here when PAYMENTS_ENABLED flips on. */}
      {PAYMENTS_ENABLED && <div data-slot="plan-section" />}
    </section>
  );
}
