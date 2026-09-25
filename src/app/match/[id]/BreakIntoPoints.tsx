"use client";

/**
 * The two ways to break a video into points, as ONE set of components:
 * "Automatically" (trim, strictness, minutes, Process) and "Mark the
 * points yourself" (the Score switch, Start marking). The unprocessed
 * match page renders them in its "Break it into points" card, and a
 * processed match renders the same rows in its More options sheet, so the
 * two places look and behave the same (Cut again, 2026-09-25). Change the
 * rows here, never in one of their hosts.
 *
 * The two ways are one pick-one group (WayChoice, Adil 2026-09-25, option
 * A), with only the selected way's content under it. They used to be two
 * accordions inside the card's own accordion, which did not read as a
 * choice.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { AllowanceRecovery } from "@/components/AllowanceRecovery";
import { ProcessingAvailabilityNotice } from "@/components/ProcessingAvailabilityNotice";
import { ProcessingEstimateNote } from "@/components/ProcessingEstimateNote";
import { Switch } from "@/components/Switch";
import { TrimBar } from "@/components/TrimBar";
import { formatMinutes, processWindow } from "@/lib/commerce/minutes";
import { processingExitMessage, type AvailabilityContext } from "@/lib/processingAvailability";
import { createClient } from "@/lib/supabase/client";
import { clock as playerClock } from "./ClipPlayer";
import { scoreSwitchCopy, type CutMode } from "./handCut";
import { RadioMark, choiceCellClass } from "./recut/RecutChoice";
import { WAY_ORDER, type RecutWay } from "./recut/recutView";

export type Strictness = "tight" | "normal" | "loose";

/** The chevron the "Break it into points" card turns when it opens. */
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

const WAY_TITLE: Record<RecutWay, string> = {
  automatic: "Automatically",
  hand: "Mark the points yourself",
};

/** The line under each title, on the unprocessed page and in More options
 *  alike (as on iOS). */
const WAY_DETAIL: Record<RecutWay, string> = {
  automatic: "We find the rallies and cut them for you.",
  hand: "You mark where each point starts and ends.",
};

/**
 * The two ways as one pick-one group: a radio mark on the left, the title
 * with its one line under it, and the trailing minutes or "{N} marked" on
 * the title's line, dressed and laid out like the Replace / Keep cells
 * (RecutChoice) so the product's two choices read as one pattern. No
 * chevrons: nothing here opens, the host shows the selected way's content
 * under the group. Shown only when both ways are on offer
 * (wayChoiceView).
 *
 * A radiogroup in the ARIA pattern: one tab stop on the selected row, and
 * the arrow keys move the selection between the rows the player can use.
 */
export function WayChoice({
  label,
  selected,
  onSelect,
  trailing,
  handDisabled = false,
  className = "",
}: {
  /** The group's accessible name: the heading it sits under. */
  label: string;
  selected: RecutWay;
  onSelect: (way: RecutWay) => void;
  trailing: Partial<Record<RecutWay, string | null>>;
  /** The hand row shows greyed and cannot be picked. */
  handDisabled?: boolean;
  className?: string;
}) {
  const refs = useRef<Partial<Record<RecutWay, HTMLButtonElement | null>>>({});
  const usable = WAY_ORDER.filter((w) => !(w === "hand" && handDisabled));

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step =
      e.key === "ArrowDown" || e.key === "ArrowRight"
        ? 1
        : e.key === "ArrowUp" || e.key === "ArrowLeft"
          ? -1
          : 0;
    if (!step || usable.length < 2) return;
    e.preventDefault();
    const at = Math.max(0, usable.indexOf(selected));
    const next = usable[(at + step + usable.length) % usable.length];
    onSelect(next);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={`grid gap-2.5 ${className}`}
    >
      {WAY_ORDER.map((way) => {
        const on = selected === way;
        const enabled = !(way === "hand" && handDisabled);
        const trail = trailing[way];
        return (
          <button
            key={way}
            ref={(el) => {
              refs.current[way] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            disabled={!enabled}
            onClick={() => onSelect(way)}
            className={`flex w-full items-start gap-3 text-left outline-none focus-visible:border-cyan-glow ${choiceCellClass(on, enabled)}`}
          >
            <RadioMark on={on} />
            <span className="min-w-0 flex-1">
              <span className={`block text-sm font-semibold ${on ? "text-cyan-glow" : "text-zinc-100"}`}>
                {WAY_TITLE[way]}
              </span>
              <span className="mt-0.5 block text-xs text-zinc-500">{WAY_DETAIL[way]}</span>
            </span>
            {trail && (
              <span className="shrink-0 text-sm font-semibold tabular-nums text-zinc-300">
                {trail}
              </span>
            )}
          </button>
        );
      })}
    </div>
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
  /** The stored length (the player's reading when the row has none):
   *  what claim_processing charges from. */
  const [duration, setDuration] = useState<number | null>(durationS);
  /** The length the player itself read, which the trim bar is drawn on
   *  (processWindow). Null until the metadata arrives. */
  const [videoDuration, setVideoDuration] = useState<number | null>(null);
  const [trimStart, setTrimStart] = useState(0);
  /** Where the end handle was put; null while it sits at the end. */
  const [trimEnd, setTrimEnd] = useState<number | null>(null);
  const [strictness, setStrictness] = useState<Strictness>("normal");
  const [availableMinutes, setAvailableMinutes] = useState(minutesBalance);
  const [minutesShort, setMinutesShort] = useState(false);
  useEffect(() => { setAvailableMinutes(minutesBalance); }, [minutesBalance]);

  /** The player read the file's length: the bar takes it, and it stands in
   *  for a length the row did not have. */
  const learnDuration = useCallback((d: number) => {
    setDuration((prev) => prev ?? d);
    setVideoDuration(d);
  }, []);

  const win = processWindow({
    storedS: duration,
    videoS: videoDuration,
    trimStartS: trimStart,
    trimEndS: trimEnd,
  });

  const stampStart = () => {
    const t = videoRef?.current?.currentTime ?? 0;
    setTrimStart(Math.min(t, (win.barEndS ?? t) - 5));
  };
  const stampEnd = () => {
    const t = videoRef?.current?.currentTime ?? 0;
    setTrimEnd(Math.max(t, trimStart + 5));
  };
  const resetTrim = () => {
    setTrimStart(0);
    setTrimEnd(null);
  };

  const { charge, trimmed } = win;
  const enough =
    charge != null && availableMinutes != null && availableMinutes >= charge && !minutesShort;

  /** The body /api/process takes, bar the match. */
  const request = () => ({
    trimStartS: win.requestStartS,
    trimEndS: win.requestEndS,
    points: true,
    // The detailed analysis rides on the same run for nothing
    // (the ball is detected and the table found for the cut anyway);
    // generating it later re-detects the whole video.
    placement: true,
    strictness,
  });

  return {
    duration, setDuration, learnDuration,
    videoDuration, barDuration: win.barS, barEnd: win.barEndS,
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
 * "Automatically", selected: what to process, how strictly, and the button
 * that spends the minutes. `picture` sits above the trim bar when the host
 * has no video of its own on screen; `choice` sits directly above the
 * button (Replace or Keep, on a processed match). `className` is the
 * host's spacing: the card pads it, the sheet already has its own.
 */
export function AutoProcessPanel({
  quote,
  onProcess,
  busy,
  error,
  picture,
  choice,
  onBalanceChecked,
  actionLabel = "Process",
  className = "p-5",
}: {
  className?: string;
  quote: ProcessQuote;
  onProcess: () => void;
  busy: boolean;
  error: string | null;
  picture?: ReactNode;
  choice?: ReactNode;
  /** The button's verb: "Process" on the unprocessed page, "Process
   *  again" in a processed match's More options. The minutes follow it. */
  actionLabel?: string;
  /** "Check minutes" read a fresh balance: the host clears its refusal. */
  onBalanceChecked?: () => void;
}) {
  const q = quote;
  return (
    <div className={className}>
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
            duration={q.barDuration ?? q.duration}
            start={q.trimStart}
            end={q.barEnd ?? q.duration}
            onChange={q.setTrim}
            onScrub={(t) => {
              if (q.videoRef?.current) q.videoRef.current.currentTime = t;
            }}
            // Drawn on the file's own length and written the way the
            // player above writes it, so the bar's end and the player's
            // length are the same number (a 728.99 s file is 12:08 in
            // both, not 12:08 over 12:09).
            clock={playerClock}
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
              {q.charge != null ? `${actionLabel} · ${q.charge} min` : actionLabel}
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
 * "Mark the points yourself", selected: the Score switch and the button
 * into the marker. The switch's label names the pass ("Cut and score" /
 * "Cut only") with one line under it (Adil, 2026-09-25); practice and
 * drills show it off and greyed, and the line gives the reason.
 */
export function MarkYourselfPanel({
  mode,
  scoringAllowed,
  onMode,
  resume,
  opening,
  onStart,
  className = "p-5",
}: {
  /** The host's spacing, as on AutoProcessPanel. */
  className?: string;
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
    <div className={className}>
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
