"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { frameStepTime } from "@/lib/research/serveDetection";
import { applyServeReviewPlaybackDefaults } from "./serveDetectionView";
import {
  TEMPORAL_SERVE_RESULT_SUMMARY,
  filterTemporalServeResults,
  temporalResultBadge,
  temporalResultJumpTargets,
} from "./temporalServeResultsView";
import type {
  TemporalServeOutcome,
  TemporalServeResultAssignment,
  TemporalServeResultFilter,
} from "./types";

const BADGE_STYLES = {
  success: "border-emerald-400/30 bg-emerald-500/15 text-emerald-100",
  danger: "border-rose-400/30 bg-rose-500/15 text-rose-100",
  warning: "border-amber-400/30 bg-amber-500/15 text-amber-100",
} as const;

function sideLabel(side: "near" | "far" | null): string {
  if (side === "near") return "Near-side player";
  if (side === "far") return "Far-side player";
  return "No call";
}

function reasonLabel(reason: string): string {
  return reason.replaceAll("_", " ");
}

export function TemporalServeResults({
  assignments,
  onReturnToLabeling,
}: {
  assignments: TemporalServeResultAssignment[];
  onReturnToLabeling: () => void;
}) {
  const [filter, setFilter] = useState<TemporalServeResultFilter>({
    outcome: "all",
    match: "all",
  });
  const [assignmentId, setAssignmentId] = useState(assignments[0]?.id ?? "");
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const matches = useMemo(
    () => [...new Set(assignments.map((item) => item.source.match_label))].sort(),
    [assignments],
  );
  const filtered = useMemo(
    () => filterTemporalServeResults(assignments, filter),
    [assignments, filter],
  );
  const assignment =
    filtered.find((item) => item.id === assignmentId) ?? filtered[0] ?? null;
  const visibleIndex = assignment
    ? filtered.findIndex((item) => item.id === assignment.id)
    : -1;

  useEffect(() => {
    if (assignment && assignment.id !== assignmentId) {
      setAssignmentId(assignment.id);
    }
  }, [assignment, assignmentId]);

  useEffect(() => {
    if (!assignment) return;
    let cancelled = false;
    setMediaUrl(null);
    setMediaError(null);
    setCurrentTime(0);
    fetch("/api/research/media", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignmentId: assignment.id }),
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          url?: string;
          error?: string;
        };
        if (!response.ok || !payload.url) {
          throw new Error(payload.error ?? "Could not load video");
        }
        return payload.url;
      })
      .then((url) => {
        if (!cancelled) setMediaUrl(url);
      })
      .catch((error: Error) => {
        if (!cancelled) setMediaError(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [assignment]);

  const jumpTo = (timeS: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.currentTime = timeS;
    setCurrentTime(timeS);
  };

  const stepFrames = (frames: number) => {
    if (!assignment || !videoRef.current) return;
    const video = videoRef.current;
    video.pause();
    const proposal = assignment.source.proposal;
    const target = frameStepTime(
      video.currentTime,
      frames,
      proposal.video.fps,
      proposal.video.duration_s,
    );
    video.currentTime = target;
    setCurrentTime(target);
  };

  const summary = TEMPORAL_SERVE_RESULT_SUMMARY;

  return (
    <main className="min-h-screen bg-arena pb-24 text-zinc-100">
      <header className="sticky top-0 z-40 border-b border-edge bg-ink/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-3 px-4 py-3">
          <div className="mr-auto">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-glow">
              Pong Lens Research
            </p>
            <h1 className="text-xl font-bold">Serve detection results</h1>
          </div>
          <div className="flex rounded-lg border border-edge bg-surface-2 p-1 text-xs">
            <span className="rounded-md bg-cyan-glow px-3 py-1.5 font-semibold text-ink">
              Latest results · {assignments.length}
            </span>
            <button
              type="button"
              onClick={onReturnToLabeling}
              className="rounded-md px-3 py-1.5 font-semibold text-zinc-400 hover:text-white"
            >
              Labeling workspace
            </button>
          </div>
          <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1 text-xs font-bold text-amber-100">
            Research only
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] space-y-4 p-4">
        <section className="rounded-2xl border border-edge bg-surface/90 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-magenta-soft">
                Complete held-out result
              </p>
              <h2 className="mt-1 text-xl font-bold">
                The temporal detector did not generalize
              </h2>
              <p className="mt-1 max-w-3xl text-sm text-zinc-400">
                These 24 clips show its strongest held-out evidence—eight correct,
                eight wrong, and eight withheld. Headline numbers below come from
                all {summary.holdout_points} held-out points, not this review sample.
              </p>
            </div>
            <span className="rounded-full border border-edge bg-ink/50 px-3 py-1.5 text-xs text-zinc-300">
              {summary.qualification} cohort
            </span>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            <Metric label="Raw point accuracy" value={`${(summary.raw_accuracy * 100).toFixed(1)}%`} />
            <Metric label="Fused precision" value={`${(summary.fused_precision * 100).toFixed(1)}%`} />
            <Metric label="Fused coverage" value={`${(summary.fused_coverage * 100).toFixed(1)}%`} />
            <Metric label="Production cohort" value={`${summary.total_points} points · ${summary.total_matches} matches`} />
            <Metric label="Pose compute" value={`${summary.seconds_per_point.toFixed(2)}s / point`} />
          </div>
        </section>

        <nav className="grid gap-2 rounded-xl border border-edge bg-surface/80 p-2 md:grid-cols-[1fr_1fr_auto_minmax(220px,1fr)_auto]">
          <select
            value={filter.outcome}
            onChange={(event) =>
              setFilter((current) => ({
                ...current,
                outcome: event.target.value as TemporalServeOutcome | "all",
              }))
            }
            className="rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm"
            aria-label="Filter by result"
          >
            <option value="all">All outcomes</option>
            <option value="correct">Correct</option>
            <option value="wrong">Wrong</option>
            <option value="withheld">Withheld</option>
          </select>
          <select
            value={filter.match}
            onChange={(event) =>
              setFilter((current) => ({ ...current, match: event.target.value }))
            }
            className="rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm"
            aria-label="Filter by match"
          >
            <option value="all">All matches</option>
            {matches.map((match) => (
              <option key={match} value={match}>{match}</option>
            ))}
          </select>
          <button
            type="button"
            disabled={visibleIndex <= 0}
            onClick={() => setAssignmentId(filtered[visibleIndex - 1]?.id ?? "")}
            className="rounded-lg border border-edge px-3 py-2 disabled:opacity-30"
          >
            ←
          </button>
          <select
            value={assignment?.id ?? ""}
            onChange={(event) => setAssignmentId(event.target.value)}
            className="min-w-0 rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm"
            aria-label="Result review item"
          >
            {filtered.map((item, index) => (
              <option key={item.id} value={item.id}>
                {index + 1}/{filtered.length} · {item.source.match_label} · point {item.source.source_point_idx} · {item.source.proposal.temporal_result.outcome}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={visibleIndex < 0 || visibleIndex >= filtered.length - 1}
            onClick={() => setAssignmentId(filtered[visibleIndex + 1]?.id ?? "")}
            className="rounded-lg border border-edge px-3 py-2 disabled:opacity-30"
          >
            →
          </button>
        </nav>

        {!assignment ? (
          <section className="rounded-2xl border border-dashed border-edge p-8 text-center text-zinc-400">
            No clips match these filters.
          </section>
        ) : (
          <ResultWorkspace
            assignment={assignment}
            mediaUrl={mediaUrl}
            mediaError={mediaError}
            currentTime={currentTime}
            videoRef={videoRef}
            onTimeChange={setCurrentTime}
            onJump={jumpTo}
            onStep={stepFrames}
          />
        )}
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-edge bg-ink/35 px-3 py-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-1 text-sm font-bold text-zinc-100">{value}</p>
    </div>
  );
}

function ResultWorkspace({
  assignment,
  mediaUrl,
  mediaError,
  currentTime,
  videoRef,
  onTimeChange,
  onJump,
  onStep,
}: {
  assignment: TemporalServeResultAssignment;
  mediaUrl: string | null;
  mediaError: string | null;
  currentTime: number;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onTimeChange: (time: number) => void;
  onJump: (time: number) => void;
  onStep: (frames: number) => void;
}) {
  const proposal = assignment.source.proposal;
  const result = proposal.temporal_result;
  const badge = temporalResultBadge(result.outcome);
  const targets = temporalResultJumpTargets(result);
  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,.75fr)]">
      <article className="rounded-2xl border border-edge bg-surface/90 p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-glow">
              {assignment.source.match_label} · source point {assignment.source.source_point_idx}
            </p>
            <h2 className="text-xl font-bold">Held-out example {assignment.sequence} of 24</h2>
          </div>
          <span className={`rounded-full border px-3 py-1.5 text-sm font-bold ${BADGE_STYLES[badge.tone]}`}>
            {badge.label}
          </span>
        </div>
        <div className="overflow-hidden rounded-xl bg-black">
          {mediaUrl ? (
            <video
              key={assignment.id}
              ref={videoRef}
              src={mediaUrl}
              className="aspect-video w-full"
              controls
              playsInline
              preload="auto"
              onLoadedMetadata={(event) => {
                applyServeReviewPlaybackDefaults(event.currentTarget);
                if (typeof result.temporal.onset_s === "number" && result.temporal.onset_s >= 0) {
                  event.currentTarget.currentTime = result.temporal.onset_s;
                  onTimeChange(result.temporal.onset_s);
                }
              }}
              onTimeUpdate={(event) => onTimeChange(event.currentTarget.currentTime)}
            />
          ) : (
            <div className="flex aspect-video items-center justify-center text-sm text-zinc-500">
              {mediaError ?? "Loading protected video…"}
            </div>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {[-3, -2, -1, 1, 2, 3].map((frames) => (
            <button
              key={frames}
              type="button"
              onClick={() => onStep(frames)}
              className="rounded-lg border border-edge px-3 py-2 text-xs font-semibold hover:border-zinc-500"
            >
              {frames > 0 ? "+" : ""}{frames} frame{Math.abs(frames) === 1 ? "" : "s"}
            </button>
          ))}
          <span className="ml-auto rounded-lg bg-ink/50 px-3 py-2 font-mono text-xs text-zinc-300">
            {currentTime.toFixed(3)}s · {proposal.video.fps.toFixed(2)} fps
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {targets.map((target) => (
            <button
              key={target.key}
              type="button"
              onClick={() => onJump(target.time_s)}
              className="rounded-lg border border-cyan-glow/35 bg-cyan-glow/10 px-3 py-2 font-mono text-xs font-bold text-cyan-glow"
            >
              {target.label} · {target.time_s.toFixed(3)}s
            </button>
          ))}
          {!targets.length && (
            <span className="text-xs text-zinc-500">No reliable action timestamp was retained.</span>
          )}
        </div>
      </article>

      <aside className="space-y-4">
        <article className="rounded-2xl border border-edge bg-surface/90 p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-magenta-soft">Server comparison</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
            <Comparison label="Model predicted" value={sideLabel(result.predicted_side)} />
            <Comparison label="Rotation-derived expected" value={sideLabel(result.expected_side)} />
          </div>
          <dl className="mt-4 space-y-2 text-sm">
            <Row label="Fused confidence" value={`${(result.fused.confidence * 100).toFixed(1)}%`} />
            <Row label="Decision reason" value={reasonLabel(result.fused.reason)} />
            <Row label="Near-side evidence" value={(result.temporal.near * 100).toFixed(1) + "%"} />
            <Row label="Far-side evidence" value={(result.temporal.far * 100).toFixed(1) + "%"} />
            <Row label="Pose margin" value={(result.temporal.margin * 100).toFixed(1) + "%"} />
            <Row label="Bounce-chain rank" value={result.placement.chain_rank === null ? "Unavailable" : result.placement.chain_rank.toFixed(3)} />
          </dl>
        </article>
        <article className="rounded-2xl border border-amber-400/25 bg-amber-500/5 p-4 text-sm text-amber-50/90">
          <p className="font-bold">How to interpret this</p>
          <p className="mt-2 text-xs leading-5 text-amber-100/70">
            The expected server comes from Pong Lens scoring rotation, not a new independent visual adjudication. The model-onset jump is its best estimate; these 24 clips do not have exact onset ground truth, so judge timing visually.
          </p>
          <p className="mt-2 text-xs leading-5 text-amber-100/70">
            Confident successes are concentrated in familiar Vaibhav camera setups. That concentration is part of the result, not hidden by this sample.
          </p>
        </article>
      </aside>
    </section>
  );
}

function Comparison({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-edge bg-ink/35 p-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-1 text-lg font-bold">{value}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-edge/60 pb-2 last:border-0">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="max-w-[60%] text-right font-semibold text-zinc-200">{value}</dd>
    </div>
  );
}
