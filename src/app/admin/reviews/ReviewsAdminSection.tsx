"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { formatUsd } from "@/lib/reviews/money";
import { createClient } from "@/lib/supabase/client";
import { UpLink } from "@/components/UpLink";

interface AdminOrder {
  id: string;
  status: string;
  offering_title: string;
  coach_name: string;
  student_name: string;
  price_cents: number;
  fee_cents: number;
  fee_mode: string;
  billing_mode?: "live" | "test";
  refunded: boolean;
  paid_out: boolean;
  disputed_at: string | null;
  created_at: string;
  completed_at: string | null;
}

interface FeeConfig {
  enabled: boolean;
  mode: "percent" | "fixed";
  percent: number;
  fixedCents: number;
}

export function ReviewsAdminSection({
  initialOrders,
  initialConfig,
}: {
  initialOrders: AdminOrder[];
  initialConfig: FeeConfig;
}) {
  const router = useRouter();
  const [cfg, setCfg] = useState(initialConfig);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);

  async function saveConfig(next: FeeConfig) {
    setCfg(next);
    setBusy(true);
    const supabase = createClient();
    // The four keys are seeded by migration 073, so plain updates suffice
    // (and avoid needing an INSERT policy on app_config).
    await Promise.all([
      supabase
        .from("app_config")
        .update({ value: next.enabled ? "true" : "false" })
        .eq("key", "coach_reviews_enabled"),
      supabase
        .from("app_config")
        .update({ value: next.mode })
        .eq("key", "review_fee_mode"),
      supabase
        .from("app_config")
        .update({ value: String(Math.round(next.percent)) })
        .eq("key", "review_fee_percent"),
      supabase
        .from("app_config")
        .update({ value: String(Math.round(next.fixedCents)) })
        .eq("key", "review_fee_fixed_cents"),
    ]);
    setBusy(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  }

  async function cancelOrder(id: string) {
    setBusy(true);
    await fetch("/api/admin/review-refund", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderId: id }),
    }).catch(() => {});
    setBusy(false);
    setCancelling(null);
    router.refresh();
  }

  // Test orders (092) are fake money between QA accounts; they stay in
  // the list with a chip but never count as fees.
  const money = initialOrders
    .filter((o) => o.status === "completed" && o.billing_mode !== "test")
    .reduce((sum, o) => sum + o.fee_cents, 0);

  return (
    <>
      <UpLink href="/admin" label="Admin" />
      <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
        Paid reviews
      </h1>

      <div className="mt-6 rounded-2xl border border-edge bg-surface p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-zinc-200">
              Purchases {cfg.enabled ? "on" : "off"}
            </p>
            <p className="mt-0.5 text-xs text-zinc-500">
              The kill switch. Coach tools stay visible either way.
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void saveConfig({ ...cfg, enabled: !cfg.enabled })}
            className={
              cfg.enabled
                ? "rounded-full border border-edge px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-surface-2"
                : "glow-cta rounded-full bg-cyan-glow px-4 py-2 text-xs font-semibold text-ink"
            }
          >
            {cfg.enabled ? "Turn off" : "Turn on"}
          </button>
        </div>

        <div className="mt-5 flex flex-wrap items-end gap-4 border-t border-edge/60 pt-5">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Fee
            </label>
            <select
              value={cfg.mode}
              onChange={(e) =>
                void saveConfig({
                  ...cfg,
                  mode: e.target.value === "fixed" ? "fixed" : "percent",
                })
              }
              className="mt-2 rounded-xl border border-edge bg-surface-2 px-3 py-2 text-sm text-zinc-200 outline-none"
            >
              <option value="percent">Percent of price</option>
              <option value="fixed">Flat per review</option>
            </select>
          </div>
          {cfg.mode === "percent" ? (
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Percent
              </label>
              <input
                type="number"
                min={0}
                max={50}
                value={cfg.percent}
                onChange={(e) =>
                  setCfg({ ...cfg, percent: Number(e.target.value) })
                }
                onBlur={() => void saveConfig(cfg)}
                className="mt-2 w-24 rounded-xl border border-edge bg-surface-2 px-3 py-2 text-sm tabular-nums text-zinc-200 outline-none"
              />
            </div>
          ) : (
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Dollars
              </label>
              <input
                type="number"
                min={0}
                max={100}
                value={cfg.fixedCents / 100}
                onChange={(e) =>
                  setCfg({ ...cfg, fixedCents: Number(e.target.value) * 100 })
                }
                onBlur={() => void saveConfig(cfg)}
                className="mt-2 w-24 rounded-xl border border-edge bg-surface-2 px-3 py-2 text-sm tabular-nums text-zinc-200 outline-none"
              />
            </div>
          )}
          <p className="pb-2 text-xs text-zinc-500">
            Applies to new orders only.{" "}
            {saved && <span className="text-cyan-glow">Saved.</span>}
          </p>
        </div>
      </div>

      {money > 0 && (
        <p className="mt-4 text-sm text-zinc-400">
          {formatUsd(money)} in fees from completed orders.
        </p>
      )}

      <div className="mt-6 overflow-x-auto rounded-2xl border border-edge bg-surface">
        {initialOrders.length === 0 ? (
          <p className="px-5 py-6 text-sm text-zinc-500">No orders yet.</p>
        ) : (
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-edge/60 text-xs uppercase tracking-wider text-zinc-500">
                <th className="px-5 py-3 font-semibold">Order</th>
                <th className="px-3 py-3 font-semibold">Status</th>
                <th className="px-3 py-3 text-right font-semibold">Price</th>
                <th className="px-3 py-3 text-right font-semibold">Fee</th>
                <th className="px-5 py-3 text-right font-semibold"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge/40">
              {initialOrders.map((o) => (
                <tr key={o.id}>
                  <td className="px-5 py-3">
                    <p className="font-medium text-zinc-200">
                      {o.student_name}
                      <span className="text-zinc-500"> → {o.coach_name}</span>
                      {o.billing_mode === "test" && (
                        <span className="ml-2 rounded-full border border-edge bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                          Test
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {o.offering_title} ·{" "}
                      {new Date(o.created_at).toLocaleDateString()}
                    </p>
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={
                        o.disputed_at
                          ? "text-amber-400"
                          : o.status === "completed"
                            ? "text-zinc-300"
                            : "text-zinc-400"
                      }
                    >
                      {o.disputed_at ? "disputed" : o.status}
                      {o.refunded && " · refunded"}
                      {o.paid_out && " · paid out"}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-zinc-300">
                    {formatUsd(o.price_cents)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-zinc-400">
                    {formatUsd(o.fee_cents)}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {!["completed", "declined", "cancelled"].includes(
                      o.status,
                    ) &&
                      (cancelling === o.id ? (
                        <span className="whitespace-nowrap">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void cancelOrder(o.id)}
                            className="text-xs font-medium text-amber-400"
                          >
                            Confirm refund
                          </button>
                          <button
                            type="button"
                            onClick={() => setCancelling(null)}
                            className="ml-3 text-xs text-zinc-500"
                          >
                            Keep
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setCancelling(o.id)}
                          className="text-xs text-zinc-500 hover:text-amber-400"
                        >
                          Cancel + refund
                        </button>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
