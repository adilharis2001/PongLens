"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import {
  CHANNEL_LABEL,
  EMPTY_FILTER,
  STAGES,
  channelHref,
  channelsFor,
  filterCoaches,
  formatFollowers,
  initialFor,
  profileHref,
  summarise,
  type OutreachCoach,
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

  const withStages = useMemo(
    () => coaches.map((c) => ({ ...c, stage: stages[c.id] ?? c.stage })),
    [coaches, stages],
  );
  const shown = useMemo(
    () => filterCoaches(withStages, filter),
    [withStages, filter],
  );
  const totals = summarise(withStages);

  async function setStage(id: string, stage: Stage) {
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
        {totals.total} coaches, {totals.english} writing in English,{" "}
        {totals.withEmail} with an email. {totals.contacted} contacted,{" "}
        {totals.replied} replied.
      </p>

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
          value={filter.stage}
          onChange={(e) =>
            setFilter({ ...filter, stage: e.target.value as OutreachFilter["stage"] })
          }
          aria-label="Filter by stage"
          className="rounded-full border border-edge bg-surface-2 px-4 py-2 text-sm text-zinc-200 focus:border-cyan-glow/50 focus:outline-none"
        >
          <option value="all">Every stage</option>
          <option value="live">Still open</option>
          {STAGES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
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
                        {coach.country && (
                          <>
                            <span className="mx-1.5">·</span>
                            {coach.country}
                          </>
                        )}
                        {coach.english && (
                          <>
                            <span className="mx-1.5">·</span>
                            <span className="text-cyan-glow">English</span>
                          </>
                        )}
                      </p>
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
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
