/**
 * The admin's own answer to what a card should have been.
 *
 * A card is not a point. The splits filed against it say where the points
 * inside it begin and end, so a card with two splits is THREE points and
 * each of them has its own server and its own winner. The answers are
 * therefore arrays indexed by SEGMENT — splits + 1 of them — with null
 * wherever nothing has been said yet.
 *
 * A join runs one point across two cards. Nothing is copied between rows
 * for it: the point starts in the first card's last segment and ends in
 * the next card's first, so the SERVE is filed where the point starts and
 * the WINNER where it ends, and the sequence of real points is rebuilt by
 * reading the cards in order. That rule is the whole of it, and it is the
 * reason neither answer is ever asked twice.
 *
 * Stored by migrations 20260913140000 and 20260914150000; nothing in the
 * product reads them back, and none of it touches the player's own points.
 * They are training rows.
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
  /** One per segment, null where unanswered. Shorter than the segment
   *  count means the tail is unanswered; that is what the database stores
   *  and there is no reason to pad it on the way in. */
  serverEnds: (EndName | null)[];
  winnerEnds: (EndName | null)[];
  /** Source seconds where a point inside the card ended, ascending. */
  splits: number[];
  joinNext: boolean;
}

/** What the fields mean when nothing has been filed. */
export function emptyLabel(): PointLabel {
  return { serverEnds: [], winnerEnds: [], splits: [], joinNext: false };
}

/** How many points this card holds, as labelled. One more than its cuts. */
export function segmentCount(label: PointLabel): number {
  return label.splits.length + 1;
}

/** The i-th segment's answer, from an array that may be shorter than the
 *  segment count or hold nulls. */
export function endAt(
  ends: (EndName | null)[],
  index: number
): EndName | null {
  return ends[index] ?? null;
}

/** The array to file for a change to ONE segment: padded to the card's
 *  segment count so an answer on the third point cannot be mistaken for
 *  an answer on the first, and trimmed of the trailing nulls the database
 *  would only have to store. */
export function withEndAt(
  ends: (EndName | null)[],
  index: number,
  value: EndName | null,
  count: number
): (EndName | null)[] {
  const next: (EndName | null)[] = [];
  for (let i = 0; i < count; i += 1) next.push(ends[i] ?? null);
  if (index >= 0 && index < count) next[index] = value;
  while (next.length > 0 && next[next.length - 1] === null) next.pop();
  return next;
}

/** Where each segment of a card starts and ends, in source seconds. */
export function segmentBounds(
  label: PointLabel,
  cardT0: number,
  cardT1: number
): { start: number; end: number }[] {
  const cuts = [cardT0, ...label.splits, cardT1];
  const out: { start: number; end: number }[] = [];
  for (let i = 0; i + 1 < cuts.length; i += 1) {
    out.push({ start: cuts[i], end: cuts[i + 1] });
  }
  return out;
}

/** Whether anything has been filed on this card at all — what the list's
 *  marker and the database's "delete the row when it empties" both ask. */
export function isLabelled(label: PointLabel | null | undefined): boolean {
  if (!label) return false;
  return (
    label.serverEnds.some((e) => e !== null) ||
    label.winnerEnds.some((e) => e !== null) ||
    label.splits.length > 0 ||
    label.joinNext
  );
}

/** The patch shape the RPC takes. Keys absent are left alone; a key set to
 *  null clears that field — which is how a second tap on the end already
 *  chosen withdraws the answer rather than filing it twice. */
export interface LabelPatch {
  server_ends?: (EndName | null)[] | null;
  winner_ends?: (EndName | null)[] | null;
  splits?: number[] | null;
  join_next?: boolean;
}

export function applyPatch(label: PointLabel, patch: LabelPatch): PointLabel {
  const next: PointLabel = {
    ...label,
    serverEnds: [...label.serverEnds],
    winnerEnds: [...label.winnerEnds],
    splits: [...label.splits],
  };
  if ("server_ends" in patch) next.serverEnds = [...(patch.server_ends ?? [])];
  if ("winner_ends" in patch) next.winnerEnds = [...(patch.winner_ends ?? [])];
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
  /** One per segment: the end that took that point — the admin's mark
   *  where there is one, the owner's scoring turned back into an end on a
   *  card nobody has cut. Null on a point nobody has called. */
  winnerEnds: (EndName | null)[];
  /** How many points this card holds, as labelled. */
  segments: number;
  /** This card's last point runs on into the next card. */
  joinNext: boolean;
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
  /** point id -> the score once the whole card had been played. */
  byPoint: Map<string, CardScore>;
  /** point id -> the score after each of its segments, in order. */
  bySegment: Map<string, CardScore[]>;
  /** Points in play that nobody has named a winner for. */
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
 *
 * A CARD IS NOT A POINT. Each segment is one, except the first segment of
 * a card the previous one joins into — that finishes the point already
 * running, and takes its winner rather than starting another. So the walk
 * steps once per point rather than once per card, and a card holding three
 * rallies moves the score three times.
 */
export function labelScoreByPoint(rows: ScoreRow[]): LabelScore {
  const byPoint = new Map<string, CardScore>();
  const bySegment = new Map<string, CardScore[]>();
  const games: { near: number; far: number }[] = [];
  const walk = createBoundaryWalk();
  let unmarked = 0;
  let carried = false; // the previous card runs into this one

  for (const row of rows) {
    const segments: CardScore[] = [];
    const count = Math.max(1, row.segments);
    for (let i = 0; i < count; i += 1) {
      const last = i === count - 1;
      // A segment that continues the previous card's point does not start
      // one: the point it belongs to is already open, and this is where it
      // finishes. The open point's winner is the one filed here.
      const continues = i === 0 && carried;
      // The last segment of a joined card leaves its point open — the
      // winner will be filed on the card it finishes in.
      const stillOpen = last && row.joinNext;
      const winner = row.is_let ? null : endAt(row.winnerEnds, i);
      if (!row.is_let && !stillOpen && winner === null) unmarked += 1;

      if (row.is_let || stillOpen) {
        // Nothing to count yet; report the score as it stands.
        segments.push({
          near: walk.you,
          far: walk.them,
          game: games.length + 1,
          closes: false,
        });
        continue;
      }
      void continues;
      const ended = stepBoundaryWalk(
        walk,
        winner === null ? null : winner === "near" ? "user" : "opponent",
        // The owner's boundary pin is a fact about the CARD, so it lands
        // on the card's last point rather than on each of them.
        last ? asOverride(row.gameEndOverride) : null
      );
      if (ended) {
        games.push({ near: ended.you, far: ended.them });
        segments.push({
          near: ended.you,
          far: ended.them,
          game: games.length,
          closes: true,
        });
      } else {
        segments.push({
          near: walk.you,
          far: walk.them,
          game: games.length + 1,
          closes: false,
        });
      }
    }
    carried = row.joinNext;
    bySegment.set(row.id, segments);
    byPoint.set(row.id, segments[segments.length - 1]);
  }
  return { byPoint, bySegment, unmarked, games };
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
