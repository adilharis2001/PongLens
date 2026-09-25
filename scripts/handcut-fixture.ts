/**
 * Regenerates the hand-cut rules parity fixture.
 *
 *   node --experimental-strip-types scripts/handcut-fixture.ts
 *
 * The fixture (ios/Tests/fixtures/handcut-parity.json) drives the REAL
 * exported rules in src/app/match/[id]/handCut.ts through scripted marking
 * sessions and records the whole state after every step. The Swift port
 * replays the same steps and must arrive at the same state each time, so it
 * is compared against the web's own behaviour rather than against a second
 * reading of the spec. That is the arrangement that caught the placement
 * mirror; two hand-written suites agreeing only proves both authors read
 * the same sentence the same way.
 *
 * handCut.test.ts rebuilds the fixture in memory and fails if the committed
 * file differs, so a rule change cannot land without regenerating it.
 *
 * FORMAT
 *
 *   constants   every number the rules use, for Swift to assert
 *   leadFor     the start-tap lead at a range of playback rates
 *   refusals    REFUSE: refusal key -> the words the player sees
 *   invalid     INVALID: validate reason key -> the words
 *   cases[]     marking sessions:
 *     name, mode ("cut" | "score" | null), durationS (number | null),
 *     start     { marks, selectedId, awaitingId } (undo always starts empty)
 *     steps[]   { op, args, now?, rate?, refused, result?, expect }
 *       refused  a key of `refusals`, or null when the step was accepted
 *       result   what a query op (or reset's backTo) returned
 *       expect   { marks, undo, selectedId, awaitingId } after the step
 *   checks[]    pure functions on explicit inputs: { fn, args, result }
 *
 * Ops that change state: start {id} + now + rate, end + now,
 * outcome {outcome}, star {id}, clearAwaiting, select {id}, moveEdge
 * {id, edge, delta}, setEdges {id, t0, t1}, insert {t0, t1, id}, remove {id},
 * reset (result {backTo}), undo, load {raw} (state becomes the empty state
 * with marks = normalizeMarks(raw)).
 *
 * Query ops leave the state alone and return `result`: openMark (id or
 * null), lastClosedEnd, firstUnscored {afterId}, allCalled, gapsAround
 * {id, durationS}, draftMode {recorded}, openAs {durationS, mode},
 * summarize, submittable, validate {durationS} (result {ok, reason?,
 * reasonKey?}), asPoints, score (markScore: {current: [you, them],
 * games: [[you, them, resolved winner or null]], gamesYou, gamesThem}) and
 * nextServer {firstServer} (markNextServer). Every default is resolved into
 * `args`, so the Swift side never has to guess one.
 *
 * A mark carries `gameEnd` and `gameWinner` only when set (a match marked
 * again brings the owner's game ends with its marks), so every mark without
 * them reads exactly as it always has.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  GAP_WORTH_MARKING_S,
  INVALID,
  LEAD_MAX_S,
  LEAD_MIN_S,
  LONGEST_POINT_S,
  MAX_MARKS,
  MAX_POINT_S,
  MIN_POINT_S,
  PAST_END_ALLOWANCE_S,
  REFUSE,
  SPLIT_LEAD_S,
  TAIL_S,
  allCalled,
  asPoints,
  clearAwaiting,
  draftMode,
  emptyState,
  endMark,
  firstUnscored,
  gapsAround,
  insertMark,
  lastClosedEnd,
  leadFor,
  markNextServer,
  markScore,
  moveEdge,
  normalizeMarks,
  openAs,
  openMark,
  removeMark,
  resetOpen,
  selectMark,
  setEdges,
  setOutcome,
  startMark,
  submittable,
  summarize,
  toggleStar,
  undoLast,
  validate,
  type Applied,
  type CutMode,
  type Mark,
  type MarkState,
  type Outcome,
} from "../src/app/match/[id]/handCut.ts";
import { resolvedGameWinner } from "../src/app/match/[id]/gameScore.ts";

type Args = Record<string, unknown>;

interface StepIn {
  op: string;
  args?: Args;
  now?: number;
  rate?: number;
}

interface CaseIn {
  name: string;
  mode: CutMode | null;
  durationS: number | null;
  start?: { marks?: Mark[]; selectedId?: string | null; awaitingId?: string | null };
  steps: StepIn[];
}

/* ------------------------------------------------------------ builders */

const mark = (
  id: string,
  t0: number,
  t1: number | null,
  winner: "user" | "opponent" | null = null,
  isLet = false,
  starred = false
): Mark => ({ id, t0, t1, winner, isLet, starred, tap: t0, rate: 1 });

/** A mark as start_recut prefills it, carrying the owner's game ends. */
const markG = (
  id: string,
  t0: number,
  t1: number,
  winner: "user" | "opponent" | null,
  game: { gameEnd?: "end" | "continue"; gameWinner?: "user" | "opponent" }
): Mark => ({ ...mark(id, t0, t1, winner), ...game });

/** n called rallies, 10 s apart from `from`, each won by `winner`. */
const run = (prefix: string, n: number, from: number, winner: "user" | "opponent"): Mark[] =>
  Array.from({ length: n }, (_, i) => mark(`${prefix}${i + 1}`, from + i * 10, from + i * 10 + 6, winner));

const S = (id: string, now: number, rate = 1): StepIn => ({ op: "start", args: { id }, now, rate });
const E = (now: number): StepIn => ({ op: "end", now });
const O = (outcome: Outcome): StepIn => ({ op: "outcome", args: { outcome } });
const Q = (op: string, args: Args = {}): StepIn => ({ op, args });
const U: StepIn = { op: "undo" };
const RESET: StepIn = { op: "reset" };
const sel = (id: string | null): StepIn => ({ op: "select", args: { id } });

/** Three called rallies, marked the way the pad is used:
 *  a 9.4-24 (user), b 39.4-55 (opponent), c 69.4-78 (user). */
const THREE: StepIn[] = [
  S("a", 10), E(24), O("user"),
  S("b", 40), E(55), O("opponent"),
  S("c", 70), E(78), O("user"),
];

/* --------------------------------------------------------------- cases */

const CASES: CaseIn[] = [
  {
    name: "the three-tap rhythm, cut and score",
    mode: "score",
    durationS: 600,
    steps: [
      S("a", 10), E(24), O("user"),
      S("b", 40), E(55), O("opponent"),
      S("c", 70), E(78), O("let"),
      Q("openMark"), Q("lastClosedEnd"), Q("allCalled"), Q("summarize"),
      Q("submittable"), Q("validate"), Q("asPoints"), Q("draftMode"), Q("openAs"),
    ],
  },
  {
    name: "cut only: begin and end, nothing answered",
    mode: "cut",
    durationS: 100,
    steps: [
      S("a", 10), E(24), S("b", 40), E(55),
      Q("summarize"), Q("firstUnscored"), Q("allCalled"),
      Q("draftMode", { recorded: null }), Q("openAs", { mode: "cut" }),
      Q("openAs", { mode: "score" }),
    ],
  },
  {
    name: "the start lead scales with playback rate and is clamped",
    mode: "score",
    durationS: 600,
    steps: [S("a", 10, 2), E(20), S("b", 30, 0.25), E(40), S("c", 50, 8), E(60), S("d", 70, 1.5)],
  },
  {
    name: "a start in the first half second clamps to zero",
    mode: "score",
    durationS: 600,
    steps: [S("a", 0.3), E(5)],
  },
  {
    name: "refusal: too short, on start and on end",
    mode: "score",
    durationS: 600,
    steps: [
      S("a", 10),
      S("b", 10.5),
      E(9.9),
      // 10.1 - 9.4 is 0.6999999999999993 in floating point, so this is
      // refused. Swift's Double does the same arithmetic.
      E(10.1),
      E(10.2),
    ],
  },
  {
    name: "refusal: nothing open, nothing ended",
    mode: "score",
    durationS: 600,
    steps: [E(12), O("user"), S("a", 10), O("user"), E(24), E(30), O("user")],
  },
  {
    name: "refusal: a start before the last point ended",
    mode: "score",
    durationS: 600,
    steps: [S("a", 10), E(60), O("user"), S("b", 30), S("b", 60.6)],
  },
  {
    name: "forgotten end: Begin while a rally is open",
    mode: "score",
    durationS: 600,
    steps: [S("a", 10), S("b", 40), U, S("b", 40), E(55), O("user"), U, U, U, U, U],
  },
  {
    name: "reset: back to the last finished point, and undo",
    mode: "score",
    durationS: 600,
    steps: [S("a", 10), E(24), O("user"), S("b", 40), RESET, U, RESET, S("c", 30), E(45)],
  },
  {
    name: "reset with nothing finished, and with nothing open",
    mode: "cut",
    durationS: 600,
    steps: [RESET, S("a", 40), RESET, S("a", 40), E(50), RESET],
  },
  {
    name: "reset clears a selection on the rally it throws away",
    mode: "score",
    durationS: 600,
    steps: [S("a", 10), sel("a"), RESET],
  },
  {
    name: "held for an answer, then moved on",
    mode: "score",
    durationS: 600,
    steps: [
      S("a", 10), E(24),
      { op: "clearAwaiting" },
      O("user"),
      sel("a"), O("user"),
      { op: "clearAwaiting" },
      sel("a"),
    ],
  },
  {
    name: "answers toggle, and a let and a win exclude each other",
    mode: "score",
    durationS: 600,
    steps: [
      S("a", 10), E(24), O("user"),
      sel("a"), O("user"), O("let"), O("let"), O("opponent"), O("let"), O("user"),
      U, U,
    ],
  },
  {
    name: "the point just ended outranks a selected chip",
    mode: "score",
    durationS: 600,
    steps: [S("a", 10), E(24), O("user"), sel("a"), S("b", 40), E(55), O("opponent")],
  },
  {
    name: "star, unstar, undo, and a star on nothing",
    mode: "score",
    durationS: 600,
    steps: [
      S("a", 10), E(24),
      { op: "star", args: { id: "a" } },
      { op: "star", args: { id: "a" } },
      U, U,
      { op: "star", args: { id: "missing" } },
    ],
  },
  {
    name: "moving edges, every refusal and the clamp at zero",
    mode: "score",
    durationS: 600,
    steps: [
      S("a", 10), E(24), O("user"), S("b", 40), E(55), O("user"),
      { op: "moveEdge", args: { id: "a", edge: "t1", delta: 20 } },
      { op: "moveEdge", args: { id: "a", edge: "t1", delta: 0.15 } },
      { op: "moveEdge", args: { id: "a", edge: "t0", delta: -20 } },
      { op: "moveEdge", args: { id: "a", edge: "t1", delta: -23.6 } },
      { op: "moveEdge", args: { id: "b", edge: "t0", delta: -16 } },
      { op: "moveEdge", args: { id: "missing", edge: "t0", delta: 1 } },
      { op: "setEdges", args: { id: "b", t0: 30, t1: 50 } },
      { op: "setEdges", args: { id: "b", t0: 20, t1: 50 } },
      { op: "setEdges", args: { id: "b", t0: 30, t1: 30.5 } },
      { op: "setEdges", args: { id: "a", t0: -5, t1: 20.004 } },
      { op: "setEdges", args: { id: "missing", t0: 1, t1: 5 } },
      S("c", 70),
      { op: "moveEdge", args: { id: "c", edge: "t1", delta: 1 } },
      { op: "setEdges", args: { id: "c", t0: 60, t1: 80 } },
      { op: "moveEdge", args: { id: "b", edge: "t1", delta: 20 } },
      U, U, U, U,
    ],
  },
  {
    name: "insert a missed rally, and undo clears its selection",
    mode: "score",
    durationS: 100,
    start: { marks: [mark("a", 10, 15, "user"), mark("c", 60, 65, "user")] },
    steps: [
      { op: "insert", args: { t0: 30, t1: 36, id: "b" } },
      Q("gapsAround", { id: "b" }),
      U,
      { op: "insert", args: { t0: 30, t1: 30.2, id: "x" } },
      { op: "insert", args: { t0: 12, t1: 20, id: "x" } },
      { op: "insert", args: { t0: 15, t1: 21, id: "x" } },
      { op: "insert", args: { t0: 5, t1: 10, id: "y" } },
      Q("summarize"),
    ],
  },
  {
    name: "remove a selected point and an awaited one, then undo",
    mode: "score",
    durationS: 600,
    steps: [
      ...THREE,
      sel("b"),
      { op: "remove", args: { id: "b" } },
      U,
      S("d", 90), E(100),
      { op: "remove", args: { id: "d" } },
      { op: "remove", args: { id: "missing" } },
      U,
    ],
  },
  {
    name: "undo of every entry type, each straight after it",
    mode: "score",
    durationS: 600,
    steps: [
      S("a", 10), U, S("a", 10),
      S("b", 30), U,
      E(24), U, E(24),
      O("user"), U, O("user"),
      { op: "star", args: { id: "a" } }, U,
      { op: "moveEdge", args: { id: "a", edge: "t1", delta: 1 } }, U,
      { op: "setEdges", args: { id: "a", t0: 9, t1: 26 } }, U,
      { op: "remove", args: { id: "a" } }, U,
      S("b", 40), RESET, U,
      E(55),
      { op: "insert", args: { t0: 60, t1: 66, id: "c" } }, U,
      U, U, U, U, U, U, U,
    ],
  },
  {
    name: "undo clears a selection whose point it takes away or reopens",
    mode: "score",
    durationS: 600,
    steps: [
      S("a", 10), sel("a"), U,
      S("a", 10), E(24), sel("a"), U,
      E(24), O("user"), sel("a"), { op: "star", args: { id: "a" } }, U,
    ],
  },
  {
    name: "an answer never lands on a rally still open",
    mode: "score",
    durationS: 600,
    steps: [S("a", 10), sel("a"), O("user"), E(24), O("user")],
  },
  {
    name: "mark again: a point in the middle is marked again in its gap",
    mode: "score",
    durationS: 600,
    steps: [
      ...THREE,
      sel("b"),
      { op: "remove", args: { id: "b" } },
      S("b2", 41),
      Q("openMark"), Q("lastClosedEnd"), Q("summarize"), Q("submittable"),
      Q("gapsAround", { id: "a" }), Q("gapsAround", { id: "c" }), Q("gapsAround", { id: "b2" }),
      Q("openAs", { mode: "score" }), Q("openAs", { mode: "cut" }),
      E(72),
      E(40.5),
      E(54),
      O("opponent"),
      Q("validate"), Q("submittable"), Q("allCalled"),
    ],
  },
  {
    name: "starts inside a point, beside one, and with no room before the next",
    mode: "score",
    durationS: 600,
    steps: [
      ...THREE,
      S("x", 75),
      S("x", 45),
      S("x", 12),
      S("x", 24.6),
      RESET,
      { op: "remove", args: { id: "b" } },
      S("x", 69.5),
      S("x", 69.3),
      E(69.4),
    ],
  },
  {
    name: "forgotten end inside a gap",
    mode: "score",
    durationS: 600,
    steps: [
      ...THREE,
      { op: "remove", args: { id: "b" } },
      S("b2", 41),
      S("x", 72),
      S("x", 69.5),
      S("b3", 50),
      E(72),
      E(69.4),
      U, U,
      RESET,
      U,
    ],
  },
  {
    name: "insert and adjust around a rally being marked",
    mode: "score",
    durationS: 600,
    steps: [
      ...THREE,
      { op: "remove", args: { id: "b" } },
      S("b2", 41),
      { op: "insert", args: { t0: 45, t1: 50, id: "x" } },
      { op: "insert", args: { t0: 38, t1: 44, id: "x" } },
      { op: "setEdges", args: { id: "c", t0: 40, t1: 78 } },
      { op: "setEdges", args: { id: "c", t0: 40.8, t1: 78 } },
      { op: "moveEdge", args: { id: "c", edge: "t0", delta: -29 } },
      { op: "setEdges", args: { id: "c", t0: 41.1, t1: 78 } },
      { op: "insert", args: { t0: 30, t1: 36, id: "x" } },
      E(41.1),
      E(41),
    ],
  },
  {
    name: "gap offers either side of the point stood on",
    mode: "score",
    durationS: 100,
    start: {
      marks: [mark("a", 10, 15, "user"), mark("b", 30, 35, "user"), mark("c", 60, 65, "user")],
    },
    steps: [
      Q("gapsAround", { id: null }),
      Q("gapsAround", { id: "b" }),
      Q("gapsAround", { id: "a" }),
      Q("gapsAround", { id: "c" }),
      Q("gapsAround", { id: "c", durationS: null }),
      Q("gapsAround", { id: "c", durationS: 0 }),
      Q("gapsAround", { id: "missing" }),
      S("o", 80),
      Q("gapsAround", { id: "c" }),
      Q("gapsAround", { id: "o" }),
    ],
  },
  {
    name: "a tight gap offers nothing",
    mode: "score",
    durationS: 100,
    start: { marks: [mark("a", 10, 15, "user"), mark("b", 17, 22, "user"), mark("c", 25.99, 30)] },
    steps: [Q("gapsAround", { id: "a" }), Q("gapsAround", { id: "b" })],
  },
  {
    name: "the review sheet's counts: open, long, starred, unscored",
    mode: "score",
    durationS: 900,
    steps: [
      S("a", 10), E(24), O("user"),
      S("b", 40), E(190),
      { op: "star", args: { id: "b" } },
      S("c", 200), E(210), O("let"),
      S("d", 300), E(500),
      S("e", 520),
      Q("summarize"), Q("submittable"), Q("validate"), Q("firstUnscored"),
      Q("firstUnscored", { afterId: "b" }), Q("asPoints"),
    ],
  },
  {
    name: "load: a draft handed back after a failed cut",
    mode: "score",
    durationS: 600,
    steps: [
      {
        op: "load",
        args: {
          raw: [
            { t0: 39.4, t1: 55, w: "opponent", let: false, star: true, tap: 40, rate: 1 },
            { t0: 9.4, t1: 24, w: null, let: false, star: false, tap: 10, rate: 1 },
            { t0: 69.4, t1: 78, w: null, let: true, star: false, tap: 70, rate: 2 },
          ],
        },
      },
      Q("allCalled"), Q("firstUnscored"), Q("openAs", { mode: "score" }), Q("draftMode", { recorded: null }),
      Q("submittable"),
      sel("d1"), O("user"), Q("allCalled"), Q("openAs", { mode: "score" }),
    ],
  },
  {
    name: "load: a draft saved while marking, with an open rally",
    mode: "cut",
    durationS: 600,
    steps: [
      {
        op: "load",
        args: {
          raw: [
            { id: "m1-abc", t0: 9.4, t1: 24, winner: null, isLet: false, starred: false, tap: 10, rate: 1 },
            { id: "m2-def", t0: 39.4, t1: null, winner: null, isLet: false, starred: false, tap: 40, rate: 1 },
          ],
        },
      },
      Q("openMark"), E(55), S("m3", 70),
    ],
  },
  {
    name: "load: malformed entries, duplicate ids, several open rallies",
    mode: null,
    durationS: null,
    steps: [
      {
        op: "load",
        args: {
          raw: [
            null,
            7,
            "text",
            [1, 2],
            { t1: 5 },
            { t0: "3", t1: 5 },
            { t0: 3 },
            { t0: 3, t1: "5" },
            { id: "k", t0: 30, t1: 35, winner: "near", isLet: "yes", starred: 1 },
            { id: "k", t0: 10, t1: 15, winner: "user" },
            { id: "", t0: 20, t1: 25, w: "user", rate: 0, tap: null },
            { id: "d1", t0: 40, t1: 45, w: "opponent", let: false },
            { id: "o1", t0: 50, t1: null },
            { id: "o2", t0: 60, t1: null, winner: "user" },
          ],
        },
      },
      Q("openMark"), Q("draftMode", { recorded: null }), Q("openAs", { mode: "cut" }),
    ],
  },
  {
    name: "game ends ride on their marks: an end the score cannot prove, and its winner",
    mode: "score",
    durationS: 600,
    // Marked again: b carries the owner's end and named winner, d an end
    // pinned on a rally nobody scored (it still closes the game).
    start: {
      marks: [
        mark("a", 10, 15, "user"),
        markG("b", 20, 25, "user", { gameEnd: "end", gameWinner: "user" }),
        mark("c", 30, 35, "opponent"),
        markG("d", 40, 45, null, { gameEnd: "end" }),
        mark("e", 50, 55, "user"),
      ],
    },
    steps: [
      Q("score"), Q("nextServer", { firstServer: "user" }), Q("asPoints"), Q("submittable"),
      // Answering the point again leaves its game end where it was.
      sel("b"), O("opponent"), Q("score"), U,
      // Adjusting a point, or dropping a missed rally in beside it, keeps it too.
      { op: "setEdges", args: { id: "b", t0: 19, t1: 26 } },
      { op: "insert", args: { t0: 36, t1: 39, id: "x" } },
      Q("score"), U, U,
      // A point taken out takes its game end with it, and Undo brings both back.
      { op: "remove", args: { id: "d" } },
      Q("score"), Q("nextServer", { firstServer: "user" }), Q("submittable"),
      U,
      Q("score"),
      // Marked again in the gap it left: the new rally has no game end.
      { op: "remove", args: { id: "b" } },
      S("b2", 20.6), E(25), O("user"),
      Q("score"), Q("asPoints"),
      // A new rally after the last carries none either.
      S("f", 60.6), E(66), O("opponent"),
      Q("score"), Q("nextServer", { firstServer: "opponent" }),
    ],
  },
  {
    name: "game ends ride on their marks: continue holds a game open past eleven",
    mode: "score",
    durationS: 900,
    start: {
      marks: [
        ...run("p", 10, 10, "user"),
        markG("p11", 110, 116, "user", { gameEnd: "continue" }),
        mark("p12", 120, 126, "user"),
        markG("p13", 130, 136, "opponent", { gameEnd: "end" }),
        mark("q1", 140, 146, "opponent"),
      ],
    },
    steps: [
      Q("score"), Q("nextServer", { firstServer: "user" }),
      // Without the owner's continue, the eleventh point ends the game.
      { op: "remove", args: { id: "p11" } },
      { op: "insert", args: { t0: 110, t1: 116, id: "p11b" } },
      O("user"),
      Q("score"), Q("nextServer", { firstServer: "user" }),
      U, U, U,
      Q("score"),
    ],
  },
  {
    name: "load: game ends in both stored shapes",
    mode: "score",
    durationS: 600,
    steps: [
      {
        op: "load",
        args: {
          raw: [
            // The prefill's full form.
            { id: "p1", t0: 10, t1: 15, winner: "user", isLet: false, starred: false, tap: null, rate: null },
            { id: "p2", t0: 20, t1: 25, winner: "opponent", isLet: false, starred: false, tap: null, rate: null,
              gameEnd: "end", gameWinner: "opponent" },
            { id: "p3", t0: 30, t1: 35, winner: null, isLet: true, starred: false, tap: null, rate: null,
              gameEnd: "continue", gameWinner: null },
            // The short form a failed cut hands back.
            { t0: 40, t1: 45, w: "user", let: false, star: true, tap: 40.6, rate: 1, gameEnd: "end" },
            { t0: 50, t1: 55, w: null, let: false, star: false, tap: 50.6, rate: 1, gameWinner: "user" },
            // Nothing else is a game end or a game winner.
            { t0: 60, t1: 65, w: null, let: false, star: false, tap: 60.6, rate: 1,
              gameEnd: "END", gameWinner: "near" },
            { t0: 70, t1: 75, w: null, let: false, star: false, tap: 70.6, rate: 1,
              gameEnd: true, gameWinner: 1 },
            // A rally still open carries no game end.
            { id: "o", t0: 80, t1: null, winner: null, isLet: false, starred: false, tap: 80.6, rate: 1,
              gameEnd: "end", gameWinner: "user" },
          ],
        },
      },
      Q("asPoints"), Q("submittable"), Q("score"), Q("draftMode", { recorded: null }),
    ],
  },
  {
    name: "load: not a list",
    mode: null,
    durationS: null,
    steps: [
      { op: "load", args: { raw: { marks: [] } } },
      { op: "load", args: { raw: null } },
      { op: "load", args: { raw: "[]" } },
      { op: "load", args: { raw: [] } },
      Q("openAs", { mode: "score" }),
    ],
  },
];

/* -------------------------------------------------------------- checks */

interface CheckIn {
  fn: string;
  args: Args;
}

const called = [mark("a", 10, 15, "user"), mark("b", 30, 35, "opponent")];
const uncalled = [mark("a", 10, 15), mark("b", 30, 35)];

const CHECKS: CheckIn[] = [
  // openAs: all four ways in.
  { fn: "openAs", args: { marks: [], durationS: 600, mode: "score" } },
  { fn: "openAs", args: { marks: [...called, mark("c", 50, 55)], durationS: 60, mode: "score" } },
  { fn: "openAs", args: { marks: called, durationS: 60, mode: "score" } },
  { fn: "openAs", args: { marks: called, durationS: 80, mode: "score" } },
  { fn: "openAs", args: { marks: called, durationS: 81, mode: "score" } },
  { fn: "openAs", args: { marks: called, durationS: 600, mode: "score" } },
  { fn: "openAs", args: { marks: called, durationS: null, mode: "score" } },
  { fn: "openAs", args: { marks: called, durationS: 0, mode: "score" } },
  { fn: "openAs", args: { marks: uncalled, durationS: 600, mode: "score" } },
  { fn: "openAs", args: { marks: uncalled, durationS: 600, mode: "cut" } },
  { fn: "openAs", args: { marks: uncalled, durationS: 60, mode: "cut" } },
  { fn: "openAs", args: { marks: [mark("a", 10, 15, null, true)], durationS: 60, mode: "score" } },
  // draftMode: the recorded choice wins; otherwise any call means scoring.
  { fn: "draftMode", args: { marks: uncalled, recorded: "score" } },
  { fn: "draftMode", args: { marks: called, recorded: "cut" } },
  { fn: "draftMode", args: { marks: [mark("a", 10, 15, "user"), mark("b", 30, 35)], recorded: null } },
  { fn: "draftMode", args: { marks: [mark("a", 10, 15, null, true)], recorded: null } },
  { fn: "draftMode", args: { marks: uncalled, recorded: null } },
  { fn: "draftMode", args: { marks: [], recorded: null } },
  // validate: every message, and the server's exact bounds.
  { fn: "validate", args: { marks: [], durationS: 600 } },
  { fn: "validate", args: { marks: [mark("o", 10, null)], durationS: 600 } },
  {
    fn: "validate",
    args: {
      marks: Array.from({ length: MAX_MARKS + 1 }, (_, i) => mark(`m${i}`, i * 2, i * 2 + 1)),
      durationS: null,
    },
  },
  { fn: "validate", args: { marks: [mark("a", 10, 10)], durationS: 600 } },
  { fn: "validate", args: { marks: [mark("a", 10, 9)], durationS: 600 } },
  { fn: "validate", args: { marks: [mark("a", -1, 10)], durationS: 600 } },
  { fn: "validate", args: { marks: [mark("a", 10, 10.5)], durationS: 600 } },
  { fn: "validate", args: { marks: [mark("a", 9.4, 10.1)], durationS: 600 } },
  { fn: "validate", args: { marks: [mark("a", 10, 10.7)], durationS: 600 } },
  { fn: "validate", args: { marks: [mark("a", 10, 190)], durationS: 600 } },
  { fn: "validate", args: { marks: [mark("a", 10, 190.5)], durationS: 600 } },
  { fn: "validate", args: { marks: [mark("a", 10, 20), mark("b", 15, 30)], durationS: 600 } },
  { fn: "validate", args: { marks: [mark("a", 10, 20), mark("b", 20, 30)], durationS: 600 } },
  { fn: "validate", args: { marks: [mark("a", 10, 101)], durationS: 100 } },
  { fn: "validate", args: { marks: [mark("a", 10, 101.5)], durationS: 100 } },
  { fn: "validate", args: { marks: [mark("a", 10, 20)], durationS: null } },
  { fn: "validate", args: { marks: [mark("a", 10, 20, "user", true)], durationS: 600 } },
  { fn: "validate", args: { marks: [mark("b", 30, 40, "user"), mark("a", 10, 20, "opponent")], durationS: 600 } },
  // normalizeMarks on its own.
  { fn: "normalizeMarks", args: { raw: [{ t0: 1, t1: 5 }, { id: "d1", t0: 10, t1: 15 }] } },
  { fn: "normalizeMarks", args: { raw: [{ id: "a", t0: 5, t1: 9 }, { id: "b", t0: 5, t1: 7 }] } },
  // The small readers.
  { fn: "firstUnscored", args: { marks: [mark("a", 0, 5, "user"), mark("b", 10, 15), mark("c", 20, 25, null, true), mark("d", 30, 35), mark("o", 40, null)], afterId: null } },
  { fn: "firstUnscored", args: { marks: [mark("a", 0, 5, "user"), mark("b", 10, 15), mark("c", 20, 25, null, true), mark("d", 30, 35), mark("o", 40, null)], afterId: "b" } },
  { fn: "firstUnscored", args: { marks: [mark("a", 0, 5, "user"), mark("b", 10, 15), mark("c", 20, 25, null, true), mark("d", 30, 35), mark("o", 40, null)], afterId: "d" } },
  { fn: "allCalled", args: { marks: [] } },
  { fn: "allCalled", args: { marks: [mark("a", 0, 5, "user"), mark("b", 10, 15, null, true)] } },
  { fn: "allCalled", args: { marks: [mark("a", 0, 5, "user"), mark("o", 10, null)] } },
  { fn: "lastClosedEnd", args: { marks: [] } },
  { fn: "lastClosedEnd", args: { marks: [mark("a", 0, 5), mark("o", 10, null)] } },
];

/* ------------------------------------------------------------- running */

const refusalKey = (text: string | undefined): string | null => {
  if (text === undefined) return null;
  const key = (Object.keys(REFUSE) as (keyof typeof REFUSE)[]).find((k) => REFUSE[k] === text);
  if (!key) throw new Error(`refusal with no key: ${text}`);
  return key;
};

const invalidKey = (text: string): string => {
  const key = (Object.keys(INVALID) as (keyof typeof INVALID)[]).find((k) => INVALID[k] === text);
  if (!key) throw new Error(`validate reason with no key: ${text}`);
  return key;
};

const validated = (marks: Mark[], durationS: number | null) => {
  const v = validate(marks, durationS);
  return v.ok ? { ok: true } : { ok: false, reason: v.reason, reasonKey: invalidKey(v.reason) };
};

/** markScore, as the plain numbers the Swift side compares. */
const scoreResult = (marks: Mark[]) => {
  const s = markScore(marks);
  return {
    current: [s.current.you, s.current.them],
    games: s.games.map((g) => [g.you, g.them, resolvedGameWinner(g)]),
    gamesYou: s.gamesYou,
    gamesThem: s.gamesThem,
  };
};

const snapshot = (s: MarkState) => ({
  marks: s.marks,
  undo: s.undo,
  selectedId: s.selectedId,
  awaitingId: s.awaitingId,
});

function runCase(c: CaseIn) {
  let state: MarkState = {
    marks: c.start?.marks ?? [],
    undo: [],
    selectedId: c.start?.selectedId ?? null,
    awaitingId: c.start?.awaitingId ?? null,
  };
  const start = snapshot(state);
  const steps = c.steps.map((step) => {
    const a: Args = { ...(step.args ?? {}) };
    let applied: Applied | null = null;
    let result: unknown = undefined;
    let now: number | undefined;
    let rate: number | undefined;

    switch (step.op) {
      case "start":
        now = step.now as number;
        rate = step.rate ?? 1;
        applied = startMark(state, now, rate, a.id as string);
        break;
      case "end":
        now = step.now as number;
        applied = endMark(state, now);
        break;
      case "outcome":
        applied = setOutcome(state, a.outcome as Outcome);
        break;
      case "star":
        applied = toggleStar(state, a.id as string);
        break;
      case "clearAwaiting":
        state = clearAwaiting(state);
        break;
      case "select":
        state = selectMark(state, (a.id as string | null) ?? null);
        a.id = a.id ?? null;
        break;
      case "moveEdge":
        applied = moveEdge(state, a.id as string, a.edge as "t0" | "t1", a.delta as number);
        break;
      case "setEdges":
        applied = setEdges(state, a.id as string, a.t0 as number, a.t1 as number);
        break;
      case "insert":
        applied = insertMark(state, a.t0 as number, a.t1 as number, a.id as string);
        break;
      case "remove":
        applied = removeMark(state, a.id as string);
        break;
      case "reset": {
        const r = resetOpen(state);
        state = r.state;
        result = { backTo: r.backTo };
        break;
      }
      case "undo":
        state = undoLast(state);
        break;
      case "load":
        state = { ...emptyState, marks: normalizeMarks(a.raw) };
        break;

      case "openMark":
        result = openMark(state.marks)?.id ?? null;
        break;
      case "lastClosedEnd":
        result = lastClosedEnd(state.marks);
        break;
      case "firstUnscored":
        a.afterId = a.afterId ?? null;
        result = firstUnscored(state.marks, a.afterId as string | null)?.id ?? null;
        break;
      case "allCalled":
        result = allCalled(state.marks);
        break;
      case "gapsAround":
        if (!("durationS" in a)) a.durationS = c.durationS;
        a.id = a.id ?? null;
        result = gapsAround(state.marks, a.id as string | null, a.durationS as number | null);
        break;
      case "draftMode":
        if (!("recorded" in a)) a.recorded = c.mode;
        result = draftMode(state.marks, a.recorded as CutMode | null);
        break;
      case "openAs":
        if (!("durationS" in a)) a.durationS = c.durationS;
        if (!("mode" in a)) a.mode = c.mode ?? "score";
        result = openAs(state.marks, a.durationS as number | null, a.mode as CutMode);
        break;
      case "summarize":
        result = summarize(state.marks);
        break;
      case "submittable":
        result = submittable(state.marks);
        break;
      case "validate":
        if (!("durationS" in a)) a.durationS = c.durationS;
        result = validated(state.marks, a.durationS as number | null);
        break;
      case "asPoints":
        result = asPoints(state.marks);
        break;
      case "score":
        result = scoreResult(state.marks);
        break;
      case "nextServer":
        a.firstServer = a.firstServer ?? null;
        result = markNextServer(state.marks, a.firstServer as "user" | "opponent" | null);
        break;
      default:
        throw new Error(`unknown op ${step.op}`);
    }

    if (applied) state = applied.state;
    const out: Record<string, unknown> = { op: step.op, args: a };
    if (now !== undefined) out.now = now;
    if (rate !== undefined) out.rate = rate;
    out.refused = refusalKey(applied?.refused);
    if (result !== undefined) out.result = result;
    out.expect = snapshot(state);
    return out;
  });
  return { name: c.name, mode: c.mode, durationS: c.durationS, start, steps };
}

function runCheck(c: CheckIn) {
  const a = c.args;
  const marks = a.marks as Mark[];
  let result: unknown;
  switch (c.fn) {
    case "openAs":
      result = openAs(marks, a.durationS as number | null, a.mode as CutMode);
      break;
    case "draftMode":
      result = draftMode(marks, a.recorded as CutMode | null);
      break;
    case "validate":
      result = validated(marks, a.durationS as number | null);
      break;
    case "normalizeMarks":
      result = normalizeMarks(a.raw);
      break;
    case "firstUnscored":
      result = firstUnscored(marks, a.afterId as string | null)?.id ?? null;
      break;
    case "allCalled":
      result = allCalled(marks);
      break;
    case "lastClosedEnd":
      result = lastClosedEnd(marks);
      break;
    default:
      throw new Error(`unknown check ${c.fn}`);
  }
  return { fn: c.fn, args: a, result };
}

/** The whole fixture, exactly as it round-trips through JSON. */
export function buildFixture(): unknown {
  const fixture = {
    note:
      "Generated by scripts/handcut-fixture.ts from src/app/match/[id]/handCut.ts. " +
      "The Swift port must reproduce every step's state and every result. Do not hand-edit.",
    constants: {
      MIN_POINT_S,
      MAX_POINT_S,
      LONGEST_POINT_S,
      PAST_END_ALLOWANCE_S,
      MAX_MARKS,
      SPLIT_LEAD_S,
      LEAD_MIN_S,
      LEAD_MAX_S,
      GAP_WORTH_MARKING_S,
      TAIL_S,
      rounding:
        "Stored times are rounded to 2 decimals with JavaScript Math.round, which " +
        "rounds halves toward positive infinity: floor(x * 100 + 0.5) / 100.",
      lead: "leadFor(rate) = min(LEAD_MAX_S, max(LEAD_MIN_S, SPLIT_LEAD_S * r)), r = rate if finite and > 0, else 1",
    },
    leadFor: [0, -1, 0.1, 0.25, 0.5, 1, 1.5, 2, 3].map((rate) => ({ rate, lead: leadFor(rate) })),
    refusals: REFUSE,
    invalid: INVALID,
    cases: CASES.map(runCase),
    checks: CHECKS.map(runCheck),
  };
  return JSON.parse(JSON.stringify(fixture));
}

/**
 * JSON with small objects kept on one line, so a mark or an undo entry
 * reads as one row and a diff of the fixture shows which steps moved.
 */
function format(value: unknown, indent = ""): string {
  const flat = JSON.stringify(value);
  if (flat === undefined) return "null";
  if (value === null || typeof value !== "object" || flat.length + indent.length <= 110) {
    return flat;
  }
  const inner = indent + "  ";
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[\n${value.map((v) => inner + format(v, inner)).join(",\n")}\n${indent}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return "{}";
  return `{\n${entries
    .map(([k, v]) => `${inner}${JSON.stringify(k)}: ${format(v, inner)}`)
    .join(",\n")}\n${indent}}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = new URL("../ios/Tests/fixtures/handcut-parity.json", import.meta.url);
  const fixture = buildFixture() as { cases: { steps: unknown[] }[]; checks: unknown[] };
  writeFileSync(out, format(fixture) + "\n");
  const steps = fixture.cases.reduce((n, c) => n + c.steps.length, 0);
  console.log(
    `wrote ${fileURLToPath(out)}: ${fixture.cases.length} cases, ${steps} steps, ${fixture.checks.length} checks`
  );
}
