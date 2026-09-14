"use client";

import {
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { createClient } from "@/lib/supabase/client";
import {
  endAt,
  normaliseSplits,
  personAtEnd,
  segmentBounds,
  segmentCount,
  withEndAt,
  type CardScore,
  type EndName,
  type LabelPatch,
  type PlayheadHandle,
  type PointLabel,
} from "../pointLabels";

/**
 * What this card SHOULD have been, filed by the person watching it.
 *
 * The four answers the pipeline gets wrong often enough to be worth
 * teaching: which end served, which end won, where one card is really two
 * points, and where two cards are really one. None of it edits the
 * player's match — these are training rows, the same shape as the event
 * labels on the bounces.
 *
 * Saving is a tap with no Save button, exactly as the note box and the
 * themes work: the answer goes in optimistically and comes back out if
 * the write fails, because going through nine hundred cards means
 * answering and moving on.
 *
 * Every button names an END, and the player's name rides along only where
 * this point's game is known. An end cannot go stale at a changeover; a
 * stored "Adil" would be wrong for half the match.
 */

export function PointLabels({
  pointId,
  label,
  onPatch,
  names,
  sideThisGame,
  detectedServerEnd = null,
  rotationServerEnd = null,
  ownerWinnerEnd = null,
  scores = null,
  unmarked = 0,
  cardT0,
  cardT1,
  playhead,
  hasNext,
  cardNumber,
  continuesFromPrev = false,
}: {
  pointId: string;
  label: PointLabel;
  /** Applied to the caller's state straight away; this component puts it
   *  back itself if the database refuses. */
  onPatch: (pointId: string, patch: LabelPatch) => void;
  names: { user: string; opponent: string };
  /** The uploader's end for THIS point's game — physicalSideForGame, never
   *  the raw matches.user_side. Null on a match whose games are unknown,
   *  which costs the names and nothing else. */
  sideThisGame: string | null;
  /** Where V3 read the server, so the button carrying it says so. */
  detectedServerEnd?: EndName | null;
  /** Where the scoring rotation puts the server, as an end. */
  rotationServerEnd?: EndName | null;
  /** Which end the owner's own scoring gives the point to. */
  ownerWinnerEnd?: EndName | null;
  /** The running score after each of this card's points, in order. */
  scores?: CardScore[] | null;
  /** Points in this match nobody has named a winner for. */
  unmarked?: number;
  cardT0: number;
  cardT1: number;
  /** The picture, for filing a split at the frame on screen. Absent on a
   *  card with nothing mounted to watch, which disables the split. */
  playhead?: MutableRefObject<PlayheadHandle | null>;
  /** False on the last card, where "runs into the next one" means nothing. */
  hasNext: boolean;
  /** 1-based position in the list, for naming the neighbours a join ties
   *  this card to. */
  cardNumber: number;
  /** The card before this one is marked as running into it, so this
   *  card's first point began there and its serve was asked there. */
  continuesFromPrev?: boolean;
}) {
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle"
  );
  // A card change must not leave the previous card's "Saved" sitting under
  // a set of buttons that have not been touched yet.
  useEffect(() => setStatus("idle"), [pointId]);

  // WHICH POINT INSIDE THE CARD is being answered. One row of numbers
  // rather than three stacked copies of the questions: the panel has to
  // stay the height of the map beside it however many rallies turn out to
  // be in there, and a card with one point must look exactly as it did
  // before any of this existed.
  const segments = segmentCount(label);
  const bounds = segmentBounds(label, cardT0, cardT1);
  const [seg, setSeg] = useState(0);
  useEffect(() => setSeg(0), [pointId]);
  const at = Math.min(seg, segments - 1);
  const last = at === segments - 1;
  // The serve is asked where the point STARTS and the winner where it
  // ENDS. A point running in from the card before started there; one
  // running on into the next card finishes there. Neither is asked twice.
  const serveElsewhere = at === 0 && continuesFromPrev;
  const winnerElsewhere = last && label.joinNext;

  // The last write wins the status line. Without this a slow first write
  // landing after a fast second one would report an old result.
  const writeNo = useRef(0);

  const file = (patch: LabelPatch, undo: LabelPatch) => {
    const mine = ++writeNo.current;
    onPatch(pointId, patch);
    setStatus("saving");
    void createClient()
      .rpc("admin_point_label_set", { p_point_id: pointId, p_patch: patch })
      .then(({ error }) => {
        if (error) {
          onPatch(pointId, undo);
          if (mine === writeNo.current) setStatus("error");
          return;
        }
        if (mine === writeNo.current) setStatus("saved");
      });
  };

  const serverHere = endAt(label.serverEnds, at);
  const winnerHere = endAt(label.winnerEnds, at);
  const pickServer = (end: EndName) => {
    const next = serverHere === end ? null : end;
    file(
      { server_ends: withEndAt(label.serverEnds, at, next, segments) },
      { server_ends: label.serverEnds }
    );
  };
  const pickWinner = (end: EndName) => {
    const next = winnerHere === end ? null : end;
    file(
      { winner_ends: withEndAt(label.winnerEnds, at, next, segments) },
      { winner_ends: label.winnerEnds }
    );
  };
  const addSplit = () => {
    const at = playhead?.current?.time();
    if (at == null || !Number.isFinite(at)) return;
    // Clamped inside the card: a split at its very edge says nothing, and
    // one outside it would describe a moment this card does not contain.
    const clamped = Math.min(Math.max(at, cardT0 + 0.1), cardT1 - 0.1);
    file(
      { splits: normaliseSplits([...label.splits, clamped]) },
      { splits: label.splits }
    );
  };
  const dropSplit = (at: number) => {
    file(
      { splits: label.splits.filter((s) => s !== at) },
      { splits: label.splits }
    );
  };
  const toggleJoin = () => {
    file({ join_next: !label.joinNext }, { join_next: label.joinNext });
  };

  const splittable = cardT1 - cardT0 > 0.4;

  const nearName = personAtEnd("near", sideThisGame);

  return (
    <div className="rounded-2xl border border-edge bg-surface p-3">
      {/* Who is at each end, said ONCE. The buttons below name the end and
          nothing else, which keeps two of them on one line — and the whole
          panel inside the height the map beside it already takes. */}
      <p className="text-xs text-zinc-500">
        {nearName
          ? `Near ${nearName === "user" ? names.user : names.opponent} · Far ${
              nearName === "user" ? names.opponent : names.user
            }`
          : "Ends as the camera sees them"}
      </p>

      {segments > 1 && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {bounds.map((b, i) => {
            const answered =
              endAt(label.serverEnds, i) !== null ||
              endAt(label.winnerEnds, i) !== null;
            return (
              <button
                key={b.start}
                type="button"
                onClick={() => {
                  setSeg(i);
                  playhead?.current?.seek(b.start + 0.05);
                }}
                title={`The point from ${(b.start - cardT0).toFixed(1)}s to ${(
                  b.end - cardT0
                ).toFixed(1)}s`}
                className={`flex h-6 min-w-6 items-center justify-center gap-1 rounded-full border px-2 text-xs tabular-nums transition-colors ${
                  i === at
                    ? "border-cyan-glow/60 bg-cyan-glow/10 text-cyan-glow"
                    : "border-edge text-zinc-400 hover:border-cyan-glow/40"
                }`}
              >
                {i + 1}
                {answered && (
                  <span aria-hidden="true" className="text-[8px] leading-none">
                    ●
                  </span>
                )}
              </button>
            );
          })}
          <span className="ml-0.5 text-xs tabular-nums text-zinc-600">
            {(bounds[at].start - cardT0).toFixed(1)}&ndash;
            {(bounds[at].end - cardT0).toFixed(1)}s
          </span>
        </div>
      )}

      <div className="mt-2">
        {serveElsewhere ? (
          <div>
            <p className="text-xs text-zinc-500">Served</p>
            <p className="mt-1.5 rounded-xl border border-edge px-2 py-1.5 text-sm text-zinc-500">
              This point began on card {cardNumber - 1}.
            </p>
          </div>
        ) : (
          <EndChoice
            title="Served"
            value={serverHere}
            onPick={pickServer}
            marks={{
              // The machine read one serve, at the card's start. Once the
              // card is cut that reading is about the first point only, so
              // it stops being shown against the others rather than
              // following the selection around and meaning nothing.
              near:
                at === 0
                  ? marksFor("near", detectedServerEnd, rotationServerEnd)
                  : [],
              far:
                at === 0
                  ? marksFor("far", detectedServerEnd, rotationServerEnd)
                  : [],
            }}
          />
        )}
      </div>

      <div className="mt-2.5">
        {winnerElsewhere ? (
          <div>
            <p className="text-xs text-zinc-500">Won the point</p>
            <p className="mt-1.5 rounded-xl border border-edge px-2 py-1.5 text-sm text-zinc-500">
              This point finishes on card {cardNumber + 1}.
            </p>
          </div>
        ) : (
          <EndChoice
            title="Won the point"
            value={winnerHere}
            onPick={pickWinner}
            marks={{
              // The owner scored the CARD once. On a card holding several
              // points that answer belongs to no one of them, so it is
              // shown only while the card is still one point.
              near:
                segments === 1 && ownerWinnerEnd === "near" ? ["scored"] : [],
              far:
                segments === 1 && ownerWinnerEnd === "far" ? ["scored"] : [],
            }}
          />
        )}
        {scores && scores[at] && (
          <p className="mt-1.5 text-xs text-zinc-500">
            Score{" "}
            <span className="tabular-nums text-zinc-200">
              {scores[at].near}&ndash;{scores[at].far}
            </span>
            <span className="ml-1 text-zinc-600">
              near&ndash;far ·{" "}
              {scores[at].closes
                ? `ends game ${scores[at].game}`
                : `game ${scores[at].game}`}
              {unmarked > 0 && ` · ${unmarked} uncalled`}
            </span>
          </p>
        )}
      </div>

      <div className="mt-3 border-t border-edge pt-3">
        <p className="text-xs text-zinc-500">This card</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={addSplit}
            disabled={!playhead || !splittable}
            title={
              playhead
                ? "Cut the card in two where the picture is now"
                : "Nothing is playing, so there is no moment to cut at"
            }
            className="rounded-full border border-edge px-3 py-1 text-sm text-zinc-300 transition-colors hover:border-cyan-glow/40 disabled:cursor-default disabled:text-zinc-600 disabled:hover:border-edge"
          >
            Split here
          </button>
          {label.splits.map((at) => (
            <span
              key={at}
              className="inline-flex items-center rounded-full border border-cyan-glow/50 bg-cyan-glow/10 text-cyan-glow"
            >
              <button
                type="button"
                onClick={() => playhead?.current?.seek(at)}
                title="Go to this split"
                className="rounded-l-full py-1 pl-3 pr-1 text-sm tabular-nums"
              >
                {(at - cardT0).toFixed(1)}s
              </button>
              <button
                type="button"
                onClick={() => dropSplit(at)}
                aria-label="Remove this split"
                className="rounded-r-full py-1 pl-1 pr-2.5 text-sm leading-none transition-colors hover:text-amber-300"
              >
                ×
              </button>
            </span>
          ))}
        </div>
        {hasNext && (
          <button
            type="button"
            role="checkbox"
            aria-checked={label.joinNext}
            onClick={toggleJoin}
            className={`mt-1.5 flex w-full items-center gap-2 rounded-xl border px-3 py-1.5 text-left text-sm transition-colors ${
              label.joinNext
                ? "border-cyan-glow/50 bg-cyan-glow/10 text-cyan-glow"
                : "border-edge text-zinc-300 hover:border-cyan-glow/40"
            }`}
          >
            <span
              aria-hidden="true"
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] leading-none ${
                label.joinNext
                  ? "border-cyan-glow/60 bg-cyan-glow/20"
                  : "border-edge"
              }`}
            >
              {label.joinNext ? "✓" : ""}
            </span>
            Joins the next card
          </button>
        )}
      </div>

      <p className="mt-1.5 h-4 text-xs">
        {status === "saving" && <span className="text-zinc-600">Saving…</span>}
        {status === "saved" && <span className="text-zinc-600">Saved</span>}
        {status === "error" && (
          <span className="text-amber-300">That did not save.</span>
        )}
      </p>
    </div>
  );
}

/** One question, answered by naming an end. */
function EndChoice({
  title,
  value,
  onPick,
  marks,
}: {
  title: string;
  value: EndName | null;
  onPick: (end: EndName) => void;
  /** What the machine and the scoring each say, shown ON the end they
   *  point at. Context, never a pre-filled answer: a ticked box teaches
   *  you to confirm rather than to look, which is the rule the bounce
   *  labeling already runs on. */
  marks: { near: string[]; far: string[] };
}) {
  return (
    <div>
      <p className="text-xs text-zinc-500">{title}</p>
      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
        {(["near", "far"] as EndName[]).map((end) => {
          const on = value === end;
          return (
            <button
              key={end}
              type="button"
              onClick={() => onPick(end)}
              title={
                on
                  ? "Tap again to take this answer back"
                  : `File the ${end} end`
              }
              className={`flex items-center justify-center gap-1.5 rounded-xl border px-2 py-1.5 text-sm transition-colors ${
                on
                  ? "border-cyan-glow/60 bg-cyan-glow/10 text-cyan-glow"
                  : "border-edge text-zinc-300 hover:border-cyan-glow/40"
              }`}
            >
              {end === "near" ? "Near" : "Far"}
              {marks[end].length > 0 && (
                <span className="text-[10px] uppercase tracking-wide text-zinc-500">
                  {marks[end].join(" ")}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function marksFor(
  end: EndName,
  detected: EndName | null,
  rotation: EndName | null
): string[] {
  const out: string[] = [];
  if (detected === end) out.push("V3");
  if (rotation === end) out.push("score");
  return out;
}
