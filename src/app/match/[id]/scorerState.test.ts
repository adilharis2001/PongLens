import assert from "node:assert/strict";
import test from "node:test";
import {
  ScorePlaybackRun,
  sameScorerState,
  scorerState,
  skipState,
  winnerState,
  type ScorerState,
} from "./scorerState.ts";

const before: ScorerState = {
  confirmed_winner: "user",
  is_let: false,
  scored_at_cut_s: 60,
};

test("a winner correction preserves the active ending observation", () => {
  assert.deepEqual(winnerState(before, "opponent", 51), {
    ...before,
    confirmed_winner: "opponent",
  });
});

test("clearing an answer clears its ending observation", () => {
  assert.deepEqual(winnerState(before, null), {
    confirmed_winner: null,
    is_let: false,
    scored_at_cut_s: null,
  });
});

test("Skip clears the answer and ending together", () => {
  assert.deepEqual(skipState(before, true), {
    confirmed_winner: null,
    is_let: true,
    scored_at_cut_s: null,
  });
});

test("assigning a winner to a skipped legacy row cannot reactivate its stale tap", () => {
  assert.deepEqual(
    winnerState(
      { confirmed_winner: null, is_let: true, scored_at_cut_s: 60 },
      "opponent",
      61,
    ),
    {
      confirmed_winner: "opponent",
      is_let: false,
      scored_at_cut_s: null,
    },
  );
});

test("a paused first answer cannot reactivate an orphan tap from a legacy unskip", () => {
  const orphaned: ScorerState = {
    confirmed_winner: null,
    is_let: false,
    scored_at_cut_s: 60,
  };
  assert.deepEqual(winnerState(orphaned, "user"), {
    confirmed_winner: "user",
    is_let: false,
    scored_at_cut_s: null,
  });
});

test("only a finite first-answer observation creates a new ending", () => {
  const unanswered: ScorerState = {
    confirmed_winner: null,
    is_let: false,
    scored_at_cut_s: null,
  };
  assert.deepEqual(winnerState(unanswered, "user", 50.4), {
    confirmed_winner: "user",
    is_let: false,
    scored_at_cut_s: 50.4,
  });
  assert.deepEqual(winnerState(unanswered, "user", Number.NaN), {
    confirmed_winner: "user",
    is_let: false,
    scored_at_cut_s: null,
  });
  assert.deepEqual(winnerState(unanswered, "user", Number.POSITIVE_INFINITY), {
    confirmed_winner: "user",
    is_let: false,
    scored_at_cut_s: null,
  });
});

test("scorerState normalizes skipped and non-finite legacy observations", () => {
  assert.deepEqual(
    scorerState({
      confirmed_winner: null,
      is_let: true,
      scored_at_cut_s: 60,
    }),
    { confirmed_winner: null, is_let: true, scored_at_cut_s: null },
  );
  assert.deepEqual(
    scorerState({
      confirmed_winner: "user",
      is_let: false,
      scored_at_cut_s: Number.NaN,
    }),
    { confirmed_winner: "user", is_let: false, scored_at_cut_s: null },
  );
});

test("sameScorerState compares all coupled scorer fields", () => {
  assert.equal(sameScorerState(before, { ...before }), true);
  assert.equal(
    sameScorerState(before, { ...before, scored_at_cut_s: 59.9 }),
    false,
  );
});

const event = {
  pointId: "p",
  start: 50,
  end: 65,
  time: 50,
  playing: true,
  ready: true,
  foreground: true,
  sourceKey: "cut",
};

test("a continuous foreground cut run records its current cut clock", () => {
  const run = new ScorePlaybackRun();
  run.observe(event);
  assert.equal(run.observation({ ...event, time: 60 }), 60);
});

test("a continuous accelerated step across a point start arms the next point", () => {
  const run = new ScorePlaybackRun();
  const previous = {
    ...event,
    pointId: "previous",
    start: 0,
    end: 9,
    time: 0,
  };
  run.observe(previous);
  run.observe({ ...previous, time: 8.7 });

  const next = {
    ...event,
    pointId: "next",
    start: 9,
    end: 12,
    time: 9.1,
  };
  run.observe(next);

  assert.equal(run.observation({ ...next, time: 9.5 }), 9.5);
});

test("an invalidated run cannot re-arm from a mid-rally resume", () => {
  const run = new ScorePlaybackRun();
  run.observe(event);
  assert.equal(run.observation({ ...event, time: 58 }), 58);
  run.invalidate();
  run.observe({ ...event, time: 59 });
  assert.equal(run.observation({ ...event, time: 60 }), undefined);
});

test("pause and resume mid-rally retire the observation", () => {
  const run = new ScorePlaybackRun();
  run.observe(event);
  run.observe({ ...event, time: 55, playing: false });
  run.observe({ ...event, time: 55, playing: true });
  assert.equal(run.observation({ ...event, time: 56 }), undefined);
});

test("buffering and recovery mid-rally retire the observation", () => {
  const run = new ScorePlaybackRun();
  run.observe(event);
  run.observe({ ...event, time: 54, ready: false });
  run.observe({ ...event, time: 54, ready: true });
  assert.equal(run.observation({ ...event, time: 55 }), undefined);
});

test("leaving the foreground and returning mid-rally retires the observation", () => {
  const run = new ScorePlaybackRun();
  run.observe(event);
  run.observe({ ...event, time: 53, foreground: false });
  run.observe({ ...event, time: 53, foreground: true });
  assert.equal(run.observation({ ...event, time: 54 }), undefined);
});

test("a seek invalidation can re-arm only after landing back at the start", () => {
  const run = new ScorePlaybackRun();
  run.observe(event);
  run.invalidate();
  run.observe({ ...event, time: 58 });
  assert.equal(run.observation({ ...event, time: 59 }), undefined);
  run.observe(event);
  assert.equal(run.observation({ ...event, time: 55 }), 55);
});

test("a new point arms only when first observed at or before its start", () => {
  const run = new ScorePlaybackRun();
  run.observe(event);
  const next = { ...event, pointId: "next", start: 70, end: 71, time: 70 };
  run.observe(next);
  assert.equal(run.observation({ ...next, time: 70.2 }), 70.2);

  const stale = { ...event, pointId: "stale", start: 80, end: 90, time: 83 };
  run.observe(stale);
  assert.equal(run.observation({ ...stale, time: 84 }), undefined);
});

test("stale point, source, or timing-window observations are rejected", () => {
  const run = new ScorePlaybackRun();
  run.observe(event);
  assert.equal(
    run.observation({ ...event, pointId: "other", time: 55 }),
    undefined,
  );
  assert.equal(
    run.observation({ ...event, sourceKey: "other", time: 55 }),
    undefined,
  );
  assert.equal(run.observation({ ...event, end: 64, time: 55 }), undefined);
});

test("detour clocks are ineligible until source mapping exists", () => {
  const run = new ScorePlaybackRun();
  const detour = { ...event, sourceKey: "point:p" };
  run.observe(detour);
  assert.equal(run.observation({ ...detour, time: 55 }), undefined);
});

test("short serves have no duration minimum", () => {
  const run = new ScorePlaybackRun();
  const short = { ...event, end: 50.12 };
  run.observe(short);
  assert.equal(run.observation({ ...short, time: 50.1 }), 50.1);
});

test("a known own-clip candidate rejects main-cut fallback after signing fails", () => {
  const run = new ScorePlaybackRun();
  const fallback = { ...event, start: 8, time: 8, requiresOwnClip: true };
  run.observe(fallback);
  assert.equal(run.observation({ ...fallback, time: 8.24 }), undefined);
});

test("an observation must still be active, ready, foreground, finite, and in-window", () => {
  const run = new ScorePlaybackRun();
  run.observe(event);
  assert.equal(run.observation({ ...event, time: 60, playing: false }), undefined);
  assert.equal(run.observation({ ...event, time: 60, ready: false }), undefined);
  assert.equal(
    run.observation({ ...event, time: 60, foreground: false }),
    undefined,
  );
  assert.equal(run.observation({ ...event, time: Number.NaN }), undefined);
  assert.equal(run.observation({ ...event, time: 65.01 }), undefined);
});
