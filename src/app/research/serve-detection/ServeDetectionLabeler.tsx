"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createClient } from "@/lib/supabase/client";
import {
  HARD_NEGATIVE_REASONS,
  NO_OBSERVABLE_SERVE_REASONS,
  SERVE_EVENT_TYPES,
  frameStepTime,
  hydrateServeDetectionLabel,
  removeServeEvent,
  setActualServeContact,
  setNoObservableServe,
  upsertServeEvent,
  validateServeDetectionLabel,
  type HardNegativeReason,
  type NoObservableServeReason,
  type ServeDetectionHumanLabel,
  type ServeEventType,
} from "@/lib/research/serveDetection";
import {
  actionLabel,
  filterServeAssignments,
  nextUnsubmittedIndex,
  serveProgress,
} from "./serveDetectionView";
import type {
  DetectorStatus,
  ServeQueueFilter,
  ServeResearchAssignment,
} from "./types";

type SaveState = "idle" | "saving" | "saved" | "error";

const EVENT_LABELS: Record<ServeEventType, string> = {
  serve_contact: "Serve paddle contact",
  serve_first_bounce: "Serve first bounce",
  serve_second_bounce: "Serve second bounce",
  return_contact: "Return paddle contact",
  return_bounce: "Return bounce",
  later_contact: "Later rally paddle contact",
  later_bounce: "Later rally bounce",
  net_contact: "Net contact",
  non_relevant: "Non-relevant action",
  unsure: "Unsure",
};

const NO_SERVE_LABELS: Record<NoObservableServeReason, string> = {
  not_visible: "Serve is not visible",
  no_serve_in_clip: "No serve occurs in this clip",
  walking_retrieval: "Walking or retrieving the ball",
  handoff_toss: "Handoff or casual toss",
  bad_cut: "Bad clip boundary or cut",
};

const HARD_NEGATIVE_LABELS: Record<HardNegativeReason, string> = {
  walking_retrieval: "Walking / retrieval",
  handoff_toss: "Handoff / casual toss",
  bad_cut: "Bad cut",
};

function initialAssignmentId(
  assignments: ServeResearchAssignment[],
): string | null {
  return (
    assignments.find((item) => item.status !== "submitted")?.id ??
    assignments[0]?.id ??
    null
  );
}

export function ServeDetectionLabeler({
  initialAssignments,
  isAdmin,
}: {
  initialAssignments: ServeResearchAssignment[];
  isAdmin: boolean;
}) {
  const [assignments, setAssignments] = useState(initialAssignments);
  const [assignmentId, setAssignmentId] = useState<string | null>(() =>
    initialAssignmentId(initialAssignments),
  );
  const assignment =
    assignments.find((item) => item.id === assignmentId) ?? null;
  const [label, setLabel] = useState<ServeDetectionHumanLabel>(() =>
    hydrateServeDetectionLabel(assignment?.human_label),
  );
  const [filter, setFilter] = useState<ServeQueueFilter>({
    match: "all",
    status: "all",
  });
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [reviewerEmail, setReviewerEmail] = useState("");
  const [adminBusy, setAdminBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const openedAtRef = useRef(Date.now());
  const playbackCountRef = useRef(
    assignment?.review_metrics?.playback_count ?? 0,
  );
  const answerChangesRef = useRef(
    assignment?.review_metrics?.answer_changes ?? 0,
  );
  const supabase = useMemo(() => createClient(), []);

  const progress = serveProgress(assignments);
  const matches = useMemo(
    () =>
      [...new Set(assignments.map((item) => item.source.match_label))].sort(),
    [assignments],
  );
  const filteredAssignments = useMemo(
    () => filterServeAssignments(assignments, filter),
    [assignments, filter],
  );

  const updateLabel = useCallback(
    (
      updater: (
        current: ServeDetectionHumanLabel,
      ) => ServeDetectionHumanLabel,
    ) => {
      setLabel((current) => updater(current));
      answerChangesRef.current += 1;
      setDirty(true);
      setSaveState("idle");
      setMessage(null);
    },
    [],
  );

  const saveNow = useCallback(
    async (
      nextLabel: ServeDetectionHumanLabel,
      status: ServeResearchAssignment["status"] = "in_progress",
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
        console.error("serve research save failed", error);
        setSaveState("error");
        setMessage("Save failed. Your label is still here—retry before leaving.");
        return false;
      }
      openedAtRef.current = Date.now();
      setDirty(false);
      setSaveState("saved");
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
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

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

  const goToAssignment = useCallback(
    async (
      next: ServeResearchAssignment | undefined,
      skipCurrentSave = false,
    ) => {
      if (!next || !assignment || next.id === assignment.id) return;
      if (dirty && !skipCurrentSave) {
        const saved = await saveNow(
          label,
          assignment.status === "submitted" ? "submitted" : "in_progress",
        );
        if (!saved) return;
      }
      setAssignmentId(next.id);
      setLabel(hydrateServeDetectionLabel(next.human_label));
      setDirty(false);
      setSaveState("idle");
      setMessage(null);
      playbackCountRef.current = next.review_metrics?.playback_count ?? 0;
      answerChangesRef.current = next.review_metrics?.answer_changes ?? 0;
      openedAtRef.current = Date.now();
    },
    [assignment, dirty, label, saveNow],
  );

  const jumpTo = (timeS: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.currentTime = timeS;
    setCurrentTime(timeS);
  };

  const stepFrames = (frames: number) => {
    const video = videoRef.current;
    if (!video || !assignment) return;
    video.pause();
    const target = frameStepTime(
      video.currentTime,
      frames,
      assignment.source.proposal.video.fps,
      assignment.source.proposal.video.duration_s,
    );
    video.currentTime = target;
    setCurrentTime(target);
  };

  const markActualServe = () => {
    updateLabel((current) =>
      setActualServeContact(current, videoRef.current?.currentTime ?? currentTime),
    );
  };

  const markProposal = (
    eventId: string,
    timeS: number,
    eventType: ServeEventType,
    hardNegativeReason: HardNegativeReason | null = null,
  ) => {
    updateLabel((current) =>
      upsertServeEvent(current, {
        id: eventId,
        time_s: timeS,
        event_type: eventType,
        origin: "proposal",
        hard_negative_reason: hardNegativeReason,
      }),
    );
  };

  const addManualEvent = () => {
    const time = videoRef.current?.currentTime ?? currentTime;
    updateLabel((current) =>
      upsertServeEvent(current, {
        id: `manual-${Date.now()}`,
        time_s: time,
        event_type: "unsure",
        origin: "manual",
        hard_negative_reason: null,
      }),
    );
  };

  const submit = async () => {
    if (!assignment) return;
    if (validateServeDetectionLabel(label).length) {
      setMessage(
        "Mark the actual serve contact or choose why no observable serve exists.",
      );
      return;
    }
    const saved = await saveNow(label, "submitted");
    if (!saved) return;
    const currentIndex = assignments.findIndex(
      (item) => item.id === assignment.id,
    );
    await goToAssignment(
      assignments[nextUnsubmittedIndex(assignments, currentIndex)],
      true,
    );
  };

  const assignReviewer = async () => {
    if (!assignment || !reviewerEmail.trim()) return;
    setAdminBusy(true);
    setMessage(null);
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
    setAdminBusy(false);
    if (!response.ok) {
      setMessage(payload.error ?? "Could not assign reviewer.");
      return;
    }
    setReviewerEmail("");
    setMessage(`Reviewer received ${payload.assigned ?? 0} assignments.`);
  };

  const exportBatch = async () => {
    if (!assignment) return;
    const response = await fetch("/api/research/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ batchId: assignment.batch_id }),
    });
    if (!response.ok) {
      setMessage("Serve research export failed.");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "ponglens-serve-detection-research.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (!assignment) {
    return (
      <main className="min-h-screen bg-arena p-8 text-center">
        <h1 className="text-2xl font-bold">No serve assignments yet</h1>
        <p className="mt-2 text-zinc-400">
          Your account is approved, but this batch has not been assigned.
        </p>
        <Link href="/dashboard" className="mt-6 inline-block text-cyan-glow">
          Back to Pong Lens
        </Link>
      </main>
    );
  }

  const proposal = assignment.source.proposal;
  const detector = proposal.detector;
  const actualContact = label.actual_serve_contact_s;
  const visibleAssignments = filteredAssignments.some(
    (item) => item.id === assignment.id,
  )
    ? filteredAssignments
    : [assignment, ...filteredAssignments];
  const visibleIndex = visibleAssignments.findIndex(
    (item) => item.id === assignment.id,
  );

  return (
    <main className="min-h-screen bg-arena pb-24 text-zinc-100">
      <header className="sticky top-0 z-40 border-b border-edge bg-ink/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-3 px-4 py-3">
          <div className="mr-auto">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-glow">
              Pong Lens Research
            </p>
            <h1 className="text-xl font-bold">Serve detection review</h1>
          </div>
          <span className="rounded-full border border-edge px-3 py-1 text-xs">
            {progress.completed}/{progress.total} complete
          </span>
          {isAdmin && (
            <button
              type="button"
              onClick={() => void exportBatch()}
              className="rounded-lg border border-magenta-glow/30 px-3 py-1.5 text-xs font-semibold text-magenta-soft"
            >
              Export
            </button>
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
                : saveState === "saved"
                  ? "Saved"
                  : "Autosave on"}
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] p-4">
        <nav className="mb-4 grid gap-2 rounded-xl border border-edge bg-surface/80 p-2 md:grid-cols-[1fr_1fr_auto_minmax(180px,1fr)_auto]">
          <select
            value={filter.match}
            onChange={(event) =>
              setFilter((current) => ({
                ...current,
                match: event.target.value,
              }))
            }
            className="rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm"
            aria-label="Filter by match"
          >
            <option value="all">All matches</option>
            {matches.map((match) => (
              <option key={match} value={match}>
                {match}
              </option>
            ))}
          </select>
          <select
            value={filter.status}
            onChange={(event) =>
              setFilter((current) => ({
                ...current,
                status: event.target.value as DetectorStatus | "all",
              }))
            }
            className="rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm"
            aria-label="Filter by detector status"
          >
            <option value="all">All detector statuses</option>
            <option value="high_confidence">High confidence</option>
            <option value="needs_review">Needs review</option>
          </select>
          <button
            type="button"
            disabled={visibleIndex <= 0}
            onClick={() =>
              void goToAssignment(visibleAssignments[visibleIndex - 1])
            }
            className="rounded-lg border border-edge px-3 py-2 disabled:opacity-30"
          >
            ←
          </button>
          <select
            value={assignment.id}
            onChange={(event) =>
              void goToAssignment(
                visibleAssignments.find(
                  (item) => item.id === event.target.value,
                ),
              )
            }
            className="min-w-0 rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm"
            aria-label="Serve review item"
          >
            {visibleAssignments.map((item) => (
              <option key={item.id} value={item.id}>
                {item.sequence}/100 · {item.source.match_label}
                {item.status === "submitted" ? " · complete" : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={visibleIndex >= visibleAssignments.length - 1}
            onClick={() =>
              void goToAssignment(visibleAssignments[visibleIndex + 1])
            }
            className="rounded-lg border border-edge px-3 py-2 disabled:opacity-30"
          >
            →
          </button>
        </nav>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(390px,.8fr)]">
          <div className="space-y-4">
            <article className="rounded-2xl border border-edge bg-surface/90 p-4">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-glow">
                    {assignment.source.match_label} · source point{" "}
                    {assignment.source.source_point_idx}
                  </p>
                  <h2 className="text-xl font-bold">
                    Item {assignment.sequence} of 100
                  </h2>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full border border-cyan-glow/30 bg-cyan-glow/10 px-3 py-1.5 text-cyan-100">
                    Scored server:{" "}
                    <strong>
                      {proposal.scored_server.player &&
                      proposal.scored_server.side
                        ? `${proposal.scored_server.player === "user" ? "You" : "Opponent"} (${proposal.scored_server.side})`
                        : "unresolved"}
                    </strong>
                  </span>
                  <span
                    className={`rounded-full px-3 py-1.5 ${
                      detector.status === "high_confidence"
                        ? "bg-emerald-500/15 text-emerald-200"
                        : "bg-amber-500/15 text-amber-200"
                    }`}
                  >
                    Detector:{" "}
                    <strong>
                      {detector.status === "high_confidence"
                        ? `${detector.server_side ?? "unknown"} side`
                        : "withheld"}
                    </strong>
                  </span>
                </div>
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
                    onPlay={() => {
                      playbackCountRef.current += 1;
                    }}
                    onTimeUpdate={(event) =>
                      setCurrentTime(event.currentTarget.currentTime)
                    }
                    onEnded={() => {
                      setAssignments((current) =>
                        current.map((item) =>
                          item.id === assignment.id
                            ? {
                                ...item,
                                review_metrics: {
                                  ...item.review_metrics,
                                  video_completed: true,
                                },
                              }
                            : item,
                        ),
                      );
                    }}
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
                    onClick={() => stepFrames(frames)}
                    className="rounded-lg border border-edge px-3 py-2 text-xs font-semibold hover:border-zinc-500"
                  >
                    {frames > 0 ? "+" : ""}
                    {frames} frame{Math.abs(frames) === 1 ? "" : "s"}
                  </button>
                ))}
                <span className="ml-auto rounded-lg bg-ink/50 px-3 py-2 font-mono text-xs text-zinc-300">
                  {currentTime.toFixed(3)}s ·{" "}
                  {proposal.video.fps.toFixed(2)} fps
                </span>
              </div>
            </article>

            <article className="rounded-2xl border border-edge bg-surface/90 p-4">
              <div className="mb-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-glow">
                  Proposed actions
                </p>
                <h2 className="text-lg font-bold">
                  Jump to the exact predicted frame, then label it
                </h2>
                <p className="mt-1 text-xs text-zinc-400">
                  Jumps contain no lead-in padding. Press Play yourself if you
                  want to watch forward from that frame.
                </p>
              </div>
              {proposal.likely_actions.length ? (
                <div className="space-y-3">
                  {proposal.likely_actions.map((action) => {
                    const saved = label.events.find(
                      (event) => event.id === action.id,
                    );
                    return (
                      <div
                        key={action.id}
                        className="rounded-xl border border-edge bg-ink/35 p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => jumpTo(action.time_s)}
                            className="rounded-lg border border-cyan-glow/40 bg-cyan-glow/10 px-3 py-2 text-sm font-bold text-cyan-glow"
                          >
                            Jump · {action.time_s.toFixed(3)}s
                          </button>
                          <div className="min-w-[170px] flex-1">
                            <p className="text-sm font-bold">
                              {actionLabel(action.suggested_type)}
                            </p>
                            <p className="text-[11px] text-zinc-500">
                              {action.origin.replaceAll("_", " ")}
                            </p>
                          </div>
                          <select
                            value={saved?.event_type ?? ""}
                            onChange={(event) =>
                              markProposal(
                                action.id,
                                action.time_s,
                                event.target.value as ServeEventType,
                              )
                            }
                            className="rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm"
                            aria-label={`Label action at ${action.time_s.toFixed(3)} seconds`}
                          >
                            <option value="" disabled>
                              Choose label…
                            </option>
                            {SERVE_EVENT_TYPES.map((eventType) => (
                              <option key={eventType} value={eventType}>
                                {EVENT_LABELS[eventType]}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className="mr-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                            Hard negative
                          </span>
                          {HARD_NEGATIVE_REASONS.map((reason) => (
                            <button
                              key={reason}
                              type="button"
                              onClick={() =>
                                markProposal(
                                  action.id,
                                  action.time_s,
                                  "non_relevant",
                                  reason,
                                )
                              }
                              className={`rounded-md border px-2 py-1 text-[11px] ${
                                saved?.hard_negative_reason === reason
                                  ? "border-amber-400 bg-amber-500/15 text-amber-200"
                                  : "border-edge text-zinc-400"
                              }`}
                            >
                              {HARD_NEGATIVE_LABELS[reason]}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-edge p-4 text-sm text-zinc-400">
                  The detector withheld all action timestamps. Find the serve
                  manually and use the controls on the right.
                </p>
              )}
            </article>
          </div>

          <aside className="space-y-4">
            <article className="rounded-2xl border border-cyan-glow/30 bg-surface/90 p-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-glow">
                Highest-value answer
              </p>
              <h2 className="mt-1 text-lg font-bold">
                Where is the actual serve contact?
              </h2>
              <p className="mt-1 text-sm text-zinc-400">
                Move to the paddle-contact frame, then mark it. This is the
                only required timestamp.
              </p>
              <button
                type="button"
                onClick={markActualServe}
                className="mt-4 w-full rounded-xl bg-cyan-glow px-4 py-3 font-bold text-ink"
              >
                Mark actual serve here · {currentTime.toFixed(3)}s
              </button>
              {actualContact !== null && (
                <div className="mt-3 flex items-center justify-between rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
                  <span>Marked at {actualContact.toFixed(4)}s</span>
                  <button
                    type="button"
                    onClick={() => jumpTo(actualContact)}
                    className="font-bold underline"
                  >
                    Jump
                  </button>
                </div>
              )}
              <p className="mt-4 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                Or no observable serve
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                {NO_OBSERVABLE_SERVE_REASONS.map((reason) => (
                  <button
                    key={reason}
                    type="button"
                    onClick={() =>
                      updateLabel((current) =>
                        setNoObservableServe(current, reason),
                      )
                    }
                    className={`rounded-lg border px-3 py-2 text-left text-sm ${
                      label.no_observable_serve === reason
                        ? "border-amber-400 bg-amber-500/15 text-amber-100"
                        : "border-edge bg-ink/30 text-zinc-300"
                    }`}
                  >
                    {NO_SERVE_LABELS[reason]}
                  </button>
                ))}
              </div>
            </article>

            <article className="rounded-2xl border border-edge bg-surface/90 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-magenta-soft">
                    Missing events
                  </p>
                  <h2 className="text-lg font-bold">Add at current frame</h2>
                </div>
                <button
                  type="button"
                  onClick={addManualEvent}
                  className="rounded-lg border border-magenta-glow/35 px-3 py-2 text-xs font-bold text-magenta-soft"
                >
                  + Add event
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {label.events
                  .filter((event) => event.origin === "manual")
                  .map((event) => (
                    <div
                      key={event.id}
                      className="flex items-center gap-2 rounded-lg border border-edge bg-ink/35 p-2"
                    >
                      <button
                        type="button"
                        onClick={() => jumpTo(event.time_s)}
                        className="font-mono text-xs text-cyan-glow"
                      >
                        {event.time_s.toFixed(3)}s
                      </button>
                      <select
                        value={event.event_type}
                        onChange={(change) =>
                          updateLabel((current) =>
                            upsertServeEvent(current, {
                              ...event,
                              event_type: change.target
                                .value as ServeEventType,
                            }),
                          )
                        }
                        className="min-w-0 flex-1 rounded-md border border-edge bg-surface-2 px-2 py-1.5 text-xs"
                        aria-label={`Label manual event at ${event.time_s.toFixed(3)} seconds`}
                      >
                        {SERVE_EVENT_TYPES.map((eventType) => (
                          <option key={eventType} value={eventType}>
                            {EVENT_LABELS[eventType]}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() =>
                          updateLabel((current) =>
                            removeServeEvent(current, event.id),
                          )
                        }
                        className="px-2 text-zinc-500 hover:text-rose-300"
                        aria-label="Remove manual event"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                {!label.events.some((event) => event.origin === "manual") && (
                  <p className="text-xs text-zinc-500">
                    Add only genuinely missing contacts, bounces, or net
                    contacts.
                  </p>
                )}
              </div>
              <label className="mt-4 block text-xs font-bold text-zinc-400">
                Optional notes
                <textarea
                  value={label.notes}
                  onChange={(event) =>
                    updateLabel((current) => ({
                      ...current,
                      notes: event.target.value,
                    }))
                  }
                  rows={3}
                  className="mt-2 w-full rounded-lg border border-edge bg-ink/35 p-3 font-normal text-zinc-200"
                  placeholder="Only add context that the structured labels miss."
                />
              </label>
            </article>

            {message && (
              <p
                className={`rounded-xl border p-3 text-sm ${
                  saveState === "error"
                    ? "border-rose-500/30 bg-rose-500/10 text-rose-200"
                    : "border-cyan-glow/25 bg-cyan-glow/5 text-cyan-100"
                }`}
              >
                {message}
              </p>
            )}

            <button
              type="button"
              onClick={() => void submit()}
              className="w-full rounded-xl bg-magenta-glow px-4 py-3 font-bold text-white"
            >
              Submit & next
            </button>

            {isAdmin && (
              <article className="rounded-2xl border border-edge bg-surface/90 p-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
                  Delegate this batch
                </p>
                <p className="mt-1 text-xs text-zinc-400">
                  The reviewer must sign in once before assignment.
                </p>
                <div className="mt-3 flex gap-2">
                  <input
                    type="email"
                    value={reviewerEmail}
                    onChange={(event) => setReviewerEmail(event.target.value)}
                    placeholder="reviewer@example.com"
                    className="min-w-0 flex-1 rounded-lg border border-edge bg-ink/35 px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    disabled={adminBusy || !reviewerEmail.trim()}
                    onClick={() => void assignReviewer()}
                    className="rounded-lg border border-edge px-3 py-2 text-sm font-bold disabled:opacity-40"
                  >
                    {adminBusy ? "Assigning…" : "Assign"}
                  </button>
                </div>
              </article>
            )}
          </aside>
        </section>
      </div>
    </main>
  );
}
