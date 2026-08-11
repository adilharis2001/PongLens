"use client";

/**
 * The match page before processing (096): a raw library video. Watch it,
 * delete it, or spend minutes to process it. The point-by-point
 * experience stays out of sight until the video has been through the
 * pipeline — this view is deliberately small.
 *
 * Trimming is player-driven: scrub the native player, then stamp "Start
 * here" / "End here". The charge quote updates from the stamped window,
 * and claim_processing recomputes the same charge server-side, so what
 * the button says is what the balance loses.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { chargeMinutes, formatClock, formatMinutes } from "@/lib/commerce/minutes";
import { createClient } from "@/lib/supabase/client";
import type { Match } from "@/lib/types";

interface ActiveJob {
  id: string;
  status: string;
  progress: number | null;
  user_message: string | null;
}

export function RawMatchView({
  match,
  rawUrl,
  isOwner,
  commerceEnabled,
  minutesBalance,
  initialJob,
}: {
  match: Match;
  rawUrl: string | null;
  isOwner: boolean;
  commerceEnabled: boolean;
  minutesBalance: number | null;
  initialJob: ActiveJob | null;
}) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [duration, setDuration] = useState<number | null>(
    match.duration_s ?? null,
  );
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState<number | null>(
    match.duration_s ?? null,
  );
  const [placement, setPlacement] = useState(false);
  const [strictness, setStrictness] = useState<"tight" | "normal" | "loose">(
    "normal",
  );
  const [job, setJob] = useState<ActiveJob | null>(initialJob);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const title =
    (match.opponent_name && `vs ${match.opponent_name}`) ||
    match.original_name ||
    "Uploaded video";

  // Duration can be missing when the browser could not read metadata at
  // upload time; the player itself is the backfill.
  const onMetadata = useCallback(() => {
    const d = videoRef.current?.duration;
    if (!d || !Number.isFinite(d) || d <= 0) return;
    setDuration((prev) => prev ?? d);
    setTrimEnd((prev) => prev ?? d);
    if (isOwner && match.duration_s == null) {
      const supabase = createClient();
      supabase
        .rpc("set_match_duration", {
          p_match_id: match.id,
          p_duration_s: d,
        })
        .then(() => undefined);
    }
  }, [isOwner, match.duration_s, match.id]);

  // While a job runs, poll it; when it lands, the server page has a whole
  // different view to render.
  useEffect(() => {
    if (!job || (job.status !== "queued" && job.status !== "processing")) {
      return;
    }
    const supabase = createClient();
    const timer = setInterval(async () => {
      const { data } = await supabase
        .from("jobs")
        .select("id, status, progress, user_message")
        .eq("id", job.id)
        .maybeSingle();
      if (!data) return;
      setJob(data as ActiveJob);
      if (data.status === "done") {
        router.refresh();
      }
    }, 8000);
    return () => clearInterval(timer);
  }, [job, router]);

  const stampStart = () => {
    const t = videoRef.current?.currentTime ?? 0;
    setTrimStart(Math.min(t, (trimEnd ?? duration ?? t) - 5));
  };
  const stampEnd = () => {
    const t = videoRef.current?.currentTime ?? 0;
    setTrimEnd(Math.max(t, trimStart + 5));
  };
  const resetTrim = () => {
    setTrimStart(0);
    setTrimEnd(duration);
  };

  const windowS =
    duration != null ? Math.max(0, (trimEnd ?? duration) - trimStart) : null;
  const charge = windowS != null ? chargeMinutes(windowS) : null;
  const trimmed =
    duration != null &&
    (trimStart > 0.5 || (trimEnd != null && trimEnd < duration - 0.5));
  const enough =
    charge != null && minutesBalance != null && minutesBalance >= charge;

  const process = async () => {
    if (busy || charge == null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/process", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          matchId: match.id,
          trimStartS: trimmed ? trimStart : null,
          trimEndS: trimmed ? trimEnd : null,
          points: true,
          placement,
          strictness,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          data.code === "insufficient_minutes"
            ? "Not enough minutes for this video."
            : data.code === "queue_full"
              ? "Your queue is full. Wait for a video to finish."
              : "Something went wrong. Try again.",
        );
        return;
      }
      setJob({
        id: data.job_id,
        status: "queued",
        progress: 0,
        user_message: null,
      });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { error: deleteError } = await supabase
      .from("matches")
      .delete()
      .eq("id", match.id);
    if (deleteError) {
      setError("Could not delete the video. Try again.");
      setBusy(false);
      return;
    }
    router.push("/matches");
  };

  const jobRunning =
    job != null && (job.status === "queued" || job.status === "processing");

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-6">
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">{title}</h1>
          <p className="mt-0.5 text-sm text-zinc-400">
            {new Date(match.played_at).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
            {duration != null && <> · {formatClock(duration)}</>}
          </p>
        </div>
        <span className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-400">
          Not processed
        </span>
      </header>

      {/* Sized on the div, never the video: a media element has no
          intrinsic size until metadata arrives. */}
      <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-black">
        {rawUrl ? (
          <video
            ref={videoRef}
            src={rawUrl}
            controls
            playsInline
            preload="metadata"
            onLoadedMetadata={onMetadata}
            className="max-h-[min(70vh,42rem)] w-full"
          />
        ) : (
          <p className="p-8 text-center text-sm text-zinc-400">
            The video file is not available.
          </p>
        )}
      </div>

      {jobRunning && (
        <section className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
          <h2 className="text-sm font-medium text-zinc-100">Processing</h2>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-cyan-400 transition-all"
              style={{ width: `${Math.max(4, job?.progress ?? 0)}%` }}
            />
          </div>
          <p className="mt-3 text-sm text-zinc-400">
            You can leave this page. We email you when the match is ready.
          </p>
        </section>
      )}

      {isOwner && !jobRunning && commerceEnabled && (
        <section className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
          <h2 className="text-sm font-medium text-zinc-100">
            Break it into points
          </h2>
          {match.status === "failed" && (
            <p className="mt-2 text-sm text-amber-300/90">
              {job?.user_message ??
                "Processing failed, and your minutes came back."}
            </p>
          )}

          {duration == null ? (
            <p className="mt-2 text-sm text-zinc-400">
              Play the video once so we can read its length.
            </p>
          ) : (
            <>
              <p className="mt-2 text-sm text-zinc-400">
                Scrub to where the match starts and stamp it. Warm-up you
                trim off is warm-up you don&apos;t pay for.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  onClick={stampStart}
                  className="rounded-full border border-zinc-700 px-4 py-1.5 text-sm text-zinc-200 hover:border-zinc-500"
                >
                  Start here
                </button>
                <button
                  onClick={stampEnd}
                  className="rounded-full border border-zinc-700 px-4 py-1.5 text-sm text-zinc-200 hover:border-zinc-500"
                >
                  End here
                </button>
                <span className="text-sm tabular-nums text-zinc-400">
                  {formatClock(trimStart)} – {formatClock(trimEnd ?? duration)}
                </span>
                {trimmed && (
                  <button
                    onClick={resetTrim}
                    className="text-sm text-zinc-400 underline-offset-2 hover:underline"
                  >
                    Reset
                  </button>
                )}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Toggle
                  on={placement}
                  label="Placement maps"
                  onClick={() => setPlacement(!placement)}
                />
                {(["tight", "normal", "loose"] as const).map((s) => (
                  <Toggle
                    key={s}
                    on={strictness === s}
                    label={s === "tight" ? "Tight" : s === "loose" ? "Loose" : "Normal"}
                    onClick={() => setStrictness(s)}
                  />
                ))}
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  onClick={process}
                  disabled={busy || !enough}
                  className="rounded-full bg-cyan-400 px-5 py-2 text-sm font-semibold text-zinc-950 disabled:opacity-40"
                >
                  {charge != null
                    ? `Process · ${formatMinutes(charge)}`
                    : "Process"}
                </button>
                {minutesBalance != null && (
                  <span className="text-sm text-zinc-400">
                    You have {formatMinutes(minutesBalance)}.
                  </span>
                )}
                {charge != null && minutesBalance != null && !enough && (
                  <a
                    href="/account"
                    className="rounded-full border border-zinc-700 px-4 py-1.5 text-sm text-zinc-200 hover:border-zinc-500"
                  >
                    Get more minutes
                  </a>
                )}
              </div>
            </>
          )}
          {error && <p className="mt-3 text-sm text-amber-300/90">{error}</p>}
        </section>
      )}

      {isOwner && !jobRunning && (
        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={remove}
            disabled={busy}
            className="rounded-full border border-zinc-700 px-4 py-1.5 text-sm text-zinc-300 hover:border-amber-400/60 hover:text-amber-200"
          >
            {confirmDelete ? "Delete for good?" : "Delete video"}
          </button>
          {confirmDelete && (
            <button
              onClick={() => setConfirmDelete(false)}
              className="rounded-full border border-zinc-700 px-4 py-1.5 text-sm text-zinc-400 hover:border-zinc-500"
            >
              Keep it
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Toggle({
  on,
  label,
  onClick,
  disabled,
}: {
  on: boolean;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-full border px-4 py-1.5 text-sm transition-colors disabled:opacity-40 ${
        on
          ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-200"
          : "border-zinc-700 text-zinc-300 hover:border-zinc-500"
      }`}
    >
      {label}
    </button>
  );
}
