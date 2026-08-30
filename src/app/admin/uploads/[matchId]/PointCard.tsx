"use client";

import { useState } from "react";
import type { Point } from "@/lib/types";
import type { ServeInfo } from "../../../match/[id]/serving";
import {
  effectiveEnd,
  paddedEnd,
  type ClipPad,
  type EndOptions,
} from "../../../match/[id]/playhead";
import {
  formatClock,
  gapLabel,
  pointFlags,
  type UploadPointRow,
} from "../uploadView";
import { reasonShort, reasonTone, type MissCard, type ServeMissData } from "../serveMiss";
import { CardReview, type Theme } from "./CardReview";
import { ServeMissView } from "./ServeMissView";

/**
 * One card, as the owner sees it plus what the machine did to make it.
 *
 * It MIRRORS the owner's point row rather than importing it. That row is
 * 280 lines of inline JSX inside MatchView, bound to about fifteen of its
 * closures, and every control on it writes to the owner's rows — which an
 * admin has neither the column grant nor the business to do. Copying the
 * shell and dropping the controls is the honest version; the alternative
 * is a shared component with fifteen props that do nothing here.
 *
 * The whole card is the tap target and nothing inside it is. The row this
 * replaces carried ten 10px label buttons and a bare grey "Play" text
 * link, which together made it 590px wide on a 393px phone — the Play
 * button was off the side of the screen and could not be reached at all.
 */

export function PointCard({
  row,
  serve,
  names,
  pad,
  ends,
  playable,
  selected = false,
  compact = false,
  showAnalysis = true,
  onPlay,
  miss,
  missData,
  cutOffset,
  videoUrl,
  review,
  vocabulary,
  onNoteChange,
  onThemeToggle,
  onThemeCreated,
}: {
  row: UploadPointRow;
  serve: ServeInfo | null;
  /** Whose match this is and who they played. An admin is looking at
   *  somebody else's upload, so "their serve" names nobody — the two
   *  sides have to be said out loud. */
  names: { user: string; opponent: string };
  pad: ClipPad;
  ends: EndOptions;
  playable: boolean;
  /** Drawn as the current card, when a pane beside the list is showing it. */
  selected?: boolean;
  /** The list is an INDEX, not the work: beside a pane that repeats every
   *  fact in full, a card only needs enough to pick it out. Dropping the
   *  gap and the flags here takes a card from four wrapped lines to two,
   *  which is the difference between seeing three cards and seeing eight. */
  compact?: boolean;
  /** Whether this card may expand its own evidence. False on a laptop,
   *  where the pane beside the list owns it — two players of the same
   *  rally, side by side, is the failure mode. */
  showAnalysis?: boolean;
  onPlay: () => void;
  /** Why this card was built with no serve. Absent on a card that has one,
   *  and on every match with no diagnosis written for it. */
  miss?: MissCard | null;
  missData?: ServeMissData | null;
  cutOffset?: number | null;
  videoUrl?: string | null;
  /** The operator's note and themes for this card. Only rendered where the
   *  list owns the expansion — on a laptop the pane holds it instead. */
  review?: { note: string; themeIds: string[] } | null;
  vocabulary?: Theme[];
  onNoteChange?: (pointId: string, body: string) => void;
  onThemeToggle?: (pointId: string, themeId: string, on: boolean) => void;
  onThemeCreated?: (theme: Theme) => void;
}) {
  const [openMiss, setOpenMiss] = useState(false);
  const flags = pointFlags(row);
  const gap = gapLabel(row.gapBeforeS);

  // How much of the clip the player will actually show. effectiveEnd is
  // the same function the owner's player uses, so a difference here is a
  // real difference in what they get — never a second opinion about it.
  const padded = paddedEnd(row as unknown as Point, pad);
  const effective = effectiveEnd(row as unknown as Point, pad, ends);
  const trimmedS =
    padded !== null && effective !== null && effective < padded
      ? padded - effective
      : 0;

  const outcome = row.is_let
    ? { label: "Skipped", tone: "text-zinc-400" }
    : row.confirmed_winner === "user"
      ? { label: "Won", tone: "text-emerald-300" }
      : row.confirmed_winner === "opponent"
        ? { label: "Lost", tone: "text-fuchsia-300" }
        : { label: "Not scored", tone: "text-zinc-500" };

  return (
    <li>
      <button
        type="button"
        onClick={onPlay}
        disabled={!playable}
        className={`flex w-full items-center gap-2.5 rounded-xl border bg-surface text-left transition-colors ${
          compact ? "px-3 py-2" : "p-4"
        } ${
          selected ? "border-cyan-glow/70" : "border-edge"
        } ${playable && !selected ? "hover:border-cyan-glow/40" : ""} ${
          playable ? "" : "cursor-default"
        } ${row.deleted ? "opacity-60" : ""}`}
      >
        <span
          className={`flex shrink-0 items-center justify-center rounded-full font-medium tabular-nums ${
            compact ? "h-6 w-6 text-xs" : "h-9 w-9 text-sm"
          } ${
            row.deleted
              ? "bg-surface-2 text-zinc-600"
              : "bg-surface-2 text-zinc-300"
          }`}
        >
          {row.displayNo ?? "–"}
        </span>

        <span className="min-w-0 flex-1">
          {/* What the owner sees */}
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span
              className={`font-medium ${compact ? "text-xs" : "text-sm"} ${outcome.tone}`}
            >
              {outcome.label}
            </span>
            {serve?.server && (
              <span
                className={`truncate text-zinc-500 ${compact ? "text-xs" : "text-sm"}`}
              >
                {serve.server === "user" ? names.user : names.opponent} served
              </span>
            )}
            {review && (review.note || review.themeIds.length > 0) && (
              <span
                className={compact ? "text-xs text-cyan-glow" : "text-sm text-cyan-glow"}
                title="Reviewed"
              >
                ✎
              </span>
            )}
            {row.starred && (
              <span className={compact ? "text-xs text-cyan-glow" : "text-sm text-cyan-glow"}>
                ★
              </span>
            )}
            {row.notes > 0 && !compact && (
              <span className="text-sm text-zinc-500">
                {row.notes} {row.notes === 1 ? "note" : "notes"}
              </span>
            )}
          </span>

          {/* What the machine did. Wraps rather than truncating: on a
              phone a truncated diagnostic is the same as no diagnostic. */}
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
            <span className="tabular-nums">
              {formatClock(row.t0)} → {formatClock(row.t1)}
            </span>
            <span className="tabular-nums">{row.lengthS.toFixed(1)}s</span>
            {gap && !compact && <span className="tabular-nums">{gap}</span>}
            {trimmedS >= 0.1 && !compact && (
              <span className="tabular-nums text-cyan-glow/80">
                {trimmedS.toFixed(1)}s trimmed
              </span>
            )}
            {miss &&
              (typeof miss.serve_s === "number" ? (
                <span className="rounded border border-edge px-1.5 py-px text-zinc-400">
                  serve +{(miss.serve_s - row.t0).toFixed(1)}s
                </span>
              ) : (
                <span
                  className="rounded border px-1.5 py-px"
                  style={{
                    borderColor: `${reasonTone(miss.why.reason)}66`,
                    color: reasonTone(miss.why.reason),
                  }}
                >
                  no serve: {reasonShort(miss.why.reason)}
                </span>
              ))}
            {(compact ? [] : flags).map((f) => (
              <span
                key={f.label}
                className={
                  f.tone === "warn"
                    ? "rounded border border-amber-400/40 px-1.5 py-px text-amber-300"
                    : "rounded border border-edge px-1.5 py-px text-zinc-500"
                }
              >
                {f.label}
              </span>
            ))}
          </span>
        </span>

        {playable && !compact && (
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5 shrink-0 text-zinc-600"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      {showAnalysis && (
        <div className="mt-1">
          <button
            type="button"
            onClick={() => setOpenMiss((v) => !v)}
            className="rounded-full border border-edge px-3 py-1 text-xs text-zinc-400 transition-colors hover:text-white"
          >
            {openMiss
              ? "Close"
              : miss && missData
                ? typeof miss.serve_s === "number"
                  ? "Show the ball"
                  : "Why no serve"
                : "Add a note"}
          </button>
          {openMiss && (
            <>
              {miss && missData && (
                <ServeMissView
                  data={missData}
                  card={miss}
                  cutOffset={cutOffset ?? 0}
                  videoUrl={videoUrl ?? null}
                />
              )}
              {review && vocabulary && onNoteChange && onThemeToggle &&
                onThemeCreated && (
                  <CardReview
                    pointId={row.id}
                    note={review.note}
                    themeIds={review.themeIds}
                    vocabulary={vocabulary}
                    onNoteChange={onNoteChange}
                    onThemeToggle={onThemeToggle}
                    onThemeCreated={onThemeCreated}
                  />
                )}
            </>
          )}
        </div>
      )}
    </li>
  );
}
