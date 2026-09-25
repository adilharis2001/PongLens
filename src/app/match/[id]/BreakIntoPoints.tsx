"use client";

/**
 * The two ways to break a video into points, as ONE set of components:
 * "Automatically" (the trim with its preview, the minutes, Process) and
 * "Mark the points yourself" (the Score switch, Start marking). The unprocessed
 * match page renders them in its "Break it into points" card, and a
 * processed match renders the same rows in its More options sheet, so the
 * two places look and behave the same (Cut again, 2026-09-25). Change the
 * rows here, never in one of their hosts.
 *
 * The two ways are one pick-one group (WayChoice, Adil 2026-09-25, option
 * A), with only the selected way's content under it. They used to be two
 * accordions inside the card's own accordion, which did not read as a
 * choice. Neither is selected until the player picks one, and nothing
 * shows under the group until then.
 *
 * Cut strictness is no longer a choice anywhere a player sees (Adil,
 * 2026-09-25): every new run asks for "normal". A match cut before that
 * keeps its stored strictness, which the clip padding still reads.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { AllowanceRecovery } from "@/components/AllowanceRecovery";
import { ProcessingAvailabilityNotice } from "@/components/ProcessingAvailabilityNotice";
import { ProcessingEstimateNote } from "@/components/ProcessingEstimateNote";
import { Switch } from "@/components/Switch";
import { TrimPreview } from "@/components/TrimPreview";
import { minutesUseLine, processWindow } from "@/lib/commerce/minutes";
import { processingExitMessage, type AvailabilityContext } from "@/lib/processingAvailability";
import { createClient } from "@/lib/supabase/client";
import { scoreSwitchCopy, type CutMode } from "./handCut";
import { RadioMark, choiceCellClass } from "./recut/RecutChoice";
import { WAY_ORDER, type RecutWay } from "./recut/recutView";

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

/**
 * Every row the group can show: the two ways, and "Later", which only the
 * upload card offers (it leaves the choice to the match page; Adil,
 * 2026-09-25). The unprocessed page and More options list the two ways.
 */
export type WayRow = RecutWay | "later";

const WAY_TITLE: Record<WayRow, string> = {
  later: "Later",
  automatic: "Automatically",
  hand: "Mark the points yourself",
};

/** The line under each title, on the upload card, the unprocessed page and
 *  in More options alike (as on iOS). */
const WAY_DETAIL: Record<WayRow, string> = {
  later: "Choose on the match page when you're ready.",
  automatic: "We find the rallies and cut them for you.",
  hand: "You mark where each point starts and ends.",
};

/**
 * The two ways as one pick-one group: a radio mark on the left, the title
 * with its one line under it, and a trailing "{N} marked" on the hand
 * row's title line (the minutes are said once, under the button, not here),
 * dressed and laid out like the Replace / Keep cells
 * (RecutChoice) so the product's two choices read as one pattern. No
 * chevrons: nothing here opens, the host shows the selected way's content
 * under the group. Shown only when both ways are on offer
 * (wayChoiceView). The upload card shows the same group with Later first
 * (uploadChoice.ts), so the choice reads the same before and after the
 * upload.
 *
 * A radiogroup in the ARIA pattern: one tab stop on the selected row (on
 * the first usable row while nothing is selected), and the arrow keys move
 * the selection between the rows the player can use.
 */
export function WayChoice<W extends WayRow = RecutWay>({
  label,
  rows = WAY_ORDER as readonly WayRow[] as readonly W[],
  selected,
  onSelect,
  trailing,
  handDisabled = false,
  disabled = false,
  className = "",
}: {
  /** The group's accessible name: the heading it sits under. */
  label: string;
  /** The rows, in order. The two ways unless the host says otherwise (the
   *  upload card puts Later first). */
  rows?: readonly W[];
  /** Null until the player picks (the two match surfaces start that way). */
  selected: W | null;
  onSelect: (way: W) => void;
  trailing: Partial<Record<W, string | null>>;
  /** The hand row shows greyed and cannot be picked. */
  handDisabled?: boolean;
  /** Every row shows greyed and none can be picked (the upload card, once
   *  its button has been pressed). */
  disabled?: boolean;
  className?: string;
}) {
  const refs = useRef<Partial<Record<W, HTMLButtonElement | null>>>({});
  const usable = rows.filter((w) => !disabled && !(w === "hand" && handDisabled));

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step =
      e.key === "ArrowDown" || e.key === "ArrowRight"
        ? 1
        : e.key === "ArrowUp" || e.key === "ArrowLeft"
          ? -1
          : 0;
    if (!step || usable.length === 0) return;
    e.preventDefault();
    const at = selected == null ? -1 : usable.indexOf(selected);
    const next =
      at < 0
        ? usable[step > 0 ? 0 : usable.length - 1]
        : usable[(at + step + usable.length) % usable.length];
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
      {rows.map((way) => {
        const on = selected === way;
        const enabled = !disabled && !(way === "hand" && handDisabled);
        const tabStop = selected == null || !usable.includes(selected) ? usable[0] === way : on;
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
            tabIndex={tabStop ? 0 : -1}
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
 * The window to process and the price, and the balance it is paid from.
 * claim_processing recomputes the same charge server-side, so what the
 * line under the button says is what the balance loses.
 */
export function useProcessQuote({
  durationS,
  minutesBalance,
}: {
  durationS: number | null;
  minutesBalance: number | null;
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
    // Not a player's choice any more (Adil, 2026-09-25). Sent rather than
    // left out because claim_auto_recut takes it as a required argument.
    strictness: "normal" as const,
  });

  return {
    duration, setDuration, learnDuration,
    videoDuration, barDuration: win.barS, barEnd: win.barEndS,
    trimStart, trimEnd, setTrim: (s: number, e: number) => { setTrimStart(s); setTrimEnd(e); },
    resetTrim,
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
 * "Automatically", selected: what to process, with the picture it is cut
 * against (TrimPreview, the same trim the upload card shows), and the
 * button that spends the minutes, with what it spends on the line under
 * it. `choice` sits directly above the button (Replace or Keep, on a
 * processed match). `className` is the host's spacing: the card pads it,
 * the sheet already has its own.
 */
export function AutoProcessPanel({
  quote,
  onProcess,
  busy,
  error,
  preview,
  choice,
  onBalanceChecked,
  actionLabel = "Process",
  columns = false,
  className = "p-5",
}: {
  className?: string;
  /** From `lg` up, two columns: the trim with its preview on the left
   *  (three fifths, so the picture is wide) and the choice, the button and
   *  its minutes on the right. One tree either way, so there is only ever
   *  one preview player. More options on a desktop (Adil, 2026-09-25). */
  columns?: boolean;
  quote: ProcessQuote;
  onProcess: () => void;
  busy: boolean;
  error: string | null;
  /** The video the trim is cut against. `playable` false when the host
   *  already knows this browser cannot play it (the bar shows alone);
   *  `unavailable` is the host's line for a video that is gone. */
  preview: {
    src: string | null;
    playable?: boolean;
    aspect?: number | null;
    unavailable?: ReactNode;
  };
  choice?: ReactNode;
  /** The button: "Process" on the unprocessed page, "Process again" in a
   *  processed match's More options. The minutes are on the line under
   *  it, never on the button. */
  actionLabel?: string;
  /** "Check minutes" read a fresh balance: the host clears its refusal. */
  onBalanceChecked?: () => void;
}) {
  const q = quote;
  const line = minutesUseLine(q.charge, q.availableMinutes, q.minutesShort);
  return (
    <div className={className}>
      <div className={columns ? "lg:flex lg:items-start lg:gap-8" : undefined}>
      {/* No paragraph around the trim. The bar reads 0:00 · 12:04 kept ·
          12:04 under itself and the two buttons say what they do, so a
          sentence explaining them only pushes the handles further from
          the picture they are cut against. */}
      <TrimPreview
        className={columns ? "lg:min-w-0 lg:shrink-0 lg:basis-3/5" : ""}
        src={preview.src}
        playable={preview.playable}
        aspect={preview.aspect}
        unavailable={preview.unavailable}
        onLoadedMetadata={(el) => {
          if (Number.isFinite(el.duration) && el.duration > 0) q.learnDuration(el.duration);
        }}
        label={
          <p className="mb-3 text-sm font-medium text-zinc-200">What to process</p>
        }
        // Drawn on the file's own length, so the bar's end and the
        // player's length are the same number (a 728.99 s file is 12:08
        // in both, not 12:08 over 12:09).
        duration={q.duration == null ? null : q.barDuration ?? q.duration}
        noDuration={
          <p className="text-sm text-zinc-400">
            Play the video once so we can read its length.
          </p>
        }
        start={q.trimStart}
        end={q.barEnd ?? q.duration ?? 0}
        onChange={q.setTrim}
        trimmed={q.trimmed}
        onReset={q.resetTrim}
      />
      {q.duration != null && (
        <div className={columns ? "lg:min-w-0 lg:flex-1" : undefined}>
          {choice && <div className={columns ? "mt-5 lg:mt-0" : "mt-5"}>{choice}</div>}

          {/* Full width (of its column, on a desktop), with what it
              spends under it rather than floating alongside. A hugging
              pill beside a loose sentence was the scrappiest thing on
              this screen. */}
          <div className="mt-6">
            <button
              onClick={onProcess}
              disabled={busy || !q.enough}
              className="glow-cta w-full rounded-full bg-cyan-glow px-5 py-3 text-sm font-semibold text-ink transition-opacity disabled:opacity-40"
            >
              {actionLabel}
            </button>
            {line && (
              <p
                className={`mt-2 w-full text-center text-xs ${
                  line.short ? "text-amber-300/90" : "text-zinc-500"
                }`}
              >
                {line.text}
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
        </div>
      )}
      </div>
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
  columns = false,
  className = "p-5",
}: {
  /** The host's spacing, as on AutoProcessPanel. */
  className?: string;
  /** From `lg` up, the switch in the left three fifths and the button in
   *  the right column, where Automatically keeps its own button, so
   *  neither control stretches across a wide dialog. */
  columns?: boolean;
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
    <div
      className={`${className} ${columns ? "lg:flex lg:items-center lg:gap-8" : ""}`}
    >
      {/* A labelled row with the app's switch, the shape the upload
          card's rows have. */}
      <div
        className={`rounded-xl border border-edge bg-ink/20 ${
          columns ? "lg:min-w-0 lg:shrink-0 lg:basis-3/5" : ""
        }`}
      >
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
      <div className={columns ? "mt-6 lg:mt-0 lg:min-w-0 lg:flex-1" : "mt-6"}>
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
