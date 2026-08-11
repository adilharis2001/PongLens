"use client";

/**
 * The commerce control panel. Three groups: the switch and the free
 * allowances, the three pack lists, and the support grants. Config writes
 * are plain app_config updates (keys are seeded, so no INSERT policy is
 * needed); pack lists are edited as rows and stored as the same JSON the
 * purchase RPC validates against.
 */

import { useState } from "react";

import {
  parseMinutePacks,
  parseSponsoredPacks,
  parseStoragePacks,
} from "@/lib/commerce/packs";
import { createClient } from "@/lib/supabase/client";
import { AdminHeader } from "../AdminHeader";

interface Initial {
  enabled: boolean;
  freeMinutes: number;
  reviewMinutes: number;
  sponsoredFree: number;
  defaultGb: number;
  minutePacks: string;
  storagePacks: string;
  sponsoredPacks: string;
}

interface PackRow {
  key: string;
  qty: string;
  months?: string;
  price: string;
}

function packsToRows(json: string, kind: "minutes" | "gb" | "credits"): PackRow[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    raw = [];
  }
  const parsed =
    kind === "minutes"
      ? parseMinutePacks(raw).map((p) => ({
          key: p.key,
          qty: String(p.minutes),
          price: (p.priceCents / 100).toFixed(2),
        }))
      : kind === "gb"
        ? parseStoragePacks(raw).map((p) => ({
            key: p.key,
            qty: String(p.gb),
            months: String(p.months),
            price: (p.priceCents / 100).toFixed(2),
          }))
        : parseSponsoredPacks(raw).map((p) => ({
            key: p.key,
            qty: String(p.credits),
            price: (p.priceCents / 100).toFixed(2),
          }));
  return parsed;
}

function rowsToJson(rows: PackRow[], kind: "minutes" | "gb" | "credits"): string {
  const out = rows
    .map((r) => {
      const qty = Math.round(Number(r.qty));
      const cents = Math.round(Number(r.price) * 100);
      if (!Number.isFinite(qty) || qty <= 0) return null;
      if (!Number.isFinite(cents) || cents < 50) return null;
      const key = `${kind === "minutes" ? "m" : kind === "gb" ? "s" : "sp"}${qty}`;
      if (kind === "minutes") return { key, minutes: qty, price_cents: cents };
      if (kind === "credits") return { key, credits: qty, price_cents: cents };
      const months = Math.round(Number(r.months ?? "12"));
      return {
        key,
        gb: qty,
        months: Number.isFinite(months) && months > 0 ? months : 12,
        price_cents: cents,
      };
    })
    .filter((r) => r !== null);
  return JSON.stringify(out);
}

const FIELD =
  "w-24 rounded-xl border border-edge bg-surface-2/40 px-3 py-2 text-sm " +
  "text-zinc-100 focus:border-cyan-glow/60 focus:outline-none";
const PILL =
  "rounded-full border border-edge px-4 py-1.5 text-sm text-zinc-300 " +
  "transition-colors hover:border-cyan-glow/50 hover:text-white " +
  "disabled:opacity-50";

export function CommerceSection({ initial }: { initial: Initial }) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [freeMinutes, setFreeMinutes] = useState(String(initial.freeMinutes));
  const [reviewMinutes, setReviewMinutes] = useState(
    String(initial.reviewMinutes),
  );
  const [sponsoredFree, setSponsoredFree] = useState(
    String(initial.sponsoredFree),
  );
  const [defaultGb, setDefaultGb] = useState(String(initial.defaultGb));
  const [minuteRows, setMinuteRows] = useState(
    packsToRows(initial.minutePacks, "minutes"),
  );
  const [storageRows, setStorageRows] = useState(
    packsToRows(initial.storagePacks, "gb"),
  );
  const [sponsoredRows, setSponsoredRows] = useState(
    packsToRows(initial.sponsoredPacks, "credits"),
  );
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const write = async (key: string, value: string) => {
    setBusy(true);
    setFlash(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("app_config")
      .update({ value })
      .eq("key", key);
    setBusy(false);
    setFlash(error ? "Could not save. Try again." : "Saved.");
    setTimeout(() => setFlash(null), 1500);
  };

  const intOr = (s: string, fallback: number) => {
    const n = Math.round(Number(s));
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };

  const packEditor = (
    label: string,
    unit: string,
    rows: PackRow[],
    setRows: (r: PackRow[]) => void,
    kind: "minutes" | "gb" | "credits",
    configKey: string,
  ) => (
    <div className="mt-5">
      <p className="text-sm font-medium text-zinc-200">{label}</p>
      <div className="mt-2 space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
            <input
              value={r.qty}
              onChange={(e) => {
                const next = [...rows];
                next[i] = { ...r, qty: e.target.value };
                setRows(next);
              }}
              inputMode="numeric"
              aria-label={unit}
              className={FIELD}
            />
            <span className="text-zinc-500">{unit} for $</span>
            <input
              value={r.price}
              onChange={(e) => {
                const next = [...rows];
                next[i] = { ...r, price: e.target.value };
                setRows(next);
              }}
              inputMode="decimal"
              aria-label="price in dollars"
              className={FIELD}
            />
            {kind === "gb" && (
              <>
                <span className="text-zinc-500">·</span>
                <input
                  value={r.months ?? "12"}
                  onChange={(e) => {
                    const next = [...rows];
                    next[i] = { ...r, months: e.target.value };
                    setRows(next);
                  }}
                  inputMode="numeric"
                  aria-label="months"
                  className={FIELD}
                />
                <span className="text-zinc-500">months</span>
              </>
            )}
            <button
              type="button"
              onClick={() => setRows(rows.filter((_, j) => j !== i))}
              className="rounded-full border border-edge px-3 py-1 text-sm text-zinc-400 hover:border-amber-400/60 hover:text-amber-200"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() =>
            setRows([...rows, { key: "", qty: "", months: "12", price: "" }])
          }
          className={PILL}
        >
          Add a pack
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void write(configKey, rowsToJson(rows, kind))}
          className={PILL}
        >
          Save packs
        </button>
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-2xl">
      <AdminHeader title="Commerce" />

      <section className="mt-6 rounded-2xl border border-edge bg-surface p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-zinc-200">
              Purchases and minute charging
            </p>
            <p className="mt-0.5 text-xs text-zinc-500">
              Off means today&apos;s behavior: uploads process straight away
              and nothing is for sale.
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const next = !enabled;
              setEnabled(next);
              void write("commerce_enabled", next ? "true" : "false");
            }}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium ${
              enabled
                ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-300"
                : "border-edge text-zinc-400"
            }`}
          >
            {enabled ? "On" : "Off"}
          </button>
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-edge bg-surface p-5">
        <p className="text-sm font-medium text-zinc-200">Free allowances</p>
        <div className="mt-3 space-y-3 text-sm">
          <Row
            label="Minutes for a new account"
            value={freeMinutes}
            onChange={setFreeMinutes}
            onSave={() =>
              void write(
                "free_processing_minutes",
                String(intOr(freeMinutes, 250)),
              )
            }
            busy={busy}
          />
          <Row
            label="Storage for a new account (GB)"
            value={defaultGb}
            onChange={setDefaultGb}
            onSave={() =>
              void write(
                "default_storage_bytes",
                String(intOr(defaultGb, 10) * 1073741824),
              )
            }
            busy={busy}
          />
          <Row
            label="Minutes a review covers"
            value={reviewMinutes}
            onChange={setReviewMinutes}
            onSave={() =>
              void write(
                "review_included_minutes",
                String(intOr(reviewMinutes, 45)),
              )
            }
            busy={busy}
          />
          <Row
            label="Free sponsored reviews for a new coach"
            value={sponsoredFree}
            onChange={setSponsoredFree}
            onSave={() =>
              void write(
                "sponsored_free_credits",
                String(intOr(sponsoredFree, 3)),
              )
            }
            busy={busy}
          />
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-edge bg-surface p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Packs
        </p>
        {packEditor(
          "Processing minutes",
          "minutes",
          minuteRows,
          setMinuteRows,
          "minutes",
          "minute_packs",
        )}
        {packEditor(
          "Storage",
          "GB",
          storageRows,
          setStorageRows,
          "gb",
          "storage_packs",
        )}
        {packEditor(
          "Sponsored reviews",
          "reviews",
          sponsoredRows,
          setSponsoredRows,
          "credits",
          "sponsored_packs",
        )}
      </section>

      <GrantCard />

      <p aria-live="polite" className="mt-4 min-h-5 text-center text-xs">
        {flash && <span className="text-emerald-400">{flash}</span>}
      </p>
    </div>
  );
}

function Row({
  label,
  value,
  onChange,
  onSave,
  busy,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-zinc-300">{label}</span>
      <span className="flex items-center gap-2">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode="numeric"
          aria-label={label}
          className={FIELD}
        />
        <button type="button" disabled={busy} onClick={onSave} className={PILL}>
          Save
        </button>
      </span>
    </div>
  );
}

/**
 * The support path: grant or adjust by email. Negative numbers take
 * away; the response echoes the resulting balance so the admin sees the
 * effect immediately.
 */
function GrantCard() {
  const [email, setEmail] = useState("");
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<"minutes" | "storage" | "sponsored">(
    "minutes",
  );
  const [months, setMonths] = useState("12");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const grant = async () => {
    if (busy) return;
    setBusy(true);
    setResult(null);
    const supabase = createClient();
    const n = Math.round(Number(amount));
    const call =
      kind === "minutes"
        ? supabase.rpc("admin_grant_minutes", {
            p_email: email.trim(),
            p_minutes: n,
            p_note: note.trim() || null,
          })
        : kind === "storage"
          ? supabase.rpc("admin_grant_storage", {
              p_email: email.trim(),
              p_gb: n,
              p_months: Math.round(Number(months)) || 12,
              p_note: note.trim() || null,
            })
          : supabase.rpc("admin_grant_sponsored", {
              p_email: email.trim(),
              p_credits: n,
              p_note: note.trim() || null,
            });
    const { data, error } = await call;
    setBusy(false);
    if (error) {
      setResult(
        error.message.includes("user not found")
          ? "No account with that email."
          : "Could not grant. Check the values.",
      );
      return;
    }
    const balance = (data as { balance?: number } | null)?.balance;
    setResult(
      typeof balance === "number"
        ? `Done. New balance: ${balance}.`
        : "Done.",
    );
  };

  return (
    <section className="mt-4 rounded-2xl border border-edge bg-surface p-5">
      <p className="text-sm font-medium text-zinc-200">Grant to a player</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {(
          [
            ["minutes", "Minutes"],
            ["storage", "Storage (GB)"],
            ["sponsored", "Sponsored reviews"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
            className={`rounded-full border px-4 py-1.5 text-sm ${
              kind === k
                ? "border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow"
                : "border-edge text-zinc-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="player@email.com"
          aria-label="email"
          className="min-w-56 flex-1 rounded-xl border border-edge bg-surface-2/40 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-cyan-glow/60 focus:outline-none"
        />
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="250"
          inputMode="numeric"
          aria-label="amount"
          className={FIELD}
        />
        {kind === "storage" && (
          <>
            <input
              value={months}
              onChange={(e) => setMonths(e.target.value)}
              inputMode="numeric"
              aria-label="months"
              className={FIELD}
            />
            <span className="text-sm text-zinc-500">months</span>
          </>
        )}
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Why (optional)"
        aria-label="note"
        className="mt-2 w-full rounded-xl border border-edge bg-surface-2/40 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-cyan-glow/60 focus:outline-none"
      />
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          disabled={busy || !email.trim() || !amount.trim()}
          onClick={() => void grant()}
          className="glow-cta rounded-full bg-cyan-glow px-5 py-2 text-sm font-semibold text-ink disabled:opacity-50"
        >
          Grant
        </button>
        {result && <span className="text-sm text-zinc-400">{result}</span>}
      </div>
    </section>
  );
}
