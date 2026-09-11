"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatCost } from "@/lib/costs/calculations";
import type {
  CostCategory,
  CostFixedItem,
  CostOneTimeItem,
} from "@/lib/costs/types";

/**
 * Where every bill that is not metered gets entered.
 *
 * The fixed-cost table existed from the day the cost dashboard shipped and
 * had never held a single row, because the RPC that writes it was never
 * given a caller. Everything predictable about the bill — the database
 * plan, the mailbox, the subscriptions the product is built with — read as
 * zero, which is why the page could not answer what a month actually
 * costs. This tab is that missing caller.
 *
 * Running and building live in one editor on purpose: they are both "a
 * thing I pay for", entered from the same invoice in the same sitting, and
 * splitting the form in two would mean deciding which half a new bill
 * belongs to before you can type it. They stay separated in every TOTAL,
 * which is where the separation matters.
 */

const INPUT =
  "h-10 w-full rounded-xl border border-edge bg-surface-2/40 px-3 text-sm " +
  "text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-glow/50 focus:outline-none";
const LABEL = "block text-xs font-medium text-zinc-400";
const PRIMARY =
  "glow-cta rounded-full bg-cyan-glow px-5 py-2 text-sm font-semibold text-ink disabled:opacity-50";
const SECONDARY =
  "rounded-full border border-edge px-4 py-2 text-sm text-zinc-300 transition-colors hover:text-white disabled:opacity-50";

type FixedDraft = {
  id: string | null;
  provider: string;
  label: string;
  amount: string;
  recurrence: "monthly" | "annual";
  category: CostCategory;
  effectiveFrom: string;
  enabled: boolean;
  note: string;
};

type OneTimeDraft = {
  id: string | null;
  provider: string;
  label: string;
  amount: string;
  incurredOn: string;
  category: CostCategory;
  note: string;
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyFixed(category: CostCategory): FixedDraft {
  return {
    id: null,
    provider: "",
    label: "",
    amount: "",
    recurrence: "monthly",
    category,
    effectiveFrom: today(),
    enabled: true,
    note: "",
  };
}

function emptyOneTime(): OneTimeDraft {
  return {
    id: null,
    provider: "",
    label: "",
    amount: "",
    incurredOn: today(),
    category: "build",
    note: "",
  };
}

function fixedToDraft(item: CostFixedItem): FixedDraft {
  return {
    id: item.id,
    provider: item.provider,
    label: item.label,
    amount: String(item.amount_usd),
    recurrence: item.recurrence,
    category: item.category,
    effectiveFrom: item.effective_from.slice(0, 10),
    enabled: item.enabled,
    note: item.note ?? "",
  };
}

function oneTimeToDraft(item: CostOneTimeItem): OneTimeDraft {
  return {
    id: item.id,
    provider: item.provider,
    label: item.label,
    amount: String(item.amount_usd),
    incurredOn: item.incurred_on.slice(0, 10),
    category: item.category,
    note: item.note ?? "",
  };
}

export function CostBuildingTab({
  fixedItems,
  oneTimeItems,
  monthlyBuildUsd,
  monthlyRunUsd,
  onChanged,
}: {
  fixedItems: CostFixedItem[];
  oneTimeItems: CostOneTimeItem[];
  monthlyBuildUsd: number;
  monthlyRunUsd: number;
  onChanged: () => void;
}) {
  const [fixedDraft, setFixedDraft] = useState<FixedDraft | null>(null);
  const [oneTimeDraft, setOneTimeDraft] = useState<OneTimeDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const call = async (fn: string, args: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    const { error: rpcError } = await createClient().rpc(fn, args);
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return false;
    }
    onChanged();
    return true;
  };

  const saveFixed = async (draft: FixedDraft) => {
    const amount = Number(draft.amount);
    if (!draft.provider.trim() || !draft.label.trim() || !(amount >= 0)) {
      setError("A recurring cost needs a provider, a name and an amount.");
      return;
    }
    const ok = await call("admin_upsert_cost_fixed_item", {
      p_provider: draft.provider,
      p_label: draft.label,
      p_amount_usd: amount,
      p_effective_from: draft.effectiveFrom,
      p_recurrence: draft.recurrence,
      p_category: draft.category,
      p_enabled: draft.enabled,
      p_note: draft.note || null,
      p_id: draft.id,
    });
    if (ok) setFixedDraft(null);
  };

  const saveOneTime = async (draft: OneTimeDraft) => {
    const amount = Number(draft.amount);
    if (!draft.provider.trim() || !draft.label.trim() || !(amount >= 0)) {
      setError("A one-time cost needs a provider, a name and an amount.");
      return;
    }
    const ok = await call("admin_upsert_cost_one_time_item", {
      p_provider: draft.provider,
      p_label: draft.label,
      p_amount_usd: amount,
      p_incurred_on: draft.incurredOn,
      p_category: draft.category,
      p_note: draft.note || null,
      p_id: draft.id,
    });
    if (ok) setOneTimeDraft(null);
  };

  const build = fixedItems.filter((item) => item.category === "build");
  const run = fixedItems.filter((item) => item.category === "run");
  const oneTimeTotal = oneTimeItems.reduce(
    (sum, item) => sum + Number(item.amount_usd || 0),
    0,
  );

  return (
    <div className="mt-6 space-y-6">
      {error && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
          <p className="text-sm text-amber-200">{error}</p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Figure
          label="Building, every month"
          value={formatCost(monthlyBuildUsd)}
          detail="Subscriptions and tools that make the product"
        />
        <Figure
          label="Running, every month"
          value={formatCost(monthlyRunUsd)}
          detail="The recurring floor under every player"
        />
        <Figure
          label="One-time, in this period"
          value={formatCost(oneTimeTotal)}
          detail={
            oneTimeItems.length === 1
              ? "1 purchase"
              : `${oneTimeItems.length} purchases`
          }
        />
      </div>

      <section className="overflow-hidden rounded-2xl border border-edge bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-edge px-5 py-4">
          <h3 className="text-sm font-semibold text-zinc-200">Every month</h3>
          <button
            type="button"
            className={SECONDARY}
            onClick={() => setFixedDraft(emptyFixed("build"))}
          >
            Add a recurring cost
          </button>
        </div>

        {fixedDraft && fixedDraft.id === null && (
          <FixedForm
            draft={fixedDraft}
            setDraft={setFixedDraft}
            onSave={saveFixed}
            onCancel={() => setFixedDraft(null)}
            busy={busy}
          />
        )}

        {fixedItems.length === 0 && !fixedDraft ? (
          <p className="px-5 py-6 text-sm text-zinc-500">
            No recurring costs yet.
          </p>
        ) : (
          <ul className="divide-y divide-edge/60">
            {[...build, ...run].map((item) =>
              fixedDraft?.id === item.id ? (
                <li key={item.id}>
                  <FixedForm
                    draft={fixedDraft}
                    setDraft={setFixedDraft}
                    onSave={saveFixed}
                    onCancel={() => setFixedDraft(null)}
                    onDelete={async () => {
                      const ok = await call("admin_delete_cost_fixed_item", {
                        p_id: item.id,
                      });
                      if (ok) setFixedDraft(null);
                    }}
                    busy={busy}
                  />
                </li>
              ) : (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center gap-3 px-5 py-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-zinc-200">
                      {item.label}
                      <CategoryBadge category={item.category} />
                      {!item.enabled && (
                        <span className="rounded-full border border-edge px-2 py-0.5 text-[11px] font-normal text-zinc-500">
                          Stopped
                        </span>
                      )}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {item.provider} · since {item.effective_from.slice(0, 10)}
                      {item.note ? ` · ${item.note}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm tabular-nums text-zinc-200">
                      {formatCost(item.amount_usd)}
                      <span className="text-zinc-500">
                        {item.recurrence === "annual" ? "/yr" : "/mo"}
                      </span>
                    </p>
                    {item.recurrence === "annual" && (
                      <p className="text-[11px] tabular-nums text-zinc-600">
                        {formatCost(item.monthly_cost_usd)}/mo
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    className={SECONDARY}
                    onClick={() => setFixedDraft(fixedToDraft(item))}
                  >
                    Edit
                  </button>
                </li>
              ),
            )}
          </ul>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-edge bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-edge px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold text-zinc-200">One-time</h3>
            <p className="mt-1 text-xs text-zinc-500">
              Counted in the month it was paid, never spread across months.
            </p>
          </div>
          <button
            type="button"
            className={SECONDARY}
            onClick={() => setOneTimeDraft(emptyOneTime())}
          >
            Add a purchase
          </button>
        </div>

        {oneTimeDraft && oneTimeDraft.id === null && (
          <OneTimeForm
            draft={oneTimeDraft}
            setDraft={setOneTimeDraft}
            onSave={saveOneTime}
            onCancel={() => setOneTimeDraft(null)}
            busy={busy}
          />
        )}

        {oneTimeItems.length === 0 && !oneTimeDraft ? (
          <p className="px-5 py-6 text-sm text-zinc-500">
            Nothing bought in this period.
          </p>
        ) : (
          <ul className="divide-y divide-edge/60">
            {oneTimeItems.map((item) =>
              oneTimeDraft?.id === item.id ? (
                <li key={item.id}>
                  <OneTimeForm
                    draft={oneTimeDraft}
                    setDraft={setOneTimeDraft}
                    onSave={saveOneTime}
                    onCancel={() => setOneTimeDraft(null)}
                    onDelete={async () => {
                      const ok = await call("admin_delete_cost_one_time_item", {
                        p_id: item.id,
                      });
                      if (ok) setOneTimeDraft(null);
                    }}
                    busy={busy}
                  />
                </li>
              ) : (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center gap-3 px-5 py-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-zinc-200">
                      {item.label}
                      <CategoryBadge category={item.category} />
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {item.provider} · {item.incurred_on.slice(0, 10)}
                      {item.note ? ` · ${item.note}` : ""}
                    </p>
                  </div>
                  <p className="text-sm tabular-nums text-zinc-200">
                    {formatCost(item.amount_usd)}
                  </p>
                  <button
                    type="button"
                    className={SECONDARY}
                    onClick={() => setOneTimeDraft(oneTimeToDraft(item))}
                  >
                    Edit
                  </button>
                </li>
              ),
            )}
          </ul>
        )}
      </section>
    </div>
  );
}

function Figure({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-edge bg-surface p-5">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-zinc-100">
        {value}
      </p>
      <p className="mt-1 text-xs text-zinc-500">{detail}</p>
    </div>
  );
}

function CategoryBadge({ category }: { category: CostCategory }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[11px] font-normal ${
        category === "build"
          ? "border-cyan-glow/30 text-cyan-glow"
          : "border-edge text-zinc-400"
      }`}
    >
      {category === "build" ? "Building" : "Running"}
    </span>
  );
}

function CategoryChoice({
  value,
  onChange,
}: {
  value: CostCategory;
  onChange: (next: CostCategory) => void;
}) {
  return (
    <div>
      <span className={LABEL}>What kind of cost</span>
      <div className="mt-1 flex gap-1 rounded-full border border-edge p-1">
        {(["run", "build"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={`flex-1 rounded-full px-3 py-1.5 text-xs transition-colors ${
              value === option
                ? "bg-zinc-100 text-zinc-950"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            {option === "run" ? "Running" : "Building"}
          </button>
        ))}
      </div>
    </div>
  );
}

function FixedForm({
  draft,
  setDraft,
  onSave,
  onCancel,
  onDelete,
  busy,
}: {
  draft: FixedDraft;
  setDraft: (next: FixedDraft) => void;
  onSave: (draft: FixedDraft) => void;
  onCancel: () => void;
  onDelete?: () => void;
  busy: boolean;
}) {
  return (
    <form
      className="space-y-4 border-b border-edge bg-surface-2/20 px-5 py-5"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(draft);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          <span className={LABEL}>Who charges it</span>
          <input
            className={`mt-1 ${INPUT}`}
            value={draft.provider}
            placeholder="Supabase"
            onChange={(e) => setDraft({ ...draft, provider: e.target.value })}
          />
        </label>
        <label>
          <span className={LABEL}>What it is</span>
          <input
            className={`mt-1 ${INPUT}`}
            value={draft.label}
            placeholder="Database and auth plan"
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          />
        </label>
        <label>
          <span className={LABEL}>Amount on the invoice</span>
          <input
            className={`mt-1 ${INPUT}`}
            value={draft.amount}
            inputMode="decimal"
            placeholder="50"
            onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
          />
        </label>
        <div>
          <span className={LABEL}>How often</span>
          <div className="mt-1 flex gap-1 rounded-full border border-edge p-1">
            {(["monthly", "annual"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setDraft({ ...draft, recurrence: option })}
                className={`flex-1 rounded-full px-3 py-1.5 text-xs transition-colors ${
                  draft.recurrence === option
                    ? "bg-zinc-100 text-zinc-950"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                {option === "monthly" ? "Every month" : "Every year"}
              </button>
            ))}
          </div>
        </div>
        <CategoryChoice
          value={draft.category}
          onChange={(category) => setDraft({ ...draft, category })}
        />
        <label>
          <span className={LABEL}>Paying since</span>
          <input
            type="date"
            className={`mt-1 ${INPUT}`}
            value={draft.effectiveFrom}
            onChange={(e) =>
              setDraft({ ...draft, effectiveFrom: e.target.value })
            }
          />
        </label>
        <label className="sm:col-span-2">
          <span className={LABEL}>Note</span>
          <input
            className={`mt-1 ${INPUT}`}
            value={draft.note}
            placeholder="Optional"
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
          />
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm text-zinc-300">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
          className="h-4 w-4 rounded border-edge bg-surface-2"
        />
        Still paying for this
      </label>

      <div className="flex flex-wrap gap-2">
        <button type="submit" className={PRIMARY} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className={SECONDARY}
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </button>
        {onDelete && (
          <button
            type="button"
            className="rounded-full border border-amber-500/40 px-4 py-2 text-sm text-amber-300 transition-colors hover:bg-amber-500/10 disabled:opacity-50"
            onClick={onDelete}
            disabled={busy}
          >
            Remove
          </button>
        )}
      </div>
    </form>
  );
}

function OneTimeForm({
  draft,
  setDraft,
  onSave,
  onCancel,
  onDelete,
  busy,
}: {
  draft: OneTimeDraft;
  setDraft: (next: OneTimeDraft) => void;
  onSave: (draft: OneTimeDraft) => void;
  onCancel: () => void;
  onDelete?: () => void;
  busy: boolean;
}) {
  return (
    <form
      className="space-y-4 border-b border-edge bg-surface-2/20 px-5 py-5"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(draft);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          <span className={LABEL}>Who charged it</span>
          <input
            className={`mt-1 ${INPUT}`}
            value={draft.provider}
            placeholder="Apple"
            onChange={(e) => setDraft({ ...draft, provider: e.target.value })}
          />
        </label>
        <label>
          <span className={LABEL}>What it was</span>
          <input
            className={`mt-1 ${INPUT}`}
            value={draft.label}
            placeholder="Developer Program"
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          />
        </label>
        <label>
          <span className={LABEL}>Amount</span>
          <input
            className={`mt-1 ${INPUT}`}
            value={draft.amount}
            inputMode="decimal"
            placeholder="99"
            onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
          />
        </label>
        <label>
          <span className={LABEL}>When</span>
          <input
            type="date"
            className={`mt-1 ${INPUT}`}
            value={draft.incurredOn}
            onChange={(e) => setDraft({ ...draft, incurredOn: e.target.value })}
          />
        </label>
        <CategoryChoice
          value={draft.category}
          onChange={(category) => setDraft({ ...draft, category })}
        />
        <label>
          <span className={LABEL}>Note</span>
          <input
            className={`mt-1 ${INPUT}`}
            value={draft.note}
            placeholder="Optional"
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="submit" className={PRIMARY} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className={SECONDARY}
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </button>
        {onDelete && (
          <button
            type="button"
            className="rounded-full border border-amber-500/40 px-4 py-2 text-sm text-amber-300 transition-colors hover:bg-amber-500/10 disabled:opacity-50"
            onClick={onDelete}
            disabled={busy}
          >
            Remove
          </button>
        )}
      </div>
    </form>
  );
}
