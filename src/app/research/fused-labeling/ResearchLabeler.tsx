"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  EVENT_SHORTCUTS,
  createHumanEventLabel,
  hydrateHumanLabel,
  requiredPointFields,
  unresolvedEventFields,
  type HumanEventLabel,
  type ResearchEventType,
  type ResearchHumanLabel,
  type ResearchPointLabel,
} from "@/lib/research/labeling";
import type {
  ResearchAssignment,
  ResearchVisualCandidate,
} from "@/lib/research/types";
import { FusedTimeline } from "./FusedTimeline";
import { TablePlacementEditor } from "./TablePlacementEditor";

type SaveState = "idle" | "saving" | "saved" | "error";

const EVENT_CHOICES: { key: ResearchEventType; label: string; shortcut: string }[] = [
  { key: "paddle", label: "Paddle", shortcut: "P" },
  { key: "table", label: "Table", shortcut: "T" },
  { key: "net", label: "Net", shortcut: "N" },
  { key: "floor", label: "Floor", shortcut: "F" },
  { key: "body_catch", label: "Body/catch", shortcut: "B" },
  { key: "voice", label: "Voice", shortcut: "V" },
  { key: "other", label: "Other", shortcut: "O" },
  { key: "unsure", label: "Unsure", shortcut: "U" },
];

function OptionGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { key: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
        {label}
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            aria-pressed={value === option.key}
            onClick={() => onChange(option.key)}
            className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              value === option.key
                ? "border-cyan-glow bg-cyan-glow/15 text-cyan-glow"
                : "border-edge bg-surface-2 text-zinc-300 hover:border-zinc-500"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function formatTime(value: number | string | null) {
  if (value === null) return "Not marked";
  if (typeof value === "string") return value.replace("_", " ");
  return `${value.toFixed(3)}s`;
}

function emptyTableBounce(): NonNullable<HumanEventLabel["table_bounce"]> {
  return {
    table_side: null,
    landing_status: null,
    table_u: null,
    table_v: null,
    screen_x: null,
    screen_y: null,
    homography_version: null,
    location_visibility: null,
    location_confidence: null,
    track_candidate_id: null,
  };
}

function existingSide(
  assignment: ResearchAssignment,
  value: "user" | "opponent" | "let" | null | undefined,
) {
  if (!value) return "Not entered";
  if (value === "let") return "Let / replay";
  const nearIsUser =
    (assignment.source.player_near_name ?? "").toLowerCase() === "adil";
  const side =
    value === "user"
      ? nearIsUser
        ? "Near"
        : "Far"
      : nearIsUser
        ? "Far"
        : "Near";
  return side;
}

export function ResearchLabeler({
  initialAssignments,
  isAdmin,
  adminProgress,
}: {
  initialAssignments: ResearchAssignment[];
  isAdmin: boolean;
  adminProgress: { submitted: number; total: number } | null;
}) {
  const [assignments, setAssignments] = useState(initialAssignments);
  const firstOpen = Math.max(
    0,
    initialAssignments.findIndex((assignment) => assignment.status !== "submitted"),
  );
  const [assignmentIndex, setAssignmentIndex] = useState(firstOpen);
  const assignment = assignments[assignmentIndex] ?? null;
  const [label, setLabel] = useState<ResearchHumanLabel>(() =>
    assignment
      ? hydrateHumanLabel(assignment.source.proposal, assignment.human_label)
      : hydrateHumanLabel({}, null),
  );
  const [selectedEventId, setSelectedEventId] = useState<string | null>(
    label.events[0]?.event_id ?? null,
  );
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(0.25);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [reviewerEmail, setReviewerEmail] = useState("");
  const [reviewerStatus, setReviewerStatus] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const historyRef = useRef<ResearchHumanLabel[]>([]);
  const openedAtRef = useRef(Date.now());
  const playbackCountRef = useRef(assignment?.review_metrics?.playback_count ?? 0);
  const answerChangesRef = useRef(assignment?.review_metrics?.answer_changes ?? 0);
  const supabase = useMemo(() => createClient(), []);

  const selectedEvent =
    label.events.find((event) => event.event_id === selectedEventId) ?? null;
  const pointMissing = requiredPointFields(
    label.point as unknown as Record<string, unknown>,
  );
  const incompleteEvents = label.events.filter(
    (event) => unresolvedEventFields(event).length > 0,
  );
  const submittedCount = assignments.filter(
    (item) => item.status === "submitted",
  ).length;

  const pushLabel = useCallback(
    (updater: (current: ResearchHumanLabel) => ResearchHumanLabel) => {
      historyRef.current.push(structuredClone(label));
      if (historyRef.current.length > 40) historyRef.current.shift();
      answerChangesRef.current += 1;
      setLabel((current) => updater(structuredClone(current)));
      setDirty(true);
      setSubmitError(null);
    },
    [label],
  );

  const saveNow = useCallback(
    async (
      nextLabel: ResearchHumanLabel,
      status: ResearchAssignment["status"] = "in_progress",
    ) => {
      if (!assignment) return false;
      setSaveState("saving");
      const now = new Date().toISOString();
      const reviewMetrics = {
        time_spent_s:
          (assignment.review_metrics?.time_spent_s ?? 0) +
          Math.round((Date.now() - openedAtRef.current) / 1000),
        playback_count: playbackCountRef.current,
        answer_changes: answerChangesRef.current,
        video_completed: assignment.review_metrics?.video_completed ?? false,
      };
      const { error } = await supabase
        .from("research_assignments")
        .update({
          status,
          human_label: nextLabel,
          review_metrics: reviewMetrics,
          started_at: assignment.started_at ?? now,
          submitted_at: status === "submitted" ? now : null,
        })
        .eq("id", assignment.id);
      if (error) {
        console.error("research autosave failed", error);
        setSaveState("error");
        return false;
      }
      openedAtRef.current = Date.now();
      setDirty(false);
      setSaveState("saved");
      setLastSaved(
        status === "submitted"
          ? `Point ${assignment.sequence} submitted`
          : `Saved at ${new Date().toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
              second: "2-digit",
            })}`,
      );
      setAssignments((current) =>
        current.map((item) =>
          item.id === assignment.id
            ? {
                ...item,
                status,
                human_label: nextLabel,
                review_metrics: reviewMetrics,
                started_at: item.started_at ?? now,
                submitted_at: status === "submitted" ? now : null,
              }
            : item,
        ),
      );
      return true;
    },
    [assignment, supabase],
  );

  useEffect(() => {
    if (!dirty || !assignment) return;
    const timer = window.setTimeout(() => void saveNow(label), 650);
    return () => window.clearTimeout(timer);
  }, [assignment, dirty, label, saveNow]);

  useEffect(() => {
    if (!assignment) return;
    let cancelled = false;
    setMediaUrl(null);
    setMediaError(null);
    fetch("/api/research/media", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignmentId: assignment.id }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json()).error);
        return response.json() as Promise<{ url: string }>;
      })
      .then((payload) => {
        if (!cancelled) setMediaUrl(payload.url);
      })
      .catch((error) => {
        if (!cancelled) setMediaError(error.message || "Could not load video");
      });
    return () => {
      cancelled = true;
    };
  }, [assignment]);

  const goToAssignment = useCallback(
    async (nextIndex: number, alreadySaved = false) => {
      if (!assignments[nextIndex] || !assignment) return;
      if (dirty && !alreadySaved) {
        await saveNow(
          label,
          assignment.status === "submitted" ? "submitted" : "in_progress",
        );
      }
      const next = assignments[nextIndex];
      const nextLabel = hydrateHumanLabel(
        next.source.proposal,
        next.human_label,
      );
      setAssignmentIndex(nextIndex);
      setLabel(nextLabel);
      setSelectedEventId(
        nextLabel.events.find((event) => unresolvedEventFields(event).length)?.event_id ??
          nextLabel.events[0]?.event_id ??
          null,
      );
      setCurrentTime(0);
      setDirty(false);
      setSubmitError(null);
      setSaveState("idle");
      setLastSaved(null);
      historyRef.current = [];
      playbackCountRef.current = next.review_metrics?.playback_count ?? 0;
      answerChangesRef.current = next.review_metrics?.answer_changes ?? 0;
      openedAtRef.current = Date.now();
    },
    [assignment, assignments, dirty, label, saveNow],
  );

  const seek = useCallback((time: number, play = false) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(video.duration || Infinity, time));
    setCurrentTime(video.currentTime);
    if (play) void video.play();
  }, []);

  const selectEvent = useCallback(
    (eventId: string) => {
      const event = label.events.find((candidate) => candidate.event_id === eventId);
      if (!event) return;
      setSelectedEventId(eventId);
      seek(Math.max(0, event.time_s - 0.18));
    },
    [label.events, seek],
  );

  const moveMarker = useCallback(
    (direction: -1 | 1) => {
      if (!label.events.length) return;
      const index = Math.max(
        0,
        label.events.findIndex((event) => event.event_id === selectedEventId),
      );
      const next = Math.min(
        label.events.length - 1,
        Math.max(0, index + direction),
      );
      selectEvent(label.events[next].event_id);
    },
    [label.events, selectEvent, selectedEventId],
  );

  const setEventType = useCallback(
    (eventType: ResearchEventType, insert = false) => {
      let targetId = selectedEventId;
      if (insert || !targetId) {
        targetId = `manual-${crypto.randomUUID()}`;
        const manual = createHumanEventLabel({
          eventId: targetId,
          timeS: Number(currentTime.toFixed(4)),
          origin: "manual",
        });
        manual.event_type = eventType;
        pushLabel((current) => ({
          ...current,
          events: [...current.events, manual].sort((left, right) => left.time_s - right.time_s),
        }));
        setSelectedEventId(targetId);
        return;
      }
      pushLabel((current) => ({
        ...current,
        events: current.events.map((event) =>
          event.event_id === targetId
            ? {
                ...event,
                event_type: eventType,
                table_bounce:
                  eventType === "table"
                    ? event.table_bounce ?? emptyTableBounce()
                    : null,
              }
            : event,
        ),
      }));
    },
    [currentTime, pushLabel, selectedEventId],
  );

  const updateSelectedEvent = useCallback(
    (patch: Partial<HumanEventLabel>) => {
      if (!selectedEventId) return;
      pushLabel((current) => ({
        ...current,
        events: current.events.map((event) =>
          event.event_id === selectedEventId ? { ...event, ...patch } : event,
        ),
      }));
    },
    [pushLabel, selectedEventId],
  );

  const updatePoint = useCallback(
    <K extends keyof ResearchPointLabel>(
      field: K,
      value: ResearchPointLabel[K],
    ) => {
      pushLabel((current) => ({
        ...current,
        point: { ...current.point, [field]: value },
      }));
    },
    [pushLabel],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT"
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      if (event.key === " ") {
        event.preventDefault();
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) void video.play();
        else video.pause();
      } else if (event.key === ",") {
        event.preventDefault();
        seek(currentTime - 1 / 30);
      } else if (event.key === ".") {
        event.preventDefault();
        seek(currentTime + 1 / 30);
      } else if (key === "j") {
        event.preventDefault();
        seek(currentTime - 0.5);
      } else if (key === "l") {
        event.preventDefault();
        seek(currentTime + 0.5);
      } else if (key === "r") {
        event.preventDefault();
        seek(currentTime - 2, true);
      } else if (event.key === "[") {
        event.preventDefault();
        moveMarker(-1);
      } else if (event.key === "]") {
        event.preventDefault();
        moveMarker(1);
      } else if (key === "c") {
        event.preventDefault();
        updatePoint("decisive_c_s", Number(currentTime.toFixed(4)));
      } else if (key === "e") {
        event.preventDefault();
        updatePoint("review_end_s", Number(currentTime.toFixed(4)));
      } else if (key === "s") {
        event.preventDefault();
        updatePoint("serve_contact_s", Number(currentTime.toFixed(4)));
      } else if (event.key === "Backspace") {
        event.preventDefault();
        const previous = historyRef.current.pop();
        if (previous) {
          setLabel(previous);
          setDirty(true);
        }
      } else if (key in EVENT_SHORTCUTS) {
        event.preventDefault();
        setEventType(
          EVENT_SHORTCUTS[key as keyof typeof EVENT_SHORTCUTS],
          event.shiftKey,
        );
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [currentTime, moveMarker, seek, setEventType, updatePoint]);

  const activeVisualDots = useMemo(() => {
    if (!assignment) return [];
    return assignment.source.proposal.visual_candidates.filter(
      (candidate) =>
        candidate.x_norm !== null &&
        candidate.x_norm !== undefined &&
        candidate.y_norm !== null &&
        candidate.y_norm !== undefined &&
        Math.abs(candidate.time_s - currentTime) <= 0.32,
    );
  }, [assignment, currentTime]);

  const submit = async () => {
    if (pointMissing.length || incompleteEvents.length) {
      setSubmitError(
        `Still needed: ${pointMissing.length} point answer${
          pointMissing.length === 1 ? "" : "s"
        } and ${incompleteEvents.length} event review${
          incompleteEvents.length === 1 ? "" : "s"
        }. “Unsure” is a valid answer.`,
      );
      return;
    }
    const saved = await saveNow(label, "submitted");
    if (saved && assignmentIndex < assignments.length - 1) {
      await goToAssignment(assignmentIndex + 1, true);
    }
  };

  const exportBatch = async () => {
    if (!assignment) return;
    const response = await fetch("/api/research/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ batchId: assignment.batch_id }),
    });
    if (!response.ok) {
      setSubmitError("The admin export failed.");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "ponglens-fused-labeling-pilot.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const assignReviewer = async () => {
    if (!assignment || !reviewerEmail.trim()) return;
    setReviewerStatus("Assigning…");
    const response = await fetch("/api/research/reviewers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: reviewerEmail.trim(),
        batchId: assignment.batch_id,
      }),
    });
    const payload = (await response.json()) as {
      assigned?: number;
      error?: string;
    };
    if (!response.ok) {
      setReviewerStatus(payload.error ?? "Could not assign reviewer");
      return;
    }
    setReviewerStatus(
      payload.assigned
        ? `${payload.assigned} pilot points assigned`
        : "Reviewer already has this pilot",
    );
    setReviewerEmail("");
  };

  if (!assignment) {
    return (
      <main className="min-h-screen bg-arena p-8 text-center">
        <h1 className="text-2xl font-bold">No research assignments yet</h1>
        <p className="mt-2 text-zinc-400">Your account is approved, but no pilot batch is assigned.</p>
        <Link href="/dashboard" className="mt-6 inline-block text-cyan-glow">Back to Pong Lens</Link>
      </main>
    );
  }

  const nearName = assignment.source.player_near_name ?? "Near player";
  const farName = assignment.source.player_far_name ?? "Far player";
  const point = label.point;

  return (
    <main className="min-h-screen bg-arena pb-20">
      <header className="sticky top-0 z-40 border-b border-edge bg-ink/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1550px] flex-wrap items-center gap-3 px-4 py-3">
          <div className="mr-auto">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-glow">
              Pong Lens Research
            </p>
            <h1 className="text-xl font-bold">Fused point labeling</h1>
          </div>
          <span className="rounded-full border border-edge px-3 py-1 text-xs text-zinc-300">
            {submittedCount}/{assignments.length} complete
          </span>
          {isAdmin && adminProgress && (
            <span className="rounded-full border border-edge px-3 py-1 text-xs text-zinc-400">
              All reviewers: {adminProgress.submitted}/{adminProgress.total}
            </span>
          )}
          <span
            className={`rounded-full px-3 py-1 text-xs ${
              saveState === "error"
                ? "bg-rose-500/15 text-rose-300"
                : "bg-green-500/10 text-green-300"
            }`}
          >
            {saveState === "saving"
              ? "Saving…"
              : saveState === "error"
                ? "Save failed"
                : lastSaved ?? "Autosaves after every answer"}
          </span>
          {isAdmin && (
            <button
              type="button"
              onClick={exportBatch}
              className="rounded-lg bg-cyan-glow px-3 py-2 text-xs font-bold text-ink"
            >
              Export pilot JSON
            </button>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-[1550px] p-4">
        {isAdmin && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-magenta-glow/20 bg-magenta-glow/5 p-3">
            <div className="mr-auto">
              <p className="text-xs font-semibold text-magenta-soft">Assign a paid reviewer</p>
              <p className="text-[11px] text-zinc-500">
                They must sign in to Pong Lens once first. This gives them the same 30-point pilot and nothing else.
              </p>
            </div>
            <input
              type="email"
              value={reviewerEmail}
              onChange={(event) => setReviewerEmail(event.target.value)}
              placeholder="reviewer@example.com"
              className="min-w-[240px] rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={() => void assignReviewer()}
              className="rounded-lg border border-magenta-glow/40 px-3 py-2 text-xs font-semibold text-magenta-soft"
            >
              Assign pilot
            </button>
            {reviewerStatus && <span className="text-xs text-zinc-300">{reviewerStatus}</span>}
          </div>
        )}
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-edge bg-surface/80 p-2">
          <button
            type="button"
            disabled={assignmentIndex === 0}
            onClick={() => void goToAssignment(assignmentIndex - 1)}
            className="rounded-lg border border-edge px-3 py-2 disabled:opacity-30"
          >
            ←
          </button>
          <select
            value={assignmentIndex}
            onChange={(event) => void goToAssignment(Number(event.target.value))}
            className="min-w-0 flex-1 rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm"
            aria-label="Assignment"
          >
            {assignments.map((item, index) => (
              <option key={item.id} value={index}>
                Point {item.sequence} of {assignments.length}
                {item.status === "submitted" ? " · complete" : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={assignmentIndex === assignments.length - 1}
            onClick={() => void goToAssignment(assignmentIndex + 1)}
            className="rounded-lg border border-edge px-3 py-2 disabled:opacity-30"
          >
            →
          </button>
        </div>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(520px,.95fr)]">
          <div className="space-y-4">
            <div className="rounded-2xl border border-edge bg-surface/90 p-4">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-glow">
                    Visible rally
                  </p>
                  <h2 className="text-xl font-bold">
                    {assignment.source.match_label} · review {assignment.sequence}
                  </h2>
                  <p className="text-xs text-zinc-400">
                    Near: {nearName} · Far: {farName}
                    {assignment.source.venue_label ? ` · ${assignment.source.venue_label}` : ""}
                  </p>
                </div>
                <span className="rounded-full border border-edge px-3 py-1 text-xs text-zinc-400">
                  BlurBall overlay on
                </span>
              </div>
              <div className="relative overflow-hidden rounded-xl bg-black">
                {mediaUrl ? (
                  <video
                    ref={videoRef}
                    src={mediaUrl}
                    className="aspect-video w-full"
                    playsInline
                    preload="auto"
                    onLoadedMetadata={(event) => {
                      event.currentTarget.playbackRate = playbackSpeed;
                    }}
                    onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                    onPlay={() => {
                      playbackCountRef.current += 1;
                    }}
                  />
                ) : (
                  <div className="flex aspect-video items-center justify-center text-sm text-zinc-500">
                    {mediaError ?? "Loading protected video…"}
                  </div>
                )}
                <div className="pointer-events-none absolute inset-0">
                  {activeVisualDots.map((candidate, index) => (
                    <VisualDot key={candidate.id} candidate={candidate} age={index} />
                  ))}
                  <div className="absolute bottom-2 left-2 flex gap-2 rounded-lg bg-black/70 px-2 py-1 text-[10px]">
                    <span className="text-amber-400">● Near side</span>
                    <span className="text-cyan-300">● Far side</span>
                    <span className="text-zinc-300">● Uncertain</span>
                  </div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => videoRef.current?.paused ? void videoRef.current.play() : videoRef.current?.pause()} className="rounded-lg border border-edge px-3 py-2 text-xs">
                  <kbd>Space</kbd> Play
                </button>
                <button type="button" onClick={() => seek(currentTime - 1 / 30)} className="rounded-lg border border-edge px-3 py-2 text-xs"><kbd>,</kbd> −1 frame</button>
                <button type="button" onClick={() => seek(currentTime + 1 / 30)} className="rounded-lg border border-edge px-3 py-2 text-xs"><kbd>.</kbd> +1 frame</button>
                <button type="button" onClick={() => seek(currentTime - 0.5)} className="rounded-lg border border-edge px-3 py-2 text-xs"><kbd>J</kbd> −0.5s</button>
                <button type="button" onClick={() => seek(currentTime + 0.5)} className="rounded-lg border border-edge px-3 py-2 text-xs"><kbd>L</kbd> +0.5s</button>
                <button type="button" onClick={() => seek(currentTime - 2, true)} className="rounded-lg border border-edge px-3 py-2 text-xs"><kbd>R</kbd> Replay 2s</button>
                <label className="ml-auto flex items-center gap-2 text-xs text-zinc-400">
                  Speed
                  <select
                    value={playbackSpeed}
                    onChange={(event) => {
                      const speed = Number(event.target.value);
                      setPlaybackSpeed(speed);
                      if (videoRef.current) videoRef.current.playbackRate = speed;
                    }}
                    className="rounded-lg border border-edge bg-surface-2 px-3 py-2 text-white"
                  >
                    {[0.1, 0.15, 0.25, 0.5, 1].map((speed) => (
                      <option key={speed} value={speed}>{speed.toFixed(2).replace(/0$/, "")}×</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <div className="rounded-2xl border border-edge bg-surface/90 p-4">
              <div className="mb-3 rounded-xl border border-cyan-glow/25 bg-cyan-glow/5 p-3">
                <p className="text-sm font-semibold">
                  Your task: review each bottom dot. Play that moment and say what actually happened.
                </p>
                <p className="mt-1 text-xs text-zinc-400">
                  The top and middle rows are only timing proposals. They are not labels. A green ring and letter mean your answer was recorded.
                </p>
              </div>
              <FusedTimeline
                proposal={assignment.source.proposal}
                humanLabel={label}
                selectedEventId={selectedEventId}
                currentTime={currentTime}
                onSelect={selectEvent}
              />
              <div className="mt-2 flex items-center justify-between text-xs">
                <button type="button" onClick={() => moveMarker(-1)} className="rounded-lg border border-edge px-3 py-2"><kbd>[</kbd> Previous marker</button>
                <span className="text-zinc-400">
                  {selectedEvent
                    ? `${label.events.findIndex((event) => event.event_id === selectedEvent.event_id) + 1}/${label.events.length} · ${selectedEvent.time_s.toFixed(3)}s`
                    : "No marker selected"}
                </span>
                <button type="button" onClick={() => moveMarker(1)} className="rounded-lg border border-edge px-3 py-2">Next marker <kbd>]</kbd></button>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-edge bg-surface/90 p-4">
              {selectedEvent ? (
                <>
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-green-300">
                        Selected review dot
                      </p>
                      <h2 className="text-lg font-bold">
                        At {selectedEvent.time_s.toFixed(3)}s, what happened?
                      </h2>
                      <p className="text-xs text-zinc-400">
                        Proposed by {selectedEvent.origin === "both" ? "audio and BlurBall" : selectedEvent.origin}. Judge it from the video and sound.
                      </p>
                    </div>
                    <button type="button" onClick={() => seek(Math.max(0, selectedEvent.time_s - 0.7), true)} className="rounded-lg border border-edge px-3 py-2 text-xs">
                      Play moment
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {EVENT_CHOICES.map((choice) => (
                      <button
                        key={choice.key}
                        type="button"
                        aria-pressed={selectedEvent.event_type === choice.key}
                        onClick={() => setEventType(choice.key)}
                        className={`rounded-xl border px-3 py-3 text-left ${
                          selectedEvent.event_type === choice.key
                            ? "border-green-400 bg-green-400/10 text-green-200"
                            : "border-edge hover:border-zinc-500"
                        }`}
                      >
                        <kbd className="mr-2 rounded border border-zinc-600 px-1.5 py-0.5 text-[10px]">{choice.shortcut}</kbd>
                        <span className="text-sm font-semibold">{choice.label}</span>
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] text-zinc-500">
                    Shift + letter inserts a missed event at the playhead. Backspace undoes your last answer.
                  </p>

                  <div className="mt-4 grid gap-4 border-t border-edge pt-4 sm:grid-cols-2">
                    <OptionGroup label="Belongs to this visible point?" value={selectedEvent.belongs_to_visible_point} onChange={(value) => updateSelectedEvent({ belongs_to_visible_point: value })} options={[
                      { key: "yes", label: "Yes" },
                      { key: "background", label: "Other table/background" },
                      { key: "unsure", label: "Unsure" },
                    ]} />
                    <OptionGroup label="Phase" value={selectedEvent.phase} onChange={(value) => updateSelectedEvent({ phase: value })} options={[
                      { key: "pre_serve", label: "Pre-serve ritual" },
                      { key: "serve", label: "Serve" },
                      { key: "rally", label: "Rally" },
                      { key: "point_ending", label: "Point-ending" },
                      { key: "post_point", label: "Post-point" },
                    ]} />
                    <OptionGroup label="Audibility" value={selectedEvent.audibility} onChange={(value) => updateSelectedEvent({ audibility: value })} options={[
                      { key: "clear", label: "Clearly audible" },
                      { key: "faint", label: "Faint" },
                      { key: "not_audible", label: "Not audible" },
                      { key: "unsure", label: "Unsure" },
                    ]} />
                    <OptionGroup label="Visual support" value={selectedEvent.visual_support} onChange={(value) => updateSelectedEvent({ visual_support: value })} options={[
                      { key: "clear", label: "Clear" },
                      { key: "weak", label: "Weak / trail only" },
                      { key: "absent", label: "Absent" },
                    ]} />
                    <OptionGroup label="Player side" value={selectedEvent.player_side} onChange={(value) => updateSelectedEvent({ player_side: value })} options={[
                      { key: "near", label: "Near" },
                      { key: "far", label: "Far" },
                      { key: "neither", label: "Neither" },
                      { key: "unsure", label: "Unsure" },
                    ]} />
                    <OptionGroup label="Confidence" value={selectedEvent.confidence} onChange={(value) => updateSelectedEvent({ confidence: value })} options={[
                      { key: "certain", label: "Certain" },
                      { key: "likely", label: "Likely" },
                      { key: "unsure", label: "Unsure" },
                    ]} />
                    <OptionGroup label="Proposal result" value={selectedEvent.proposal_confirmed} onChange={(value) => updateSelectedEvent({ proposal_confirmed: value })} options={[
                      { key: "confirmed", label: "Real event" },
                      { key: "corrected", label: "Real, corrected type/time" },
                      { key: "rejected", label: "Reject proposal" },
                    ]} />
                  </div>
                  {selectedEvent.event_type === "table" && selectedEvent.table_bounce && (
                    <div className="mt-4 grid gap-4 border-t border-edge pt-4 md:grid-cols-[260px_1fr]">
                      <TablePlacementEditor
                        value={selectedEvent.table_bounce}
                        onChange={(table_bounce) => updateSelectedEvent({ table_bounce })}
                      />
                      <div className="space-y-4">
                        <OptionGroup label="Table side" value={selectedEvent.table_bounce.table_side} onChange={(value) => updateSelectedEvent({ table_bounce: { ...selectedEvent.table_bounce!, table_side: value } })} options={[
                          { key: "near", label: "Near" },
                          { key: "far", label: "Far" },
                          { key: "net_center", label: "Net / center" },
                          { key: "unsure", label: "Unsure" },
                        ]} />
                        <OptionGroup label="Landing" value={selectedEvent.table_bounce.landing_status} onChange={(value) => updateSelectedEvent({ table_bounce: { ...selectedEvent.table_bounce!, landing_status: value } })} options={[
                          { key: "in", label: "In" },
                          { key: "edge", label: "Edge" },
                          { key: "out", label: "Out" },
                          { key: "unsure", label: "Unsure" },
                        ]} />
                        <OptionGroup label="Location visibility" value={selectedEvent.table_bounce.location_visibility} onChange={(value) => updateSelectedEvent({ table_bounce: { ...selectedEvent.table_bounce!, location_visibility: value } })} options={[
                          { key: "clear", label: "Clear" },
                          { key: "estimated", label: "Estimated from trail" },
                          { key: "not_visible", label: "Not visible" },
                        ]} />
                        <OptionGroup label="Location confidence" value={selectedEvent.table_bounce.location_confidence} onChange={(value) => updateSelectedEvent({ table_bounce: { ...selectedEvent.table_bounce!, location_confidence: value } })} options={[
                          { key: "certain", label: "Certain" },
                          { key: "likely", label: "Likely" },
                          { key: "unsure", label: "Unsure" },
                        ]} />
                      </div>
                    </div>
                  )}
                  <div className="mt-3 rounded-lg bg-ink/40 px-3 py-2 text-xs text-zinc-400">
                    This event still needs {unresolvedEventFields(selectedEvent).length} field{unresolvedEventFields(selectedEvent).length === 1 ? "" : "s"}.
                  </div>
                </>
              ) : (
                <p className="text-zinc-400">Select a bottom review dot.</p>
              )}
            </div>

            <div className="rounded-2xl border border-edge bg-surface/90 p-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-glow">
                Point anchors
              </p>
              <h2 className="text-lg font-bold">Mark when the point happened</h2>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <button type="button" onClick={() => updatePoint("serve_contact_s", Number(currentTime.toFixed(4)))} className="rounded-xl border border-edge p-3 text-left">
                  <span className="text-xs text-zinc-500">S · Serve contact</span>
                  <b className="mt-1 block text-sm">{formatTime(point.serve_contact_s)}</b>
                </button>
                <button type="button" onClick={() => updatePoint("decisive_c_s", Number(currentTime.toFixed(4)))} className="rounded-xl border border-rose-400/40 p-3 text-left">
                  <span className="text-xs text-rose-300">C · Point clearly decided</span>
                  <b className="mt-1 block text-sm">{formatTime(point.decisive_c_s)}</b>
                </button>
                <button type="button" onClick={() => updatePoint("review_end_s", Number(currentTime.toFixed(4)))} className="rounded-xl border border-edge p-3 text-left">
                  <span className="text-xs text-zinc-500">E · Ignore later activity</span>
                  <b className="mt-1 block text-sm">{formatTime(point.review_end_s)}</b>
                </button>
              </div>
              <button type="button" onClick={() => updatePoint("serve_contact_s", "not_visible")} className="mt-2 text-xs text-zinc-400 underline">
                Serve contact is not visible
              </button>
            </div>

            <div className="rounded-2xl border border-edge bg-surface/90 p-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-glow">
                Point outcome
              </p>
              <h2 className="text-lg font-bold">How did this point end?</h2>
              <div className="mt-2 rounded-xl border border-edge bg-ink/35 p-3 text-xs text-zinc-400">
                Existing Pong Lens entries to confirm or correct · Server: <b className="text-white">{existingSide(assignment, assignment.source.prefill.server)}</b> · Winner: <b className="text-white">{existingSide(assignment, assignment.source.prefill.winner)}</b>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <OptionGroup label="Point validity" value={point.point_validity} onChange={(value) => updatePoint("point_validity", value)} options={[
                  { key: "rally", label: "Rally" },
                  { key: "let_replay", label: "Let / replay" },
                  { key: "abandoned", label: "Abandoned" },
                  { key: "unusable", label: "Unusable clip" },
                ]} />
                <OptionGroup label="Server" value={point.server} onChange={(value) => updatePoint("server", value)} options={[
                  { key: "near", label: nearName },
                  { key: "far", label: farName },
                  { key: "unsure", label: "Unsure" },
                ]} />
                <OptionGroup label="Winner" value={point.winner} onChange={(value) => updatePoint("winner", value)} options={[
                  { key: "near", label: nearName },
                  { key: "far", label: farName },
                  { key: "let", label: "Let" },
                  { key: "unsure", label: "Unsure" },
                ]} />
                <OptionGroup label="Last hitter" value={point.last_hitter} onChange={(value) => updatePoint("last_hitter", value)} options={[
                  { key: "near", label: nearName },
                  { key: "far", label: farName },
                  { key: "no_contact", label: "No contact" },
                  { key: "unsure", label: "Unsure" },
                ]} />
                <OptionGroup label="Responsible player" value={point.responsible_player} onChange={(value) => updatePoint("responsible_player", value)} options={[
                  { key: "near", label: nearName },
                  { key: "far", label: farName },
                  { key: "neither", label: "Neither" },
                  { key: "unsure", label: "Unsure" },
                ]} />
                <OptionGroup label="Final ball result" value={point.final_ball_result} onChange={(value) => updatePoint("final_ball_result", value)} options={[
                  { key: "in", label: "In" },
                  { key: "net", label: "Net" },
                  { key: "long", label: "Long" },
                  { key: "wide", label: "Wide" },
                  { key: "edge", label: "Edge" },
                  { key: "double_bounce", label: "Double bounce" },
                  { key: "body_catch", label: "Body / catch" },
                  { key: "unknown", label: "Unknown" },
                ]} />
                <OptionGroup label="Return contact after final bounce?" value={point.return_contact_after_final_bounce} onChange={(value) => updatePoint("return_contact_after_final_bounce", value)} options={[
                  { key: "yes", label: "Yes" },
                  { key: "no", label: "No" },
                  { key: "unsure", label: "Unsure" },
                ]} />
                <OptionGroup label="Point confidence" value={point.point_confidence} onChange={(value) => updatePoint("point_confidence", value)} options={[
                  { key: "certain", label: "Certain" },
                  { key: "likely", label: "Likely" },
                  { key: "unsure", label: "Unsure" },
                ]} />
              </div>
              <div className="mt-4">
                <OptionGroup label="Ending type" value={point.ending_type} onChange={(value) => updatePoint("ending_type", value)} options={[
                  { key: "clean_winner", label: "Clean winner" },
                  { key: "net_error", label: "Net error" },
                  { key: "long_error", label: "Long error" },
                  { key: "wide_error", label: "Wide error" },
                  { key: "edge_ball", label: "Edge ball" },
                  { key: "net_cord_winner", label: "Net-cord winner" },
                  { key: "double_bounce", label: "Double bounce" },
                  { key: "body_catch_obstruction", label: "Body/catch/obstruction" },
                  { key: "serve_fault", label: "Serve fault" },
                  { key: "let_replay", label: "Let/replay" },
                  { key: "other", label: "Other" },
                  { key: "unsure", label: "Unsure" },
                ]} />
              </div>
              <div className="mt-4">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Optional reaction cues</p>
                <div className="flex flex-wrap gap-2">
                  {["cho", "raised_hand_apology", "celebration", "disappointment", "ball_retrieval"].map((cue) => {
                    const active = point.reaction_cues.includes(cue);
                    return (
                      <button key={cue} type="button" aria-pressed={active} onClick={() => updatePoint("reaction_cues", active ? point.reaction_cues.filter((item) => item !== cue) : [...point.reaction_cues, cue])} className={`rounded-lg border px-2.5 py-1.5 text-xs ${active ? "border-magenta-glow text-magenta-soft" : "border-edge text-zinc-400"}`}>
                        {cue.replaceAll("_", " ")}
                      </button>
                    );
                  })}
                </div>
              </div>
              <label className="mt-4 block text-xs font-semibold text-zinc-400">
                Optional notes
                <textarea value={label.notes} onChange={(event) => pushLabel((current) => ({ ...current, notes: event.target.value }))} rows={3} className="mt-1 w-full rounded-xl border border-edge bg-ink/40 p-3 text-sm text-white" placeholder="Anything unusual or ambiguous…" />
              </label>
            </div>

            <div className={`rounded-2xl border p-4 ${pointMissing.length || incompleteEvents.length ? "border-amber-400/30 bg-amber-400/5" : "border-green-400/30 bg-green-400/5"}`}>
              <div className="flex flex-wrap items-center gap-3">
                <div className="mr-auto">
                  <p className="font-semibold">
                    {pointMissing.length || incompleteEvents.length
                      ? `${pointMissing.length + incompleteEvents.length} review item${pointMissing.length + incompleteEvents.length === 1 ? "" : "s"} remaining`
                      : "Point review is complete"}
                  </p>
                  <p className="text-xs text-zinc-400">
                    {pointMissing.length} missing point fields · {incompleteEvents.length} incomplete event dots
                  </p>
                </div>
                <button type="button" onClick={() => void submit()} className="rounded-xl bg-green-400 px-5 py-3 text-sm font-bold text-[#071323]">
                  Submit point and continue
                </button>
              </div>
              {submitError && <p className="mt-3 rounded-lg bg-rose-500/10 p-2 text-xs text-rose-300">{submitError}</p>}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function VisualDot({
  candidate,
  age,
}: {
  candidate: ResearchVisualCandidate;
  age: number;
}) {
  const side =
    candidate.side ??
    (candidate.v === null || candidate.v === undefined
      ? null
      : candidate.v >= 1.37
        ? "far"
        : "near");
  const color =
    side === "near" ? "#f59e0b" : side === "far" ? "#22d3ee" : "#cbd5e1";
  return (
    <span
      className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/80 shadow-[0_0_12px_currentColor]"
      style={{
        left: `${(candidate.x_norm ?? 0) * 100}%`,
        top: `${(candidate.y_norm ?? 0) * 100}%`,
        backgroundColor: color,
        color,
        opacity: Math.max(0.4, 1 - age * 0.08),
      }}
    />
  );
}
