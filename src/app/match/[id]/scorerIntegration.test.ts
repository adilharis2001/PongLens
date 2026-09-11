import assert from "node:assert/strict";
import test from "node:test";
import type { Point } from "@/lib/types";
import { effectiveEnd, scorekeeperEnds } from "./playhead.ts";
import {
  ScorerCommands,
  isScorerFailure,
  applySynchronousStateUpdate,
  scorerTimingGuard,
  type ScorerCommandReceipt,
  type ScorerState,
} from "./scorerState.ts";
import * as scorer from "./scorerState.ts";

type TestPoint = Pick<
  Point,
  | "id"
  | "confirmed_winner"
  | "is_let"
  | "scored_at_cut_s"
  | "cut_t0"
  | "t0"
  | "t1"
  | "edited"
  | "tight_start"
  | "tight_end"
> & {
  starred?: boolean;
  note?: string;
  rally_end_cut_s?: number | null;
};

function point(id: string, over: Partial<TestPoint> = {}): TestPoint {
  return {
    id,
    confirmed_winner: null,
    is_let: false,
    scored_at_cut_s: null,
    cut_t0: 50,
    t0: 100,
    t1: 109,
    edited: false,
    tight_start: false,
    tight_end: false,
    starred: false,
    note: "keep",
    rally_end_cut_s: 59,
    ...over,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function harness(initial: TestPoint[]) {
  const local = new Map(initial.map((p) => [p.id, { ...p }]));
  const remote = new Map(initial.map((p) => [p.id, { ...p }]));
  const writes: {
    pointId: string;
    state: ScorerState;
    gate: ReturnType<typeof deferred<boolean>>;
  }[] = [];
  const commands = new ScorerCommands({
    read: (id) => local.get(id) ?? null,
    apply: (id, state) => {
      const current = local.get(id);
      if (current) local.set(id, { ...current, ...state });
    },
    persist: (id, state) => {
      const gate = deferred<boolean>();
      writes.push({ pointId: id, state: { ...state }, gate });
      return gate.promise.then((ok) => {
        if (ok) {
          const current = remote.get(id);
          if (current) remote.set(id, { ...current, ...state });
        }
        return ok;
      });
    },
  });
  return { commands, local, remote, writes };
}

async function tick() {
  await Promise.resolve();
  await Promise.resolve();
}

function synchronousPointHarness(initial: TestPoint[]) {
  const ref = { current: initial.map((p) => ({ ...p })) };
  let rendered = ref.current;
  const update = (
    transition: TestPoint[] | ((current: TestPoint[]) => TestPoint[]),
  ) =>
    applySynchronousStateUpdate(ref, (next) => {
      rendered = next;
    }, transition);
  const commands = new ScorerCommands({
    read: (id) => ref.current.find((p) => p.id === id) ?? null,
    apply: (id, state) =>
      update((points) =>
        points.map((p) => (p.id === id ? { ...p, ...state } : p)),
      ),
    persist: async () => true,
  });
  return { commands, rendered: () => rendered, update };
}

test("same-turn scoring preserves a pending join structure", async () => {
  const h = synchronousPointHarness([
    point("survivor", { t1: 109 }),
    point("joined", { cut_t0: 61, t0: 110, t1: 119 }),
  ]);
  h.update((points) =>
    points
      .filter((p) => p.id !== "joined")
      .map((p) =>
        p.id === "survivor" ? { ...p, t1: 119, edited: true } : p,
      ),
  );

  assert.ok(await h.commands.winner("survivor", "user"));
  assert.deepEqual(
    h.rendered().map((p) => ({
      id: p.id,
      winner: p.confirmed_winner,
      t1: p.t1,
      edited: p.edited,
    })),
    [{ id: "survivor", winner: "user", t1: 119, edited: true }],
  );
});

test("same-turn scoring preserves a pending split Undo structure", async () => {
  const h = synchronousPointHarness([
    point("parent", { t1: 105, tight_end: true, edited: true }),
    point("child", { cut_t0: 56, t0: 106, t1: 109 }),
  ]);
  h.update((points) =>
    points
      .filter((p) => p.id !== "child")
      .map((p) =>
        p.id === "parent"
          ? { ...p, t1: 109, tight_end: false, edited: true }
          : p,
      ),
  );

  assert.ok(await h.commands.winner("parent", "opponent"));
  assert.deepEqual(
    h.rendered().map((p) => ({
      id: p.id,
      winner: p.confirmed_winner,
      t1: p.t1,
      tightEnd: p.tight_end,
    })),
    [{ id: "parent", winner: "opponent", t1: 109, tightEnd: false }],
  );
});

test("a failed clear restores the complete scorer state and no unrelated field", async () => {
  const h = harness([
    point("p", { confirmed_winner: "user", scored_at_cut_s: 60 }),
  ]);
  const result = h.commands.winner("p", null);
  await tick();
  assert.deepEqual(
    {
      winner: h.local.get("p")!.confirmed_winner,
      tap: h.local.get("p")!.scored_at_cut_s,
    },
    { winner: null, tap: null },
  );
  h.local.get("p")!.starred = true;
  h.local.get("p")!.note = "newer";
  h.writes[0].gate.resolve(false);
  assert.deepEqual(await result, { failed: true });
  assert.deepEqual(
    {
      winner: h.local.get("p")!.confirmed_winner,
      skipped: h.local.get("p")!.is_let,
      tap: h.local.get("p")!.scored_at_cut_s,
      starred: h.local.get("p")!.starred,
      note: h.local.get("p")!.note,
    },
    {
      winner: "user",
      skipped: false,
      tap: 60,
      starred: true,
      note: "newer",
    },
  );
});

test("a failed clear cannot restore an old tap after the timing window changed", async () => {
  const h = harness([
    point("p", { confirmed_winner: "user", scored_at_cut_s: 60 }),
  ]);
  const result = h.commands.winner("p", null);
  await tick();
  h.local.get("p")!.t1 = 110;
  h.writes[0].gate.resolve(false);
  assert.deepEqual(await result, { failed: true });
  assert.deepEqual(
    {
      winner: h.local.get("p")!.confirmed_winner,
      tap: h.local.get("p")!.scored_at_cut_s,
      t1: h.local.get("p")!.t1,
    },
    { winner: "user", tap: null, t1: 110 },
  );
});

test("a failed Skip restores winner, Skip, and ending together", async () => {
  const h = harness([
    point("p", { confirmed_winner: "user", scored_at_cut_s: 60 }),
  ]);
  const result = h.commands.skip("p", true);
  await tick();
  assert.deepEqual(
    {
      winner: h.local.get("p")!.confirmed_winner,
      skipped: h.local.get("p")!.is_let,
      tap: h.local.get("p")!.scored_at_cut_s,
    },
    { winner: null, skipped: true, tap: null },
  );
  h.writes[0].gate.resolve(false);
  assert.deepEqual(await result, { failed: true });
  assert.deepEqual(
    {
      winner: h.local.get("p")!.confirmed_winner,
      skipped: h.local.get("p")!.is_let,
      tap: h.local.get("p")!.scored_at_cut_s,
    },
    { winner: "user", skipped: false, tap: 60 },
  );
});

test("immediate Undo waits for its pending command receipt", async () => {
  const h = harness([point("p")]);
  const command = h.commands.winner("p", "user", 60);
  const undo = h.commands.beginRestore("p", command);
  await tick();
  assert.equal(h.writes.length, 1);
  h.writes[0].gate.resolve(true);
  assert.ok(await command);
  await tick();
  assert.equal(h.writes.length, 2);
  assert.deepEqual(h.writes[1].state, {
    confirmed_winner: null,
    is_let: false,
    scored_at_cut_s: null,
  });
  h.writes[1].gate.resolve(true);
  assert.ok(await undo);
  assert.equal(h.local.get("p")!.confirmed_winner, null);
  assert.equal(h.local.get("p")!.scored_at_cut_s, null);
});

test("rapid corrections serialize per point and preserve the first ending", async () => {
  const h = harness([point("p")]);
  const first = h.commands.winner("p", "user", 60);
  const correction = h.commands.winner("p", "opponent", 51);
  await tick();
  assert.equal(h.writes.length, 1);
  h.writes[0].gate.resolve(true);
  const firstReceipt = await first;
  assert.ok(firstReceipt);
  await tick();
  assert.equal(h.writes.length, 2);
  assert.deepEqual(h.writes[1].state, {
    confirmed_winner: "opponent",
    is_let: false,
    scored_at_cut_s: 60,
  });
  h.writes[1].gate.resolve(true);
  assert.ok(await correction);
  assert.equal(h.remote.get("p")!.confirmed_winner, "opponent");
  assert.equal(h.remote.get("p")!.scored_at_cut_s, 60);
});

test("Undo reserves its position before a later opponent correction", async () => {
  const h = harness([point("p", { confirmed_winner: "user", scored_at_cut_s: 60 })]);
  const clear = h.commands.winner("p", null);
  const undo = h.commands.beginRestore("p", clear);
  const opponent = h.commands.winner("p", "opponent");
  await tick();
  h.writes[0].gate.resolve(true);
  await clear;
  await tick();
  assert.deepEqual(h.writes[1].state, {
    confirmed_winner: "user", is_let: false, scored_at_cut_s: 60,
  });
  h.writes[1].gate.resolve(true);
  await undo;
  await tick();
  assert.deepEqual(h.writes[2].state, {
    confirmed_winner: "opponent", is_let: false, scored_at_cut_s: 60,
  });
  h.writes[2].gate.resolve(true);
  await opponent;
});

test("failed persistence is distinguishable from an unchanged winner", async () => {
  const h = harness([point("p")]);
  assert.equal(await h.commands.winner("p", null), null);
  const first = h.commands.winner("p", "user", 60);
  await tick();
  h.writes[0].gate.resolve(false);
  assert.deepEqual(await first, { failed: true });
  assert.equal(h.local.get("p")!.confirmed_winner, null);
});

for (const action of ["close", "reopen", "navigate", "unchanged"] as const) {
  test(`delayed Undo persists but respects ${action} playback ownership`, async () => {
    const h = harness([point("p", { confirmed_winner: "user", scored_at_cut_s: 60 })]);
    const effects = new scorer.ScorerSessionEffects();
    effects.open();
    const clear = h.commands.winner("p", null);
    const owner = effects.capture();
    const restore = h.commands.beginRestore("p", clear);
    let replays = 0;
    const completion = restore.then(() => {
      if (effects.owns(owner)) replays += 1;
    });
    if (action === "close" || action === "reopen") effects.close();
    if (action === "reopen") effects.open();
    if (action === "navigate") effects.navigate();
    await tick();
    h.writes[0].gate.resolve(true);
    await clear;
    await tick();
    h.writes[1].gate.resolve(true);
    await completion;
    assert.equal(h.remote.get("p")!.scored_at_cut_s, 60);
    assert.equal(replays, action === "unchanged" ? 1 : 0);
  });
}

test("an edited point scores without creating a new ending observation", async () => {
  const h = harness([point("p", { edited: true })]);
  const result = h.commands.winner("p", "user", 60);
  await tick();
  assert.deepEqual(h.writes[0].state, {
    confirmed_winner: "user",
    is_let: false,
    scored_at_cut_s: null,
  });
  h.writes[0].gate.resolve(true);
  assert.ok(await result);
});

test("a correction after a failed first request resolves from the rolled-back state", async () => {
  const h = harness([point("p")]);
  const first = h.commands.winner("p", "user", 60);
  const correction = h.commands.winner("p", "opponent", 51);
  await tick();
  h.writes[0].gate.resolve(false);
  assert.deepEqual(await first, { failed: true });
  await tick();
  assert.deepEqual(h.writes[1].state, {
    confirmed_winner: "opponent",
    is_let: false,
    scored_at_cut_s: 51,
  });
  h.writes[1].gate.resolve(true);
  assert.ok(await correction);
  assert.equal(h.remote.get("p")!.confirmed_winner, "opponent");
  assert.equal(h.remote.get("p")!.scored_at_cut_s, 51);
});

test("a queued first answer discards an observation from an older timing window", async () => {
  const initial = point("p", { is_let: true });
  const h = harness([initial]);
  const first = h.commands.skip("p", false);
  const queued = h.commands.winner(
    "p",
    "opponent",
    51,
    scorerTimingGuard(initial),
  );
  await tick();
  h.local.get("p")!.t1 = 110;
  h.writes[0].gate.resolve(true);
  assert.ok(await first);
  await tick();
  assert.deepEqual(h.writes[1].state, {
    confirmed_winner: "opponent",
    is_let: false,
    scored_at_cut_s: null,
  });
  h.writes[1].gate.resolve(true);
  assert.ok(await queued);
});

test("independent point requests may finish out of order", async () => {
  const h = harness([point("a"), point("b", { cut_t0: 70 })]);
  const a = h.commands.winner("a", "user", 60);
  const b = h.commands.winner("b", "opponent", 75);
  await tick();
  assert.equal(h.writes.length, 2);
  const aWrite = h.writes.find((w) => w.pointId === "a")!;
  const bWrite = h.writes.find((w) => w.pointId === "b")!;
  bWrite.gate.resolve(true);
  assert.ok(await b);
  assert.equal(h.remote.get("b")!.confirmed_winner, "opponent");
  assert.equal(h.remote.get("a")!.confirmed_winner, null);
  aWrite.gate.resolve(true);
  assert.ok(await a);
});

test("correction and Undo keep the same effective ending", async () => {
  const p = point("p", {
    confirmed_winner: "user",
    scored_at_cut_s: 60,
  });
  const h = harness([p]);
  const beforeEnd = effectiveEnd(
    p as Point,
    { pre: 1, post: 1 },
    { tapEnd: true },
  );
  const correction = h.commands.winner("p", "opponent", 51);
  await tick();
  h.writes[0].gate.resolve(true);
  const receipt = await correction;
  assert.ok(receipt && !isScorerFailure(receipt));
  const correctedEnd = effectiveEnd(
    h.local.get("p") as Point,
    { pre: 1, post: 1 },
    { tapEnd: true },
  );
  assert.equal(correctedEnd, beforeEnd);

  const undo = h.commands.restore(receipt!);
  await tick();
  h.writes[1].gate.resolve(true);
  assert.ok(await undo);
  const restoredEnd = effectiveEnd(
    h.local.get("p") as Point,
    { pre: 1, post: 1 },
    { tapEnd: true },
  );
  assert.equal(restoredEnd, beforeEnd);
  assert.equal(h.local.get("p")!.scored_at_cut_s, 60);
});

test("Undo rejects a newer outcome or timing window", async () => {
  const h = harness([point("p")]);
  const command = h.commands.winner("p", "user", 60);
  await tick();
  h.writes[0].gate.resolve(true);
  const receipt = await command;
  assert.ok(receipt && !isScorerFailure(receipt));

  h.local.get("p")!.confirmed_winner = "opponent";
  assert.equal(await h.commands.restore(receipt!), null);
  assert.equal(h.writes.length, 1);

  h.local.get("p")!.confirmed_winner = "user";
  h.local.get("p")!.t1 = 110;
  assert.equal(await h.commands.restore(receipt!), null);
  assert.equal(h.writes.length, 1);
});

test("full-card toggle changes playback after a correction without changing its saved ending", async () => {
  const h = synchronousPointHarness([
    point("p", { confirmed_winner: "user", scored_at_cut_s: 60 }),
  ]);
  const receipt = await h.commands.winner("p", "opponent", 51);
  assert.ok(receipt && !isScorerFailure(receipt));
  const corrected = h.rendered()[0] as Point;
  const pad = { pre: 1, post: 1 };
  const ends = { tapEnd: true, keepScoreFullCard: true };
  assert.equal(effectiveEnd(corrected, pad, scorekeeperEnds(ends)), 61);
  assert.equal(effectiveEnd(corrected, pad, scorekeeperEnds({ ...ends, keepScoreFullCard: false })), 60.5);
  assert.equal(effectiveEnd(corrected, pad, ends), 60.5);
  assert.equal(corrected.scored_at_cut_s, 60);
  assert.ok(await h.commands.restore(receipt));
  assert.equal(effectiveEnd(h.rendered()[0] as Point, pad, scorekeeperEnds(ends)), 61);
});

test("a failed Undo retains the committed outcome for retry", async () => {
  const h = harness([point("p")]);
  const command = h.commands.winner("p", "user", 60);
  await tick();
  h.writes[0].gate.resolve(true);
  const receipt = (await command) as ScorerCommandReceipt;
  const undo = h.commands.restore(receipt);
  await tick();
  h.writes[1].gate.resolve(false);
  assert.deepEqual(await undo, { failed: true });
  assert.equal(h.local.get("p")!.confirmed_winner, "user");
  assert.equal(h.local.get("p")!.scored_at_cut_s, 60);
});
