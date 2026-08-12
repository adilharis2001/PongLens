"use client";

import { useCallback, useEffect, useState } from "react";
import type { StoragePack } from "@/lib/commerce/packs";
import { PackTiles } from "@/components/PackTiles";
import { createClient } from "@/lib/supabase/client";
import { PAYMENTS_ENABLED } from "@/lib/flags";
import type { StorageState } from "@/lib/quota";
import { formatUsd } from "@/lib/reviews/money";

const GB = 1024 ** 3;

function gb(n: number, decimals = 1) {
  const v = n / GB;
  const rounded = v.toFixed(decimals);
  return rounded.endsWith(".0") ? rounded.slice(0, -2) : rounded;
}

export function StorageSection({
  userId,
  packs = [],
}: {
  userId: string;
  // Commerce (096): 12-month storage packs from admin config. Empty
  // before the flip — the section then reads exactly as it always has.
  packs?: StoragePack[];
}) {
  const [state, setState] = useState<StorageState | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [buyingKey, setBuyingKey] = useState<string | null>(null);

  const buy = async (packKey: string) => {
    if (buyingKey) return;
    setBuyingKey(packKey);
    setSubmitError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "storage", packKey, next: "/account" }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setSubmitError("Checkout did not open. Try again.");
        return;
      }
      window.location.assign(data.url);
    } finally {
      setBuyingKey(null);
    }
  };

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
  const limit = state?.storage_limit_bytes ?? 5 * GB;
  const full = state !== null && used >= limit;
  const pct = Math.min(100, Math.round((used / limit) * 100));

  return (
    <section className="rounded-2xl border border-edge bg-surface p-5">
      {/* The page's group label says "Storage"; the card leads with the
          number itself. */}
      <p
        className={`text-sm font-medium ${full ? "text-red-400" : "text-zinc-200"}`}
      >
        {state ? `${gb(used)} of ${gb(limit)} GB used` : "Reading usage…"}
      </p>
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
          Storage is full. Your videos stay put; delete some or add space to
          upload more.
        </p>
      )}
      {(state?.entitlement_bytes ?? 0) > 0 && state?.entitlement_expires_at && (
        <p className="mt-2 text-xs text-zinc-500">
          Includes {gb(state.entitlement_bytes ?? 0)} GB of purchased space
          until{" "}
          {new Date(state.entitlement_expires_at).toLocaleDateString(
            undefined,
            { month: "long", day: "numeric", year: "numeric" },
          )}
          .
        </p>
      )}

      {packs.length > 0 && (
        <p className="mt-2 text-xs text-zinc-500">
          Your videos and their cut versions count here. Point clips and
          notes don&apos;t.
        </p>
      )}
      {packs.length > 0 && (
        <div className="mt-4">
          <PackTiles
            tiles={packs.map((p) => ({
              key: p.key,
              amount: String(p.gb),
              unit: "GB",
              price: formatUsd(p.priceCents),
              note:
                p.months === 12 ? "for a year" : `for ${p.months} months`,
            }))}
            busy={buyingKey !== null}
            onPick={(key) => void buy(key)}
          />
        </div>
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
          className={
            packs.length > 0
              ? "mt-3 text-xs text-zinc-500 underline decoration-zinc-600 underline-offset-2 transition-colors hover:text-zinc-300"
              : "mt-4 rounded-full border border-edge px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white"
          }
        >
          Request more space
        </button>
      )}

      {/* Plan management mounts here when PAYMENTS_ENABLED flips on. */}
      {PAYMENTS_ENABLED && <div data-slot="plan-section" />}
    </section>
  );
}
