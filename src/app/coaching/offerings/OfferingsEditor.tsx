"use client";

import Link from "next/link";
import { useState } from "react";

import {
  coachShareCents,
  formatUsd,
  parseUsd,
  type ReviewFeeConfig,
} from "@/lib/reviews/money";
import { OFFERING_TEMPLATES } from "@/lib/reviews/templates";
import type {
  IntakeQuestion,
  OfferingRow,
  ReviewSectionDef,
} from "@/lib/reviews/types";
import { createClient } from "@/lib/supabase/client";

/**
 * Offerings are the product a coach sells, so the editor keeps every word
 * editable: templates only prefill. Lists (what's included, questions,
 * sections) edit as one-per-line text — the shape students see is built
 * from these lines at save time.
 */

function slug(label: string, i: number): string {
  const s = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return s || `item_${i + 1}`;
}

function toQuestions(text: string): IntakeQuestion[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 6)
    .map((line, i) => {
      const optional = /\(optional\)\s*$/i.test(line);
      const label = line.replace(/\s*\(optional\)\s*$/i, "");
      return { id: slug(label, i), label, optional };
    });
}

function fromQuestions(qs: IntakeQuestion[]): string {
  return qs
    .map((q) => (q.optional ? `${q.label} (optional)` : q.label))
    .join("\n");
}

function toSections(text: string): ReviewSectionDef[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((label, i) => ({ key: slug(label, i), label }));
}

const FIELD =
  "mt-2 w-full rounded-xl border border-edge bg-surface-2 px-4 py-3 " +
  "text-sm text-zinc-100 outline-none focus:border-cyan-glow/50";
const LABEL =
  "mt-5 block text-xs font-semibold uppercase tracking-wider text-zinc-500";

function OfferingCard({
  offering,
  feeConfig,
  onChanged,
}: {
  offering: OfferingRow;
  feeConfig: ReviewFeeConfig;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(offering.title === "");
  const [title, setTitle] = useState(offering.title);
  const [description, setDescription] = useState(offering.description);
  const [price, setPrice] = useState(
    (offering.price_cents / 100).toFixed(2).replace(/\.00$/, ""),
  );
  const [turnaround, setTurnaround] = useState(offering.turnaround_days);
  const [includes, setIncludes] = useState(offering.includes.join("\n"));
  const [questions, setQuestions] = useState(
    fromQuestions(offering.intake_questions),
  );
  const [sections, setSections] = useState(
    offering.review_sections.map((s) => s.label).join("\n"),
  );
  const [followups, setFollowups] = useState(offering.followup_rounds);
  const [active, setActive] = useState(offering.active);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const priceCents = parseUsd(price);
  const priceOk =
    priceCents !== null && priceCents >= 500 && priceCents <= 50000;
  const take = priceOk
    ? // Their share under the current fee config, less an estimate of card
      // processing (2.9% + 30¢), which comes out of the coach's side.
      Math.max(
        0,
        coachShareCents(priceCents, feeConfig) -
          Math.round(priceCents * 0.029 + 30),
      )
    : null;

  async function save() {
    if (!priceOk || !title.trim()) {
      setNote(
        !title.trim()
          ? "Give it a title."
          : "Price must be between $5 and $500.",
      );
      return;
    }
    setBusy(true);
    setNote(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("offerings")
      .update({
        title: title.trim().slice(0, 80),
        description: description.trim().slice(0, 1000),
        price_cents: priceCents,
        turnaround_days: turnaround,
        includes: includes
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .slice(0, 10),
        intake_questions: toQuestions(questions),
        review_sections: toSections(sections),
        followup_rounds: followups,
        active,
        updated_at: new Date().toISOString(),
      })
      .eq("id", offering.id);
    setBusy(false);
    if (error) {
      setNote("Could not save. Try again.");
      return;
    }
    setOpen(false);
    onChanged();
  }

  async function remove() {
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("offerings")
      .delete()
      .eq("id", offering.id);
    setBusy(false);
    if (error) {
      // Offerings with orders can't be deleted (FK restrict); retiring is
      // the supported path.
      setNote("This offering has orders. Turn it off instead.");
      return;
    }
    onChanged();
  }

  return (
    <div className="rounded-2xl border border-edge bg-surface">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-zinc-200">
            {title || "New offering"}
            {!active && (
              <span className="ml-2 text-xs font-normal text-zinc-500">
                off
              </span>
            )}
          </p>
        </div>
        <span className="shrink-0 text-sm font-medium tabular-nums text-zinc-300">
          {priceOk ? formatUsd(priceCents) : "—"}
        </span>
      </button>

      {open && (
        <div className="border-t border-edge/60 px-5 pb-5">
          <label className={LABEL}>Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={80}
            className={FIELD}
          />

          <label className={LABEL}>Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={1000}
            className={FIELD}
          />

          <div className="flex gap-4">
            <div className="flex-1">
              <label className={LABEL}>Price</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 mt-1 -translate-y-1/2 text-sm text-zinc-500">
                  $
                </span>
                <input
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  inputMode="decimal"
                  className={`${FIELD} pl-8`}
                />
              </div>
            </div>
            <div className="flex-1">
              <label className={LABEL}>Turnaround</label>
              <select
                value={turnaround}
                onChange={(e) => setTurnaround(Number(e.target.value))}
                className={FIELD}
              >
                {[1, 2, 3, 4, 5, 7, 10, 14, 21, 30].map((d) => (
                  <option key={d} value={d}>
                    {d} {d === 1 ? "day" : "days"}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {take !== null && (
            <p className="mt-2 text-xs text-zinc-500">
              You receive about {formatUsd(take)} after fees.
            </p>
          )}

          <label className={LABEL}>What's included</label>
          <textarea
            value={includes}
            onChange={(e) => setIncludes(e.target.value)}
            rows={4}
            className={FIELD}
            placeholder="One per line"
          />

          <label className={LABEL}>Questions for the student</label>
          <textarea
            value={questions}
            onChange={(e) => setQuestions(e.target.value)}
            rows={3}
            className={FIELD}
            placeholder={
              "One per line. End a line with (optional) to make it optional."
            }
          />

          <label className={LABEL}>Sections of your review</label>
          <textarea
            value={sections}
            onChange={(e) => setSections(e.target.value)}
            rows={3}
            className={FIELD}
            placeholder="One per line"
          />

          <div className="flex items-end gap-4">
            <div className="flex-1">
              <label className={LABEL}>Follow-up questions included</label>
              <select
                value={followups}
                onChange={(e) => setFollowups(Number(e.target.value))}
                className={FIELD}
              >
                {[0, 1, 2, 3].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex flex-1 cursor-pointer items-center justify-between rounded-xl border border-edge bg-surface-2 px-4 py-3 text-sm">
              <span className="text-zinc-300">Available to buy</span>
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                className="h-4 w-4 accent-cyan-400"
              />
            </label>
          </div>

          {note && <p className="mt-3 text-xs text-amber-400">{note}</p>}

          <div className="mt-6 flex items-center justify-between">
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="text-xs text-zinc-500 hover:text-amber-400"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="glow-cta rounded-full bg-cyan-glow px-6 py-2.5 text-sm font-semibold text-ink disabled:opacity-60"
            >
              {busy ? "Saving" : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function OfferingsEditor({
  initialOfferings,
  feeConfig,
}: {
  initialOfferings: OfferingRow[];
  feeConfig: ReviewFeeConfig;
}) {
  const [offerings, setOfferings] = useState(initialOfferings);
  const [creating, setCreating] = useState(false);

  async function refresh() {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from("offerings")
      .select("*")
      .eq("coach_id", user.id)
      .order("sort")
      .order("created_at");
    if (data) setOfferings(data as OfferingRow[]);
  }

  async function createFrom(templateKey: string) {
    if (creating) return;
    setCreating(true);
    const template = OFFERING_TEMPLATES.find((t) => t.key === templateKey);
    if (!template) return;
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("offerings").insert({
      coach_id: user.id,
      template_key: template.key,
      title: template.title,
      description: template.description,
      includes: template.includes,
      price_cents: template.price_cents,
      turnaround_days: template.turnaround_days,
      intake_questions: template.intake_questions,
      review_sections: template.review_sections,
      followup_rounds: template.followup_rounds,
      sort: offerings.length,
    });
    await refresh();
    setCreating(false);
  }

  return (
    <div className="mx-auto max-w-lg">
      <Link
        href="/coaching"
        className="text-xs font-medium text-zinc-500 hover:text-zinc-300"
      >
        ← Coaching
      </Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
        Offerings
      </h1>

      <div className="mt-6 space-y-4">
        {offerings.map((o) => (
          <OfferingCard
            key={`${o.id}-${o.updated_at}`}
            offering={o}
            feeConfig={feeConfig}
            onChanged={refresh}
          />
        ))}
        {offerings.length === 0 && (
          <p className="text-sm text-zinc-500">
            Start from a template. Every word stays editable.
          </p>
        )}
      </div>

      <h2 className="mt-10 mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        {offerings.length > 0 ? "Add another" : "Templates"}
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {OFFERING_TEMPLATES.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => createFrom(t.key)}
            disabled={creating}
            className="rounded-2xl border border-edge bg-surface p-4 text-left transition-colors hover:border-cyan-glow/40 disabled:opacity-60"
          >
            <p className="text-sm font-semibold text-zinc-200">{t.name}</p>
            <p className="mt-1 text-xs text-zinc-500">{t.blurb}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
