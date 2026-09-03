"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ServeMissView } from "@/app/admin/uploads/[matchId]/ServeMissView";
import { formatClock, whenLabel } from "@/app/admin/uploads/uploadView";
import { missForPoint, type ServeMissData } from "@/app/admin/uploads/serveMiss";
import { clipPad, effectivePad } from "@/app/match/[id]/clipEdit";
import { cutUrlFor } from "./adminClipUrls";
import { ThemeTape } from "./ThemeTape";
import {
  buildThemeReach,
  cardCutOffset,
  cardWhere,
  reachLine,
  type ThemeCardRow,
  type ThemeRow,
} from "./themeView";

/**
 * Every card noted under a theme, across every match, with the footage.
 *
 * The review list on /admin/uploads/themes answers "what did I write";
 * this answers "show me". They are the same rows and deliberately not the
 * same page: that one is a reading list, and its rows link back to the
 * match so the note can be edited in the place it was made.
 *
 * Two players, because the two questions are different. Expanding a card
 * gives the admin page's own analysis view — muted, drawn on, steppable
 * down to a tenth of speed — which is for seeing WHY one card failed.
 * "Watch them all" runs the theme as a tape through the match page's
 * player, with sound and gestures, which is for seeing whether eleven
 * cards are really the same thing.
 */

const pill =
  "rounded-full border px-3 py-1 text-sm transition-colors whitespace-nowrap";

export function ThemeAnalysis({
  themes,
  rows,
  missByMatch,
}: {
  themes: ThemeRow[];
  rows: ThemeCardRow[];
  /** One match's serve diagnosis, keyed by match id. Missing for any match
   *  processed before the worker wrote one — that costs the drawing on its
   *  cards and nothing else. */
  missByMatch: Record<string, ServeMissData | null>;
}) {
  const reach = useMemo(() => buildThemeReach(themes, rows), [themes, rows]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openCard, setOpenCard] = useState<string | null>(null);
  // A match is either absent (never asked), "asking", "failed", or holds a
  // URL. Collapsing the last two into null is the obvious shortcut and it
  // leaves a card that will never load saying "Loading…" for ever.
  const [cutUrls, setCutUrls] = useState<
    Record<string, string | "asking" | "failed">
  >({});
  const [tape, setTape] = useState<{ themeId: string; index: number } | null>(
    null
  );

  const shown = selectedId
    ? reach.filter((t) => t.id === selectedId)
    : reach;

  // The cut video is signed only when a card on that match is actually
  // opened. Signing all of them up front would be five round trips for a
  // page that is usually read one card at a time.
  const needCut = useCallback(
    (matchId: string) => {
      if (matchId in cutUrls) return;
      setCutUrls((prev) => ({ ...prev, [matchId]: "asking" }));
      void cutUrlFor(matchId).then((url) => {
        setCutUrls((prev) => ({ ...prev, [matchId]: url ?? "failed" }));
      });
    },
    [cutUrls]
  );

  useEffect(() => {
    if (!openCard) return;
    const row = rows.find((r) => r.point_id === openCard);
    if (row) needCut(row.match_id);
  }, [openCard, rows, needCut]);

  const tapeTheme = tape ? reach.find((t) => t.id === tape.themeId) : null;

  if (reach.length === 0) {
    return (
      <p className="mt-8 text-sm text-zinc-500">
        No themes yet. Open an upload, pick a card, and add one there.
      </p>
    );
  }

  return (
    <>
      <div className="mt-6 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setSelectedId(null)}
          className={`${pill} ${
            selectedId
              ? "border-edge text-zinc-400 hover:text-white"
              : "border-cyan-glow/50 bg-cyan-glow/10 text-cyan-glow"
          }`}
        >
          Every theme
        </button>
        {reach.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSelectedId(t.id === selectedId ? null : t.id)}
            className={`${pill} ${
              selectedId === t.id
                ? "border-cyan-glow/50 bg-cyan-glow/10 text-cyan-glow"
                : "border-edge text-zinc-400 hover:text-white"
            }`}
          >
            {t.label}
            <span className="ml-1.5 tabular-nums text-zinc-600">
              {t.matches}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-10 space-y-12">
        {shown.map((theme) => (
          <section key={theme.id}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
              <div>
                <h2 className="text-xl font-semibold text-zinc-100">
                  {theme.label}
                </h2>
                <p className="mt-1 text-sm text-zinc-500">
                  {reachLine(theme)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTape({ themeId: theme.id, index: 0 })}
                className="rounded-full border border-edge px-4 py-1.5 text-sm text-zinc-300 transition-colors hover:border-cyan-glow/40 hover:text-white"
              >
                Watch them all
              </button>
            </div>

            <ul className="mt-4 space-y-2">
              {theme.rows.map((row) => {
                const open = openCard === row.point_id;
                const data = missByMatch[row.match_id] ?? null;
                const miss = missForPoint(data, row);
                const pad = effectivePad(
                  clipPad(row.strictness, row.clip_pads),
                  row.tight_start,
                  row.tight_end
                );
                const offset = cardCutOffset(row, pad.pre);
                const cutState = cutUrls[row.match_id];
                const cutUrl =
                  cutState && cutState !== "asking" && cutState !== "failed"
                    ? cutState
                    : null;
                return (
                  <li
                    key={row.point_id}
                    className="overflow-hidden rounded-2xl border border-edge bg-surface"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setOpenCard(open ? null : row.point_id)
                      }
                      className="block w-full px-4 py-3 text-left transition-colors hover:bg-white/[0.02]"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <p className="text-sm font-medium text-zinc-200">
                          {cardWhere(row)}
                          <span className="ml-2 font-normal tabular-nums text-zinc-500">
                            {formatClock(Number(row.t0))} →{" "}
                            {formatClock(Number(row.t1))}
                          </span>
                        </p>
                        <p className="text-xs text-zinc-500">
                          {whenLabel(row.played_at)}
                        </p>
                      </div>
                      {row.note && (
                        <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-300">
                          {row.note}
                        </p>
                      )}
                      {row.themes.length > 1 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {row.themes
                            .filter((label) => label !== theme.label)
                            .map((label) => (
                              <span
                                key={label}
                                className="rounded-full border border-edge px-2.5 py-0.5 text-xs text-zinc-500"
                              >
                                also {label}
                              </span>
                            ))}
                        </div>
                      )}
                    </button>

                    {open && (
                      <div className="border-t border-edge px-4 pb-4 pt-4">
                        {miss && data && offset !== null ? (
                          <ServeMissView
                            data={data}
                            card={miss}
                            cutOffset={offset}
                            videoUrl={cutUrl}
                          />
                        ) : (
                          <PlainCard
                            row={row}
                            url={cutUrl}
                            offset={offset}
                            failed={cutState === "failed"}
                          />
                        )}
                        <div className="mt-3 flex flex-wrap gap-3">
                          <button
                            type="button"
                            onClick={() =>
                              setTape({
                                themeId: theme.id,
                                index: theme.rows.findIndex(
                                  (r) => r.point_id === row.point_id
                                ),
                              })
                            }
                            className="rounded-full border border-edge px-4 py-1.5 text-sm text-zinc-300 transition-colors hover:border-cyan-glow/40 hover:text-white"
                          >
                            Watch with sound
                          </button>
                          <Link
                            href={`/admin/uploads/${row.match_id}`}
                            className="rounded-full border border-edge px-4 py-1.5 text-sm text-zinc-300 transition-colors hover:border-cyan-glow/40 hover:text-white"
                          >
                            Open the upload
                          </Link>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {tape && tapeTheme && (
        <ThemeTape
          label={tapeTheme.label}
          rows={tapeTheme.rows}
          index={tape.index}
          onIndex={(i) => setTape({ themeId: tapeTheme.id, index: i })}
          onClose={() => setTape(null)}
        />
      )}
    </>
  );
}

/**
 * A card with no serve diagnosis behind it.
 *
 * Native controls on purpose — there is nothing to draw over the picture,
 * so the browser's own transport is better than a worse copy of it. It
 * still opens at the card and stops at its end, which is the only part
 * that has to be told where the card is.
 */
function PlainCard({
  row,
  url,
  offset,
  failed,
}: {
  row: ThemeCardRow;
  url: string | null;
  offset: number | null;
  failed: boolean;
}) {
  const start = offset === null ? null : Number(row.t0) + offset;
  const end = offset === null ? null : Number(row.t1) + offset;

  if (!url) {
    return (
      <div className="flex aspect-video items-center justify-center rounded-lg border border-edge bg-ink/60">
        <p className="text-sm text-zinc-500">
          {!row.has_cut
            ? "This match has no cut video."
            : failed
              ? "Couldn't load this match's video."
              : "Loading…"}
        </p>
      </div>
    );
  }
  return (
    <video
      key={row.point_id}
      src={url}
      controls
      playsInline
      preload="metadata"
      className="w-full rounded-lg bg-black"
      onLoadedMetadata={(e) => {
        if (start !== null) e.currentTarget.currentTime = start;
      }}
      onTimeUpdate={(e) => {
        if (end !== null && e.currentTarget.currentTime >= end) {
          e.currentTarget.pause();
        }
      }}
    />
  );
}
