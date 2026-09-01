"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AUDIO_IMPACT_KINDS,
  audioImpactKindForShortcut,
  audioImpactProgress,
  hydrateAudioImpactLabel,
  insertManualAudioImpactEvent,
  isAudioImpactShortcutTarget,
  labelAudioImpactEvent,
  setAudioImpactSequenceComplete,
  validateAudioImpactLabel,
  type AudioImpactHumanLabel,
  type AudioImpactKind,
} from "@/lib/research/audioImpacts";
import { createClient } from "@/lib/supabase/client";
import {
  candidateLoop,
  filterAudioImpactAssignments,
  firstReviewTarget,
  nextReviewTarget,
  previousReviewTarget,
  queueWithActive,
  type AudioImpactReviewTarget,
} from "./audioImpactView";
import type {
  AudioImpactResearchAssignment,
  AudioImpactReviewMetrics,
  AudioImpactRound,
  AudioImpactVenueCategory,
} from "./types";

type SaveState = "idle" | "saving" | "saved" | "error";

interface PendingSave {
  assignment_id: string;
  target: AudioImpactReviewTarget;
  label: AudioImpactHumanLabel;
  previous_label: AudioImpactHumanLabel;
  status: AudioImpactResearchAssignment["status"];
  advance: boolean;
}

const LABELS: Record<
  AudioImpactKind,
  { key: string; title: string; description: string }
> = {
  paddle: {
    key: "P",
    title: "Paddle",
    description: "Ball on either visible match player’s paddle.",
  },
  table: {
    key: "T",
    title: "Table",
    description: "Ball on the visible match table.",
  },
  floor: {
    key: "F",
    title: "Ball on floor",
    description: "The match ball bounces on the floor.",
  },
  shoe: {
    key: "S",
    title: "Shoe / stomp",
    description: "A footfall, shoe squeak, or serving stomp.",
  },
  net: {
    key: "N",
    title: "Net",
    description: "Ball on the visible net or net assembly.",
  },
  background: {
    key: "B",
    title: "Background court",
    description: "Paddle or table contact from another game.",
  },
  other: {
    key: "O",
    title: "Other",
    description: "Voice, catch, body, clap, or unrelated transient.",
  },
  no_impact: {
    key: "X",
    title: "No clear impact",
    description: "No distinct impact is audible at the marker.",
  },
  unsure: {
    key: "U",
    title: "Unsure",
    description: "A real sound is present, but its class is unclear.",
  },
};

function firstAssignmentId(assignments: AudioImpactResearchAssignment[]) {
  return firstReviewTarget(assignments)?.assignment_id ?? assignments[0]?.id ?? null;
}

function waveformPoints(values: readonly number[]): string {
  if (values.length === 0) return "";
  return values
    .map((value, index) => {
      const x = values.length === 1 ? 0 : (index / (values.length - 1)) * 1000;
      const y = 48 - Math.max(0, Math.min(1, value)) * 42;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function labelForAssignment(
  assignment: AudioImpactResearchAssignment | null,
): AudioImpactHumanLabel {
  return hydrateAudioImpactLabel(
    assignment?.human_label,
    assignment?.source.proposal.audio.candidates ?? [],
  );
}

export function AudioImpactLabeler({
  initialAssignments,
  isAdmin,
}: {
  initialAssignments: AudioImpactResearchAssignment[];
  isAdmin: boolean;
}) {
  const initialAssignmentId = firstAssignmentId(initialAssignments);
  const initialAssignment =
    initialAssignments.find((item) => item.id === initialAssignmentId) ?? null;
  const [assignments, setAssignments] = useState(initialAssignments);
  const [target, setTarget] = useState<AudioImpactReviewTarget | null>(() =>
    firstReviewTarget(initialAssignments),
  );
  const [label, setLabel] = useState<AudioImpactHumanLabel>(() =>
    labelForAssignment(initialAssignment),
  );
  const [venueFilter, setVenueFilter] = useState<
    AudioImpactVenueCategory | "all"
  >("all");
  const [roundFilter, setRoundFilter] = useState<AudioImpactRound | "all">(
    "all",
  );
  const [completionFilter, setCompletionFilter] = useState<
    "all" | "open" | "complete"
  >("all");
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pendingSave, setPendingSave] = useState<PendingSave | null>(null);
  const [history, setHistory] = useState<PendingSave[]>([]);
  const [looping, setLooping] = useState(true);
  const [playbackSpeed, setPlaybackSpeedState] = useState(1);
  const videoRef = useRef<HTMLVideoElement>(null);
  const openedAt = useRef(Date.now());
  const playbackCount = useRef(
    initialAssignment?.review_metrics?.playback_count ?? 0,
  );
  const answerChanges = useRef(
    initialAssignment?.review_metrics?.answer_changes ?? 0,
  );
  const halfSpeedCount = useRef(
    initialAssignment?.review_metrics?.replay_half_speed_count ?? 0,
  );
  const quarterSpeedCount = useRef(
    initialAssignment?.review_metrics?.replay_quarter_speed_count ?? 0,
  );
  const fullContextPlayed = useRef(
    initialAssignment?.review_metrics?.full_context_played ?? false,
  );
  const supabase = useMemo(() => createClient(), []);

  const assignment =
    assignments.find((item) => item.id === target?.assignment_id) ?? null;
  const currentEvent =
    label.events.find((event) => event.id === target?.event_id) ??
    label.events[0] ??
    null;
  const assignmentId = assignment?.id ?? null;
  const eventTimeS = currentEvent?.time_s ?? null;
  const durationS = assignment?.source.duration_s ?? null;
  const loopWindow = useMemo(
    () =>
      eventTimeS !== null && durationS !== null
        ? candidateLoop(eventTimeS, durationS)
        : null,
    [durationS, eventTimeS],
  );
  const visible = useMemo(
    () =>
      filterAudioImpactAssignments(assignments, {
        venue: venueFilter,
        round: roundFilter,
        completion: completionFilter,
      }),
    [assignments, completionFilter, roundFilter, venueFilter],
  );
  const queue = queueWithActive(visible, assignment);
  const progress = audioImpactProgress(
    assignments.map((item) => ({
      status: item.status,
      label: hydrateAudioImpactLabel(
        item.id === assignment?.id ? label : item.human_label,
        item.source.proposal.audio.candidates,
      ),
    })),
  );
  const waveform = useMemo(
    () => waveformPoints(assignment?.source.proposal.audio.waveform ?? []),
    [assignment],
  );

  const resetMetrics = useCallback((next: AudioImpactResearchAssignment) => {
    openedAt.current = Date.now();
    playbackCount.current = next.review_metrics?.playback_count ?? 0;
    answerChanges.current = next.review_metrics?.answer_changes ?? 0;
    halfSpeedCount.current =
      next.review_metrics?.replay_half_speed_count ?? 0;
    quarterSpeedCount.current =
      next.review_metrics?.replay_quarter_speed_count ?? 0;
    fullContextPlayed.current =
      next.review_metrics?.full_context_played ?? false;
  }, []);

  const openTarget = useCallback(
    (next: AudioImpactReviewTarget | null) => {
      if (!next) return;
      const nextAssignment = assignments.find(
        (item) => item.id === next.assignment_id,
      );
      if (!nextAssignment) return;
      if (nextAssignment.id !== assignment?.id) {
        setLabel(labelForAssignment(nextAssignment));
        resetMetrics(nextAssignment);
      }
      setTarget(next);
      setLooping(true);
      setPlaybackSpeedState(1);
      setMessage(null);
      setPendingSave(null);
      setDirty(false);
    },
    [assignment?.id, assignments, resetMetrics],
  );

  const persist = useCallback(
    async (
      item: AudioImpactResearchAssignment,
      nextLabel: AudioImpactHumanLabel,
      status: AudioImpactResearchAssignment["status"],
    ): Promise<AudioImpactResearchAssignment | null> => {
      setSaveState("saving");
      const now = new Date().toISOString();
      const metrics: AudioImpactReviewMetrics = {
        time_spent_s:
          (item.review_metrics?.time_spent_s ?? 0) +
          Math.round((Date.now() - openedAt.current) / 1000),
        playback_count: playbackCount.current,
        answer_changes: answerChanges.current,
        replay_half_speed_count: halfSpeedCount.current,
        replay_quarter_speed_count: quarterSpeedCount.current,
        full_context_played: fullContextPlayed.current,
        video_completed: item.review_metrics?.video_completed ?? false,
      };
      const { error } = await supabase
        .from("research_assignments")
        .update({
          status,
          human_label: nextLabel,
          review_metrics: metrics,
          started_at: item.started_at ?? now,
          submitted_at: status === "submitted" ? now : null,
        })
        .eq("id", item.id);
      if (error) {
        console.error("audio impact research save failed", error);
        setSaveState("error");
        setMessage("Save failed. Your answer is still on this screen.");
        return null;
      }
      const updated: AudioImpactResearchAssignment = {
        ...item,
        status,
        human_label: nextLabel,
        review_metrics: metrics,
        started_at: item.started_at ?? now,
        submitted_at: status === "submitted" ? now : null,
      };
      setAssignments((current) =>
        current.map((candidate) =>
          candidate.id === updated.id ? updated : candidate,
        ),
      );
      openedAt.current = Date.now();
      setDirty(false);
      setSaveState("saved");
      setMessage(null);
      return updated;
    },
    [supabase],
  );

  const finishSave = useCallback(
    (saved: PendingSave, updated: AudioImpactResearchAssignment) => {
      const updatedAssignments = assignments.map((item) =>
        item.id === updated.id ? updated : item,
      );
      setPendingSave(null);
      setHistory((current) => [...current.slice(-19), saved]);
      if (saved.advance) {
        openTarget(
          nextReviewTarget(
            updatedAssignments,
            saved.target.assignment_id,
            saved.target.event_id,
          ),
        );
      }
    },
    [assignments, openTarget],
  );

  const saveAndAdvance = useCallback(
    async (kind: AudioImpactKind) => {
      if (!assignment || !currentEvent || !target || saveState === "saving") {
        return;
      }
      const previousLabel = label;
      const nextLabel = labelAudioImpactEvent(label, currentEvent.id, kind);
      const pending: PendingSave = {
        assignment_id: assignment.id,
        target,
        label: nextLabel,
        previous_label: previousLabel,
        status: "in_progress",
        advance: true,
      };
      answerChanges.current += 1;
      setLabel(nextLabel);
      setDirty(true);
      setPendingSave(pending);
      const updated = await persist(assignment, nextLabel, "in_progress");
      if (updated) finishSave(pending, updated);
    },
    [assignment, currentEvent, finishSave, label, persist, saveState, target],
  );

  const retrySave = useCallback(async () => {
    if (!pendingSave || saveState === "saving") return;
    const item = assignments.find(
      (candidate) => candidate.id === pendingSave.assignment_id,
    );
    if (!item) return;
    const updated = await persist(item, pendingSave.label, pendingSave.status);
    if (updated) finishSave(pendingSave, updated);
  }, [assignments, finishSave, pendingSave, persist, saveState]);

  const undo = useCallback(async () => {
    const prior = history.at(-1);
    if (!prior || saveState === "saving") return;
    const item = assignments.find(
      (candidate) => candidate.id === prior.assignment_id,
    );
    if (!item) return;
    resetMetrics(item);
    setTarget(prior.target);
    setLabel(prior.previous_label);
    setDirty(true);
    const updated = await persist(item, prior.previous_label, "in_progress");
    if (!updated) return;
    setHistory((current) => current.slice(0, -1));
  }, [assignments, history, persist, resetMetrics, saveState]);

  const addMissedSound = useCallback(async () => {
    if (!assignment || !videoRef.current || saveState === "saving") return;
    const nextLabel = insertManualAudioImpactEvent(
      label,
      videoRef.current.currentTime,
      assignment.source.proposal.audio.low_threshold_candidates,
    );
    const added = nextLabel.events.find(
      (event) => !label.events.some((existing) => existing.id === event.id),
    );
    if (!added) return;
    answerChanges.current += 1;
    setLabel(nextLabel);
    setTarget({ assignment_id: assignment.id, event_id: added.id });
    setDirty(true);
    const updated = await persist(assignment, nextLabel, "in_progress");
    if (!updated) {
      setPendingSave({
        assignment_id: assignment.id,
        target: { assignment_id: assignment.id, event_id: added.id },
        label: nextLabel,
        previous_label: label,
        status: "in_progress",
        advance: false,
      });
    }
  }, [assignment, label, persist, saveState]);

  const completePoint = useCallback(async () => {
    if (!assignment || !target || saveState === "saving") return;
    const nextLabel = setAudioImpactSequenceComplete(label, true);
    const missing = validateAudioImpactLabel(nextLabel);
    if (missing.length > 0) {
      setMessage(
        `Label all ${missing.filter((item) => item.endsWith(".kind")).length} remaining sounds before completing this point.`,
      );
      return;
    }
    setLabel(nextLabel);
    setDirty(true);
    const updated = await persist(assignment, nextLabel, "submitted");
    if (!updated) {
      setPendingSave({
        assignment_id: assignment.id,
        target,
        label: nextLabel,
        previous_label: label,
        status: "submitted",
        advance: true,
      });
      return;
    }
    const updatedAssignments = assignments.map((item) =>
      item.id === updated.id ? updated : item,
    );
    openTarget(firstReviewTarget(updatedAssignments.filter((item) => item.status !== "submitted")));
  }, [assignment, assignments, label, openTarget, persist, saveState, target]);

  const setPlaybackSpeed = useCallback((speed: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = speed;
    setPlaybackSpeedState(speed);
    if (speed === 0.5) halfSpeedCount.current += 1;
    if (speed === 0.25) quarterSpeedCount.current += 1;
    void video.play().catch(() => undefined);
  }, []);

  const playFullContext = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setLooping(false);
    video.currentTime = 0;
    video.playbackRate = 1;
    setPlaybackSpeedState(1);
    fullContextPlayed.current = true;
    void video.play().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!assignmentId) return;
    let cancelled = false;
    setMediaUrl(null);
    setMediaError(null);
    fetch("/api/research/media", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignmentId }),
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          url?: string;
          error?: string;
        };
        if (!response.ok || !payload.url) {
          throw new Error(payload.error ?? "Could not load protected video.");
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
  }, [assignmentId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !mediaUrl || !loopWindow) return;
    setLooping(true);
    setPlaybackSpeedState(1);
    video.playbackRate = 1;
    video.currentTime = loopWindow.start_s;
    void video.play().catch(() => undefined);
  }, [currentEvent?.id, loopWindow, mediaUrl]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isAudioImpactShortcutTarget(event.target)) return;
      const kind = audioImpactKindForShortcut(event.key);
      if (!kind) return;
      event.preventDefault();
      void saveAndAdvance(kind);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saveAndAdvance]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || saveState === "saving" || saveState === "error") {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, saveState]);

  const exportBatch = async () => {
    if (!assignment) return;
    const response = await fetch("/api/research/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ batchId: assignment.batch_id }),
    });
    if (!response.ok) {
      setMessage("Research export failed.");
      return;
    }
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "audio-impact-labeling-recent-v1.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (!assignment || !target || !currentEvent) {
    return (
      <main className="min-h-screen bg-arena p-8 text-center text-zinc-100">
        <h1 className="text-2xl font-bold">No audio-impact assignments yet</h1>
        <p className="mt-2 text-zinc-400">
          The batch has not been seeded or assigned to this account.
        </p>
        <Link href="/research" className="mt-6 inline-block text-cyan-glow">
          Back to research
        </Link>
      </main>
    );
  }

  const markerX = Math.max(
    0,
    Math.min(1000, (currentEvent.time_s / assignment.source.duration_s) * 1000),
  );
  const queueIndex = queue.findIndex((item) => item.id === assignment.id);

  return (
    <main className="min-h-screen bg-arena pb-16 text-zinc-100">
      <header className="sticky top-0 z-40 border-b border-edge bg-ink/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1700px] flex-wrap items-center gap-3 px-4 py-3">
          <div className="mr-auto">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-glow">
              Pong Lens Research
            </p>
            <h1 className="text-xl font-bold">What made this sound?</h1>
          </div>
          <span className="rounded-full border border-edge px-3 py-1 text-xs">
            {progress.labeled_sounds}/{progress.total_sounds} labeled sounds
          </span>
          <span className="rounded-full border border-edge px-3 py-1 text-xs">
            {progress.completed_points}/{progress.total_points} points
          </span>
          {isAdmin && (
            <button
              type="button"
              onClick={() => void exportBatch()}
              className="rounded-lg border border-magenta-glow/30 px-3 py-1.5 text-xs font-semibold text-magenta-soft"
            >
              Export JSON
            </button>
          )}
          <span
            className={`rounded-full px-3 py-1 text-xs ${
              saveState === "error"
                ? "bg-rose-500/15 text-rose-300"
                : "bg-emerald-500/10 text-emerald-300"
            }`}
          >
            {saveState === "saving"
              ? "Saving…"
              : saveState === "saved"
                ? "Saved"
                : saveState === "error"
                  ? "Save failed"
                  : "Autosave on"}
          </span>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1700px] gap-4 p-4 xl:grid-cols-[280px_minmax(0,1fr)_400px]">
        <aside className="space-y-3 rounded-2xl border border-edge bg-surface/90 p-3 xl:sticky xl:top-20 xl:h-[calc(100vh-6rem)] xl:overflow-y-auto">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-glow">
              Queue
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              Filter points; progress always counts the full batch.
            </p>
          </div>
          <select
            aria-label="Filter by venue"
            value={venueFilter}
            onChange={(event) =>
              setVenueFilter(event.target.value as AudioImpactVenueCategory | "all")
            }
            className="w-full rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm"
          >
            <option value="all">All venues</option>
            <option value="pingpod">PingPod</option>
            <option value="westchester">Westchester</option>
            <option value="lyttc">LYTTC</option>
          </select>
          <div className="grid grid-cols-2 gap-2">
            <select
              aria-label="Filter by round"
              value={roundFilter}
              onChange={(event) =>
                setRoundFilter(event.target.value as AudioImpactRound | "all")
              }
              className="rounded-lg border border-edge bg-surface-2 px-2 py-2 text-sm"
            >
              <option value="all">All rounds</option>
              <option value="A">Round A</option>
              <option value="B">Round B</option>
              <option value="C">Round C</option>
            </select>
            <select
              aria-label="Filter by completion"
              value={completionFilter}
              onChange={(event) =>
                setCompletionFilter(
                  event.target.value as "all" | "open" | "complete",
                )
              }
              className="rounded-lg border border-edge bg-surface-2 px-2 py-2 text-sm"
            >
              <option value="all">All states</option>
              <option value="open">Open</option>
              <option value="complete">Complete</option>
            </select>
          </div>
          <div className="grid grid-cols-[auto_1fr_auto] gap-2">
            <button
              type="button"
              disabled={queueIndex <= 0 || saveState === "saving"}
              onClick={() => {
                const next = queue[queueIndex - 1];
                if (next) {
                  openTarget(firstReviewTarget([next]));
                }
              }}
              className="rounded-lg border border-edge px-3 disabled:opacity-30"
              aria-label="Previous point"
            >
              ←
            </button>
            <select
              aria-label="Audio-impact point"
              value={assignment.id}
              onChange={(event) => {
                const next = queue.find((item) => item.id === event.target.value);
                if (next) openTarget(firstReviewTarget([next]));
              }}
              className="min-w-0 rounded-lg border border-edge bg-surface-2 px-2 py-2 text-sm"
            >
              {queue.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.sequence} · {item.source.match_label} · point {item.source.source_point_idx}
                  {item.status === "submitted" ? " · complete" : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={queueIndex >= queue.length - 1 || saveState === "saving"}
              onClick={() => {
                const next = queue[queueIndex + 1];
                if (next) openTarget(firstReviewTarget([next]));
              }}
              className="rounded-lg border border-edge px-3 disabled:opacity-30"
              aria-label="Next point"
            >
              →
            </button>
          </div>
          <div className="space-y-1 border-t border-edge pt-3 text-xs text-zinc-400">
            <p className="font-semibold text-zinc-200">{assignment.source.match_label}</p>
            <p>{assignment.source.venue_label ?? "Unknown venue"}</p>
            <p>
              Round {assignment.source.prefill.round} · point {assignment.source.source_point_idx}
            </p>
            {assignment.source.prefill.round === "C" && (
              <p className="rounded-lg bg-amber-500/10 p-2 text-amber-200">
                Sealed evaluation point · predictions remain hidden
              </p>
            )}
          </div>
        </aside>

        <section className="space-y-4">
          <article className="rounded-2xl border border-edge bg-surface/90 p-4">
            <div className="mb-3 flex flex-wrap items-end gap-3">
              <div className="mr-auto">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-glow">
                  Sound {label.events.findIndex((event) => event.id === currentEvent.id) + 1} of {label.events.length}
                </p>
                <h2 className="mt-1 text-xl font-bold">
                  Listen at normal speed first
                </h2>
              </div>
              <span className="rounded-full border border-edge px-3 py-1 text-xs text-zinc-300">
                {currentEvent.time_s.toFixed(3)} s
              </span>
            </div>
            <div className="overflow-hidden rounded-xl bg-black">
              {mediaUrl ? (
                <video
                  ref={videoRef}
                  key={assignment.id}
                  src={mediaUrl}
                  controls
                  playsInline
                  preload="auto"
                  className="aspect-video w-full"
                  onPlay={() => {
                    playbackCount.current += 1;
                  }}
                  onTimeUpdate={(event) => {
                    if (!looping || !loopWindow) return;
                    const video = event.currentTarget;
                    if (
                      video.currentTime >= loopWindow.end_s ||
                      video.currentTime < loopWindow.start_s - 0.05
                    ) {
                      video.currentTime = loopWindow.start_s;
                      void video.play().catch(() => undefined);
                    }
                  }}
                  onEnded={() => {
                    if (looping && loopWindow && videoRef.current) {
                      videoRef.current.currentTime = loopWindow.start_s;
                      void videoRef.current.play().catch(() => undefined);
                    }
                  }}
                />
              ) : (
                <div className="flex aspect-video items-center justify-center text-sm text-zinc-500">
                  {mediaError ?? "Loading protected video…"}
                </div>
              )}
            </div>
            <div className="mt-3 rounded-xl border border-edge bg-ink/40 p-3">
              <svg
                viewBox="0 0 1000 52"
                preserveAspectRatio="none"
                className="h-16 w-full"
                role="img"
                aria-label="Point audio waveform with current sound marker"
              >
                <polyline
                  points={waveform}
                  fill="none"
                  stroke="rgb(34 211 238 / .65)"
                  strokeWidth="2"
                />
                <line
                  x1={markerX}
                  x2={markerX}
                  y1="0"
                  y2="52"
                  stroke="rgb(244 114 182)"
                  strokeWidth="3"
                />
              </svg>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!videoRef.current || !loopWindow) return;
                    setLooping(true);
                    videoRef.current.currentTime = loopWindow.start_s;
                    videoRef.current.playbackRate = 1;
                    setPlaybackSpeedState(1);
                    void videoRef.current.play().catch(() => undefined);
                  }}
                  className="rounded-lg border border-cyan-glow/40 px-3 py-2 text-sm text-cyan-100"
                >
                  Replay loop · 1x
                </button>
                <button
                  type="button"
                  onClick={() => setPlaybackSpeed(0.5)}
                  className={`rounded-lg border px-3 py-2 text-sm ${playbackSpeed === 0.5 ? "border-cyan-glow text-cyan-100" : "border-edge text-zinc-300"}`}
                >
                  0.5x
                </button>
                <button
                  type="button"
                  onClick={() => setPlaybackSpeed(0.25)}
                  className={`rounded-lg border px-3 py-2 text-sm ${playbackSpeed === 0.25 ? "border-cyan-glow text-cyan-100" : "border-edge text-zinc-300"}`}
                >
                  0.25x
                </button>
                <button
                  type="button"
                  onClick={playFullContext}
                  className="rounded-lg border border-edge px-3 py-2 text-sm text-zinc-300"
                >
                  Play full point context
                </button>
              </div>
            </div>
          </article>
          {message && (
            <div
              className={`rounded-xl border p-3 text-sm ${saveState === "error" ? "border-rose-500/40 bg-rose-500/10 text-rose-200" : "border-amber-500/30 bg-amber-500/10 text-amber-100"}`}
              role="status"
            >
              {message}
              {saveState === "error" && pendingSave && (
                <button
                  type="button"
                  onClick={() => void retrySave()}
                  className="ml-3 rounded-lg border border-rose-300/40 px-3 py-1 font-semibold"
                >
                  Retry save
                </button>
              )}
            </div>
          )}
        </section>

        <aside className="space-y-4 xl:sticky xl:top-20 xl:h-[calc(100vh-6rem)] xl:overflow-y-auto">
          <article className="rounded-2xl border border-cyan-glow/25 bg-surface/95 p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-glow">
              Choose one · keyboard enabled
            </p>
            <h2 className="mt-1 text-lg font-bold">What is the marked sound?</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Classify the visible match. Sounds from other games are Background court.
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              {AUDIO_IMPACT_KINDS.map((kind) => {
                const option = LABELS[kind];
                const active = currentEvent.kind === kind;
                return (
                  <button
                    key={kind}
                    type="button"
                    disabled={saveState === "saving"}
                    onClick={() => void saveAndAdvance(kind)}
                    className={`rounded-xl border p-3 text-left transition disabled:opacity-50 ${
                      active
                        ? "border-cyan-glow bg-cyan-glow/15 text-cyan-50"
                        : "border-edge bg-ink/35 text-zinc-200 hover:border-zinc-500"
                    }`}
                  >
                    <span className="flex items-center gap-2 font-semibold">
                      <kbd className="rounded border border-current/30 px-1.5 py-0.5 text-xs">
                        {option.key}
                      </kbd>
                      {option.title}
                    </span>
                    <span className="mt-1 block text-xs text-zinc-400">
                      {option.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </article>

          <article className="rounded-2xl border border-edge bg-surface/90 p-4">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={history.length === 0 || saveState === "saving"}
                onClick={() => void undo()}
                className="rounded-lg border border-edge px-3 py-2 text-sm disabled:opacity-30"
              >
                Undo
              </button>
              <button
                type="button"
                disabled={saveState === "saving"}
                onClick={() =>
                  openTarget(
                    previousReviewTarget(
                      assignments,
                      target.assignment_id,
                      target.event_id,
                    ),
                  )
                }
                className="rounded-lg border border-edge px-3 py-2 text-sm disabled:opacity-30"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={saveState === "saving" || !mediaUrl}
                onClick={() => void addMissedSound()}
                className="col-span-2 rounded-lg border border-magenta-glow/30 px-3 py-2 text-sm text-magenta-soft disabled:opacity-30"
              >
                Add missed sound at playhead
              </button>
              <button
                type="button"
                disabled={saveState === "saving"}
                onClick={() => void completePoint()}
                className="col-span-2 rounded-lg bg-cyan-glow px-3 py-3 text-sm font-bold text-ink disabled:opacity-50"
              >
                Point complete
              </button>
            </div>
          </article>
        </aside>
      </div>
    </main>
  );
}
