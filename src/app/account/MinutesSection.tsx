"use client";

/**
 * Processing minutes on the Account page (096): the balance, the packs,
 * and the recent purchases. Packs come from admin config via the server
 * page; the purchase RPC re-validates against the same config, so what
 * this shows is what checkout will charge.
 */

import { useCallback, useEffect, useState } from "react";

import { formatMinutes } from "@/lib/commerce/minutes";
import type { MinutePack } from "@/lib/commerce/packs";
import { PackTiles } from "@/components/PackTiles";
import { formatUsd } from "@/lib/reviews/money";
import { createClient } from "@/lib/supabase/client";
import { AllowanceRequest } from "@/components/AllowanceRequest";

interface PurchaseRow {
  id: string;
  title: string;
  amount_cents: number;
  status: string;
  paid_at: string | null;
}

export function MinutesSection({ packs, purchasesEnabled = false }: { packs: MinutePack[]; purchasesEnabled?: boolean }) {
  const [balance, setBalance] = useState<number | null>(null);
  const [history, setHistory] = useState<PurchaseRow[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [stateRes, historyRes] = await Promise.all([
      supabase.rpc("my_processing_state").single(),
      supabase
        .from("platform_purchases")
        .select("id, title, amount_cents, status, paid_at")
        .eq("status", "paid")
        .eq("kind", "minute_pack")
        .order("paid_at", { ascending: false })
        .limit(5),
    ]);
    const state = stateRes.data as { minutes_balance?: number } | null;
    if (typeof state?.minutes_balance === "number") {
      setBalance(state.minutes_balance);
    }
    setHistory((historyRes.data ?? []) as PurchaseRow[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const buy = async (packKey: string) => {
    if (busyKey) return;
    setBusyKey(packKey);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "minute_pack", packKey, next: "/account" }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setError("Checkout did not open. Try again.");
        return;
      }
      window.location.assign(data.url);
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <section className="rounded-2xl border border-edge bg-surface p-5">
      <p className="text-sm font-medium text-zinc-200">
        {balance === null ? "Reading balance…" : `You have ${formatMinutes(balance)}.`}
      </p>
      <p className="mt-1 text-xs text-zinc-500">
        Processing is what turns a video into a match: the dead time cut
        out, every point its own clip. One minute of footage uses one
        minute from your balance, and trimming off the warm-up first uses
        fewer.
      </p>

      {purchasesEnabled && <div className="mt-4">
        <PackTiles
          tiles={packs.map((p) => ({
            key: p.key,
            amount: String(p.minutes),
            unit: p.minutes === 1 ? "minute" : "minutes",
            price: formatUsd(p.priceCents),
          }))}
          busy={busyKey !== null}
          onPick={(key) => void buy(key)}
        />
      </div>}
      {!purchasesEnabled && <AllowanceRequest resource="minutes" />}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

      {history.length > 0 && (
        <ul className="mt-4 space-y-1 border-t border-edge/60 pt-3">
          {history.map((h) => (
            <li
              key={h.id}
              className="flex items-baseline justify-between gap-3 text-xs text-zinc-500"
            >
              <span className="truncate">{h.title}</span>
              <span className="shrink-0 tabular-nums">
                {formatUsd(h.amount_cents)}
                {h.paid_at &&
                  ` · ${new Date(h.paid_at).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
