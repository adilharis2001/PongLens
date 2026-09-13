/**
 * The admin's own answer to what a card should have been.
 *
 * Four things get filed against one card: which END served, which END won
 * the point, where the card should have been cut in two, and whether it
 * runs on into the next one. Stored by migration 20260913140000; nothing
 * in the product reads them back, and none of it touches the player's own
 * points. They are training rows.
 *
 * ENDS, not people, all the way through. Near and far are what the camera
 * sees and what the detector reads; a person is near or far only for the
 * game they are currently playing, because players change ends at every
 * game. So the stored answer names an end and the page names the player
 * beside it, through the same physicalSideForGame every other surface
 * uses.
 */

import {
  createBoundaryWalk,
  stepBoundaryWalk,
  type GameEndOverride,
} from "../../match/[id]/gameScore.ts";

export type EndName = "near" | "far";

export interface PointLabel {
  serverEnd: EndName | null;
  winnerEnd: EndName | null;
  /** Source seconds where a point inside the card ended, ascending. */
  splits: number[];
  joinNext: boolean;
}

/** What the four fields mean when nothing has been filed. */
export function emptyLabel(): PointLabel {
  return { serverEnd: null, winnerEnd: null, splits: [], joinNext: false };
}

/** Whether anything has been filed on this card at all — what the list's
 *  marker and the database's "delete the row when it empties" both ask. */
export function isLabelled(label: PointLabel | null | undefined): boolean {
  if (!label) return false;
  return (
    label.serverEnd !== null ||
    label.winnerEnd !== null ||
    label.splits.length > 0 ||
    label.joinNext
  );
}

/** The patch shape the RPC takes. Keys absent are left alone; a key set to
 *  null clears that field — which is how a second tap on the end already
 *  chosen withdraws the answer rather than filing it twice. */
export interface LabelPatch {
  server_end?: EndName | null;
  winner_end?: EndName | null;
  splits?: number[] | null;
  join_next?: boolean;
}

export function applyPatch(label: PointLabel, patch: LabelPatch): PointLabel {
  const next: PointLabel = { ...label, splits: [...label.splits] };
  if ("server_end" in patch) next.serverEnd = patch.server_end ?? null;
  if ("winner_end" in patch) next.winnerEnd = patch.winner_end ?? null;
  if ("splits" in patch) next.splits = normaliseSplits(patch.splits ?? []);
  if ("join_next" in patch) next.joinNext = patch.join_next ?? false;
  return next;
}

/**
 * Two decimal places, ascending, no repeats.
 *
 * Two taps a frame apart are one split, and the order is what makes the
 * list mean "the first point ends here, then the second". The database
 * does the same thing to whatever it is sent, so the page never shows a
 * list the row does not hold.
 */
export function normaliseSplits(times: number[]): number[] {
  const seen = new Set<number>();
  for (const t of times) {
    if (!Number.isFinite(t)) continue;
    seen.add(Math.round(t * 100) / 100);
  }
  return [...seen].sort((a, b) => a - b);
}

/**
 * Who was at this end during THIS point's game.
 *
 * `sideThisGame` is the uploader's end for the game the point belongs to —
 * physicalSideForGame, never the raw `matches.user_side`, which is only
 * their end in game one. Null in, null out: on a match with no recorded
 * side, or no scoring to find the games with, an end names nobody and the
 * page says "near end" rather than guessing at a person.
 */
export function personAtEnd(
  end: EndName | null | undefined,
  sideThisGame: string | null | undefined
): "user" | "opponent" | null {
  if (!end) return null;
  if (sideThisGame !== "near" && sideThisGame !== "far") return null;
  return end === sideThisGame ? "user" : "opponent";
}

/** The same rule read the other way: which end a player was at. */
export function endForPerson(
  person: "user" | "opponent" | null | undefined,
  sideThisGame: string | null | undefined
): EndName | null {
  if (!person) return null;
  if (sideThisGame !== "near" && sideThisGame !== "far") return null;
  const other: EndName = sideThisGame === "near" ? "far" : "near";
  return person === "user" ? sideThisGame : other;
}

export interface ScoreRow {
  id: string;
  is_let: boolean;
  /** The owner's own game boundary pin, consumed positionally. */
  gameEndOverride: string | null;
  /** The end that took this point — the admin's mark where there is one,
   *  the owner's scoring turned back into an end otherwise. Null on a
   *  point nobody has called. */
  winnerEnd: EndName | null;
}

export interface CardScore {
  near: number;
  far: number;
  /** 1-based game this score belongs to. */
  game: number;
  /** A game closes at this card. */
  closes: boolean;
}

export interface LabelScore {
  /** point id -> the score as it stood once that card was played. */
  byPoint: Map<string, CardScore>;
  /** Cards in play that nobody has named a winner for. */
  unmarked: number;
  games: { near: number; far: number }[];
}

/**
 * The running score, in ends, from whoever has called each point.
 *
 * It folds through `stepBoundaryWalk` rather than counting to eleven on
 * its own, because that function is the single boundary authority in this
 * codebase — the match page, the serve rotation and the reel all go
 * through it, and a fourth opinion about where a game ends is exactly how
 * two surfaces start disagreeing about the score.
 *
 * Near plays the part of "you" and far of "them" inside the walk, which is
 * arithmetic on two counters and cares about nothing else. Reading the
 * answer as ends is what makes it safe on a match nobody has scored: ends
 * are fixed for the length of a game and the score resets at the boundary,
 * so no game ever needs to know which player was where.
 */
export function labelScoreByPoint(rows: ScoreRow[]): LabelScore {
  const byPoint = new Map<string, CardScore>();
  const games: { near: number; far: number }[] = [];
  const walk = createBoundaryWalk();
  let unmarked = 0;
  for (const row of rows) {
    const winner = row.is_let ? null : row.winnerEnd;
    if (!row.is_let && row.winnerEnd === null) unmarked += 1;
    const ended = stepBoundaryWalk(
      walk,
      winner === null ? null : winner === "near" ? "user" : "opponent",
      asOverride(row.gameEndOverride)
    );
    if (ended) {
      games.push({ near: ended.you, far: ended.them });
      byPoint.set(row.id, {
        near: ended.you,
        far: ended.them,
        game: games.length,
        closes: true,
      });
    } else {
      byPoint.set(row.id, {
        near: walk.you,
        far: walk.them,
        game: games.length + 1,
        closes: false,
      });
    }
  }
  return { byPoint, unmarked, games };
}

function asOverride(value: string | null): GameEndOverride {
  return value === "end" || value === "continue" ? value : null;
}

/** What the picture is showing and how to move it, handed up from
 *  whichever player is mounted so a split can be filed at the frame on
 *  screen instead of at a number typed in. */
export interface PlayheadHandle {
  /** Source seconds of the frame on screen. */
  time: () => number;
  /** Put the picture at this source second. */
  seek: (sourceSeconds: number) => void;
}
