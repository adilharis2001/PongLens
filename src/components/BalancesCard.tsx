"use client";

/**
 * The balances card (096): processing minutes and storage in one tile,
 * tapping through to Account where they change. It sits at the bottom of
 * Home and Upload — the two places the next upload gets decided — and
 * renders nothing until both numbers are in hand.
 */

import { useEffect, useState } from "react";
import Link from "next/link";

import { formatGb } from "@/lib/commerce/minutes";
import { createClient } from "@/lib/supabase/client";

export function BalancesCard() {
  const [balances, setBalances] = useState<{
    minutes: number;
    usedBytes: number;
    limitBytes: number;
  } | null>(null);

  useEffect(() => {
    const supabase = createClient();
    void Promise.all([
      supabase.rpc("my_processing_state").single(),
      supabase.rpc("my_storage_state").single(),
    ]).then(([m, s]) => {
      const minutes = (m.data as { minutes_balance?: number } | null)
        ?.minutes_balance;
      const storage = s.data as {
        used_bytes?: number;
        storage_limit_bytes?: number;
      } | null;
      if (typeof minutes === "number" && storage?.storage_limit_bytes) {
        setBalances({
          minutes,
          usedBytes: Number(storage.used_bytes ?? 0),
          limitBytes: Number(storage.storage_limit_bytes),
        });
      }
    });
  }, []);

  if (!balances) return null;
  return (
    <Link
      href="/account"
      className="flex items-end gap-6 rounded-2xl border border-edge bg-surface px-5 py-4 transition-colors hover:border-cyan-glow/40"
    >
      <div>
        <p className="text-lg font-semibold tabular-nums text-zinc-100">
          {balances.minutes}
        </p>
        <p className="text-xs text-zinc-500">
          processing minute{balances.minutes === 1 ? "" : "s"}
        </p>
      </div>
      <div>
        <p className="text-lg font-semibold tabular-nums text-zinc-100">
          {formatGb(balances.usedBytes)}
          <span className="text-sm font-normal text-zinc-500">
            {" "}
            of {formatGb(balances.limitBytes)}
          </span>
        </p>
        <p className="text-xs text-zinc-500">storage used</p>
      </div>
    </Link>
  );
}
