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
  ATTEMPTED_RETURN_VALUES,
  ENDING_CONFIDENCE_VALUES,
  ENDING_FAMILIES,
  FINAL_HITTERS,
  NET_BEHAVIORS,
  RECEIVING_ZONES,
  hydrateWinnerConstrainedEndingLabel,
  setEndingFamily,
  setServerReview,
  validateWinnerConstrainedEndingLabel,
  type AttemptedReturn,
  type EndingConfidence,
  type EndingFamily,
  type FinalHitter,
  type NetBehavior,
  type ReceivingZone,
  type WinnerConstrainedEndingHumanLabel,
} from "@/lib/research/winnerConstrainedEnding";
import { createClient } from "@/lib/supabase/client";
import type { WinnerConstrainedResearchAssignment } from "./types";
import {
  effectiveServer,
  endingExplanation,
  receiverForServer,
} from "./winnerConstrainedEndingView";

type SaveState = "idle" | "saving" | "saved" | "error";

const ENDING_LABELS: Record<EndingFamily, string> = {
  net: "Hit the net",
  long: "Went long",
  wide: "Went wide",
  clean_winner: "Clean winner / unreturned",
  missed_return: "Tried but missed the ball",
  edge: "Clipped the table edge",
  other: "Other ending",
  unsure: "Unsure",
};

const FINAL_HITTER_LABELS: Record<FinalHitter, string> = {
  server: "Server",
  receiver: "Receiver",
  unknown: "Not visible",
  unsure: "Unsure",
};

const ATTEMPT_LABELS: Record<AttemptedReturn, string> = {
  yes: "Yes",
  no: "No",
  unknown: "Not visible",
  unsure: "Unsure",
};

const NET_LABELS: Record<NetBehavior, string> = {
  died_stuck_lateral: "Stopped, came back, or rolled sideways",
  clipped_continued: "Clipped the net and continued",
  other: "Another net behavior",
  unsure: "Unsure",
};

const ZONE_LABELS: Record<ReceivingZone, string> = {
  forehand: "Forehand",
  backhand: "Backhand",
  middle: "Middle / body",
  unknown: "Unknown",
};

const CONFIDENCE_LABELS: Record<EndingConfidence, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

function firstAssignmentId(assignments: WinnerConstrainedResearchAssignment[]) {
  return (
    assignments.find((item) => item.status !== "submitted")?.id ??
    assignments[0]?.id ??
    null
  );
}

function optionButton(active: boolean) {
  return `rounded-xl border px-3 py-2 text-left text-sm transition ${
    active
      ? "border-cyan-glow bg-cyan-glow/15 text-cyan-50"
      : "border-edge bg-ink/30 text-zinc-300 hover:border-zinc-500"
  }`;
}

export function WinnerConstrainedEndingLabeler({
  initialAssignments,
  isAdmin,
}: {
  initialAssignments: WinnerConstrainedResearchAssignment[];
  isAdmin: boolean;
}) {
  const [assignments, setAssignments] = useState(initialAssignments);
  const [assignmentId, setAssignmentId] = useState<string | null>(() =>
    firstAssignmentId(initialAssignments),
  );
  const assignment =
    assignments.find((item) => item.id === assignmentId) ?? null;
  const [label, setLabel] = useState<WinnerConstrainedEndingHumanLabel>(() =>
    hydrateWinnerConstrainedEndingLabel(assignment?.human_label),
  );
  const [matchFilter, setMatchFilter] = useState("all");
  const [completionFilter, setCompletionFilter] = useState("all");
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const openedAt = useRef(Date.now());
  const playbackCount = useRef(
    assignment?.review_metrics?.playback_count ?? 0,
  );
  const answerChanges = useRef(
    assignment?.review_metrics?.answer_changes ?? 0,
  );
  const supabase = useMemo(() => createClient(), []);

  const completed = assignments.filter(
    (item) => item.status === "submitted",
  ).length;
  const matches = useMemo(
    () =>
      [...new Set(assignments.map((item) => item.source.match_label))].sort(),
    [assignments],
  );
  const visible = useMemo(
    () =>
      assignments.filter(
        (item) =>
          (matchFilter === "all" ||
            item.source.match_label === matchFilter) &&
          (completionFilter === "all" ||
            (completionFilter === "complete"
              ? item.status === "submitted"
              : item.status !== "submitted")),
      ),
    [assignments, completionFilter, matchFilter],
  );

  const updateLabel = useCallback(
    (
      update: (
        current: WinnerConstrainedEndingHumanLabel,
      ) => WinnerConstrainedEndingHumanLabel,
    ) => {
      setLabel((current) => update(current));
      answerChanges.current += 1;
      setDirty(true);
      setSaveState("idle");
      setMessage(null);
    },
    [],
  );

  const saveNow = useCallback(
    async (
      nextLabel: WinnerConstrainedEndingHumanLabel,
      status: WinnerConstrainedResearchAssignment["status"] = "in_progress",
    ) => {
      if (!assignment) return false;
      setSaveState("saving");
      const now = new Date().toISOString();
      const metrics = {
        time_spent_s:
          (assignment.review_metrics?.time_spent_s ?? 0) +
          Math.round((Date.now() - openedAt.current) / 1000),
        playback_count: playbackCount.current,
        answer_changes: answerChanges.current,
        video_completed:
          assignment.review_metrics?.video_completed ?? false,
      };
      const { error } = await supabase
        .from("research_assignments")
        .update({
          status,
          human_label: nextLabel,
          review_metrics: metrics,
          started_at: assignment.started_at ?? now,
          submitted_at: status === "submitted" ? now : null,
        })
        .eq("id", assignment.id);
      if (error) {
        console.error("point-ending research save failed", error);
        setSaveState("error");
        setMessage("Save failed. Your answer is still on this screen.");
        return false;
      }
      openedAt.current = Date.now();
      setDirty(false);
      setSaveState("saved");
      setAssignments((current) =>
        current.map((item) =>
          item.id === assignment.id
            ? {
                ...item,
                status,
                human_label: nextLabel,
                review_metrics: metrics,
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
        const payload = (await response.json()) as {
          url?: string;
          error?: string;
        };
        if (!response.ok || !payload.url) {
          throw new Error(payload.error ?? "Could not load video.");
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

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const goTo = useCallback(
    async (
      next: WinnerConstrainedResearchAssignment | undefined,
      skipSave = false,
    ) => {
      if (!next || !assignment || next.id === assignment.id) return;
      if (dirty && !skipSave) {
        const saved = await saveNow(
          label,
          assignment.status === "submitted" ? "submitted" : "in_progress",
        );
        if (!saved) return;
      }
      setAssignmentId(next.id);
      setLabel(hydrateWinnerConstrainedEndingLabel(next.human_label));
      setDirty(false);
      setSaveState("idle");
      setMessage(null);
      openedAt.current = Date.now();
      playbackCount.current = next.review_metrics?.playback_count ?? 0;
      answerChanges.current = next.review_metrics?.answer_changes ?? 0;
    },
    [assignment, dirty, label, saveNow],
  );

  const submit = async () => {
    if (!assignment) return;
    const missing = validateWinnerConstrainedEndingLabel(label);
    if (missing.length) {
      setMessage(
        "Review the imported server, then complete the ending, final hitter, return attempt, confidence, and net behavior when relevant.",
      );
      return;
    }
    const saved = await saveNow(label, "submitted");
    if (!saved) return;
    const currentIndex = assignments.findIndex(
      (item) => item.id === assignment.id,
    );
    const next =
      assignments
        .slice(currentIndex + 1)
        .find((item) => item.status !== "submitted") ??
      assignments.find((item) => item.status !== "submitted");
    await goTo(next, true);
  };

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
    anchor.download = "ponglens-winner-constrained-endings.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (!assignment) {
    return (
      <main className="min-h-screen bg-arena p-8 text-center text-zinc-100">
        <h1 className="text-2xl font-bold">No point-ending assignments yet</h1>
        <p className="mt-2 text-zinc-400">
          Your account can access research, but this batch is not assigned.
        </p>
        <Link href="/dashboard" className="mt-6 inline-block text-cyan-glow">
          Back to Pong Lens
        </Link>
      </main>
    );
  }

  const proposal = assignment.source.proposal;
  const scoring = proposal.scoring;
  const importedServer = scoring.server;
  const alternateServer = receiverForServer(scoring, importedServer);
  const reviewedServer = effectiveServer(scoring, label);
  const reviewedReceiver = receiverForServer(scoring, reviewedServer);
  const queue = visible.some((item) => item.id === assignment.id)
    ? visible
    : [assignment, ...visible];
  const queueIndex = queue.findIndex((item) => item.id === assignment.id);

  return (
    <main className="min-h-screen bg-arena pb-24 text-zinc-100">
      <header className="sticky top-0 z-40 border-b border-edge bg-ink/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-3 px-4 py-3">
          <div className="mr-auto">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-glow">
              Pong Lens Research
            </p>
            <h1 className="text-xl font-bold">How did the point end?</h1>
          </div>
          <span className="rounded-full border border-edge px-3 py-1 text-xs">
            {completed}/{assignments.length} complete
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

      <div className="mx-auto max-w-[1500px] p-4">
        <nav className="mb-4 grid gap-2 rounded-xl border border-edge bg-surface/80 p-2 md:grid-cols-[1fr_1fr_auto_minmax(210px,1fr)_auto]">
          <select
            value={matchFilter}
            onChange={(event) => setMatchFilter(event.target.value)}
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
            value={completionFilter}
            onChange={(event) => setCompletionFilter(event.target.value)}
            className="rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm"
            aria-label="Filter by completion"
          >
            <option value="all">All review states</option>
            <option value="open">Needs review</option>
            <option value="complete">Complete</option>
          </select>
          <button
            type="button"
            disabled={queueIndex <= 0}
            onClick={() => void goTo(queue[queueIndex - 1])}
            className="rounded-lg border border-edge px-3 py-2 disabled:opacity-30"
          >
            ←
          </button>
          <select
            value={assignment.id}
            onChange={(event) =>
              void goTo(queue.find((item) => item.id === event.target.value))
            }
            className="min-w-0 rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm"
            aria-label="Point-ending review item"
          >
            {queue.map((item) => (
              <option key={item.id} value={item.id}>
                {item.sequence}/{assignments.length} ·{" "}
                {item.source.match_label} · point{" "}
                {item.source.source_point_idx}
                {item.status === "submitted" ? " · complete" : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={queueIndex >= queue.length - 1}
            onClick={() => void goTo(queue[queueIndex + 1])}
            className="rounded-lg border border-edge px-3 py-2 disabled:opacity-30"
          >
            →
          </button>
        </nav>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(410px,.85fr)]">
          <div className="space-y-4">
            <article className="rounded-2xl border border-edge bg-surface/90 p-4">
              <div className="mb-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-glow">
                  {proposal.match.label} · {proposal.match.venue} · source
                  point {assignment.source.source_point_idx}
                </p>
                <h2 className="mt-1 text-xl font-bold">
                  Watch the entire rally, especially the final shot
                </h2>
              </div>
              <div className="overflow-hidden rounded-xl bg-black">
                {mediaUrl ? (
                  <video
                    key={assignment.id}
                    src={mediaUrl}
                    controls
                    playsInline
                    preload="auto"
                    className="aspect-video w-full"
                    onPlay={() => {
                      playbackCount.current += 1;
                    }}
                  />
                ) : (
                  <div className="flex aspect-video items-center justify-center text-sm text-zinc-500">
                    {mediaError ?? "Loading protected video…"}
                  </div>
                )}
              </div>
            </article>

            <article className="rounded-2xl border border-edge bg-surface/90 p-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-magenta-soft">
                Scoring context
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div
                  className={`rounded-xl border p-4 ${
                    label.server_review === "corrected"
                      ? "border-amber-500/40 bg-amber-500/10"
                      : "border-edge bg-ink/35"
                  }`}
                >
                  <p className="text-xs uppercase tracking-wider text-zinc-500">
                    {label.server_review === "corrected"
                      ? "Corrected server"
                      : label.server_review === "unsure"
                        ? "Imported server · uncertain"
                        : "Imported server"}
                  </p>
                  <p className="mt-1 text-lg font-bold">
                    {reviewedServer.name}
                  </p>
                  <p className="text-xs text-zinc-400">
                    {reviewedServer.side} side
                  </p>
                  {label.server_review === "corrected" && (
                    <p className="mt-2 text-xs text-amber-200/80">
                      Imported record said {importedServer.name}.
                    </p>
                  )}
                </div>
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                  <p className="text-xs uppercase tracking-wider text-emerald-300">
                    Confirmed winner
                  </p>
                  <p className="mt-1 text-lg font-bold">
                    {scoring.winner.name}
                  </p>
                  <p className="text-xs text-emerald-100/70">
                    {scoring.winner.side} side
                  </p>
                </div>
              </div>
              <div className="mt-4 rounded-xl border border-edge bg-ink/20 p-3">
                <p className="text-sm font-semibold">
                  Is the imported server correct?
                </p>
                <p className="mt-1 text-xs text-zinc-400">
                  The winner is confirmed from your score. The server was
                  reconstructed from score rotation, so please correct it when
                  the video disagrees.
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <button
                    type="button"
                    onClick={() =>
                      updateLabel((current) => ({
                        ...setServerReview(
                          current,
                          "correct",
                          importedServer.player,
                        ),
                        final_hitter:
                          current.server_review === "correct"
                            ? current.final_hitter
                            : null,
                      }))
                    }
                    className={optionButton(
                      label.server_review === "correct",
                    )}
                  >
                    Yes — {importedServer.name} served
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateLabel((current) => ({
                        ...setServerReview(
                          current,
                          "corrected",
                          importedServer.player,
                          alternateServer.player,
                        ),
                        final_hitter:
                          current.server_review === "corrected"
                            ? current.final_hitter
                            : null,
                      }))
                    }
                    className={optionButton(
                      label.server_review === "corrected",
                    )}
                  >
                    No — {alternateServer.name} served
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateLabel((current) => ({
                        ...setServerReview(
                          current,
                          "unsure",
                          importedServer.player,
                        ),
                        final_hitter:
                          current.server_review === "unsure"
                            ? current.final_hitter
                            : null,
                      }))
                    }
                    className={optionButton(
                      label.server_review === "unsure",
                    )}
                  >
                    Can&apos;t tell
                  </button>
                </div>
              </div>
            </article>
          </div>

          <aside className="space-y-4">
            <article className="rounded-2xl border border-cyan-glow/25 bg-surface/90 p-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-glow">
                1 · Point ending
              </p>
              <h2 className="mt-1 text-lg font-bold">
                What happened on the final shot?
              </h2>
              <p className="mt-1 text-sm text-zinc-400">
                Net, long, and wide always mean {scoring.loser.name}&apos;s
                terminal shot. A clean winner means {scoring.winner.name}&apos;s
                shot was not touched.
              </p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {ENDING_FAMILIES.map((ending) => (
                  <button
                    key={ending}
                    type="button"
                    onClick={() =>
                      updateLabel((current) =>
                        setEndingFamily(current, ending),
                      )
                    }
                    className={optionButton(label.ending_family === ending)}
                  >
                    <span className="font-semibold">
                      {ENDING_LABELS[ending]}
                    </span>
                    <span className="mt-1 block text-xs opacity-70">
                      {endingExplanation(ending, scoring)}
                    </span>
                  </button>
                ))}
              </div>
            </article>

            {label.ending_family === "net" && (
              <article className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300">
                  Net detail
                </p>
                <h2 className="mt-1 text-base font-bold">
                  What did the ball do after touching the net?
                </h2>
                <div className="mt-3 grid gap-2">
                  {NET_BEHAVIORS.map((behavior) => (
                    <button
                      key={behavior}
                      type="button"
                      onClick={() =>
                        updateLabel((current) => ({
                          ...current,
                          net_behavior: behavior,
                        }))
                      }
                      className={optionButton(
                        label.net_behavior === behavior,
                      )}
                    >
                      {NET_LABELS[behavior]}
                    </button>
                  ))}
                </div>
              </article>
            )}

            <article className="rounded-2xl border border-edge bg-surface/90 p-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-magenta-soft">
                2 · Rally details
              </p>
              <div className="mt-3 space-y-4">
                <label className="block text-sm font-semibold">
                  Racket contacts, including the serve
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={label.contact_count ?? ""}
                    onChange={(event) =>
                      updateLabel((current) => ({
                        ...current,
                        contact_count:
                          event.target.value === ""
                            ? null
                            : Number(event.target.value),
                      }))
                    }
                    className="mt-2 w-full rounded-lg border border-edge bg-ink/35 px-3 py-2 font-normal"
                    placeholder="Leave blank if you cannot tell"
                  />
                </label>

                <fieldset>
                  <legend className="text-sm font-semibold">
                    Who hit the final shot?
                  </legend>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {FINAL_HITTERS.map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() =>
                          updateLabel((current) => ({
                            ...current,
                            final_hitter: value,
                          }))
                        }
                        className={optionButton(
                          label.final_hitter === value,
                        )}
                      >
                        {value === "server"
                          ? `Server — ${reviewedServer.name}`
                          : value === "receiver"
                            ? `Receiver — ${reviewedReceiver.name}`
                            : FINAL_HITTER_LABELS[value]}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <fieldset>
                  <legend className="text-sm font-semibold">
                    Did the losing player try to return the final ball?
                  </legend>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {ATTEMPTED_RETURN_VALUES.map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() =>
                          updateLabel((current) => ({
                            ...current,
                            attempted_return: value,
                          }))
                        }
                        className={optionButton(
                          label.attempted_return === value,
                        )}
                      >
                        {ATTEMPT_LABELS[value]}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <label className="block text-sm font-semibold">
                  Where did the final ball reach the receiving player?
                  <select
                    value={label.receiving_zone}
                    onChange={(event) =>
                      updateLabel((current) => ({
                        ...current,
                        receiving_zone: event.target.value as ReceivingZone,
                      }))
                    }
                    className="mt-2 w-full rounded-lg border border-edge bg-ink/35 px-3 py-2 font-normal"
                  >
                    {RECEIVING_ZONES.map((zone) => (
                      <option key={zone} value={zone}>
                        {ZONE_LABELS[zone]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </article>

            <article className="rounded-2xl border border-edge bg-surface/90 p-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
                3 · Confidence and note
              </p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {ENDING_CONFIDENCE_VALUES.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() =>
                      updateLabel((current) => ({
                        ...current,
                        confidence: value,
                      }))
                    }
                    className={optionButton(label.confidence === value)}
                  >
                    {CONFIDENCE_LABELS[value]}
                  </button>
                ))}
              </div>
              <textarea
                value={label.notes}
                onChange={(event) =>
                  updateLabel((current) => ({
                    ...current,
                    notes: event.target.value,
                  }))
                }
                rows={3}
                className="mt-3 w-full rounded-lg border border-edge bg-ink/35 p-3 text-sm"
                placeholder="Optional: describe anything the structured labels missed."
              />
            </article>

            {message && (
              <p
                className={`rounded-xl border p-3 text-sm ${
                  saveState === "error"
                    ? "border-rose-500/30 bg-rose-500/10 text-rose-200"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-100"
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
          </aside>
        </section>
      </div>
    </main>
  );
}
