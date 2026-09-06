"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { SectionHeading } from "@/components/SectionHeading";
import {
  agoLabel,
  buildWorkerRows,
  durationLabel,
  isKnownKind,
  kindLabel,
  queueSummary,
  secondsBetween,
  sourceName,
  throughputSummary,
  unclaimedRunning,
  waitingRows,
  type ProcessingOverview,
  type WorkerRow,
  type WorkerState,
} from "./processingView";

/** Ten seconds. The worker beats every fifteen, so this is often enough
 *  that a counter visibly moves and rare enough to be free. */
const REFRESH_MS = 10_000;

const STATE_LABEL: Record<WorkerState, string> = {
  working: "Working",
  idle: "Idle",
  "not-reporting": "Not reporting",
  "not-running": "Not running",
  off: "Off",
};

/**
 * Off is grey and Not running is amber, deliberately. A lane switched off
 * is a decision; a lane that should be running and is not is an outage,
 * and the two must never look the same at a glance.
 */
const STATE_DOT: Record<WorkerState, string> = {
  working: "bg-cyan-glow",
  idle: "bg-zinc-500",
  "not-reporting": "bg-amber-400",
  "not-running": "bg-amber-400",
  off: "bg-zinc-700",
};

const STATE_TEXT: Record<WorkerState, string> = {
  working: "text-cyan-glow",
  idle: "text-zinc-400",
  "not-reporting": "text-amber-300",
  "not-running": "text-amber-300",
  off: "text-zinc-600",
};

/** A job kind the page has not been taught reads as its raw name, with a
 *  marker, so the gap gets noticed on that kind's first job. */
function Kind({ kind }: { kind: string }) {
  return (
    <>
      {kindLabel(kind)}
      {!isKnownKind(kind) && (
        <span className="ml-1.5 rounded-full bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
          new kind
        </span>
      )}
    </>
  );
}

function WorkerCard({ row }: { row: WorkerRow }) {
  return (
    <li className="px-4 py-4 sm:px-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="flex min-w-0 items-baseline gap-2">
          <span
            aria-hidden="true"
            className={`h-2 w-2 shrink-0 translate-y-[-1px] rounded-full ${
              STATE_DOT[row.state]
            }`}
          />
          <span className="truncate text-sm font-semibold text-zinc-100">
            {row.title}
          </span>
        </p>
        <p className={`shrink-0 text-sm font-medium ${STATE_TEXT[row.state]}`}>
          {STATE_LABEL[row.state]}
        </p>
      </div>

      <p className="mt-1.5 pl-4 text-sm text-zinc-300">{row.detail}</p>

      {row.pct !== null && (
        <div className="mt-2 ml-4 h-1 overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-cyan-glow/70"
            style={{ width: `${Math.min(100, Math.max(0, row.pct))}%` }}
          />
        </div>
      )}

      {row.note && (
        <p className="mt-1.5 pl-4 text-xs tabular-nums text-zinc-500">
          {row.note}
          {row.pct !== null && ` · ${row.pct}%`}
        </p>
      )}

      {row.loadNote && (
        <p className="mt-1.5 pl-4 text-xs text-amber-300">{row.loadNote}</p>
      )}

      {(row.upSince || row.codeVersion || row.matchId) && (
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 pl-4 text-xs text-zinc-600">
          {row.upSince && <span>Up {durationLabel(secondsBetween(row.upSince, new Date()))}</span>}
          {row.codeVersion && (
            <>
              {row.upSince && <span aria-hidden="true">·</span>}
              <span className="max-w-[18rem] truncate">
                {row.codeVersion}
              </span>
            </>
          )}
          {row.matchId && (
            <>
              <span aria-hidden="true">·</span>
              <Link
                href={`/admin/uploads/${row.matchId}`}
                className="text-zinc-400 transition-colors hover:text-cyan-glow"
              >
                Open the upload
              </Link>
            </>
          )}
        </p>
      )}
    </li>
  );
}

export function ProcessingSection() {
  const [doc, setDoc] = useState<ProcessingOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  // Re-render on a timer as well as on a fetch, so the "2h 37m" counters
  // stay honest between refreshes rather than freezing at whatever they
  // said when the last response landed.
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc(
      "admin_processing_overview",
    );
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setError(null);
    setDoc(data as ProcessingOverview);
    setFetchedAt(new Date());
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (error) {
    return <p className="text-sm text-red-400">{error}</p>;
  }
  if (!doc) {
    return (
      <div className="h-40 animate-pulse rounded-2xl border border-edge bg-surface" />
    );
  }

  const now = new Date();
  const workers = buildWorkerRows(doc, now);
  const waiting = waitingRows(doc, now);
  const orphaned = unclaimedRunning(doc, now);

  return (
    <>
      <p className="text-sm text-zinc-500">
        {queueSummary(waiting)}
        {fetchedAt && (
          <span className="text-zinc-600"> · updated {agoLabel(fetchedAt.toISOString(), now)}</span>
        )}
      </p>

      {/* ---------------------------------------------------------- workers */}
      <SectionHeading className="mt-8">Workers</SectionHeading>
      <ul className="mt-3 divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface">
        {workers.map((row) => (
          <WorkerCard key={row.key} row={row} />
        ))}
      </ul>

      {orphaned.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-2xl border border-amber-400/25 bg-surface">
          <div className="px-4 py-4 sm:px-5">
            <p className="text-sm font-semibold text-amber-300">
              {orphaned.length === 1
                ? "One job is marked in flight with nothing reporting behind it."
                : `${orphaned.length} jobs are marked in flight with nothing reporting behind them.`}
            </p>
            <p className="mt-1 text-sm text-zinc-400">
              The percentage below is written at a few milestones and then
              stands still, so it cannot tell you whether this is running or
              stopped. Only a worker reporting itself can.
            </p>
            <ul className="mt-3 space-y-2">
              {orphaned.map((job) => (
                <li key={job.id} className="text-sm text-zinc-300">
                  <Kind kind={job.kind} />
                  {job.player && (
                    <span className="text-zinc-500"> · {job.player}</span>
                  )}
                  <span className="text-zinc-500">
                    {" "}
                    · {job.progress}% · started{" "}
                    {durationLabel(secondsBetween(job.created_at, now))} ago
                  </span>
                  {job.match_id && (
                    <>
                      {" "}
                      <Link
                        href={`/admin/uploads/${job.match_id}`}
                        className="text-zinc-400 underline-offset-2 transition-colors hover:text-cyan-glow"
                      >
                        Open
                      </Link>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------- waiting */}
      <div className="mt-8 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <SectionHeading>Waiting</SectionHeading>
        <p className="text-xs text-zinc-600">{queueSummary(waiting)}</p>
      </div>
      {waiting.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">Nothing waiting.</p>
      ) : (
        <ul className="mt-3 divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface">
          {waiting.map((job) => (
            <li
              key={job.id}
              className="flex items-baseline justify-between gap-3 px-4 py-3 sm:px-5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-zinc-200">
                  <Kind kind={job.kind} />
                  {job.player && (
                    <span className="text-zinc-500"> · {job.player}</span>
                  )}
                </p>
                {sourceName(job.original_name, job.kind) && (
                  <p className="mt-0.5 truncate text-xs text-zinc-600">
                    {sourceName(job.original_name, job.kind)}
                  </p>
                )}
              </div>
              <div className="shrink-0 text-right">
                <p
                  className={`text-sm tabular-nums ${
                    job.attention ? "text-amber-300" : "text-zinc-300"
                  }`}
                >
                  {durationLabel(job.waited)}
                </p>
                {job.estimated_work_seconds ? (
                  <p className="mt-0.5 text-xs text-zinc-600">
                    about {durationLabel(job.estimated_work_seconds)} of work
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* ------------------------------------------------- recently finished */}
      <div className="mt-8 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <SectionHeading>Recently finished</SectionHeading>
        <p className="text-xs text-zinc-600">{throughputSummary(doc.day)}</p>
      </div>
      {doc.recent.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">Nothing has finished yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface">
          {doc.recent.map((job) => (
            <li
              key={job.id}
              className="flex items-baseline justify-between gap-3 px-4 py-3 sm:px-5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-zinc-200">
                  <Kind kind={job.kind} />
                  {job.player && (
                    <span className="text-zinc-500"> · {job.player}</span>
                  )}
                </p>
                {job.status === "done" ? (
                  sourceName(job.original_name, job.kind) && (
                    <p className="mt-0.5 truncate text-xs text-zinc-600">
                      {sourceName(job.original_name, job.kind)}
                    </p>
                  )
                ) : (
                  <p className="mt-0.5 text-xs text-amber-300">
                    {job.status === "cancelled"
                      ? "Cancelled"
                      : job.user_message || job.error || "Failed"}
                  </p>
                )}
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm tabular-nums text-zinc-400">
                  {agoLabel(job.updated_at, now)}
                </p>
                <p className="mt-0.5 text-xs tabular-nums text-zinc-600">
                  {durationLabel(
                    (secondsBetween(job.created_at, now) ?? 0) -
                      (secondsBetween(job.updated_at, now) ?? 0),
                  )}{" "}
                  from queued
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* ------------------------------------------------------------ cloud */}
      <SectionHeading className="mt-8">Cloud</SectionHeading>
      <div className="mt-3 rounded-2xl border border-edge bg-surface p-4 sm:p-5">
        <p className="text-sm text-zinc-300">
          {doc.cloud?.cloud_mode === "disabled"
            ? "Match processing is not sent to the cloud. No pipeline release has been activated, so there is nothing for a cloud worker to run."
            : `Cloud mode is ${doc.cloud?.cloud_mode}. Active release ${
                doc.cloud?.active_release_id ?? "none"
              }.`}
        </p>
        <dl className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {[
            ["Mode", doc.cloud?.cloud_mode ?? "—"],
            [
              "Active release",
              doc.cloud?.active_release_id ??
                `none of ${doc.cloud?.candidate_releases ?? 0} built`,
            ],
            [
              "Parity signed off",
              doc.cloud?.parity_gate_passed ? "yes" : "not yet",
            ],
            ["Privacy", doc.cloud?.privacy_gate_passed ? "signed off" : "not yet"],
            ["Licensing", doc.cloud?.license_gate_passed ? "signed off" : "not yet"],
            [
              "Spend cap",
              `$${doc.cloud?.daily_cap_usd ?? 0} a day, $${
                doc.cloud?.monthly_cap_usd ?? 0
              } a month`,
            ],
          ].map(([label, value]) => (
            <div
              key={label as string}
              className="flex items-baseline justify-between gap-3 border-b border-edge/50 pb-2"
            >
              <dt className="text-xs text-zinc-500">{label}</dt>
              <dd className="text-right text-sm text-zinc-300">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <p className="mt-6 text-xs text-zinc-600">
        Workers report themselves every fifteen seconds. A job&apos;s
        percentage is written at a handful of milestones, so it can stand
        still for hours on a job that is running perfectly — the worker
        rows above, not the percentage, are what says whether anything is
        alive.
      </p>
    </>
  );
}
