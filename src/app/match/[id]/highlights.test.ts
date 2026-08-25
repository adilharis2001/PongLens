import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import type { Point } from "../../../lib/types.ts";
import { pickHighlights, HIGHLIGHT_BUDGETS_S } from "./highlights.ts";
import { clipPad } from "./clipEdit.ts";
import { sortPoints } from "./gameScore.ts";

const PAD = clipPad("normal", null);

let seq = 0;
function pt(over: Partial<Point> = {}): Point {
  seq += 1;
  return {
    id: `00000000-0000-0000-0000-${String(seq).padStart(12, "0")}`,
    idx: seq,
    t0: seq * 100,
    t1: seq * 100 + 5,
    is_let: false,
    starred: false,
    tight_start: false,
    tight_end: false,
    confirmed_winner: null,
    game_end_override: null,
    clip_path: "c",
    ...over,
  } as unknown as Point;
}

test("fills the budget with the longest rallies", () => {
  const points = [
    pt({ t0: 100, t1: 103 }), // 3s rally
    pt({ t0: 200, t1: 212 }), // 12s
    pt({ t0: 300, t1: 308 }), // 8s
  ];
  // Budget sized to hold exactly the 12s and 3s clips: the 12s ranks
  // first, the 8s no longer fits, the 3s fills the tail.
  const padS = PAD.pre + PAD.post;
  const budget = 12 + 3 + 2 * padS + 0.01;
  const { picks, totalS } = pickHighlights(points, PAD, budget);
  assert.deepEqual(
    picks.map((p) => p.t1! - p.t0!),
    [3, 12]
  );
  assert.ok(totalS <= budget);
});

test("picks come back in match order, not rank order", () => {
  const points = [
    pt({ t0: 100, t1: 104 }),
    pt({ t0: 200, t1: 210 }),
    pt({ t0: 300, t1: 305 }),
  ];
  const { picks } = pickHighlights(points, PAD, 120);
  assert.deepEqual(
    picks.map((p) => p.t0),
    [100, 200, 300]
  );
});

test("a starred rally outranks a longer one, but only two get the nod", () => {
  const points = [
    pt({ t0: 100, t1: 103, starred: true }), // 3s, starred
    pt({ t0: 200, t1: 204, starred: true }), // 4s, starred
    pt({ t0: 300, t1: 305, starred: true }), // 5s, starred
    pt({ t0: 400, t1: 415 }), // 15s, unstarred
  ];
  // Budget holds exactly the two longest starred clips: the boost covers
  // two, so those two beat the 15s rally — and the THIRD star competes on
  // plain length, where 15s wins.
  const padS = PAD.pre + PAD.post;
  const twoStars = 5 + 4 + 2 * padS + 0.01;
  const first = pickHighlights(points, PAD, twoStars);
  assert.deepEqual(
    first.picks.map((p) => p.t0),
    [200, 300]
  );
  const roomy = pickHighlights(points, PAD, twoStars + 15 + padS + 0.01);
  assert.deepEqual(
    roomy.picks.map((p) => p.t0),
    [200, 300, 400] // third star (3s) loses to the 15s rally
  );
});

test("a long rally with almost no recorded contacts drops to the back", () => {
  const sparse = {
    v: 3,
    status: "ready",
    candidates: [{ t: 1 }, { t: 2 }],
    hypotheses: { near: {}, far: {} },
  };
  const points = [
    pt({ t0: 100, t1: 130, placement: sparse } as never), // 30s, 2 contacts
    pt({ t0: 300, t1: 308 }), // 8s, no contact data (reads genuine)
  ];
  const padS = PAD.pre + PAD.post;
  // Room for one clip: the genuine 8s rally wins over the suspect 30s one.
  const { picks } = pickHighlights(points, PAD, 8 + padS + 0.01);
  assert.equal(picks.length, 1);
  assert.equal(picks[0].t0, 300);
  // With room for both, the suspect rally still fills the tail.
  const both = pickHighlights(points, PAD, 38 + 2 * padS + 0.02);
  assert.equal(both.picks.length, 2);
});

test("lets and clipless rallies never make the cut", () => {
  const points = [
    pt({ t0: 100, t1: 120, is_let: true }),
    pt({ t0: 200, t1: 220, clip_path: null }),
    pt({ t0: 300, t1: 303 }),
  ];
  const { picks } = pickHighlights(points, PAD, 120);
  assert.equal(picks.length, 1);
  assert.equal(picks[0].t0, 300);
});

test("a serve error never outranks a real rally, whatever its span claims", () => {
  const points = [
    // One bat contact across a "13.5 second rally": the Prabhas case.
    pt({ t0: 100, t1: 113.5, suggestion: { winner: "user", how: "", n_hits: 1 } } as never),
    pt({ t0: 300, t1: 306, suggestion: { winner: "user", how: "", n_hits: 6 } } as never),
  ];
  const padS = PAD.pre + PAD.post;
  const { picks } = pickHighlights(points, PAD, 6 + padS + 0.01);
  assert.equal(picks.length, 1);
  assert.equal(picks[0].t0, 300);
});

test("a bloated span ranks only as high as its hits vouch for", () => {
  const points = [
    // 25s span but only 5 hits: ranks as 10s of credible play.
    pt({ t0: 100, t1: 125, suggestion: { winner: "user", how: "", n_hits: 5 } } as never),
    // 12s span, 8 hits: honest, ranks as 12s and wins.
    pt({ t0: 300, t1: 312, suggestion: { winner: "user", how: "", n_hits: 8 } } as never),
  ];
  const padS = PAD.pre + PAD.post;
  const { picks } = pickHighlights(points, PAD, 12 + padS + 0.01);
  assert.equal(picks.length, 1);
  assert.equal(picks[0].t0, 300);
});

test("nothing eligible means nothing picked", () => {
  const { picks, totalS } = pickHighlights([], PAD, 20);
  assert.equal(picks.length, 0);
  assert.equal(totalS, 0);
});

// The parity fixture is this module's recorded output over a real match
// (the Swift port replays it in ios/Tests). If the rule changes without
// `node --experimental-strip-types scripts/highlights-fixture.ts` being
// re-run, THIS is the test that says so — otherwise the drift would only
// surface as a Swift failure that looks like the port's fault.
test("the committed parity fixture matches this module's output", () => {
  const fx = JSON.parse(
    readFileSync(
      new URL("../../../../ios/Tests/fixtures/highlights-parity.json", import.meta.url),
      "utf8"
    )
  );
  // The same row mapping the generator uses (scripts/highlights-fixture.ts)
  // — the two MUST agree or parity fails for mapper reasons, not rule
  // reasons.
  const mapRows = (rows: Record<string, unknown>[]) =>
    sortPoints(
      rows.map((r) => ({
        id: r.id,
        idx: r.idx,
        t0: r.t0,
        t1: r.t1,
        is_let: r.is_let,
        starred: r.starred,
        tight_start: r.tight_start,
        tight_end: r.tight_end,
        confirmed_winner: r.confirmed_winner,
        game_end_override: r.game_end_override,
        clip_path: r.has_clip ? "c" : null,
        cut_t0: r.cut_t0 ?? null,
        scored_at_cut_s: r.scored_at_cut_s ?? null,
        edited: false,
        suggestion:
          r.n_hits == null
            ? null
            : { winner: "user", how: "", n_hits: r.n_hits },
        placement:
          r.contacts == null
            ? null
            : {
                v: 3,
                status: "ready",
                candidates: Array.from(
                  { length: r.contacts as number },
                  (_, i) => ({ t: i })
                ),
                hypotheses: { near: {}, far: {} },
              },
      })) as unknown as Point[]
    );
  const pad = clipPad(fx.strictness, fx.clip_pads);
  const points = mapRows(fx.points);
  for (const kind of Object.keys(HIGHLIGHT_BUDGETS_S) as
    (keyof typeof HIGHLIGHT_BUDGETS_S)[]) {
    // No taps in the legacy block: both flag states must reproduce it.
    for (const tapEnd of [false, true]) {
      const { picks, totalS } = pickHighlights(
        points,
        pad,
        HIGHLIGHT_BUDGETS_S[kind],
        tapEnd
      );
      assert.deepEqual(
        picks.map((p) => p.id),
        fx.expected[kind].ids,
        `${kind}: fixture is stale — rerun scripts/highlights-fixture.ts`
      );
      assert.equal(totalS, fx.expected[kind].totalS);
    }
  }

  // The tapped block (Julian 08-23, 76 winner taps): trimmed lengths on,
  // the old rule off.
  assert.ok(fx.tapped, "fixture carries the tapped block");
  const tpad = clipPad(null, fx.tapped.clip_pads);
  const tPoints = mapRows(fx.tapped.points);
  assert.ok(
    tPoints.some((p) => p.scored_at_cut_s !== null),
    "tapped block really carries winner taps"
  );
  for (const kind of Object.keys(HIGHLIGHT_BUDGETS_S) as
    (keyof typeof HIGHLIGHT_BUDGETS_S)[]) {
    const on = pickHighlights(tPoints, tpad, HIGHLIGHT_BUDGETS_S[kind], true);
    assert.deepEqual(
      on.picks.map((p) => p.id),
      fx.tapped.expected[kind].ids,
      `tapped ${kind} on: fixture is stale — rerun scripts/highlights-fixture.ts`
    );
    assert.equal(on.totalS, fx.tapped.expected[kind].totalS);
    const off = pickHighlights(tPoints, tpad, HIGHLIGHT_BUDGETS_S[kind], false);
    assert.deepEqual(
      off.picks.map((p) => p.id),
      fx.tapped.expected_off[kind].ids,
      `tapped ${kind} off: fixture is stale — rerun scripts/highlights-fixture.ts`
    );
    assert.equal(off.totalS, fx.tapped.expected_off[kind].totalS);
  }
});

// The trim itself, on synthetic points where the arithmetic is legible.
test("the winner tap trims a pick's cost, and the budget buys more rallies", () => {
  const PAD = { pre: 1.0, post: 1.6 };
  // Three 10s rallies (12.6s padded). Budget 30: only two fit untrimmed.
  const mk = (n: number, tap: number | null) =>
    ({
      id: `p${n}`,
      idx: n,
      t0: n * 100,
      t1: n * 100 + 10,
      cut_t0: n * 50,
      scored_at_cut_s: tap,
      is_let: false,
      starred: false,
      edited: false,
      tight_start: false,
      tight_end: false,
      confirmed_winner: "user",
      game_end_override: null,
      clip_path: "c",
      suggestion: null,
      placement: null,
    }) as unknown as Point;
  const untapped = [mk(1, null), mk(2, null), mk(3, null)];
  assert.equal(pickHighlights(untapped, PAD, 30, true).picks.length, 2);
  // Tapped 9s into each clip: 9.5s each, all three fit.
  const tapped = [mk(1, 50 + 9), mk(2, 100 + 9), mk(3, 150 + 9)];
  assert.equal(pickHighlights(tapped, PAD, 30, true).picks.length, 3);
  assert.equal(pickHighlights(tapped, PAD, 30, true).totalS, 28.5);
  // The flag off ignores the taps entirely.
  assert.equal(pickHighlights(tapped, PAD, 30, false).picks.length, 2);
});

test("a tap never extends a pick past its padded length", () => {
  const PAD = { pre: 1.0, post: 1.6 };
  const p = {
    id: "p1",
    idx: 1,
    t0: 100,
    t1: 110,
    cut_t0: 50,
    // Tap at the very end of the clip: 62.6 + 0.5 pokes past the 62.6
    // padded end, so the clamp keeps the padded length.
    scored_at_cut_s: 62.4,
    is_let: false,
    starred: false,
    edited: false,
    tight_start: false,
    tight_end: false,
    confirmed_winner: "user",
    game_end_override: null,
    clip_path: "c",
    suggestion: null,
    placement: null,
  } as unknown as Point;
  assert.equal(pickHighlights([p], PAD, 60, true).totalS, 12.6);
});
