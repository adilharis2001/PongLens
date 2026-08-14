"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { MESSAGE_KINDS, messageFor } from "@/lib/marketing/voice";
import {
  CHANNEL_LABEL,
  EMPTY_FILTER,
  ENTITY_LABEL,
  REGION_LABEL,
  WARM_ENOUGH_DAYS,
  STAGES,
  channelHref,
  channelsFor,
  filterCoaches,
  formatFollowers,
  initialFor,
  profileHref,
  DAILY_DM_CAP,
  draftFor,
  nextMessageKind,
  sentToday,
  summarise,
  warmingDays,
  worthWriting,
  type OutreachCoach,
  type MessageKind,
  type OutreachFilter,
  type Stage,
} from "./outreachModel";

/**
 * The pipeline, one card per coach. Every way of reaching them sits on the
 * card, because the channel a coach answers on is theirs to decide and not
 * ours: most have only Instagram, some have a site, a few publish an
 * address. Message is first because it is the one that always exists.
 *
 * Nothing here sends anything. Instagram messages go from Adil's own
 * account in his own app, and the stage control is how the pipeline finds
 * out. Email drafts are queued for the Fastmail worker.
 */
export function OutreachList({ coaches }: { coaches: OutreachCoach[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<OutreachFilter>(EMPTY_FILTER);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stages, setStages] = useState<Record<string, Stage>>({});
  /**
   * Set after mount, never during render. "Day 2 of 3" computed on the
   * server and again in the browser is a hydration mismatch waiting for the
   * first page load that straddles midnight.
   */
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), []);
  /** Local edits, keyed by coach. The row is the truth once saved. */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<Set<string>>(new Set());
  /**
   * The draft row's id, held locally as well as on the prop. Reading it back
   * off the prop meant a save straight after writing found nothing, because
   * router.refresh() had not landed yet, and saveDraft returned silently
   * without ever sending the request.
   */
  const [draftIds, setDraftIds] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [kinds, setKinds] = useState<Record<string, MessageKind>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  /**
   * Written when he asks, not ahead of time. His call: he decides who to
   * write to, so a message existing means he chose that coach.
   */
  async function writeDraft(coach: OutreachCoach, kind?: MessageKind) {
    const which = kind ?? kinds[coach.id] ?? nextMessageKind(coach);
    setKinds((k) => ({ ...k, [coach.id]: which }));
    setOpen((o) => new Set(o).add(coach.id));
    const existing = draftFor(coach, which);
    const note = notes[coach.id] ?? coach.personal_note ?? "";
    const body = existing?.body ?? messageFor(which, coach, note);
    setDrafts((d) => ({ ...d, [`${coach.id}:${which}`]: body }));
    if (existing) {
      setDraftIds((ids) => ({ ...ids, [`${coach.id}:${which}`]: existing.id }));
      return;
    }
    setBusy(coach.id);
    const supabase = createClient();
    const { data, error: e } = await supabase
      .from("outreach_touches")
      .insert({
        coach_id: coach.id,
        kind: "instagram",
        direction: "out",
        status: "draft",
        message_kind: which,
        body,
      })
      .select("id")
      .single();
    if (e || !data) setError("Could not save the draft. Try again.");
    else setDraftIds((ids) => ({ ...ids, [`${coach.id}:${which}`]: data.id }));
    setBusy(null);
    router.refresh();
  }

  /**
   * The one real detail, typed by him. Saving it also rewrites an untouched
   * first draft, because a note added after the message was generated would
   * otherwise never reach it.
   */
  async function saveNote(coach: OutreachCoach) {
    const note = notes[coach.id] ?? "";
    if (note === (coach.personal_note ?? "")) return;
    setBusy(coach.id);
    const supabase = createClient();
    await supabase
      .from("outreach_coaches")
      .update({ personal_note: note || null })
      .eq("id", coach.id);
    const first = draftFor(coach, "first");
    if (first && first.body === messageFor("first", coach, coach.personal_note)) {
      const rewritten = messageFor("first", coach, note);
      await supabase
        .from("outreach_touches")
        .update({ body: rewritten })
        .eq("id", first.id);
      setDrafts((d) => ({ ...d, [`${coach.id}:first`]: rewritten }));
    }
    setBusy(null);
    router.refresh();
  }

  async function saveDraft(coach: OutreachCoach) {
    const which = kinds[coach.id] ?? nextMessageKind(coach);
    const body = drafts[`${coach.id}:${which}`];
    const id = draftIds[`${coach.id}:${which}`] ?? draftFor(coach, which)?.id;
    if (!id || body === undefined) return;
    if (body === draftFor(coach, which)?.body) return;
    setBusy(coach.id);
    const supabase = createClient();
    const { data, error: e } = await supabase
      .from("outreach_touches")
      .update({ body })
      .eq("id", id)
      .select("id");
    // A row count of zero is RLS refusing quietly, which looks identical to
    // success from the client. Say so rather than losing the edit.
    if (e || !data || data.length === 0) {
      setError("Could not save that edit. Try again.");
    }
    setBusy(null);
    router.refresh();
  }

  async function copyDraft(coach: OutreachCoach) {
    const which = kinds[coach.id] ?? nextMessageKind(coach);
    const body = drafts[`${coach.id}:${which}`] ?? draftFor(coach, which)?.body ?? "";
    try {
      await navigator.clipboard.writeText(body);
      setCopied(coach.id);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError("Could not reach the clipboard. Select the text instead.");
    }
  }

  const withStages = useMemo(
    () => coaches.map((c) => ({ ...c, stage: stages[c.id] ?? c.stage })),
    [coaches, stages],
  );
  const shown = useMemo(
    () => filterCoaches(withStages, filter),
    [withStages, filter],
  );
  const totals = summarise(withStages);

  /**
   * `touch` records that a message actually went out, alongside the stage
   * move. The stage says where a coach is; the touch says what happened and
   * when, which is the thing you want back in three weeks when a reply
   * arrives and you cannot remember whether you wrote to them.
   */
  async function setStage(id: string, stage: Stage, touch?: "out" | "in") {
    setBusy(id);
    setError(null);
    const previous = stages[id];
    setStages((s) => ({ ...s, [id]: stage }));
    const supabase = createClient();
    const { error: e } = await supabase
      .from("outreach_coaches")
      .update({ stage })
      .eq("id", id);
    if (e) {
      setStages((s) => ({ ...s, [id]: previous ?? "found" }));
      setError("Could not save that. Try again.");
      setBusy(null);
      return;
    }
    if (touch) {
      // Best effort. The stage is the record that matters, and losing the
      // history line is not worth showing an error over a move that worked.
      await supabase.from("outreach_touches").insert({
        coach_id: id,
        kind: "instagram",
        direction: touch,
        status: "sent",
        sent_at: new Date().toISOString(),
      });
    }
    setBusy(null);
    router.refresh();
  }

  const toggle = (on: boolean) =>
    on
      ? "rounded-full border border-cyan-glow/50 bg-cyan-glow/10 px-4 py-2 text-sm font-medium text-cyan-glow"
      : "rounded-full border border-edge px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-surface-2";

  return (
    <>
      <p className="mt-4 text-sm text-zinc-400">
        {totals.total} found, {totals.reachable} in a market we can take
        payment in. {totals.clubs} are clubs, {totals.withEmail} have an
        email. {totals.contacted} contacted, {totals.replied} replied.
      </p>
      {now !== null && (
        <p className="mt-1 text-sm text-zinc-500">
          {sentToday(withStages, now)} sent today. Five to ten a day, written
          one at a time.
          {sentToday(withStages, now) >= DAILY_DM_CAP && (
            <span className="text-amber-400"> That is enough for today.</span>
          )}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={filter.query}
          onChange={(e) => setFilter({ ...filter, query: e.target.value })}
          placeholder="Search name, handle or bio"
          aria-label="Search coaches"
          className="w-64 max-w-full rounded-full border border-edge bg-surface-2 px-4 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-cyan-glow/50 focus:outline-none"
        />
        <select
          value={filter.region}
          onChange={(e) =>
            setFilter({ ...filter, region: e.target.value as OutreachFilter["region"] })
          }
          aria-label="Filter by region"
          className="rounded-full border border-edge bg-surface-2 px-4 py-2 text-sm text-zinc-200 focus:border-cyan-glow/50 focus:outline-none"
        >
          <option value="all">Everywhere</option>
          <option value="reachable">US and Europe</option>
          <option value="us">US</option>
          <option value="europe">Europe</option>
          <option value="other">Elsewhere</option>
          <option value="unknown">Unplaced</option>
        </select>
        <select
          value={filter.entity}
          onChange={(e) =>
            setFilter({ ...filter, entity: e.target.value as OutreachFilter["entity"] })
          }
          aria-label="Filter by kind"
          className="rounded-full border border-edge bg-surface-2 px-4 py-2 text-sm text-zinc-200 focus:border-cyan-glow/50 focus:outline-none"
        >
          <option value="all">Coaches and clubs</option>
          <option value="coach">Coaches</option>
          <option value="club">Clubs</option>
          <option value="pro">Pros</option>
        </select>
        <select
          value={filter.stage}
          onChange={(e) =>
            setFilter({ ...filter, stage: e.target.value as OutreachFilter["stage"] })
          }
          aria-label="Filter by stage"
          className="rounded-full border border-edge bg-surface-2 px-4 py-2 text-sm text-zinc-200 focus:border-cyan-glow/50 focus:outline-none"
        >
          <option value="live">Still open</option>
          <option value="all">Every stage</option>
          {STAGES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setFilter({ ...filter, payableOnly: !filter.payableOnly })}
          className={toggle(filter.payableOnly)}
        >
          Can be paid
        </button>
        <button
          type="button"
          onClick={() => setFilter({ ...filter, englishOnly: !filter.englishOnly })}
          className={toggle(filter.englishOnly)}
        >
          English
        </button>
        <button
          type="button"
          onClick={() =>
            setFilter({ ...filter, withEmailOnly: !filter.withEmailOnly })
          }
          className={toggle(filter.withEmailOnly)}
        >
          Has an email
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-amber-400">{error}</p>}

      {shown.length === 0 ? (
        <p className="mt-8 text-sm text-zinc-500">
          {totals.total === 0
            ? "No coaches yet. Run discovery to fill the list."
            : "Nothing matches those filters."}
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {shown.map((coach) => {
            const channels = channelsFor(coach);
            return (
              <li
                key={coach.id}
                className="rounded-2xl border border-edge bg-surface/80 p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      aria-hidden="true"
                      className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-sm font-semibold text-zinc-400"
                    >
                      {initialFor(coach)}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold text-zinc-100">
                        {coach.full_name || coach.handle}
                      </p>
                      {/* Wraps rather than truncates: on a phone this line
                          runs past the edge, and "English" was the part
                          getting cut off. */}
                      <p className="mt-0.5 text-sm text-zinc-500">
                        @{coach.handle}
                        <span className="mx-1.5">·</span>
                        {formatFollowers(coach.followers)} followers
                        <span className="mx-1.5">·</span>
                        {ENTITY_LABEL[coach.entity_type]}
                        <span className="mx-1.5">·</span>
                        {coach.country ?? REGION_LABEL.unknown}
                        {coach.english && (
                          <>
                            <span className="mx-1.5">·</span>
                            <span className="text-cyan-glow">English</span>
                          </>
                        )}
                      </p>
                      {(() => {
                        const days = now === null ? null : warmingDays(coach, now);
                        if (days === null) return null;
                        return (
                          <p className="mt-1 text-sm text-zinc-400">
                            Warming, day {days} of {WARM_ENOUGH_DAYS}.{" "}
                            {days >= WARM_ENOUGH_DAYS
                              ? "Warm enough to write."
                              : "Like a couple of posts, then write."}
                          </p>
                        );
                      })()}
                      {!coach.payments_supported && (
                        <p className="mt-1 text-sm text-amber-400/90">
                          {coach.country
                            ? `Stripe cannot pay a coach in ${coach.country} yet.`
                            : "No country yet, so we cannot tell if they can be paid."}
                        </p>
                      )}
                    </div>
                  </div>

                  <select
                    value={coach.stage}
                    disabled={busy === coach.id}
                    onChange={(e) => void setStage(coach.id, e.target.value as Stage)}
                    aria-label={`Stage for ${coach.handle}`}
                    className="shrink-0 rounded-full border border-edge bg-surface-2 px-4 py-2 text-sm text-zinc-200 focus:border-cyan-glow/50 focus:outline-none disabled:opacity-50"
                  >
                    {STAGES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>

                {coach.fit_note && (
                  <p className="mt-3 text-sm leading-6 text-zinc-400">
                    {coach.fit_note}
                    {coach.discovered_via && (
                      <span className="text-zinc-600">
                        {" "}
                        · found on &ldquo;{coach.discovered_via}&rdquo;
                      </span>
                    )}
                  </p>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <a
                    href={channelHref("instagram", coach.handle)}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full border border-cyan-glow/50 bg-cyan-glow/10 px-4 py-2 text-sm font-medium text-cyan-glow transition-colors hover:bg-cyan-glow/20"
                  >
                    Message
                  </a>
                  <a
                    href={profileHref(coach)}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full border border-edge px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-surface-2"
                  >
                    Profile
                  </a>
                  {channels.map((channel) => (
                    <a
                      key={`${channel.kind}:${channel.value}`}
                      href={channelHref(channel.kind, channel.value)}
                      target="_blank"
                      rel="noreferrer"
                      title={channel.value}
                      className="rounded-full border border-edge px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-surface-2"
                    >
                      {CHANNEL_LABEL[channel.kind]}
                    </a>
                  ))}

                  <button
                    type="button"
                    disabled={busy === coach.id}
                    onClick={() => void writeDraft(coach)}
                    className={
                      draftFor(coach, kinds[coach.id] ?? nextMessageKind(coach))
                        ? "rounded-full border border-cyan-glow/50 bg-cyan-glow/10 px-4 py-2 text-sm font-medium text-cyan-glow disabled:opacity-50"
                        : "rounded-full border border-edge px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-surface-2 hover:text-cyan-glow disabled:opacity-50"
                    }
                  >
                    {draftFor(coach, kinds[coach.id] ?? nextMessageKind(coach))
                      ? "Message ready"
                      : "Write a message"}
                  </button>

                  <span className="ml-auto flex items-center gap-2">
                    {["found", "qualified", "ready"].includes(coach.stage) && (
                      <button
                        type="button"
                        disabled={busy === coach.id}
                        onClick={() => void setStage(coach.id, "warming")}
                        className="rounded-full border border-edge px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-surface-2 hover:text-cyan-glow disabled:opacity-50"
                      >
                        Start warming
                      </button>
                    )}
                    {coach.stage === "warming" && (
                      <button
                        type="button"
                        disabled={busy === coach.id}
                        onClick={() => void setStage(coach.id, "contacted", "out")}
                        className="rounded-full border border-edge px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-surface-2 hover:text-cyan-glow disabled:opacity-50"
                      >
                        I sent a DM
                      </button>
                    )}
                    {coach.stage === "contacted" && (
                      <button
                        type="button"
                        disabled={busy === coach.id}
                        onClick={() => void setStage(coach.id, "replied", "in")}
                        className="rounded-full border border-edge px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-surface-2 hover:text-cyan-glow disabled:opacity-50"
                      >
                        They replied
                      </button>
                    )}
                  </span>
                </div>

                {open.has(coach.id) && (
                  <div className="mt-4 rounded-xl border border-edge bg-surface-2/60 p-4">
                    {!worthWriting(coach) && (
                      <p className="mb-3 text-sm text-amber-400/90">
                        Writing to them cannot turn into a paid coach yet.
                      </p>
                    )}
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      {MESSAGE_KINDS.map((m) => {
                        const active =
                          (kinds[coach.id] ?? nextMessageKind(coach)) === m.key;
                        return (
                          <button
                            key={m.key}
                            type="button"
                            title={m.hint}
                            onClick={() => void writeDraft(coach, m.key)}
                            className={
                              active
                                ? "rounded-full border border-cyan-glow/50 bg-cyan-glow/10 px-4 py-2 text-sm font-medium text-cyan-glow"
                                : "rounded-full border border-edge px-4 py-2 text-sm font-medium text-zinc-400 transition-colors hover:bg-surface"
                            }
                          >
                            {m.label}
                          </button>
                        );
                      })}
                    </div>

                    {(kinds[coach.id] ?? nextMessageKind(coach)) === "first" && (
                      <div className="mb-3">
                        <label
                          htmlFor={`note-${coach.id}`}
                          className="text-sm text-zinc-400"
                        >
                          Something real you noticed
                        </label>
                        <input
                          id={`note-${coach.id}`}
                          type="text"
                          value={notes[coach.id] ?? coach.personal_note ?? ""}
                          onChange={(e) =>
                            setNotes((n) => ({ ...n, [coach.id]: e.target.value }))
                          }
                          onBlur={() => void saveNote(coach)}
                          placeholder="saw that you coach out of Lily Yip"
                          className="mt-1 w-full rounded-lg border border-edge bg-surface px-4 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-cyan-glow/50 focus:outline-none"
                        />
                        <p className="mt-1 text-xs text-zinc-600">
                          Leave it empty rather than making something up. An
                          invented detail reads worse than none.
                        </p>
                      </div>
                    )}

                    <label className="sr-only" htmlFor={`draft-${coach.id}`}>
                      Message to {coach.handle}
                    </label>
                    <textarea
                      id={`draft-${coach.id}`}
                      value={
                        drafts[
                          `${coach.id}:${kinds[coach.id] ?? nextMessageKind(coach)}`
                        ] ?? ""
                      }
                      onChange={(e) => {
                        const which = kinds[coach.id] ?? nextMessageKind(coach);
                        setDrafts((d) => ({
                          ...d,
                          [`${coach.id}:${which}`]: e.target.value,
                        }));
                      }}
                      onBlur={() => void saveDraft(coach)}
                      rows={9}
                      className="w-full resize-y rounded-lg border border-edge bg-surface px-4 py-3 text-sm leading-6 text-zinc-200 focus:border-cyan-glow/50 focus:outline-none"
                    />
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void copyDraft(coach)}
                        className="rounded-full border border-cyan-glow/50 bg-cyan-glow/10 px-4 py-2 text-sm font-medium text-cyan-glow transition-colors hover:bg-cyan-glow/20"
                      >
                        {copied === coach.id ? "Copied" : "Copy"}
                      </button>
                      <a
                        href={channelHref("instagram", coach.handle)}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-full border border-edge px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-surface-2"
                      >
                        Open the DM
                      </a>
                      <button
                        type="button"
                        onClick={() =>
                          setOpen((o) => {
                            const next = new Set(o);
                            next.delete(coach.id);
                            return next;
                          })
                        }
                        className="rounded-full border border-edge px-4 py-2 text-sm font-medium text-zinc-400 transition-colors hover:bg-surface-2"
                      >
                        Close
                      </button>
                      <span className="text-xs text-zinc-600">
                        Edits save when you click away.
                      </span>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
