"use client";

/**
 * The two ways to break a video into points, as ONE set of components:
 * "Automatically" (trim, strictness, minutes, Process) and "Mark the
 * points yourself" (the Score switch, Start marking). The unprocessed
 * match page renders them in its "Break it into points" card, and a
 * processed match renders the same rows in its More options sheet, so the
 * two places look and behave the same (Cut again, 2026-09-25). Change the
 * rows here, never in one of their hosts.
 */

import { useCallback, useEffect, useState, type ReactNode, type RefObject } from "react";
import { AllowanceRecovery } from "@/components/AllowanceRecovery";
import { ProcessingAvailabilityNotice } from "@/components/ProcessingAvailabilityNotice";
import { ProcessingEstimateNote } from "@/components/ProcessingEstimateNote";
import { Switch } from "@/components/Switch";
import { TrimBar } from "@/components/TrimBar";
import { chargeMinutes, formatMinutes } from "@/lib/commerce/minutes";
import { processingExitMessage, type AvailabilityContext } from "@/lib/processingAvailability";
import { createClient } from "@/lib/supabase/client";
import { scoreSwitchCopy, type CutMode } from "./handCut";

export type Strictness = "tight" | "normal" | "loose";

/** The chevron an accordion row in this card turns when it opens. */
export function ExpandChevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform ${
        open ? "rotate-180" : ""
      }`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
    </svg>
  );
}

/**
 * One of the two ways, as a row that opens in place. `detail` is the
 * unprocessed page's line under the title; the More options sheet carries
 * none (no explanations there, per the Cut again spec).
 */
export function AccordionRow({
  title,
  detail,
  trailing,
  open,
  onToggle,
  bordered = false,
  disabled,
}: {
  title: string;
  detail?: string;
  trailing?: ReactNode;
  open: boolean;
  onToggle: () => void;
  bordered?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      disabled={disabled}
      className={`flex w-full items-center gap-3 ${
        bordered ? "border-t border-edge/60 " : ""
      }p-5 text-left transition-colors hover:bg-ink/20 disabled:opacity-40`}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-zinc-100">{title}</span>
        {detail && <span className="mt-0.5 block text-xs text-zinc-500">{detail}</span>}
      </span>
      {trailing != null && trailing !== "" && (
        <span className="shrink-0 text-sm font-semibold tabular-nums text-zinc-300">
          {trailing}
        </span>
      )}
      <ExpandChevron open={open} />
    </button>
  );
}

/**
 * The window to process, the strictness and the price, and the balance it
 * is paid from. claim_processing recomputes the same charge server-side,
 * so what the button says is what the balance loses.
 */
export function useProcessQuote({
  durationS,
  minutesBalance,
  videoRef,
}: {
  durationS: number | null;
  minutesBalance: number | null;
  /** The picture the stamps read. Without one there is nothing to stamp
   *  against, and the buttons do not show. */
  videoRef?: RefObject<HTMLVideoElement | null>;
}) {
  const [duration, setDuration] = useState<number | null>(durationS);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState<number | null>(durationS);
  const [strictness, setStrictness] = useState<Strictness>("normal");
  const [availableMinutes, setAvailableMinutes] = useState(minutesBalance);
  const [minutesShort, setMinutesShort] = useState(false);
  useEffect(() => { setAvailableMinutes(minutesBalance); }, [minutesBalance]);

  /** The player read the length the row did not have. */
  const learnDuration = useCallback((d: number) => {
    setDuration((prev) => prev ?? d);
    setTrimEnd((prev) => prev ?? d);
  }, []);

  const stampStart = () => {
    const t = videoRef?.current?.currentTime ?? 0;
    setTrimStart(Math.min(t, (trimEnd ?? duration ?? t) - 5));
  };
  const stampEnd = () => {
    const t = videoRef?.current?.currentTime ?? 0;
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
    charge != null && availableMinutes != null && availableMinutes >= charge && !minutesShort;

  /** The body /api/process takes, bar the match. */
  const request = () => ({
    trimStartS: trimmed ? trimStart : null,
    trimEndS: trimmed ? trimEnd : null,
    points: true,
    // The detailed analysis rides on the same run for nothing
    // (the ball is detected and the table found for the cut anyway);
    // generating it later re-detects the whole video.
    placement: true,
    strictness,
  });

  return {
    duration, setDuration, learnDuration,
    trimStart, trimEnd, setTrim: (s: number, e: number) => { setTrimStart(s); setTrimEnd(e); },
    stampStart, stampEnd, resetTrim, canStamp: !!videoRef,
    videoRef,
    strictness, setStrictness,
    availableMinutes, setAvailableMinutes, minutesShort, setMinutesShort,
    charge, trimmed, enough, request,
  };
}

export type ProcessQuote = ReturnType<typeof useProcessQuote>;

/**
 * POST /api/process for one match. Resolves the new job, or the refusal's
 * code for processErrorMessage.
 */
export async function postProcess(
  matchId: string,
  body: ReturnType<ProcessQuote["request"]>,
): Promise<{ ok: true; jobId: string } | { ok: false; code: string | null }> {
  try {
    const res = await fetch("/api/process", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ matchId, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, code: typeof data.code === "string" ? data.code : null };
    return { ok: true, jobId: data.job_id };
  } catch {
    return { ok: false, code: null };
  }
}

/**
 * "Automatically", opened: what to process, how strictly, and the button
 * that spends the minutes. `picture` sits above the trim bar when the host
 * has no video of its own on screen; `choice` sits directly above the
 * button (Replace or Keep, on a processed match).
 */
export function AutoProcessPanel({
  quote,
  onProcess,
  busy,
  error,
  picture,
  choice,
  onBalanceChecked,
}: {
  quote: ProcessQuote;
  onProcess: () => void;
  busy: boolean;
  error: string | null;
  picture?: ReactNode;
  choice?: ReactNode;
  /** "Check minutes" read a fresh balance: the host clears its refusal. */
  onBalanceChecked?: () => void;
}) {
  const q = quote;
  return (
    <div className="border-t border-edge/60 p-5">
      {picture}
      {q.duration == null ? (
        <p className="text-sm text-zinc-400">
          Play the video once so we can read its length.
        </p>
      ) : (
        <>
          {/* No paragraph here. The bar reads 0:00 · 12:04 kept · 12:04
              under itself and the two buttons say what they do, so a
              sentence explaining them only pushes the handles further
              from the picture they are cut against. */}
          <p className="text-sm font-medium text-zinc-200">
            What to process
          </p>
          <div className="mt-3" />
          <TrimBar
            duration={q.duration}
            start={q.trimStart}
            end={q.trimEnd ?? q.duration}
            onChange={q.setTrim}
            onScrub={(t) => {
              if (q.videoRef?.current) q.videoRef.current.currentTime = t;
            }}
          />

          {(q.canStamp || q.trimmed) && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {q.canStamp && (
                <>
                  <button
                    onClick={q.stampStart}
                    className="rounded-full border border-edge px-3.5 py-1.5 text-sm text-zinc-300 hover:border-zinc-500"
                  >
                    Start here
                  </button>
                  <button
                    onClick={q.stampEnd}
                    className="rounded-full border border-edge px-3.5 py-1.5 text-sm text-zinc-300 hover:border-zinc-500"
                  >
                    End here
                  </button>
                </>
              )}
              {q.trimmed && (
                <button
                  onClick={q.resetTrim}
                  className="ml-auto text-sm text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
                >
                  Reset
                </button>
              )}
            </div>
          )}

          {/* Same shape as the upload sheet's options: a labelled row
              with a switch, not a pill that hides what it means. */}
          <div className="mt-5 divide-y divide-edge/60 rounded-xl border border-edge bg-ink/20">
            <div className="p-3.5">
              <p className="text-sm text-zinc-200">Cut strictness</p>
              <p className="mt-0.5 text-xs text-zinc-500">
                How much room to leave around each point.
              </p>
              <div className="mt-2.5 grid grid-cols-3 gap-1 rounded-lg border border-edge bg-ink/40 p-1">
                {(["tight", "normal", "loose"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => q.setStrictness(s)}
                    aria-pressed={q.strictness === s}
                    className={`rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
                      q.strictness === s
                        ? "bg-cyan-glow text-ink"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {s === "tight"
                      ? "Tight"
                      : s === "loose"
                        ? "Loose"
                        : "Normal"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {choice && <div className="mt-5">{choice}</div>}

          {/* Full width, with the balance under it rather than
              floating alongside. A hugging pill beside a loose
              sentence was the scrappiest thing on this screen. */}
          <div className="mt-6">
            <button
              onClick={onProcess}
              disabled={busy || !q.enough}
              className="glow-cta w-full rounded-full bg-cyan-glow px-5 py-3 text-sm font-semibold text-ink transition-opacity disabled:opacity-40"
            >
              {q.charge != null ? `Process · ${q.charge} min` : "Process"}
            </button>
            {q.availableMinutes != null && (
              <p
                className={`mt-2 w-full text-center text-xs ${
                  q.enough ? "text-zinc-500" : "text-amber-300/90"
                }`}
              >
                {q.enough
                  ? `${formatMinutes(q.availableMinutes)} left`
                  : `Not enough minutes. You have ${formatMinutes(q.availableMinutes)}.`}
              </p>
            )}
            {q.charge != null && q.availableMinutes != null && !q.enough && (
              <AllowanceRecovery resource="minutes" retryLabel="Check minutes" onRetry={async () => {
                const { data, error } = await createClient().rpc("my_processing_state").single();
                const state = data as { minutes_balance?: number } | null;
                if (error || typeof state?.minutes_balance !== "number") throw new Error("Balance unavailable");
                q.setAvailableMinutes(state.minutes_balance);
                q.setMinutesShort(false);
                onBalanceChecked?.();
              }} />
            )}
          </div>
        </>
      )}
      {error && <p className="mt-3 text-sm text-amber-300/90">{error}</p>}
    </div>
  );
}

/**
 * "Mark the points yourself", opened: the Score switch and the button into
 * the marker. The switch's label names the pass ("Cut and score" / "Cut
 * only") with one line under it (Adil, 2026-09-25); practice and drills
 * show it off and greyed, and the line gives the reason.
 */
export function MarkYourselfPanel({
  mode,
  scoringAllowed,
  onMode,
  resume,
  opening,
  onStart,
}: {
  mode: CutMode;
  scoringAllowed: boolean;
  onMode: (mode: CutMode) => void;
  /** There are marks to go back to: "Keep marking". */
  resume: boolean;
  opening: boolean;
  onStart: () => void;
}) {
  const copy = scoreSwitchCopy(mode, scoringAllowed);
  return (
    <div className="border-t border-edge/60 p-5">
      {/* Same shape as Cut strictness: a labelled row with the app's
          switch. */}
      <div className="rounded-xl border border-edge bg-ink/20">
        <div className="flex items-center gap-3 p-3.5">
          <span className="min-w-0 flex-1">
            <span
              className={`block text-sm ${
                scoringAllowed ? "text-zinc-200" : "text-zinc-500"
              }`}
            >
              {copy.label}
            </span>
            <span className="mt-0.5 block text-xs text-zinc-500">
              {copy.line}
            </span>
          </span>
          <Switch
            on={mode === "score"}
            onChange={(on) => onMode(on ? "score" : "cut")}
            label={scoringAllowed ? "Cut and score" : "Cut and score, matches only"}
            disabled={!scoringAllowed}
          />
        </div>
      </div>
      <div className="mt-6">
        <button
          type="button"
          onClick={onStart}
          disabled={opening}
          className="glow-cta w-full rounded-full bg-cyan-glow px-5 py-3 text-sm font-semibold text-ink transition-opacity disabled:opacity-40"
        >
          {resume ? "Keep marking" : "Start marking"}
        </button>
      </div>
    </div>
  );
}

/**
 * A cut running on this match: its stage, its progress and when it will be
 * ready. The unprocessed page shows it in its own card; a processed match
 * being cut again shows it in More options, with the current cut still
 * playing above.
 */
export function ProcessingProgress({
  className,
  serviceNotice,
  serviceState,
  availabilityContext,
  label,
  progress,
  estimate,
  jobStatus,
  cameraWarning,
}: {
  className: string;
  /** A lane is down: the notice replaces the progress. */
  serviceNotice: boolean;
  serviceState: string | undefined;
  availabilityContext: AvailabilityContext;
  label: string | null;
  progress: number | null;
  estimate: unknown;
  jobStatus: string | null;
  cameraWarning?: string | null;
}) {
  return (
    <section className={className}>
      {serviceNotice ? <ProcessingAvailabilityNotice state={serviceState} context={availabilityContext} className="" /> : <>
      <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
        {label ?? "Processing"}
      </h2>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-cyan-400 transition-all"
          style={{ width: `${Math.max(4, progress ?? 0)}%` }}
        />
      </div>
      <p className="mt-3 text-sm text-zinc-400">
        {processingExitMessage(availabilityContext)}
      </p>
      <ProcessingEstimateNote estimate={estimate} jobStatus={jobStatus} serviceState={serviceState} />
      </>}
      {cameraWarning && <p className="mt-3 text-sm text-amber-300/90">{cameraWarning}</p>}
    </section>
  );
}
