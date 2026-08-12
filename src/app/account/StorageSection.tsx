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
  packs = [],
}: {
  // Commerce (096): 12-month storage packs from admin config. Empty
  // before the flip — the section then reads exactly as it always has.
  packs?: StoragePack[];
}) {
  const [state, setState] = useState<StorageState | null>(null);
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
          Storage holds your match videos, so your playing history lives in
          one place instead of scattered across phones. Your uploads and
          their cut versions count toward the space. Point clips and notes
          don&apos;t.
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

      {submitError && (
        <p className="mt-2 text-xs text-red-400">{submitError}</p>
      )}

      {/* Plan management mounts here when PAYMENTS_ENABLED flips on. */}
      {PAYMENTS_ENABLED && <div data-slot="plan-section" />}
    </section>
  );
}
