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
  createPlacementCalibrationLabel,
  predictionDistanceCm,
  revealPlacementComparison,
  updatePlacementCalibrationLabel,
  validatePlacementCalibrationLabel,
  type PlacementCalibrationHumanLabel,
  type PlacementCalibrationResult,
  type PlacementConfidence,
  type PlacementPrediction,
  type PlacementVisibility,
} from "@/lib/research/placementCalibration";
import { eventInstruction } from "./placementCalibrationView";
import { PlacementTableEditor } from "./PlacementTableEditor";
import type { PlacementResearchAssignment } from "./types";

type SaveState = "idle" | "saving" | "saved" | "error";

const RESULT_CHOICES: {
  key: PlacementCalibrationResult;
  label: string;
  detail: string;
}[] = [
  {
    key: "landed",
    label: "Landed on table",
    detail: "I can mark the bounce.",
  },
  {
    key: "not_visible",
    label: "Not visible",
    detail: "The bounce is hidden or too unclear.",
  },
  {
    key: "wrong_event",
    label: "Wrong event",
    detail: "The requested event is not in this clip.",
  },
  {
    key: "no_table_bounce",
    label: "No table bounce",
    detail: "The shot hit the net or went out.",
  },
];

function hydrateLabel(
  stored: Partial<PlacementCalibrationHumanLabel> | null,
): PlacementCalibrationHumanLabel {
  return { ...createPlacementCalibrationLabel(), ...(stored ?? {}) };
}

function OptionButtons<T extends string>({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: T | null;
  choices: { key: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
        {label}
      </legend>
      <div className="grid grid-cols-2 gap-2">
        {choices.map((choice) => (
          <button
            key={choice.key}
            type="button"
            aria-pressed={choice.key === value}
            onClick={() => onChange(choice.key)}
            className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
              choice.key === value
                ? "border-cyan-glow bg-cyan-glow/15 text-cyan-glow"
                : "border-edge bg-surface-2 text-zinc-300 hover:border-zinc-500"
            }`}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function PredictionMetric({
  label,
  color,
  prediction,
  human,
}: {
  label: string;
  color: string;
  prediction: PlacementPrediction | null;
  human: { u: number; v: number } | null;
}) {
  const distance = predictionDistanceCm(human, prediction);
  return (
    <div className="rounded-xl border border-edge bg-surface-2 p-3">
      <div className="flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: color }}
        />
        <p className="text-xs font-semibold text-zinc-200">{label}</p>
      </div>
      <p className="mt-1 text-lg font-bold">
        {!prediction
          ? "No prediction"
          : distance === null
            ? "Not scorable"
            : `${distance.toFixed(1)} cm away`}
      </p>
      {prediction?.zone && (
        <p className="text-[11px] text-zinc-500">{prediction.zone}</p>
      )}
    </div>
  );
}

export function PlacementCalibrationLabeler({
  initialAssignments,
  isAdmin,
}: {
  initialAssignments: PlacementResearchAssignment[];
  isAdmin: boolean;
}) {
  const firstOpen = Math.max(
    0,
    initialAssignments.findIndex((item) => item.status !== "submitted"),
  );
  const [assignments, setAssignments] = useState(initialAssignments);
  const [assignmentIndex, setAssignmentIndex] = useState(firstOpen);
  const assignment = assignments[assignmentIndex] ?? null;
  const [label, setLabel] = useState(() =>
    hydrateLabel(assignment?.human_label ?? null),
  );
  const [comparison, setComparison] = useState(
    label.revealed_at ? assignment?.source.proposal.predictions ?? null : null,
  );
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState(0.25);
  const [loopEvent, setLoopEvent] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const openedAtRef = useRef(Date.now());
  const playbackCountRef = useRef(
    assignment?.review_metrics?.playback_count ?? 0,
  );
  const answerChangesRef = useRef(
    assignment?.review_metrics?.answer_changes ?? 0,
  );
  const supabase = useMemo(() => createClient(), []);

  const updateLabel = useCallback(
    (
      patch: Parameters<typeof updatePlacementCalibrationLabel>[1],
    ) => {
      setLabel((current) => updatePlacementCalibrationLabel(current, patch));
      answerChangesRef.current += 1;
      setDirty(true);
      setMessage(null);
    },
    [],
  );

  const saveNow = useCallback(
    async (
      nextLabel: PlacementCalibrationHumanLabel,
      status: PlacementResearchAssignment["status"] = "in_progress",
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
        console.error("placement research save failed", error);
        setSaveState("error");
        setMessage("Save failed. Your answer is still visible; please retry.");
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
    const timer = window.setTimeout(() => void saveNow(label), 700);
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
    async (nextIndex: number) => {
      const next = assignments[nextIndex];
      if (!next || !assignment) return;
      if (dirty) {
        await saveNow(
          label,
          assignment.status === "submitted" ? "submitted" : "in_progress",
        );
      }
      const nextLabel = hydrateLabel(next.human_label);
      setAssignmentIndex(nextIndex);
      setLabel(nextLabel);
      setComparison(
        nextLabel.revealed_at ? next.source.proposal.predictions : null,
      );
      setDirty(false);
      setSaveState("idle");
      setMessage(null);
      playbackCountRef.current = next.review_metrics?.playback_count ?? 0;
      answerChangesRef.current = next.review_metrics?.answer_changes ?? 0;
      openedAtRef.current = Date.now();
    },
    [assignment, assignments, dirty, label, saveNow],
  );

  const reveal = async () => {
    const missing = validatePlacementCalibrationLabel(label);
    if (missing.length) {
      setMessage(
        label.result === "landed"
          ? "Mark the bounce and choose visibility and confidence first."
          : "Choose what happened first.",
      );
      return;
    }
    const revealed = revealPlacementComparison(
      label,
      new Date().toISOString(),
    );
    setLabel(revealed);
    const saved = await saveNow(revealed);
    if (!saved || !assignment) return;
    const response = await fetch("/api/research/placement-comparison", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignmentId: assignment.id }),
    });
    const payload = (await response.json()) as {
      predictions?: PlacementResearchAssignment["source"]["proposal"]["predictions"];
      error?: string;
    };
    if (!response.ok || !payload.predictions) {
      setMessage(payload.error ?? "Could not reveal the comparison.");
      return;
    }
    setComparison(payload.predictions);
    setAssignments((current) =>
      current.map((item) =>
        item.id === assignment.id
          ? {
              ...item,
              human_label: revealed,
              source: {
                ...item.source,
                proposal: {
                  ...item.source.proposal,
                  predictions: payload.predictions!,
                },
              },
            }
          : item,
      ),
    );
  };

  const submit = async () => {
    if (!label.revealed_at) {
      setMessage("Reveal the saved comparison before completing this item.");
      return;
    }
    const saved = await saveNow(label, "submitted");
    if (saved && assignmentIndex < assignments.length - 1) {
      await goToAssignment(assignmentIndex + 1);
    }
  };

  const exportPilot = async () => {
    if (!assignment) return;
    const response = await fetch("/api/research/placement-export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ batchId: assignment.batch_id }),
    });
    if (!response.ok) {
      setMessage("The placement pilot export failed.");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "ponglens-placement-calibration-pilot.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (!assignment) {
    return (
      <main className="min-h-screen bg-arena p-8 text-center">
        <h1 className="text-2xl font-bold">No placement assignments yet</h1>
        <p className="mt-2 text-zinc-400">
          Your account is approved, but this cross-venue pilot has not been
          assigned yet.
        </p>
        <Link href="/dashboard" className="mt-6 inline-block text-cyan-glow">
          Back to Pong Lens
        </Link>
      </main>
    );
  }

  const proposal = assignment.source.proposal;
  const rawNear = assignment.source.player_near_name ?? "Near player";
  const rawFar = assignment.source.player_far_name ?? "Far player";
  const opponentName =
    proposal.user_side === "near" ? rawFar : rawNear;
  const nearName = proposal.user_side === "near" ? "You" : opponentName;
  const farName = proposal.user_side === "far" ? "You" : opponentName;
  const serverName =
    proposal.scored_server === "user" ? "You" : opponentName;
  const humanPoint =
    label.result === "landed" &&
    label.table_u !== null &&
    label.table_v !== null
      ? { u: label.table_u, v: label.table_v }
      : null;
  const completed = assignments.filter(
    (item) => item.status === "submitted",
  ).length;
  const targetStart = Math.max(0, proposal.event_time_s - 1.2);
  const targetEnd = Math.min(
    assignment.source.duration_s,
    proposal.event_time_s + 1.2,
  );

  return (
    <main className="min-h-screen bg-arena pb-24">
      <header className="sticky top-0 z-40 border-b border-edge bg-ink/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1420px] flex-wrap items-center gap-3 px-4 py-3">
          <div className="mr-auto">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-glow">
              Pong Lens Research
            </p>
            <h1 className="text-xl font-bold">Placement calibration</h1>
          </div>
          <span className="rounded-full border border-edge px-3 py-1 text-xs">
            {completed}/{assignments.length} complete
          </span>
          {isAdmin && (
            <button
              type="button"
              onClick={() => void exportPilot()}
              className="rounded-lg border border-magenta-glow/30 px-3 py-1.5 text-xs font-semibold text-magenta-soft"
            >
              Export pilot
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

      <div className="mx-auto max-w-[1420px] p-4">
        <nav className="mb-4 flex items-center gap-2 rounded-xl border border-edge bg-surface/80 p-2">
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
            aria-label="Placement review item"
          >
            {assignments.map((item, index) => (
              <option key={item.id} value={index}>
                Item {index + 1} of {assignments.length}
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
        </nav>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.12fr)_minmax(430px,.88fr)]">
          <div className="space-y-4">
            <article className="rounded-2xl border border-edge bg-surface/90 p-4">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-glow">
                    {assignment.source.match_label}
                  </p>
                  <h2 className="text-xl font-bold">
                    {proposal.event_description}
                  </h2>
                  <p className="mt-1 text-xs text-zinc-400">
                    {assignment.source.venue_label ?? "Venue not recorded"} ·
                    event at {proposal.event_time_s.toFixed(2)}s
                  </p>
                </div>
                <span className="rounded-full border border-cyan-glow/35 bg-cyan-glow/10 px-3 py-1 text-sm font-bold text-cyan-glow">
                  {serverName} served
                </span>
              </div>

              <div className="mb-3 grid gap-2 sm:grid-cols-2">
                <div className="rounded-xl border border-edge bg-ink/40 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500">
                    Far / top of map
                  </p>
                  <p className="mt-1 font-bold">{farName}</p>
                </div>
                <div className="rounded-xl border border-edge bg-ink/40 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500">
                    Near / bottom of map
                  </p>
                  <p className="mt-1 font-bold">{nearName}</p>
                </div>
              </div>

              <div className="mb-3 rounded-xl border border-cyan-glow/25 bg-cyan-glow/5 p-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-glow">
                  What to validate
                </p>
                <p className="mt-1 text-base font-bold">
                  {eventInstruction(proposal, {
                    userName: "You",
                    opponentName,
                  })}
                </p>
                <p className="mt-1 text-xs text-zinc-400">
                  Do not mark the serve&apos;s first bounce or a hypothetical
                  bounce. Mark only the named event.
                </p>
              </div>

              <div className="overflow-hidden rounded-xl bg-black">
                {mediaUrl ? (
                  <video
                    ref={videoRef}
                    src={mediaUrl}
                    className="aspect-video w-full"
                    controls
                    playsInline
                    preload="auto"
                    onLoadedMetadata={(event) => {
                      event.currentTarget.playbackRate = playbackSpeed;
                      event.currentTarget.currentTime = targetStart;
                    }}
                    onPlay={() => {
                      playbackCountRef.current += 1;
                    }}
                    onTimeUpdate={(event) => {
                      if (loopEvent && event.currentTarget.currentTime > targetEnd) {
                        event.currentTarget.currentTime = targetStart;
                        void event.currentTarget.play();
                      }
                    }}
                  />
                ) : (
                  <div className="flex aspect-video items-center justify-center text-sm text-zinc-500">
                    {mediaError ?? "Loading protected video…"}
                  </div>
                )}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const video = videoRef.current;
                    if (!video) return;
                    video.currentTime = targetStart;
                    void video.play();
                  }}
                  className="rounded-lg border border-edge px-3 py-2 text-xs"
                >
                  Replay event
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const video = videoRef.current;
                    if (video) video.currentTime -= 1 / 30;
                  }}
                  className="rounded-lg border border-edge px-3 py-2 text-xs"
                >
                  −1 frame
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const video = videoRef.current;
                    if (video) video.currentTime += 1 / 30;
                  }}
                  className="rounded-lg border border-edge px-3 py-2 text-xs"
                >
                  +1 frame
                </button>
                <label className="ml-auto flex items-center gap-2 text-xs text-zinc-400">
                  <input
                    type="checkbox"
                    checked={loopEvent}
                    onChange={(event) => setLoopEvent(event.target.checked)}
                  />
                  Loop event
                </label>
                <select
                  value={playbackSpeed}
                  onChange={(event) => {
                    const speed = Number(event.target.value);
                    setPlaybackSpeed(speed);
                    if (videoRef.current) videoRef.current.playbackRate = speed;
                  }}
                  className="rounded-lg border border-edge bg-surface-2 px-3 py-2 text-xs"
                  aria-label="Playback speed"
                >
                  {[0.1, 0.25, 0.5, 1].map((speed) => (
                    <option key={speed} value={speed}>
                      {speed}×
                    </option>
                  ))}
                </select>
              </div>
            </article>
          </div>

          <aside className="space-y-4">
            <article className="rounded-2xl border border-edge bg-surface/90 p-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-glow">
                Your answer
              </p>
              <h2 className="mt-1 text-lg font-bold">
                Watch first, then mark the truth
              </h2>
              {!label.revealed_at && (
                <p className="mt-1 text-xs text-zinc-400">
                  Both computer predictions are hidden until your answer is
                  saved.
                </p>
              )}

              <div className="mt-4 grid gap-2">
                {RESULT_CHOICES.map((choice) => (
                  <button
                    key={choice.key}
                    type="button"
                    aria-pressed={label.result === choice.key}
                    onClick={() => updateLabel({ result: choice.key })}
                    className={`rounded-xl border p-3 text-left transition ${
                      label.result === choice.key
                        ? "border-cyan-glow bg-cyan-glow/10"
                        : "border-edge bg-surface-2 hover:border-zinc-500"
                    }`}
                  >
                    <p className="text-sm font-bold">{choice.label}</p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {choice.detail}
                    </p>
                  </button>
                ))}
              </div>

              {label.result === "landed" && (
                <div className="mt-4 space-y-4">
                  <PlacementTableEditor
                    nearName={nearName}
                    farName={farName}
                    value={humanPoint}
                    predictions={comparison}
                    onChange={(point) =>
                      updateLabel({
                        table_u: point?.u ?? null,
                        table_v: point?.v ?? null,
                      })
                    }
                  />
                  <OptionButtons<PlacementVisibility>
                    label="How visible was it?"
                    value={label.visibility}
                    choices={[
                      { key: "clear", label: "Clearly visible" },
                      { key: "estimated", label: "Estimated from motion" },
                    ]}
                    onChange={(visibility) => updateLabel({ visibility })}
                  />
                  <OptionButtons<PlacementConfidence>
                    label="How sure are you?"
                    value={label.confidence}
                    choices={[
                      { key: "certain", label: "Certain" },
                      { key: "likely", label: "Likely" },
                      { key: "unsure", label: "Unsure" },
                    ]}
                    onChange={(confidence) => updateLabel({ confidence })}
                  />
                </div>
              )}

              {message && (
                <p className="mt-4 rounded-lg bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
                  {message}
                </p>
              )}

              {!label.revealed_at ? (
                <button
                  type="button"
                  onClick={() => void reveal()}
                  className="mt-4 w-full rounded-xl bg-cyan-glow px-4 py-3 text-sm font-bold text-ink"
                >
                  Save blind answer & reveal comparison
                </button>
              ) : (
                <>
                  {label.post_reveal_edited && (
                    <p className="mt-4 text-xs text-amber-300">
                      This answer was edited after reveal. The original blind
                      answer remains saved for the primary analysis.
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => void submit()}
                    className="mt-4 w-full rounded-xl bg-cyan-glow px-4 py-3 text-sm font-bold text-ink"
                  >
                    Complete & next
                  </button>
                </>
              )}
            </article>

            {label.revealed_at && comparison && (
              <article className="rounded-2xl border border-edge bg-surface/90 p-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-glow">
                  Comparison revealed
                </p>
                <h2 className="mt-1 text-lg font-bold">
                  How far each system was from your mark
                </h2>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <PredictionMetric
                    label="Current · canonical"
                    color="#22d3ee"
                    prediction={comparison.canonical_current}
                    human={humanPoint}
                  />
                  <PredictionMetric
                    label="OpenAI-assisted"
                    color="#fb923c"
                    prediction={comparison.openai}
                    human={humanPoint}
                  />
                  <PredictionMetric
                    label="Legacy current"
                    color="#f472b6"
                    prediction={comparison.legacy_current}
                    human={humanPoint}
                  />
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-zinc-400">
                  <span className="text-white">○ YOU</span>
                  <span className="text-cyan-300">○ C canonical</span>
                  <span className="text-orange-300">○ O OpenAI</span>
                  <span className="text-pink-300">◌ L legacy</span>
                </div>
              </article>
            )}
          </aside>
        </section>
      </div>
    </main>
  );
}
