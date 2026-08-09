"use client";

import { useEffect, useRef, useState } from "react";

import { AutoTextarea } from "@/components/AutoTextarea";
import { UpLink } from "@/components/UpLink";
import {
  coachShareCents,
  formatUsd,
  parseUsd,
  type ReviewFeeConfig,
} from "@/lib/reviews/money";
import {
  OFFERING_TEMPLATES,
  STOCK_IMAGES,
  templateByKey,
  type OfferingTemplate,
} from "@/lib/reviews/templates";
import type {
  IntakeQuestion,
  OfferingRow,
  ReviewSectionDef,
} from "@/lib/reviews/types";
import { stockImageUrl } from "@/lib/reviews/types";
import { createClient } from "@/lib/supabase/client";

/**
 * Offerings are the product a coach sells, so building one is deliberate:
 * picking a template opens a prefilled draft to shape and confirm, never
 * an instant insert. Custom starts from a genuinely blank page. Lists
 * (what's included, questions, sections) edit as one-per-line text.
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
  "block text-xs font-semibold uppercase tracking-wider text-zinc-500";

/**
 * A field label with its meaning one tap away.
 *
 * Building an offering asks a coach to decide eleven things, several of
 * which only make sense once you know where they land: questions reach
 * the student at checkout, sections are the boxes you type into later,
 * patterns are for nobody but you. Explaining that under every label
 * would bury the form, so it waits behind the mark and opens in place.
 * In place rather than floating, because this form scrolls inside a
 * panel and a positioned bubble would eventually be clipped by it.
 */
function HintBox({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 rounded-xl border border-edge bg-surface-2/40 px-4 py-3 text-sm leading-relaxed text-zinc-400">
      {children}
    </p>
  );
}

function FieldLabel({
  text,
  hint,
  open,
  onToggle,
}: {
  text: string;
  hint: string;
  /**
   * Left out, the label owns its own box and draws it directly underneath.
   * Two fields share a row here (price beside turnaround), and a box grown
   * inside one column would leave the other column's input floating at the
   * old height, so those two hand the open state up and the row prints one
   * box beneath itself.
   */
  open?: boolean;
  onToggle?: () => void;
}) {
  const [self, setSelf] = useState(false);
  const isOpen = open ?? self;
  return (
    <>
      <div className="mt-5 flex items-center gap-2">
        <label className={LABEL}>{text}</label>
        <button
          type="button"
          onClick={onToggle ?? (() => setSelf((v) => !v))}
          aria-expanded={isOpen}
          aria-label={`More about ${text}`}
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold transition-colors ${
            isOpen
              ? "border-cyan-glow/60 text-cyan-glow"
              : "border-edge text-zinc-500 hover:border-cyan-glow/40 hover:text-zinc-300"
          }`}
        >
          i
        </button>
      </div>
      {open === undefined && isOpen && <HintBox>{hint}</HintBox>}
    </>
  );
}

/** Said once, so the builder and the edit card cannot drift apart. */
const HINTS = {
  title:
    "The name on your card and in their orders. Keep it short, since students scan a page of these.",
  description:
    "A sentence or two under the title, on what you look at and what comes back.",
  image: "The picture on your card. Use one of ours or upload your own.",
  price:
    "What a student pays. The line underneath shows what reaches you once our fee and the card charges come out.",
  turnaround:
    "How long you have to write the review. The clock starts when you accept the order, not when they pay.",
  includes:
    "The ticked list on your card. One per line. Say what actually arrives: how many patterns, whether there is a voice note, what the write-up covers.",
  questions:
    "Students answer these when they send you the match, so ask for what changes how you watch it. One per line. End a line with (optional) and they can skip it.",
  sections:
    "The headings you fill in while writing the review. One per line. Anything you leave empty never reaches the student, so a section that does not apply costs you nothing.",
  patterns:
    "Reminders to yourself, waiting in the workspace when you review a match. One per line. Tap one and it opens a pattern already named. Students never see them.",
  followups: "How many questions they can ask you after you deliver.",
};

/** Everything an offering says, as editable state. */
interface Draft {
  title: string;
  description: string;
  price: string;
  turnaround: number;
  includes: string;
  questions: string;
  sections: string;
  patterns: string;
  followups: number;
  image: string | null;
  active: boolean;
}

/** One per line, trimmed, capped. Three list fields share the shape. */
function lines(text: string, cap: number): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, cap);
}

function draftFromTemplate(t: OfferingTemplate): Draft {
  return {
    title: t.title,
    description: t.description,
    price: (t.price_cents / 100).toFixed(2).replace(/\.00$/, ""),
    turnaround: t.turnaround_days,
    includes: t.includes.join("\n"),
    questions: fromQuestions(t.intake_questions),
    sections: t.review_sections.map((s) => s.label).join("\n"),
    patterns: t.suggested_patterns.join("\n"),
    followups: t.followup_rounds,
    image: t.image,
    active: true,
  };
}

function draftFromRow(o: OfferingRow): Draft {
  return {
    title: o.title,
    description: o.description,
    price: (o.price_cents / 100).toFixed(2).replace(/\.00$/, ""),
    turnaround: o.turnaround_days,
    includes: o.includes.join("\n"),
    questions: fromQuestions(o.intake_questions),
    sections: o.review_sections.map((s) => s.label).join("\n"),
    // Rows created before 085 have no column value at all.
    patterns: (o.suggested_patterns ?? []).join("\n"),
    followups: o.followup_rounds,
    image: o.image,
    active: o.active,
  };
}

function rowValues(d: Draft, priceCents: number) {
  return {
    title: d.title.trim().slice(0, 80),
    description: d.description.trim().slice(0, 1000),
    price_cents: priceCents,
    turnaround_days: d.turnaround,
    includes: lines(d.includes, 10),
    intake_questions: toQuestions(d.questions),
    review_sections: toSections(d.sections),
    suggested_patterns: lines(d.patterns, 8).map((l) => l.slice(0, 80)),
    followup_rounds: d.followups,
    image: d.image,
    active: d.active,
  };
}

/**
 * Has this offering been made the coach's own yet?
 *
 * Comparing against the template it came from is the only honest test. A
 * coach who publishes the sample wording is selling a review written by
 * somebody who has never seen them coach, and the one line this earns is
 * the cheapest way to say so without blocking anything.
 */
function stillTemplateWording(o: OfferingRow): boolean {
  const t = templateByKey(o.template_key);
  if (!t || t.key === "custom" || !t.description) return false;
  return (
    o.description.trim() === t.description.trim() &&
    o.includes.join("\n") === t.includes.join("\n")
  );
}

function validate(draft: Draft): { priceCents: number } | { error: string } {
  const priceCents = parseUsd(draft.price);
  if (!draft.title.trim()) return { error: "Give it a title." };
  if (priceCents === null || priceCents < 500 || priceCents > 50000) {
    return { error: "Price must be between $5 and $500." };
  }
  return { priceCents };
}

/**
 * The storefront card, rendered live from the draft. Same markup as the
 * public page so what the coach shapes is exactly what students get.
 */
function OfferingPreview({
  draft,
  offeringId,
  artOverride,
  coachName,
}: {
  draft: Draft;
  offeringId: string | null;
  /** Object URL of an upload made in this session, ahead of any refetch. */
  artOverride: string | null;
  coachName: string;
}) {
  const [fetchedArt, setFetchedArt] = useState<string | null>(null);
  const isUpload = Boolean(draft.image && !draft.image.startsWith("stock:"));

  useEffect(() => {
    if (!isUpload || artOverride || fetchedArt || !offeringId) return;
    void fetch(`/api/offering-image?id=${offeringId}`)
      .then((r) => r.json())
      .then((d: { url?: string | null }) => setFetchedArt(d.url ?? null))
      .catch(() => {});
  }, [isUpload, artOverride, fetchedArt, offeringId]);

  const art =
    stockImageUrl(draft.image) ?? (isUpload ? (artOverride ?? fetchedArt) : null);
  const priceCents = parseUsd(draft.price);
  const includes = draft.includes
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 10);

  return (
    <div>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        What students see
      </h2>
      <div className="overflow-hidden rounded-2xl border border-edge bg-surface">
        {art && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={art} alt="" className="aspect-[3/1.2] w-full object-cover" />
        )}
        <div className="p-5">
          <div className="flex items-baseline justify-between gap-4">
            <h3 className="text-base font-semibold">
              {draft.title.trim() || "Untitled"}
            </h3>
            <span className="text-lg font-semibold tabular-nums text-cyan-glow">
              {priceCents !== null ? formatUsd(priceCents) : "$—"}
            </span>
          </div>
          {draft.description.trim() && (
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              {draft.description}
            </p>
          )}
          {includes.length > 0 && (
            <ul className="mt-4 space-y-1.5">
              {includes.map((line) => (
                <li key={line} className="flex gap-2.5 text-sm text-zinc-300">
                  <span
                    aria-hidden="true"
                    className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-glow/70"
                  />
                  {line}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <p className="text-xs text-zinc-500">
              Delivered within {draft.turnaround}{" "}
              {draft.turnaround === 1 ? "day" : "days"} of your match reaching{" "}
              {coachName}
              {draft.followups > 0 &&
                `, with ${
                  draft.followups === 1
                    ? "a follow-up question"
                    : `${draft.followups} follow-up questions`
                } included`}
              .
            </p>
            <span
              aria-hidden="true"
              className="glow-cta w-fit whitespace-nowrap rounded-full bg-cyan-glow px-5 py-2.5 text-sm font-semibold text-ink"
            >
              Buy {priceCents !== null ? formatUsd(priceCents) : "$—"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ImagePicker({
  value,
  offeringId,
  onChange,
}: {
  value: string | null;
  /** Set for saved offerings; draft uploads preview via object URL. */
  offeringId: string | null;
  onChange: (image: string | null, previewUrl?: string) => void;
}) {
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isUpload = Boolean(value && !value.startsWith("stock:"));
  const currentUrl = stockImageUrl(value) ?? (isUpload ? uploadPreview : null);

  useEffect(() => {
    if (!isUpload || uploadPreview || !offeringId) return;
    void fetch(`/api/offering-image?id=${offeringId}`)
      .then((r) => r.json())
      .then((d: { url?: string | null }) => {
        if (d.url) setUploadPreview(d.url);
      })
      .catch(() => {});
  }, [isUpload, uploadPreview, offeringId]);

  async function upload(file: File) {
    setBusy(true);
    setNote(null);
    try {
      const form = new FormData();
      form.append("image", file);
      const res = await fetch("/api/offering-image", {
        method: "POST",
        body: form,
      });
      const data = (await res.json()) as { image?: string; error?: string };
      if (!res.ok || !data.image) {
        setNote(data.error ?? "Could not upload. Try again.");
        return;
      }
      const objectUrl = URL.createObjectURL(file);
      setUploadPreview(objectUrl);
      onChange(data.image, objectUrl);
    } catch {
      setNote("Could not upload. Try again.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      <FieldLabel text="Card image" hint={HINTS.image} />
      <div className="mt-2 flex items-center gap-3">
        {currentUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={currentUrl}
            alt=""
            className="h-14 w-[84px] rounded-lg border border-edge object-cover"
          />
        ) : (
          <span className="flex h-14 w-[84px] items-center justify-center rounded-lg border border-dashed border-edge text-[10px] text-zinc-600">
            No image
          </span>
        )}
        <button
          type="button"
          onClick={() => setChoosing(!choosing)}
          className="rounded-full border border-edge bg-surface-2 px-4 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-cyan-glow/40"
        >
          {choosing ? "Done" : "Change image"}
        </button>
        {value && !choosing && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-xs text-zinc-500 hover:text-amber-400"
          >
            Remove
          </button>
        )}
      </div>
      {choosing && (
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {STOCK_IMAGES.map((img) => {
          const url = stockImageUrl(img);
          if (!url) return null;
          const selected = value === img;
          return (
            <button
              key={img}
              type="button"
              onClick={() => onChange(img)}
              aria-label="Use this image"
              className={`overflow-hidden rounded-lg border transition-colors ${
                selected
                  ? "border-cyan-glow"
                  : "border-edge hover:border-cyan-glow/40"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="h-12 w-[72px] object-cover" />
            </button>
          );
        })}
        {isUpload && uploadPreview && (
          <span className="overflow-hidden rounded-lg border border-cyan-glow">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={uploadPreview}
              alt=""
              className="h-12 w-[72px] object-cover"
            />
          </span>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="h-12 rounded-lg border border-dashed border-edge px-3 text-xs text-zinc-400 transition-colors hover:border-cyan-glow/40 disabled:opacity-60"
        >
          {busy ? "Uploading" : "Your own"}
        </button>
      </div>
      )}
      {note && <p className="mt-2 text-xs text-amber-400">{note}</p>}
    </div>
  );
}

function OfferingFields({
  draft,
  setDraft,
  offeringId,
  feeConfig,
  showActive,
  onArtPreview,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  offeringId: string | null;
  feeConfig: ReviewFeeConfig;
  showActive: boolean;
  /** Hands a fresh upload's object URL up so the live preview can show it. */
  onArtPreview?: (url: string) => void;
}) {
  // The two side-by-side rows each print one hint box beneath themselves.
  const [pair, setPair] = useState<"price" | "turnaround" | null>(null);
  const [tail, setTail] = useState<"followups" | null>(null);
  const priceCents = parseUsd(draft.price);
  const priceOk =
    priceCents !== null && priceCents >= 500 && priceCents <= 50000;
  const take = priceOk
    ? Math.max(
        0,
        coachShareCents(priceCents, feeConfig) -
          Math.round(priceCents * 0.029 + 30),
      )
    : null;

  return (
    <>
      <FieldLabel text="Title" hint={HINTS.title} />
      <AutoTextarea
        value={draft.title}
        onChange={(e) =>
          setDraft({ ...draft, title: e.target.value.replace(/\n/g, "") })
        }
        rows={1}
        maxLength={80}
        placeholder="What you'd call it to a student"
        className={FIELD}
      />

      <FieldLabel text="Description" hint={HINTS.description} />
      <AutoTextarea
        value={draft.description}
        onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        rows={3}
        maxLength={1000}
        placeholder="What you look at and what they get back."
        className={FIELD}
      />

      <ImagePicker
        value={draft.image}
        offeringId={offeringId}
        onChange={(image, previewUrl) => {
          setDraft({ ...draft, image });
          if (previewUrl && onArtPreview) onArtPreview(previewUrl);
        }}
      />

      <div className="flex gap-4">
        <div className="flex-1">
          <FieldLabel
            text="Price"
            hint={HINTS.price}
            open={pair === "price"}
            onToggle={() => setPair(pair === "price" ? null : "price")}
          />
          <div className="relative">
            <span className="pointer-events-none absolute left-4 top-1/2 mt-1 -translate-y-1/2 text-sm text-zinc-500">
              $
            </span>
            <input
              value={draft.price}
              onChange={(e) => setDraft({ ...draft, price: e.target.value })}
              inputMode="decimal"
              className={`${FIELD} pl-8`}
            />
          </div>
        </div>
        <div className="flex-1">
          <FieldLabel
            text="Turnaround"
            hint={HINTS.turnaround}
            open={pair === "turnaround"}
            onToggle={() =>
              setPair(pair === "turnaround" ? null : "turnaround")
            }
          />
          <select
            value={draft.turnaround}
            onChange={(e) =>
              setDraft({ ...draft, turnaround: Number(e.target.value) })
            }
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
      {pair && (
        <HintBox>{pair === "price" ? HINTS.price : HINTS.turnaround}</HintBox>
      )}
      {take !== null && (
        <p className="mt-2 text-xs text-zinc-500">
          You receive about {formatUsd(take)} after fees.
        </p>
      )}

      <FieldLabel text="What's included" hint={HINTS.includes} />
      <AutoTextarea
        value={draft.includes}
        onChange={(e) => setDraft({ ...draft, includes: e.target.value })}
        rows={4}
        className={FIELD}
        placeholder="One per line"
      />

      <FieldLabel
        text="Questions for the student"
        hint={HINTS.questions}
      />
      <AutoTextarea
        value={draft.questions}
        onChange={(e) => setDraft({ ...draft, questions: e.target.value })}
        rows={3}
        className={FIELD}
        placeholder={
          "One per line. End a line with (optional) to make it optional."
        }
      />

      <FieldLabel text="Sections of your write-up" hint={HINTS.sections} />
      <AutoTextarea
        value={draft.sections}
        onChange={(e) => setDraft({ ...draft, sections: e.target.value })}
        rows={3}
        className={FIELD}
        placeholder="One per line"
      />

      <div className="flex items-end gap-4">
        <div className="flex-1">
          <FieldLabel
            text="Follow-up questions included"
            hint={HINTS.followups}
            open={tail === "followups"}
            onToggle={() =>
              setTail(tail === "followups" ? null : "followups")
            }
          />
          <select
            value={draft.followups}
            onChange={(e) =>
              setDraft({ ...draft, followups: Number(e.target.value) })
            }
            className={FIELD}
          >
            {[0, 1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        {showActive && (
          <label className="flex flex-1 cursor-pointer items-center justify-between rounded-xl border border-edge bg-surface-2 px-4 py-3 text-sm">
            <span className="text-zinc-300">Available to buy</span>
            <input
              type="checkbox"
              checked={draft.active}
              onChange={(e) =>
                setDraft({ ...draft, active: e.target.checked })
              }
              className="h-4 w-4 accent-cyan-400"
            />
          </label>
        )}
      </div>
      {tail && <HintBox>{HINTS.followups}</HintBox>}

      {/* Last, and on its own, because everything above is what a student
          reads and this is the only field they never see. */}
      <FieldLabel text="Patterns to look for" hint={HINTS.patterns} />
      <AutoTextarea
        value={draft.patterns}
        onChange={(e) => setDraft({ ...draft, patterns: e.target.value })}
        rows={3}
        className={FIELD}
        placeholder="One per line. Just for you, never shown to a student."
      />
    </>
  );
}

function DraftBuilder({
  template,
  count,
  feeConfig,
  coachName,
  onDone,
  onCancel,
}: {
  template: OfferingTemplate;
  count: number;
  feeConfig: ReviewFeeConfig;
  coachName: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => draftFromTemplate(template));
  const [artOverride, setArtOverride] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function create() {
    const v = validate(draft);
    if ("error" in v) {
      setNote(v.error);
      return;
    }
    setBusy(true);
    setNote(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from("offerings").insert({
      coach_id: user.id,
      template_key: template.key,
      ...rowValues(draft, v.priceCents),
      sort: count,
    });
    setBusy(false);
    if (error) {
      setNote("Could not create it. Try again.");
      return;
    }
    onDone();
  }

  return (
    <div className="rounded-2xl border border-cyan-glow/40 bg-surface">
      <div className="border-b border-edge/60 px-5 py-4">
        <p className="text-sm font-semibold text-zinc-100">
          {template.key === "custom"
            ? "New offering, from scratch"
            : `The ${template.name.toLowerCase()} template`}
        </p>
        {/* The one line telling a coach to edit used to be the smallest
            thing on the panel, which is why the sample wording shipped. */}
        <p className="mt-1 text-sm text-zinc-400">
          {template.key === "custom"
            ? "Nothing is live until you create it."
            : "A starting point, not a finished offering. Change anything, and nothing is live until you create it."}
        </p>
      </div>
      <div className="px-5 pb-5 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-x-8">
        <div>
          <OfferingFields
            draft={draft}
            setDraft={setDraft}
            offeringId={null}
            feeConfig={feeConfig}
            showActive={false}
            onArtPreview={setArtOverride}
          />
          {note && <p className="mt-3 text-xs text-amber-400">{note}</p>}
          <div className="mt-6 flex items-center gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-full border border-edge bg-surface px-5 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:border-cyan-glow/40 hover:text-white"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={create}
              disabled={busy}
              className="glow-cta flex-1 rounded-full bg-cyan-glow px-6 py-2.5 text-sm font-semibold text-ink disabled:opacity-60"
            >
              {busy ? "Creating" : "Create offering"}
            </button>
          </div>
        </div>
        <div className="hidden lg:sticky lg:top-20 lg:block lg:self-start lg:pt-5">
          <OfferingPreview
            draft={draft}
            offeringId={null}
            artOverride={artOverride}
            coachName={coachName}
          />
        </div>
      </div>
    </div>
  );
}

function OfferingCard({
  offering,
  feeConfig,
  coachName,
  onChanged,
}: {
  offering: OfferingRow;
  feeConfig: ReviewFeeConfig;
  coachName: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => draftFromRow(offering));
  const [artOverride, setArtOverride] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const priceCents = parseUsd(draft.price);
  const thumb = stockImageUrl(offering.image);

  async function save() {
    const v = validate(draft);
    if ("error" in v) {
      setNote(v.error);
      return;
    }
    setBusy(true);
    setNote(null);
    const { error } = await createClient()
      .from("offerings")
      .update({
        ...rowValues(draft, v.priceCents),
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
    const { error } = await createClient()
      .from("offerings")
      .delete()
      .eq("id", offering.id);
    setBusy(false);
    setConfirmingDelete(false);
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
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        {thumb && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumb}
            alt=""
            className="h-10 w-[60px] shrink-0 rounded-lg border border-edge object-cover"
          />
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-200">
          {draft.title || "Untitled"}
          {!draft.active && (
            <span className="ml-2 text-xs font-normal text-zinc-500">
              off
            </span>
          )}
        </span>
        <span className="shrink-0 text-sm font-medium tabular-nums text-zinc-300">
          {priceCents !== null ? formatUsd(priceCents) : "—"}
        </span>
      </button>

      {/* Never blocks anything, and it disappears the moment they change a
          word. Students never see it. */}
      {!open && stillTemplateWording(offering) && (
        <p className="-mt-1 px-4 pb-3 text-sm text-zinc-500">
          Still the template wording.
        </p>
      )}

      {open && (
        <div className="border-t border-edge/60 px-5 pb-5 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-x-8">
          <div>
          <OfferingFields
            draft={draft}
            setDraft={setDraft}
            offeringId={offering.id}
            feeConfig={feeConfig}
            showActive
            onArtPreview={setArtOverride}
          />
          {note && <p className="mt-3 text-xs text-amber-400">{note}</p>}
          <div className="mt-6 flex items-center justify-between">
            {confirmingDelete ? (
              <span className="flex items-center gap-3 text-xs">
                <span className="text-zinc-400">Delete this offering?</span>
                <button
                  type="button"
                  onClick={remove}
                  disabled={busy}
                  className="font-medium text-amber-400"
                >
                  Yes, delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="text-zinc-500"
                >
                  Keep
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                disabled={busy}
                className="text-xs text-zinc-500 hover:text-amber-400"
              >
                Delete
              </button>
            )}
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
          <div className="hidden lg:sticky lg:top-20 lg:block lg:self-start lg:pt-5">
            <OfferingPreview
              draft={draft}
              offeringId={offering.id}
              artOverride={artOverride}
              coachName={coachName}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export function OfferingsEditor({
  initialOfferings,
  feeConfig,
  coachName,
}: {
  initialOfferings: OfferingRow[];
  feeConfig: ReviewFeeConfig;
  coachName: string;
}) {
  const [offerings, setOfferings] = useState(initialOfferings);
  const [building, setBuilding] = useState<OfferingTemplate | null>(null);
  const [picking, setPicking] = useState(false);

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

  return (
    <div className="mx-auto max-w-lg lg:max-w-none">
      <UpLink href="/coaching" label="Coaching" />
      <h1 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
        Offerings
      </h1>

      {offerings.length > 0 && (
        <>
          <h2 className="mt-8 mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Your offerings
          </h2>
          <div className="space-y-4">
            {offerings.map((o) => (
              <OfferingCard
                key={`${o.id}-${o.updated_at}`}
                offering={o}
                feeConfig={feeConfig}
                coachName={coachName}
                onChanged={refresh}
              />
            ))}
          </div>
        </>
      )}

      {building ? (
        <div className="mt-8">
          <DraftBuilder
            template={building}
            count={offerings.length}
            feeConfig={feeConfig}
            coachName={coachName}
            onDone={() => {
              setBuilding(null);
              void refresh();
            }}
            onCancel={() => setBuilding(null)}
          />
        </div>
      ) : picking ? (
        <div className="mt-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Start from a template
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {OFFERING_TEMPLATES.map((t) => {
              const art = stockImageUrl(t.image);
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => {
                    setBuilding(t);
                    setPicking(false);
                  }}
                  className="overflow-hidden rounded-2xl border border-edge bg-surface text-left transition-colors hover:border-cyan-glow/40"
                >
                  {art && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={art}
                      alt=""
                      className="aspect-[3/1.4] w-full object-cover"
                    />
                  )}
                  <div className="p-4">
                    <p className="text-sm font-semibold text-zinc-200">
                      {t.name}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">{t.blurb}</p>
                  </div>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setPicking(false)}
            className="mt-4 w-full rounded-full border border-edge bg-surface py-3 text-sm font-medium text-zinc-300 transition-colors hover:border-cyan-glow/40 hover:text-white"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="mt-8 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-edge bg-surface/50 py-4 text-sm font-medium text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white"
        >
          <span className="text-lg leading-none text-cyan-glow">+</span>
          New offering
        </button>
      )}
    </div>
  );
}
