"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Job, Match, MatchStatus, SharedPlayer } from "@/lib/types";

// v1 polls every 10s for simplicity. Upgrade path: Supabase Realtime.
const POLL_MS = 10_000;

type MatchRow = Match & { points: { count: number }[] };

const matchChips: Record<
  MatchStatus,
  { label: string; chip: string; dot: string }
> = {
  processing: {
    label: "Processing",
    chip: "border-amber-400/40 bg-amber-400/10 text-amber-300",
    dot: "bg-amber-400",
  },
  ready: {
    label: "Ready",
    chip: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
    dot: "bg-emerald-400",
  },
  failed: {
    label: "Failed",
    chip: "border-red-400/40 bg-red-400/10 text-red-300",
    dot: "bg-red-400",
  },
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function Chip({ s }: { s: { label: string; chip: string; dot: string } }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${s.chip}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

export function DashboardLists({ userId }: { userId: string }) {
  const [matches, setMatches] = useState<MatchRow[] | null>(null);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [sharedPlayers, setSharedPlayers] = useState<SharedPlayer[]>([]);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    const supabase = createClient();
    // RLS returns own matches plus matches shared by players who accepted
    // this user as a coach; coach_players() supplies their display names.
    const [matchRes, jobRes, playersRes] = await Promise.all([
      supabase
        .from("matches")
        .select("*, points(count)")
        .order("created_at", { ascending: false }),
      supabase.from("jobs").select("*").order("created_at", { ascending: false }),
      supabase.rpc("coach_players"),
    ]);
    if (matchRes.data) setMatches(matchRes.data as MatchRow[]);
    if (jobRes.data) setJobs(jobRes.data as Job[]);
    if (playersRes.data) setSharedPlayers(playersRes.data as SharedPlayer[]);
  }, []);

  useEffect(() => {
    void fetchAll();
    const id = setInterval(() => void fetchAll(), POLL_MS);
    const onCreated = () => void fetchAll();
    window.addEventListener("ponglens:job-created", onCreated);
    return () => {
      clearInterval(id);
      window.removeEventListener("ponglens:job-created", onCreated);
    };
  }, [fetchAll]);

  async function download(job: Job) {
    if (!job.result_path) return;
    setDownloading(job.id);
    setDownloadError(null);
    try {
      const res = await fetch("/api/download-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id }),
      });
      const data = res.ok ? await res.json() : null;
      if (!data?.url) throw new Error("no url");
      window.location.href = data.url;
    } catch {
      setDownloadError("Couldn't create a download link. Try again shortly.");
    } finally {
      setDownloading(null);
    }
  }

  const loading = matches === null || jobs === null;

  // Own matches vs matches other players shared with this user (coach).
  const ownMatches = (matches ?? []).filter((m) => m.user_id === userId);
  const sharedMatches = (matches ?? []).filter((m) => m.user_id !== userId);
  const playerName = new Map(
    sharedPlayers.map((p) => [p.player_id, p.player_name])
  );
  const sharedByPlayer = new Map<string, MatchRow[]>();
  for (const m of sharedMatches) {
    const list = sharedByPlayer.get(m.user_id) ?? [];
    list.push(m);
    sharedByPlayer.set(m.user_id, list);
  }

  // Jobs that asked for points but whose match row doesn't exist yet show
  // in the matches list as processing entries. Everything else (legacy
  // cut-only work) lives under Downloads.
  const matchJobIds = new Set(ownMatches.map((m) => m.job_id));
  const pendingPointJobs = (jobs ?? []).filter(
    (j) =>
      j.options?.points === true &&
      !matchJobIds.has(j.id) &&
      (j.status === "queued" || j.status === "processing")
  );
  // Downloads: legacy cut-only jobs, plus finished point jobs that never got
  // a match row (their cut video is still worth surfacing).
  const downloadJobs = (jobs ?? []).filter(
    (j) =>
      j.options?.points !== true ||
      (!matchJobIds.has(j.id) &&
        (j.status === "done" || j.status === "failed"))
  );
  const jobById = new Map((jobs ?? []).map((j) => [j.id, j]));

  const hasMatches = ownMatches.length > 0 || pendingPointJobs.length > 0;

  return (
    <div className="space-y-12">
      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Your matches</h2>
          {!loading && hasMatches && (
            <span className="text-xs text-zinc-500">
              refreshes every 10 seconds
            </span>
          )}
        </div>

        {loading ? (
          <div className="mt-4 space-y-3">
            {[0, 1].map((i) => (
              <div
                key={i}
                className="h-20 animate-pulse rounded-2xl border border-edge bg-surface"
              />
            ))}
          </div>
        ) : !hasMatches ? (
          <div className="mt-4 rounded-2xl border border-edge bg-surface p-10 text-center">
            <p className="text-3xl">🏓</p>
            <p className="mt-3 font-medium text-zinc-200">No matches yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-zinc-500">
              Upload your first match. When processing finishes it will appear
              here, broken into points and ready to review.
            </p>
            <Link
              href="/upload"
              className="glow-cta mt-5 inline-block rounded-full bg-cyan-glow px-6 py-2.5 text-sm font-semibold text-ink"
            >
              Upload a match
            </Link>
          </div>
        ) : (
          <ul className="mt-4 space-y-3">
            {pendingPointJobs.map((job) => (
              <li
                key={job.id}
                className="rounded-2xl border border-edge bg-surface p-5"
              >
                <div className="flex items-center gap-3">
                  <Chip
                    s={
                      job.status === "queued"
                        ? {
                            label: "Queued",
                            chip: "border-cyan-glow/40 bg-cyan-glow/10 text-cyan-glow",
                            dot: "bg-cyan-glow pulse-cyan",
                          }
                        : matchChips.processing
                    }
                  />
                  <span className="text-xs text-zinc-500">
                    {timeAgo(job.created_at)}
                  </span>
                </div>
                <p className="mt-2 truncate text-sm font-medium text-zinc-200">
                  {job.original_name ?? "Match"}
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {formatDate(job.created_at)}
                  {job.status === "processing" && job.progress > 0
                    ? ` · ${job.progress}%`
                    : ""}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  We&apos;ll email you when it&apos;s ready.
                </p>
              </li>
            ))}

            {ownMatches.map((m) => {
              const s = matchChips[m.status] ?? matchChips.processing;
              const count = m.points?.[0]?.count ?? 0;
              const job = m.job_id ? jobById.get(m.job_id) : undefined;
              const inner = (
                <>
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      <Chip s={s} />
                      <span className="text-xs text-zinc-500">
                        {timeAgo(m.created_at)}
                      </span>
                    </div>
                    <p className="mt-2 truncate text-sm font-medium text-zinc-200">
                      {m.opponent_name?.trim() || "Match"}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {formatDate(m.played_at)}
                      {m.status === "ready"
                        ? ` · ${count} point${count === 1 ? "" : "s"}`
                        : ""}
                      {m.status === "processing" &&
                      job &&
                      job.progress > 0 &&
                      job.status !== "done"
                        ? ` · ${job.progress}%`
                        : ""}
                    </p>
                  </div>
                  {m.status === "ready" && (
                    <svg
                      viewBox="0 0 24 24"
                      className="h-5 w-5 shrink-0 text-zinc-500"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="m9 6 6 6-6 6"
                      />
                    </svg>
                  )}
                </>
              );
              return (
                <li key={m.id}>
                  {m.status === "ready" ? (
                    <Link
                      href={`/match/${m.id}`}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-edge bg-surface p-5 transition-colors hover:border-cyan-glow/40"
                    >
                      {inner}
                    </Link>
                  ) : (
                    <div className="flex items-center justify-between gap-3 rounded-2xl border border-edge bg-surface p-5">
                      {inner}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* coach view: matches other players shared via accepted coach links */}
      {!loading && sharedByPlayer.size > 0 && (
        <section>
          <h2 className="text-lg font-semibold">Shared with me</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Matches players shared with you. Open one to watch and leave
            coach notes.
          </p>
          <div className="mt-4 space-y-6">
            {[...sharedByPlayer.entries()].map(([playerId, list]) => (
              <div key={playerId}>
                <h3 className="text-sm font-semibold text-zinc-300">
                  {playerName.get(playerId) ?? "Player"}
                </h3>
                <ul className="mt-2 space-y-3">
                  {list.map((m) => {
                    const count = m.points?.[0]?.count ?? 0;
                    return (
                      <li key={m.id}>
                        <Link
                          href={`/match/${m.id}`}
                          className="flex items-center justify-between gap-3 rounded-2xl border border-edge bg-surface p-5 transition-colors hover:border-amber-400/40"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-3">
                              <Chip s={matchChips[m.status] ?? matchChips.processing} />
                              <span className="text-xs text-zinc-500">
                                {timeAgo(m.created_at)}
                              </span>
                            </div>
                            <p className="mt-2 truncate text-sm font-medium text-zinc-200">
                              {m.opponent_name?.trim()
                                ? `vs. ${m.opponent_name.trim()}`
                                : "Match"}
                            </p>
                            <p className="mt-0.5 text-xs text-zinc-500">
                              {formatDate(m.played_at)}
                              {m.status === "ready"
                                ? ` · ${count} point${count === 1 ? "" : "s"}`
                                : ""}
                            </p>
                          </div>
                          <svg
                            viewBox="0 0 24 24"
                            className="h-5 w-5 shrink-0 text-zinc-500"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            aria-hidden="true"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="m9 6 6 6-6 6"
                            />
                          </svg>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {!loading && downloadJobs.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold">Downloads</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Cut-only videos from earlier uploads.
          </p>
          <ul className="mt-4 space-y-3">
            {downloadJobs.map((job) => {
              const s =
                job.status === "done"
                  ? matchChips.ready
                  : job.status === "failed"
                    ? matchChips.failed
                    : job.status === "processing"
                      ? matchChips.processing
                      : {
                          label: "Queued",
                          chip: "border-cyan-glow/40 bg-cyan-glow/10 text-cyan-glow",
                          dot: "bg-cyan-glow pulse-cyan",
                        };
              return (
                <li
                  key={job.id}
                  className="flex flex-col gap-3 rounded-2xl border border-edge bg-surface p-5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      <Chip
                        s={
                          job.status === "done" ? { ...s, label: "Done" } : s
                        }
                      />
                      <span className="text-xs text-zinc-500">
                        {timeAgo(job.created_at)}
                      </span>
                    </div>
                    <p className="mt-2 truncate text-sm font-medium text-zinc-200">
                      {job.original_name ?? "Match video"}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      Pure play cut · {formatDate(job.created_at)}
                    </p>
                    {job.status === "failed" && job.error && (
                      <p className="mt-1 truncate text-xs text-red-400/80">
                        {job.error}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0">
                    {job.status === "done" && job.result_path ? (
                      <button
                        onClick={() => download(job)}
                        disabled={downloading === job.id}
                        className="glow-cta rounded-full bg-cyan-glow px-5 py-2 text-sm font-semibold text-ink disabled:opacity-60"
                      >
                        {downloading === job.id ? "Preparing…" : "Download"}
                      </button>
                    ) : job.status === "processing" ? (
                      <span className="text-xs text-zinc-500">
                        {job.progress > 0
                          ? `${job.progress}%`
                          : "working on it…"}
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
          {downloadError && (
            <p className="mt-3 text-sm text-red-400">{downloadError}</p>
          )}
        </section>
      )}
    </div>
  );
}
