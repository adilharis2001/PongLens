"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Job, JobStatus } from "@/lib/types";

// v1 polls every 10s for simplicity. Upgrade path: subscribe to
// postgres_changes on the jobs table via Supabase Realtime and drop the
// interval entirely.
const POLL_MS = 10_000;

const statusStyles: Record<JobStatus, { label: string; chip: string; dot: string }> =
  {
    queued: {
      label: "Queued",
      chip: "border-cyan-glow/40 bg-cyan-glow/10 text-cyan-glow",
      dot: "bg-cyan-glow pulse-cyan",
    },
    processing: {
      label: "Processing",
      chip: "border-amber-400/40 bg-amber-400/10 text-amber-300",
      dot: "bg-amber-400",
    },
    done: {
      label: "Done",
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

/** "final vs marco.mp4" -> "final vs marco"; null -> "match" */
function baseName(name: string | null) {
  if (!name) return null;
  const i = name.lastIndexOf(".");
  const base = (i > 0 ? name.slice(0, i) : name).trim();
  return base.length > 0 ? base : null;
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

export function JobsList() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const fetchJobs = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("jobs")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) setJobs(data as Job[]);
  }, []);

  useEffect(() => {
    void fetchJobs();
    const id = setInterval(() => void fetchJobs(), POLL_MS);
    const onCreated = () => void fetchJobs();
    window.addEventListener("ponglens:job-created", onCreated);
    return () => {
      clearInterval(id);
      window.removeEventListener("ponglens:job-created", onCreated);
    };
  }, [fetchJobs]);

  async function download(job: Job) {
    if (!job.result_path) return;
    setDownloading(job.id);
    setDownloadError(null);
    const supabase = createClient();
    const { data, error } = await supabase.storage
      .from("results")
      .createSignedUrl(job.result_path, 60 * 60, {
        download: `PongLens - ${baseName(job.original_name) ?? "match"} (pure play).mp4`,
      });
    setDownloading(null);
    if (error || !data?.signedUrl) {
      setDownloadError("Couldn't create a download link. Try again shortly.");
      return;
    }
    window.location.href = data.signedUrl;
  }

  return (
    <section>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Your matches</h2>
        {jobs !== null && jobs.length > 0 && (
          <span className="text-xs text-zinc-500">
            refreshes every 10 seconds
          </span>
        )}
      </div>

      {jobs === null ? (
        <div className="mt-4 space-y-3">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-2xl border border-edge bg-surface"
            />
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-edge bg-surface p-10 text-center">
          <p className="text-3xl">🏓</p>
          <p className="mt-3 font-medium text-zinc-200">No matches yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-zinc-500">
            Upload your first match above. When processing finishes, your
            trimmed video will appear here, ready to download.
          </p>
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {jobs.map((job) => {
            const s = statusStyles[job.status] ?? statusStyles.queued;
            return (
              <li
                key={job.id}
                className="flex flex-col gap-3 rounded-2xl border border-edge bg-surface p-5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${s.chip}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                      {s.label}
                    </span>
                    <span className="text-xs text-zinc-500">
                      {timeAgo(job.created_at)}
                    </span>
                  </div>
                  <p className="mt-2 truncate text-sm font-medium text-zinc-200">
                    {job.original_name ?? "Match video"}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    Dead-space cut · {formatDate(job.created_at)}
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
                      {job.progress > 0 ? `${job.progress}%` : "working on it…"}
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {downloadError && (
        <p className="mt-3 text-sm text-red-400">{downloadError}</p>
      )}
    </section>
  );
}
