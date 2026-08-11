import assert from "node:assert/strict";
import { test } from "node:test";
import type { AggregateStats } from "../../app/stats/aggregate.ts";
import type { Lesson, NoteFeedRow } from "../types.ts";
import {
  MAX_CORPUS_TOKENS,
  approxTokens,
  buildAtCoverage,
  buildCorpus,
  type CorpusInput,
} from "./corpus.ts";

function lesson(over: Partial<Lesson> = {}): Lesson {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    user_id: "u",
    match_id: null,
    transcript: "raw words from the session",
    takeaways: {
      title: "Compact rotation",
      themes: [{ name: "Backhand", points: ["Keep the racket up"] }],
    },
    status: "ready",
    kind: "lesson",
    created_at: "2026-08-01T00:00:00.000Z",
    ...over,
  } as Lesson;
}

function note(over: Partial<NoteFeedRow> = {}): NoteFeedRow {
  return {
    id: "n",
    match_id: "22222222-2222-2222-2222-222222222222",
    point_id: null,
    author_id: "u",
    body: "pushed long again",
    audio_path: null,
    image_path: null,
    created_at: "2026-08-02T00:00:00.000Z",
    author_name: "You",
    match_owner_id: "u",
    opponent_name: "Marco",
    venue: "PingPod",
    played_at: "2026-08-02T00:00:00.000Z",
    user_side: "near",
    player_near_name: null,
    player_far_name: null,
    ...over,
  };
}

function stats(over: Partial<AggregateStats> = {}): AggregateStats {
  return {
    matchesWithScores: 2,
    points: { won: 40, lost: 35 },
    games: { you: 4, them: 3 },
    results: [
      {
        id: "aaaa",
        played_at: "2026-07-01T00:00:00.000Z",
        opponent: "Marco",
        match_type: "match",
        gamesYou: 1,
        gamesThem: 3,
        ptsYou: 18,
        ptsThem: 24,
      },
      {
        id: "bbbb",
        played_at: "2026-08-01T00:00:00.000Z",
        opponent: "Vinay",
        match_type: "league",
        gamesYou: 3,
        gamesThem: 1,
        ptsYou: 22,
        ptsThem: 11,
      },
    ],
    deuceGames: { won: 1, lost: 0 },
    serve: { played: 20, won: 12, pct: 60 },
    receive: { played: 20, won: 8, pct: 40 },
    pressure: { played: 6, won: 3, pct: 50 },
    bounceBack: { played: 10, won: 4, pct: 40 },
    longestStreak: 5,
    serveMine: { spins: [], lengths: [], count: 0 },
    serveTheirs: { spins: [], count: 0 },
    lossReasons: [{ label: "Misread the spin", count: 7 }],
    totalLost: 35,
    opponents: [{ name: "Marco", matches: 1, won: 0, lost: 1 }],
    ...over,
  } as AggregateStats;
}

function input(over: Partial<CorpusInput> = {}): CorpusInput {
  return {
    notes: [note()],
    lessons: [lesson()],
    stats: stats(),
    matchTitles: new Map(),
    focusPoints: [{ label: "Pivot footwork", done: false }],
    tags: [],
    profile: { handedness: "right", grip: "shakehand", style: null },
    ...over,
  };
}

test("the profile is citable, so 'am I right-handed' can be answered", () => {
  // Audit finding, third of the same family (working-on and tags before
  // it): a section without an id can only be answered uncited, and an
  // uncited sentence is dropped — a false refusal on a question the
  // corpus plainly answers.
  const built = buildCorpus(input());
  assert.match(built.text, /\[p1\] THE PLAYER/);
  assert.ok(built.sources.some((s) => s.id === "p1" && s.kind === "profile"));
});

test("every bracketed id in the text resolves to a source", () => {
  const built = buildCorpus(input());
  const ids = new Set(built.sources.map((s) => s.id));
  const cited = [...built.text.matchAll(/\[([a-z]\d+)\]/g)].map((m) => m[1]);
  assert.ok(cited.length > 0, "corpus should label its material");
  for (const id of cited) {
    assert.ok(ids.has(id), `text cites [${id}] with no matching source`);
  }
  assert.equal(new Set(ids).size, built.sources.length, "ids must be unique");
});

test("a level game count is not reported as a loss", () => {
  // Caught in the browser: 1-1 came out as "lost 1-1", and the model
  // repeated it faithfully because repeating is its job.
  const built = buildCorpus(
    input({
      stats: stats({
        results: [
          {
            id: "cccc",
            played_at: "2026-07-25T00:00:00.000Z",
            opponent: "Alex",
            match_type: "match",
            gamesYou: 1,
            gamesThem: 1,
            ptsYou: 31,
            ptsThem: 27,
          },
        ],
      }),
    }),
  );
  assert.doesNotMatch(built.text, /LOST 1-1/);
  assert.match(built.text, /LEVEL \(no winner in the scored games\) 1-1/);
  assert.match(built.text, /0 won, 0 lost, 1 level/);
});

test("match results are precomputed and newest first", () => {
  const built = buildCorpus(input());
  // The model must never have to derive won/lost from the point counts.
  assert.match(built.text, /WON 3-1/);
  assert.match(built.text, /LOST 1-3/);
  const vinay = built.text.indexOf("Vinay");
  const marco = built.text.indexOf("vs Marco");
  assert.ok(vinay < marco, "the newest match should be listed first");
});

test("a lesson carries its coach through to the corpus", () => {
  const built = buildCorpus(
    input({ lessons: [lesson({ coach_name: "Jonathan" })] }),
  );
  assert.match(built.text, /Lesson · with Jonathan/);
});

test("full coverage keeps transcripts; takeaways coverage drops them", () => {
  const only = [lesson({ transcript: "UNIQUETRANSCRIPTMARKER" })];
  const full = buildAtCoverage(input({ lessons: only }), "full");
  const light = buildAtCoverage(input({ lessons: only }), "takeaways");
  assert.match(full.text, /UNIQUETRANSCRIPTMARKER/);
  assert.doesNotMatch(light.text, /UNIQUETRANSCRIPTMARKER/);
  // The distilled version survives the cut — that is the whole point of
  // dropping transcripts before dropping entries.
  assert.match(light.text, /Keep the racket up/);
  assert.ok(light.approxTokens < full.approxTokens);
});

test("a journal too big for the budget steps down instead of blowing it", () => {
  const fat = Array.from({ length: 40 }, (_, i) =>
    lesson({
      id: `lesson-${i}`,
      transcript: "x".repeat(60_000),
      created_at: "2026-08-01T00:00:00.000Z",
    }),
  );
  const built = buildCorpus(input({ lessons: fat }));
  assert.ok(
    built.approxTokens <= MAX_CORPUS_TOKENS,
    `corpus was ${built.approxTokens} tokens, over the ${MAX_CORPUS_TOKENS} ceiling`,
  );
  assert.notEqual(built.coverage, "full");
});

test("padding the journal on purpose still cannot exceed the ceiling", () => {
  // Every tier is over budget: thousands of recent notes, no transcripts
  // to drop and no old material to window away.
  const flood = Array.from({ length: 4000 }, (_, i) =>
    note({
      id: `note-${i}`,
      body: "y".repeat(400),
      created_at: new Date().toISOString(),
    }),
  );
  const built = buildCorpus(input({ notes: flood, lessons: [] }));
  assert.ok(
    built.approxTokens <= MAX_CORPUS_TOKENS,
    `hard truncation failed at ${built.approxTokens} tokens`,
  );
});

test("an empty journal is reported rather than sent", () => {
  const built = buildCorpus(
    input({
      notes: [],
      lessons: [],
      stats: stats({ matchesWithScores: 0, results: [] }),
      focusPoints: [],
    }),
  );
  assert.equal(built.empty, true);
});

test("a note with no words says what it is instead of reading as blank", () => {
  const built = buildCorpus(
    input({ notes: [note({ body: "", audio_path: "voice/u/a.webm" })] }),
  );
  assert.match(built.text, /voice note with no typed words/);
});

test("token estimate is conservative", () => {
  // Under-estimating is what busts a budget, so the estimate must sit at
  // or above the usual 4-chars-a-token rule.
  assert.ok(approxTokens("a".repeat(3600)) >= 900);
});
