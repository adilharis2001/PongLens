"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { frameStepTime } from "@/lib/research/serveDetection";
import { applyServeReviewPlaybackDefaults } from "./serveDetectionView";
import {
  TEMPORAL_SERVE_RESULT_SUMMARY,
  filterTemporalServeResults,
  hydrateTemporalServeContactReview,
  nextTemporalServeReviewIndex,
  temporalServeContactReviewProgress,
  temporalResultBadge,
  temporalResultJumpTargets,
  validateTemporalServeContactReview,
} from "./temporalServeResultsView";
import type {
  TemporalServeContactReview,
  TemporalServeIssueTag,
  TemporalServeOutcome,
  TemporalServeResultAssignment,
  TemporalServeResultFilter,
} from "./types";

type SaveState = "idle" | "saving" | "saved" | "error";

const ISSUE_TAGS: Array<{ value: TemporalServeIssueTag; label: string }> = [
  { value: "contact_occluded", label: "Paddle/contact occluded" },
  { value: "ball_hard_to_see", label: "Ball hard to see" },
  { value: "wrong_player_motion", label: "Followed wrong player" },
  { value: "non_serve_motion", label: "Mistook non-serve motion" },
  { value: "clip_missing_contact", label: "Contact outside clip" },
  { value: "other", label: "Other" },
];

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
  assignments: initialAssignments,
  onReturnToLabeling,
}: {
  assignments: TemporalServeResultAssignment[];
  onReturnToLabeling: () => void;
}) {
  const [assignments, setAssignments] = useState(initialAssignments);
  const [filter, setFilter] = useState<TemporalServeResultFilter>({
    outcome: "all",
    match: "all",
    review: "unreviewed",
  });
  const [assignmentId, setAssignmentId] = useState(
    initialAssignments.find((item) => !item.human_label?.submitted_at)?.id ??
      initialAssignments[0]?.id ??
      "",
  );
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [draft, setDraft] = useState<TemporalServeContactReview>(() =>
    hydrateTemporalServeContactReview(
      initialAssignments.find((item) => item.id === assignmentId)?.human_label,
    ),
  );
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const openedAtRef = useRef(Date.now());
  const answerChangesRef = useRef(0);
  const supabase = useMemo(() => createClient(), []);
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
  const progress = useMemo(
    () => temporalServeContactReviewProgress(assignments),
    [assignments],
  );

  useEffect(() => {
    if (assignment && assignment.id !== assignmentId) {
      setAssignmentId(assignment.id);
    }
  }, [assignment, assignmentId]);

  useEffect(() => {
    if (!assignment) return;
    setDraft(hydrateTemporalServeContactReview(assignment.human_label));
    setSaveState("idle");
    setMessage(null);
    openedAtRef.current = Date.now();
    answerChangesRef.current = 0;
  }, [assignment]);

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

  const updateDraft = (
    updater: (current: TemporalServeContactReview) => TemporalServeContactReview,
  ) => {
    setDraft((current) => updater(current));
    answerChangesRef.current += 1;
    setSaveState("idle");
    setMessage(null);
  };

  const saveReview = async (
    nextDraft: TemporalServeContactReview,
    advance = true,
  ) => {
    if (!assignment) return;
    const errors = validateTemporalServeContactReview(
      nextDraft,
      assignment.source.duration_s,
    );
    if (errors.length) {
      setMessage(errors[0]);
      return;
    }
    setSaveState("saving");
    setMessage(null);
    const now = new Date().toISOString();
    const completed = { ...nextDraft, submitted_at: now };
    const reviewMetrics = {
      time_spent_s:
        (assignment.review_metrics?.time_spent_s ?? 0) +
        Math.round((Date.now() - openedAtRef.current) / 1000),
      answer_changes:
        (assignment.review_metrics?.answer_changes ?? 0) +
        answerChangesRef.current,
    };
    const { error } = await supabase
      .from("research_assignments")
      .update({
        status: "submitted",
        human_label: completed,
        review_metrics: reviewMetrics,
        started_at: assignment.started_at ?? now,
        submitted_at: assignment.submitted_at ?? now,
      })
      .eq("id", assignment.id);
    if (error) {
      console.error("temporal serve review save failed", error);
      setSaveState("error");
      setMessage("Save failed. Your feedback is still here—please retry.");
      return;
    }
    const updated = assignments.map((item) =>
      item.id === assignment.id
        ? {
            ...item,
            status: "submitted" as const,
            human_label: completed,
            review_metrics: reviewMetrics,
            started_at: item.started_at ?? now,
            submitted_at: item.submitted_at ?? now,
          }
        : item,
    );
    setAssignments(updated);
    setDraft(completed);
    setSaveState("saved");
    if (advance) {
      const currentIndex = updated.findIndex((item) => item.id === assignment.id);
      const nextIndex = nextTemporalServeReviewIndex(updated, currentIndex);
      if (nextIndex >= 0) setAssignmentId(updated[nextIndex].id);
    }
  };

  const submitVerdict = (
    verdict: "correct" | "not_visible" | "incorrect",
  ) => {
    const completed: TemporalServeContactReview = {
      ...draft,
      verdict,
      actual_contact_s:
        verdict === "incorrect"
          ? (videoRef.current?.currentTime ?? currentTime)
          : null,
    };
    setDraft(completed);
    void saveReview(completed);
  };

  const exportReviews = async () => {
    const batchId = assignments[0]?.batch_id;
    if (!batchId) return;
    const response = await fetch("/api/research/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ batchId }),
    });
    if (!response.ok) {
      setMessage("Could not export this review batch.");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "ponglens-temporal-serve-review.json";
    anchor.click();
    URL.revokeObjectURL(url);
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
          <button
            type="button"
            onClick={() => void exportReviews()}
            className="rounded-lg border border-edge px-3 py-2 text-xs font-semibold hover:border-zinc-500"
          >
            Export feedback
          </button>
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
                Review where the detector thinks service motion begins
              </h2>
              <p className="mt-1 max-w-3xl text-sm text-zinc-400">
                This {assignments.length}-point cohort preserves the original 24
                examples and adds varied held-out camera setups. Mark a good onset,
                or move frame-by-frame to the true paddle contact and save the miss.
                Headline model numbers still come from all {summary.holdout_points}
                held-out points.
              </p>
            </div>
            <span className="rounded-full border border-edge bg-ink/50 px-3 py-1.5 text-xs text-zinc-300">
              {summary.qualification} cohort
            </span>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
            <Metric label="Your progress" value={`${progress.reviewed}/${progress.total}`} />
            <Metric label="Onset looked right" value={`${progress.correct}`} />
            <Metric label="Exact misses marked" value={`${progress.incorrect}`} />
            <Metric label="Contact not visible" value={`${progress.not_visible}`} />
            <Metric
              label="Median timing miss"
              value={
                progress.median_absolute_error_s === null
                  ? "—"
                  : `${progress.median_absolute_error_s.toFixed(3)}s`
              }
            />
            <Metric label="Pose compute" value={`${summary.seconds_per_point.toFixed(2)}s / point`} />
          </div>
          {Object.keys(progress.issue_counts).length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
              <span className="font-bold text-zinc-300">Miss patterns so far:</span>
              {ISSUE_TAGS.filter(({ value }) => progress.issue_counts[value]).map(
                ({ value, label }) => (
                  <span key={value} className="rounded-full border border-edge px-2.5 py-1">
                    {label} · {progress.issue_counts[value]}
                  </span>
                ),
              )}
            </div>
          )}
        </section>

        <nav className="grid gap-2 rounded-xl border border-edge bg-surface/80 p-2 lg:grid-cols-[1fr_1fr_1fr_auto_minmax(220px,1fr)_auto]">
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
            value={filter.review}
            onChange={(event) =>
              setFilter((current) => ({
                ...current,
                review: event.target.value as TemporalServeResultFilter["review"],
              }))
            }
            className="rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm"
            aria-label="Filter by review status"
          >
            <option value="all">All review states</option>
            <option value="unreviewed">Unreviewed</option>
            <option value="correct">Marked correct</option>
            <option value="incorrect">Exact miss marked</option>
            <option value="not_visible">Contact not visible</option>
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
            total={assignments.length}
            mediaUrl={mediaUrl}
            mediaError={mediaError}
            currentTime={currentTime}
            videoRef={videoRef}
            onTimeChange={setCurrentTime}
            onJump={jumpTo}
            onStep={stepFrames}
            draft={draft}
            saveState={saveState}
            message={message}
            onUpdateDraft={updateDraft}
            onSubmitVerdict={submitVerdict}
            onSave={() => void saveReview(draft, false)}
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
  total,
  mediaUrl,
  mediaError,
  currentTime,
  videoRef,
  onTimeChange,
  onJump,
  onStep,
  draft,
  saveState,
  message,
  onUpdateDraft,
  onSubmitVerdict,
  onSave,
}: {
  assignment: TemporalServeResultAssignment;
  total: number;
  mediaUrl: string | null;
  mediaError: string | null;
  currentTime: number;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onTimeChange: (time: number) => void;
  onJump: (time: number) => void;
  onStep: (frames: number) => void;
  draft: TemporalServeContactReview;
  saveState: SaveState;
  message: string | null;
  onUpdateDraft: (
    updater: (current: TemporalServeContactReview) => TemporalServeContactReview,
  ) => void;
  onSubmitVerdict: (
    verdict: "correct" | "incorrect" | "not_visible",
  ) => void;
  onSave: () => void;
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
            <h2 className="text-xl font-bold">Held-out example {assignment.sequence} of {total}</h2>
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
        <article className="rounded-2xl border border-cyan-glow/30 bg-surface/90 p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-glow">
            Your contact review
          </p>
          <h3 className="mt-1 text-lg font-bold">Is the model-onset jump useful?</h3>
          <p className="mt-1 text-xs leading-5 text-zinc-400">
            If yes, mark it correct. If not, move to the first visible paddle-ball
            contact with the frame buttons, then mark the current frame. Use “not
            visible” only when the true contact cannot be seen.
          </p>

          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <button
              type="button"
              disabled={!mediaUrl || saveState === "saving"}
              onClick={() => onSubmitVerdict("correct")}
              className="rounded-xl border border-emerald-400/35 bg-emerald-500/15 px-3 py-3 text-sm font-bold text-emerald-100 disabled:opacity-50"
            >
              ✓ Model onset is correct
            </button>
            <button
              type="button"
              disabled={!mediaUrl || saveState === "saving"}
              onClick={() => onSubmitVerdict("incorrect")}
              className="rounded-xl border border-rose-400/35 bg-rose-500/15 px-3 py-3 text-sm font-bold text-rose-100 disabled:opacity-50"
            >
              Mark actual contact · {currentTime.toFixed(3)}s
            </button>
            <button
              type="button"
              disabled={!mediaUrl || saveState === "saving"}
              onClick={() => onSubmitVerdict("not_visible")}
              className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-3 text-sm font-bold text-amber-100 disabled:opacity-50 sm:col-span-2 xl:col-span-1 2xl:col-span-2"
            >
              Contact is not visible
            </button>
          </div>

          {draft.verdict && (
            <div className="mt-3 rounded-lg border border-edge bg-ink/35 px-3 py-2 text-xs text-zinc-300">
              Current choice: <strong>{draft.verdict.replaceAll("_", " ")}</strong>
              {draft.actual_contact_s !== null && (
                <> at <strong className="font-mono">{draft.actual_contact_s.toFixed(3)}s</strong></>
              )}
            </div>
          )}

          <fieldset className="mt-4">
            <legend className="text-xs font-bold text-zinc-300">
              What likely caused the miss? <span className="font-normal text-zinc-500">Optional</span>
            </legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {ISSUE_TAGS.map(({ value, label }) => {
                const selected = draft.issue_tags.includes(value);
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() =>
                      onUpdateDraft((current) => ({
                        ...current,
                        issue_tags: selected
                          ? current.issue_tags.filter((tag) => tag !== value)
                          : [...current.issue_tags, value],
                      }))
                    }
                    className={`rounded-full border px-2.5 py-1.5 text-xs ${
                      selected
                        ? "border-magenta-soft/50 bg-magenta-soft/15 text-fuchsia-100"
                        : "border-edge text-zinc-400 hover:border-zinc-500"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <label className="mt-4 block text-xs font-bold text-zinc-300">
            Note <span className="font-normal text-zinc-500">Optional</span>
            <textarea
              value={draft.note}
              onChange={(event) =>
                onUpdateDraft((current) => ({ ...current, note: event.target.value }))
              }
              rows={2}
              placeholder="Anything visually distinctive about this serve?"
              className="mt-2 w-full rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm font-normal text-zinc-100 outline-none focus:border-cyan-glow/50"
            />
          </label>

          <div className="mt-3 flex items-center justify-between gap-3">
            <span className={`text-xs ${saveState === "error" ? "text-rose-300" : "text-zinc-500"}`}>
              {saveState === "saving"
                ? "Saving…"
                : saveState === "saved"
                  ? "Saved · advanced to next review"
                  : saveState === "error"
                    ? "Not saved"
                    : "Choose an action to save"}
            </span>
            {draft.verdict && (
              <button
                type="button"
                disabled={saveState === "saving"}
                onClick={onSave}
                className="rounded-lg border border-edge px-3 py-2 text-xs font-semibold disabled:opacity-50"
              >
                Save edits
              </button>
            )}
          </div>
          {message && <p className="mt-2 text-xs text-rose-200">{message}</p>}
        </article>

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
            The expected server comes from Pong Lens scoring rotation, not a new independent visual adjudication. Your exact paddle-contact marks now provide the independent timing truth that this experiment previously lacked.
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
