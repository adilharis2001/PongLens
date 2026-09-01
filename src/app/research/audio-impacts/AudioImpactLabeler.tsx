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
  canReviewAudioImpact,
  filterAudioImpactAssignments,
  firstReviewTarget,
  isVerifiedFullContextPlayback,
  nextOpenPointTarget,
  nextReviewTargetInPoint,
  pointReviewState,
  previousReviewTargetInPoint,
  queueWithActive,
  roundPointPosition,
  shouldReloadAudioImpactMedia,
  type AudioImpactReviewTarget,
  type AudioImpactMediaState,
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
  advance: "sound" | "point" | "none";
  history_action: "append" | "pop" | "none";
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
    key: "H",
    title: "Shoe / footstep",
    description: "An ordinary footstep or non-squeaking shoe movement.",
  },
  shoe_squeak: {
    key: "Q",
    title: "Shoe squeak",
    description: "A distinct friction or squeaking sound from a shoe.",
  },
  stomp: {
    key: "S",
    title: "Stomp",
    description: "A strong, heavy foot strike, often during a serve.",
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
  availableRounds,
  editableRounds,
}: {
  initialAssignments: AudioImpactResearchAssignment[];
  isAdmin: boolean;
  availableRounds: AudioImpactRound[];
  editableRounds: AudioImpactRound[];
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
  const [mediaState, setMediaState] = useState<AudioImpactMediaState>("loading");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pendingSave, setPendingSave] = useState<PendingSave | null>(null);
  const [history, setHistory] = useState<PendingSave[]>([]);
  const [looping, setLooping] = useState(true);
  const [playbackSpeed, setPlaybackSpeedState] = useState(1);
  const [naturalPlaybackSeen, setNaturalPlaybackSeen] = useState(false);
  const [contextReadyAssignmentIds, setContextReadyAssignmentIds] = useState(
    () => new Set<string>(),
  );
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
  const fullContextStartedAtZero = useRef(false);
  const fullContextInvalidated = useRef(false);
  const supabase = useMemo(() => createClient(), []);

  const assignment =
    assignments.find((item) => item.id === target?.assignment_id) ?? null;
  const reviewMetricsRef = useRef(assignment?.review_metrics);
  reviewMetricsRef.current = assignment?.review_metrics;
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
  const pointPosition = roundPointPosition(assignments, assignment?.id ?? "");
  const pointNumber = pointPosition.number;
  const pointTotal = pointPosition.total;
  const nextPointTarget = assignment
    ? nextOpenPointTarget(assignments, assignment.id)
    : null;
  const nextPointAssignment = nextPointTarget
    ? assignments.find((item) => item.id === nextPointTarget.assignment_id) ?? null
    : null;
  const nextPointPosition = nextPointAssignment
    ? roundPointPosition(assignments, nextPointAssignment.id)
    : null;
  const currentEventIndex = label.events.findIndex(
    (event) => event.id === currentEvent?.id,
  );
  const currentPointState = pointReviewState(label);
  const contextReady = assignment
    ? contextReadyAssignmentIds.has(assignment.id)
    : false;
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
  const assignmentRound = assignment?.source.prefill.round ?? null;
  const reviewEnabled =
    canReviewAudioImpact(mediaState, saveState) &&
    contextReady &&
    naturalPlaybackSeen &&
    assignmentRound !== null &&
    editableRounds.includes(assignmentRound);
  const navigationBlocked = saveState === "saving" || saveState === "error";

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
    (next: AudioImpactReviewTarget | null, afterDurableSave = false) => {
      if (!next) return;
      if (!afterDurableSave && (pendingSave || saveState === "error")) {
        setMessage("Retry the failed save before leaving this sound.");
        return;
      }
      const nextAssignment = assignments.find(
        (item) => item.id === next.assignment_id,
      );
      if (!nextAssignment) return;
      const reloadMedia = shouldReloadAudioImpactMedia(
        assignment?.id ?? null,
        nextAssignment.id,
      );
      if (reloadMedia) {
        setLabel(labelForAssignment(nextAssignment));
        resetMetrics(nextAssignment);
        setHistory([]);
        fullContextStartedAtZero.current = false;
        fullContextInvalidated.current = false;
      }
      setTarget(next);
      if (reloadMedia) {
        setMediaUrl(null);
        setMediaError(null);
        setMediaState("loading");
      }
      setLooping(true);
      setPlaybackSpeedState(1);
      setNaturalPlaybackSeen(false);
      setMessage(null);
      setDirty(false);
    },
    [assignment?.id, assignments, pendingSave, resetMetrics, saveState],
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
      if (saved.history_action === "append") {
        setHistory((current) => [...current.slice(-19), saved]);
      } else if (saved.history_action === "pop") {
        setHistory((current) => current.slice(0, -1));
      }
      if (saved.advance === "sound") {
        const next = nextReviewTargetInPoint(
          updatedAssignments,
          saved.target.assignment_id,
          saved.target.event_id,
        );
        if (next) openTarget(next, true);
      } else if (saved.advance === "point") {
        const next = nextOpenPointTarget(updatedAssignments, updated.id);
        if (next) openTarget(next, true);
      }
    },
    [assignments, openTarget],
  );

  const saveAndAdvance = useCallback(
    async (kind: AudioImpactKind) => {
      if (!assignment || !currentEvent || !target || !reviewEnabled) {
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
        advance: "sound",
        history_action: "append",
      };
      answerChanges.current += 1;
      setLabel(nextLabel);
      setDirty(true);
      setPendingSave(pending);
      const updated = await persist(assignment, nextLabel, "in_progress");
      if (updated) finishSave(pending, updated);
    },
    [assignment, currentEvent, finishSave, label, persist, reviewEnabled, target],
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
    if (!prior || !assignment || prior.assignment_id !== assignment.id || navigationBlocked) {
      return;
    }
    const item = assignments.find(
      (candidate) => candidate.id === prior.assignment_id,
    );
    if (!item) return;
    const pending: PendingSave = {
      assignment_id: item.id,
      target: prior.target,
      label: prior.previous_label,
      previous_label: label,
      status: "in_progress",
      advance: "none",
      history_action: "pop",
    };
    resetMetrics(item);
    setTarget(prior.target);
    setLabel(prior.previous_label);
    setDirty(true);
    setPendingSave(pending);
    const updated = await persist(item, prior.previous_label, "in_progress");
    if (updated) finishSave(pending, updated);
  }, [assignment, assignments, finishSave, history, label, navigationBlocked, persist, resetMetrics]);

  const addMissedSound = useCallback(async () => {
    if (!assignment || !videoRef.current || !reviewEnabled) return;
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
    const pending: PendingSave = {
      assignment_id: assignment.id,
      target: { assignment_id: assignment.id, event_id: added.id },
      label: nextLabel,
      previous_label: label,
      status: "in_progress",
      advance: "none",
      history_action: "none",
    };
    setPendingSave(pending);
    const updated = await persist(assignment, nextLabel, "in_progress");
    if (updated) finishSave(pending, updated);
  }, [assignment, finishSave, label, persist, reviewEnabled]);

  const completePoint = useCallback(async () => {
    if (!assignment || !target || !reviewEnabled) return;
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
    const pending: PendingSave = {
      assignment_id: assignment.id,
      target,
      label: nextLabel,
      previous_label: label,
      status: "submitted",
      advance: "point",
      history_action: "none",
    };
    setPendingSave(pending);
    const updated = await persist(assignment, nextLabel, "submitted");
    if (updated) finishSave(pending, updated);
  }, [assignment, finishSave, label, persist, reviewEnabled, target]);

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
    void video.play().catch(() => undefined);
  }, []);

  const startPointReview = useCallback(() => {
    const video = videoRef.current;
    if (!video || !assignment) return;
    setLooping(false);
    setNaturalPlaybackSeen(false);
    fullContextStartedAtZero.current = true;
    fullContextInvalidated.current = false;
    fullContextPlayed.current = false;
    video.currentTime = 0;
    video.playbackRate = 1;
    setPlaybackSpeedState(1);
    void video.play().catch(() => undefined);
  }, [assignment]);

  const markMediaUnavailable = useCallback(
    async (id: string, errorMessage: string) => {
      const metrics = {
        ...(reviewMetricsRef.current ?? {}),
        media_unavailable: true,
        media_error: errorMessage,
      };
      const { error } = await supabase
        .from("research_assignments")
        .update({ review_metrics: metrics })
        .eq("id", id);
      if (error) {
        console.error("audio impact media-health save failed", error);
        setMessage("Could not record the media failure. Reload this point to retry.");
        return;
      }
      setAssignments((current) =>
        current.map((item) =>
          item.id === id ? { ...item, review_metrics: metrics } : item,
        ),
      );
    },
    [supabase],
  );

  useEffect(() => {
    if (!assignmentId) return;
    let cancelled = false;
    setMediaUrl(null);
    setMediaError(null);
    setMediaState("loading");
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
        if (!cancelled) {
          setMediaError(error.message);
          setMediaState("error");
          void markMediaUnavailable(assignmentId, error.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [assignmentId, markMediaUnavailable]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !mediaUrl || !loopWindow) return;
    if (!contextReady) {
      setLooping(false);
      setPlaybackSpeedState(1);
      video.playbackRate = 1;
      video.currentTime = 0;
      return;
    }
    setLooping(true);
    setPlaybackSpeedState(1);
    video.playbackRate = 1;
    video.currentTime = loopWindow.start_s;
    void video.play().catch(() => undefined);
  }, [contextReady, currentEvent?.id, loopWindow, mediaUrl]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isAudioImpactShortcutTarget(event.target) || !reviewEnabled) return;
      const kind = audioImpactKindForShortcut(event.key);
      if (!kind) return;
      event.preventDefault();
      void saveAndAdvance(kind);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [reviewEnabled, saveAndAdvance]);

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
    const response = await fetch("/api/research/audio-impact-export", {
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
            <h1 className="text-xl font-bold">Label sounds inside each point</h1>
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
              Points
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              Finish every marked sound in one point before moving to the next.
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
              {availableRounds.includes("A") && <option value="A">Round A</option>}
              {availableRounds.includes("B") && <option value="B">Round B</option>}
              {availableRounds.includes("C") && <option value="C">Round C</option>}
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
              disabled={queueIndex <= 0 || navigationBlocked}
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
              disabled={navigationBlocked}
              onChange={(event) => {
                const next = queue.find((item) => item.id === event.target.value);
                if (next) openTarget(firstReviewTarget([next]));
              }}
              className="min-w-0 rounded-lg border border-edge bg-surface-2 px-2 py-2 text-sm"
            >
              {queue.map((item) => (
                <option key={item.id} value={item.id}>
                  Point {roundPointPosition(assignments, item.id).number} · {item.source.match_label} · source {item.source.source_point_idx}
                  {item.status === "submitted" ? " · complete" : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={queueIndex >= queue.length - 1 || navigationBlocked}
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
            <p className="text-sm font-bold text-cyan-100">
              Point {pointNumber} of {pointTotal}
            </p>
            <p className="font-semibold text-zinc-200">{assignment.source.match_label}</p>
            <p>{assignment.source.venue_label ?? "Unknown venue"}</p>
            <p>
              Round {assignment.source.prefill.round} · original match point {assignment.source.source_point_idx}
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
                  Point {pointNumber} of {pointTotal}
                </p>
                <h2 className="mt-1 text-xl font-bold">
                  {assignment.source.match_label}
                </h2>
                <p className="mt-1 text-sm text-zinc-400">
                  {assignment.source.venue_label ?? "Unknown venue"} · original match point {assignment.source.source_point_idx}
                </p>
              </div>
              {contextReady && (
                <span className="rounded-full border border-edge px-3 py-1 text-xs text-zinc-300">
                  Sound {currentEventIndex + 1} of {label.events.length} · {currentEvent.time_s.toFixed(3)} s
                </span>
              )}
            </div>
            {!contextReady && (
              <div className="mb-3 rounded-xl border border-cyan-glow/30 bg-cyan-glow/10 p-4">
                <p className="text-lg font-bold text-cyan-50">
                  First, watch this whole point
                </p>
                <p className="mt-1 text-sm text-cyan-100/75">
                  This point contains {label.events.length} marked sounds. After the video ends, you’ll label those sounds one at a time without leaving this point.
                </p>
              </div>
            )}
            {contextReady && (
              <div className="mb-3">
                <p className="text-sm font-semibold text-zinc-100">
                  Sound {currentEventIndex + 1} of {label.events.length} in this point
                </p>
                <div className="mt-2 flex flex-wrap gap-2" aria-label="Sounds in this point">
                  {label.events.map((event, index) => {
                    const active = event.id === currentEvent.id;
                    const answered = event.kind !== null;
                    return (
                      <button
                        key={event.id}
                        type="button"
                        disabled={navigationBlocked}
                        onClick={() =>
                          openTarget({
                            assignment_id: assignment.id,
                            event_id: event.id,
                          })
                        }
                        aria-label={`Sound ${index + 1}: ${answered ? LABELS[event.kind!].title : "unanswered"}`}
                        className={`min-w-9 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition disabled:opacity-40 ${
                          active
                            ? "border-cyan-glow bg-cyan-glow text-ink"
                            : answered
                              ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200"
                              : "border-edge bg-ink/40 text-zinc-400"
                        }`}
                      >
                        {index + 1}{answered ? " ✓" : ""}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
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
                  onCanPlay={(event) => {
                    const video = event.currentTarget;
                    if (!Number.isFinite(video.duration) || video.duration <= 0) {
                      const error =
                        "Protected video has an invalid duration. Admin repair is required.";
                      setMediaState("error");
                      setMediaError(error);
                      void markMediaUnavailable(assignment.id, error);
                      return;
                    }
                    setMediaState("ready");
                    setMediaError(null);
                  }}
                  onError={() => {
                    const error =
                      "Protected video could not be decoded. Admin repair is required.";
                    setMediaState("error");
                    setMediaError(error);
                    void markMediaUnavailable(assignment.id, error);
                  }}
                  onPlay={() => {
                    playbackCount.current += 1;
                    if (videoRef.current?.playbackRate === 1) {
                      setNaturalPlaybackSeen(true);
                    }
                  }}
                  onSeeking={(event) => {
                    if (!contextReady && event.currentTarget.currentTime > 0.05) {
                      fullContextInvalidated.current = true;
                    }
                  }}
                  onRateChange={(event) => {
                    if (!contextReady && event.currentTarget.playbackRate !== 1) {
                      fullContextInvalidated.current = true;
                    }
                  }}
                  onTimeUpdate={(event) => {
                    const video = event.currentTarget;
                    if (
                      loopWindow &&
                      video.playbackRate === 1 &&
                      video.currentTime >= loopWindow.start_s &&
                      video.currentTime <= loopWindow.end_s
                    ) {
                      setNaturalPlaybackSeen(true);
                    }
                    if (!looping || !loopWindow) return;
                    if (
                      video.currentTime >= loopWindow.end_s ||
                      video.currentTime < loopWindow.start_s - 0.05
                    ) {
                      video.currentTime = loopWindow.start_s;
                      void video.play().catch(() => undefined);
                    }
                  }}
                  onEnded={() => {
                    if (!contextReady) {
                      const video = videoRef.current;
                      const verified =
                        video !== null &&
                        isVerifiedFullContextPlayback({
                          started_at_zero: fullContextStartedAtZero.current,
                          invalidated: fullContextInvalidated.current,
                          playback_rate: video.playbackRate,
                          current_time_s: video.currentTime,
                          duration_s: video.duration,
                        });
                      if (!verified) {
                        fullContextPlayed.current = false;
                        setMessage(
                          "Please watch the full point from the beginning at normal speed without skipping.",
                        );
                        return;
                      }
                      fullContextPlayed.current = true;
                      setContextReadyAssignmentIds((current) => {
                        const next = new Set(current);
                        next.add(assignment.id);
                        return next;
                      });
                      setNaturalPlaybackSeen(false);
                      return;
                    }
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
            {!contextReady ? (
              <button
                type="button"
                disabled={mediaState !== "ready"}
                onClick={startPointReview}
                className="mt-3 w-full rounded-xl bg-cyan-glow px-4 py-3 text-sm font-bold text-ink disabled:opacity-40"
              >
                Watch full point, then start labeling
              </button>
            ) : (
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
                  disabled={!naturalPlaybackSeen}
                  onClick={() => setPlaybackSpeed(0.5)}
                  className={`rounded-lg border px-3 py-2 text-sm disabled:opacity-35 ${playbackSpeed === 0.5 ? "border-cyan-glow text-cyan-100" : "border-edge text-zinc-300"}`}
                >
                  0.5x
                </button>
                <button
                  type="button"
                  disabled={!naturalPlaybackSeen}
                  onClick={() => setPlaybackSpeed(0.25)}
                  className={`rounded-lg border px-3 py-2 text-sm disabled:opacity-35 ${playbackSpeed === 0.25 ? "border-cyan-glow text-cyan-100" : "border-edge text-zinc-300"}`}
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
            )}
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
          {!contextReady ? (
            <article className="rounded-2xl border border-cyan-glow/25 bg-surface/95 p-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-glow">
                Point {pointNumber} setup
              </p>
              <h2 className="mt-1 text-lg font-bold">What you’ll do</h2>
              <ol className="mt-4 space-y-3 text-sm text-zinc-300">
                <li className="rounded-xl border border-edge bg-ink/35 p-3">
                  <strong className="text-zinc-100">1. Watch this point once.</strong>
                  <span className="mt-1 block text-xs text-zinc-400">This makes it clear which game point you are reviewing.</span>
                </li>
                <li className="rounded-xl border border-edge bg-ink/35 p-3">
                  <strong className="text-zinc-100">2. Label each marked sound.</strong>
                  <span className="mt-1 block text-xs text-zinc-400">You will stay inside this point for all {label.events.length} sounds.</span>
                </li>
                <li className="rounded-xl border border-edge bg-ink/35 p-3">
                  <strong className="text-zinc-100">3. Finish the point.</strong>
                  <span className="mt-1 block text-xs text-zinc-400">The next point opens only after you explicitly finish this one.</span>
                </li>
              </ol>
            </article>
          ) : (
          <>
          <article className="rounded-2xl border border-cyan-glow/25 bg-surface/95 p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-glow">
              Point {pointNumber} · sound {currentEventIndex + 1} of {label.events.length}
            </p>
            <h2 className="mt-1 text-lg font-bold">Label sound {currentEventIndex + 1}</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Listen to the short loop and identify the sound at the pink marker. Sounds from other games are Background court.
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              {AUDIO_IMPACT_KINDS.map((kind) => {
                const option = LABELS[kind];
                const active = currentEvent.kind === kind;
                return (
                  <button
                    key={kind}
                    type="button"
                    disabled={!reviewEnabled}
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
            <div className="mb-4 rounded-xl border border-edge bg-ink/35 p-3">
              <p className="text-sm font-bold text-zinc-100">
                {currentPointState.complete
                  ? `All ${currentPointState.total} sounds are labeled`
                  : `${currentPointState.answered} of ${currentPointState.total} sounds labeled`}
              </p>
              {currentPointState.complete ? (
                <ol className="mt-2 grid grid-cols-2 gap-1 text-xs text-zinc-400">
                  {label.events.map((event, index) => (
                    <li key={event.id}>
                      {index + 1}. {event.kind ? LABELS[event.kind].title : "Unanswered"}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-1 text-xs text-zinc-400">
                  Finish the remaining sounds in this point before moving on.
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={history.length === 0 || navigationBlocked}
                onClick={() => void undo()}
                className="rounded-lg border border-edge px-3 py-2 text-sm disabled:opacity-30"
              >
                Undo
              </button>
              <button
                type="button"
                disabled={navigationBlocked}
                onClick={() =>
                  openTarget(
                    previousReviewTargetInPoint(
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
                disabled={!reviewEnabled}
                onClick={() => void addMissedSound()}
                className="col-span-2 rounded-lg border border-magenta-glow/30 px-3 py-2 text-sm text-magenta-soft disabled:opacity-30"
              >
                Add missed sound at playhead
              </button>
              <button
                type="button"
                disabled={!reviewEnabled || !currentPointState.complete}
                onClick={() => void completePoint()}
                className="col-span-2 rounded-lg bg-cyan-glow px-3 py-3 text-sm font-bold text-ink disabled:opacity-50"
              >
                {nextPointAssignment && nextPointPosition
                  ? nextPointAssignment.source.prefill.round === assignment.source.prefill.round
                    ? `Finish Point ${pointNumber} and open Point ${nextPointPosition.number}`
                    : `Finish Point ${pointNumber} and open Round ${nextPointAssignment.source.prefill.round} Point ${nextPointPosition.number}`
                  : `Finish Point ${pointNumber}`}
              </button>
            </div>
          </article>
          </>
          )}
        </aside>
      </div>
    </main>
  );
}
