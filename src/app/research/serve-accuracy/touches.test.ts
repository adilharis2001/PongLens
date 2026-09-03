import assert from "node:assert/strict";
import test from "node:test";
import { activeTouch, halfOf, touchList } from "./touches.ts";
import { TABLE_L_M, type DetectedEvent } from "./serveAccuracyModel.ts";

/**
 * What the touch list promises.
 *
 * The load-bearing one is the last test: the halves must stay right when
 * the serve roles are stripped, because the roles come from the assumed
 * server and the halves are how you check that assumption.
 */

const ev = (over: Partial<DetectedEvent>): DetectedEvent => ({
  id: "e", kind: "bounce", t: 0, clipT: 0, x: null, y: null,
  u: null, v: null, nu: null, nv: null, visual: 1, audio: 0, role: null,
  ...over,
});

const NEAR_V = 0.6;
const FAR_V = TABLE_L_M - 0.6;

test("v below halfway is the near half, and near is yours when you are near", () => {
  assert.equal(halfOf({ v: NEAR_V }, "near"), "yours");
  assert.equal(halfOf({ v: FAR_V }, "near"), "theirs");
  assert.equal(halfOf({ v: NEAR_V }, "far"), "theirs");
  assert.equal(halfOf({ v: FAR_V }, "far"), "yours");
});

test("no half without a table coordinate or without an end", () => {
  assert.equal(halfOf({ v: null }, "near"), null);
  assert.equal(halfOf({ v: NEAR_V }, null), null);
});

test("touches come back in time order however they went in", () => {
  const list = touchList(
    [ev({ id: "c", t: 3 }), ev({ id: "a", t: 1 }), ev({ id: "b", t: 2 })],
    "near",
  );
  assert.deepEqual(list.map((x) => x.event.id), ["a", "b", "c"]);
  assert.deepEqual(list.map((x) => x.n), [1, 2, 3]);
});

test("the serve's two bounces are named, the rest are counted", () => {
  const list = touchList([
    ev({ id: "s1", t: 0, role: "serve_first_bounce" }),
    ev({ id: "s2", t: 0.3, role: "serve_landing" }),
    ev({ id: "b1", t: 1, role: "landing" }),
    ev({ id: "b2", t: 1.6, role: "landing" }),
  ], "near");
  assert.deepEqual(list.map((x) => x.label), [
    "Serve, 1st bounce",
    "Serve, 2nd bounce",
    "1st bounce after the serve",
    "2nd bounce after the serve",
  ]);
});

test("racket contacts are named but never take a bounce number", () => {
  // Numbering both makes "3rd bounce" mean nothing a player recognises.
  const list = touchList([
    ev({ id: "s", t: 0, role: "serve_landing" }),
    ev({ id: "a", t: 0.5, kind: "contact" }),
    ev({ id: "b", t: 1, kind: "bounce" }),
    ev({ id: "c", t: 2, kind: "contact" }),
    ev({ id: "d", t: 3, kind: "bounce" }),
  ], "near");
  assert.deepEqual(list.map((x) => x.label), [
    "Serve, 2nd bounce", "Hit", "1st bounce after the serve",
    "Hit", "2nd bounce after the serve",
  ]);
});

test("a bounce in the pad before the serve is not counted as a rally bounce", () => {
  // Real shape from Chris point 3: the clip opens on the tail of the
  // previous rally, 0.7s before the serve. Counting from it announced a
  // leftover ball as the first bounce of this point.
  const list = touchList([
    ev({ id: "old", t: 2.73, kind: "bounce" }),
    ev({ id: "s1", t: 3.43, role: "serve_first_bounce" }),
    ev({ id: "s2", t: 3.67, role: "serve_landing" }),
    ev({ id: "b1", t: 4.37, kind: "bounce" }),
    ev({ id: "b2", t: 4.7, kind: "bounce" }),
  ], "near");
  assert.deepEqual(list.map((x) => x.label), [
    "Before the serve",
    "Serve, 1st bounce",
    "Serve, 2nd bounce",
    "1st bounce after the serve",
    "2nd bounce after the serve",
  ]);
});

test("with no serve found, bounces are numbered and claim nothing", () => {
  const list = touchList([
    ev({ id: "a", t: 1, kind: "bounce" }),
    ev({ id: "b", t: 2, kind: "bounce" }),
  ], "near");
  assert.deepEqual(list.map((x) => x.label), ["Bounce 1", "Bounce 2"]);
  assert.deepEqual(list.map((x) => x.fromServer), [false, false]);
});

test("a label that mentions the serve says a wrong server can move it", () => {
  // The flag is what lets the strip warn that a wrong server moved a name.
  const list = touchList([
    ev({ id: "s", t: 0, role: "serve_first_bounce" }),
    ev({ id: "n", t: 1, kind: "bounce", role: null }),
    ev({ id: "c", t: 2, kind: "contact", role: null }),
  ], "near");
  assert.deepEqual(list.map((x) => x.fromServer), [true, true, false]);
});

test("the halves survive the serve roles being wrong", () => {
  // The whole point: strip every role, as a wrong server would, and each
  // bounce still lands on the same half it really landed on.
  const raw = [
    ev({ id: "a", t: 0, v: NEAR_V, role: "serve_first_bounce" }),
    ev({ id: "b", t: 0.3, v: FAR_V, role: "serve_landing" }),
    ev({ id: "c", t: 1, v: NEAR_V, role: "landing" }),
  ];
  const withRoles = touchList(raw, "near").map((x) => x.half);
  const stripped = touchList(raw.map((e) => ({ ...e, role: null })), "near")
    .map((x) => x.half);
  assert.deepEqual(withRoles, ["yours", "theirs", "yours"]);
  assert.deepEqual(stripped, withRoles);
});

test("nothing is lit before the first touch", () => {
  const list = touchList([ev({ t: 1, clipT: 1 })], "near");
  assert.equal(activeTouch(list, 0.2), -1);
});

test("a touch stays lit until the next one takes over", () => {
  const list = touchList([
    ev({ id: "a", t: 1, clipT: 1 }),
    ev({ id: "b", t: 2, clipT: 2 }),
  ], "near");
  assert.equal(activeTouch(list, 1.0), 0);
  assert.equal(activeTouch(list, 1.9), 0, "still the first, not nothing");
  assert.equal(activeTouch(list, 2.5), 1);
  assert.equal(activeTouch(list, 99), 1, "the last one holds to the end");
});

test("a touch with no clip time never becomes the active one", () => {
  // Its time is in source seconds, so lighting it would point at the wrong
  // moment in the video rather than at no moment.
  const list = touchList([
    ev({ id: "a", t: 1, clipT: 1 }),
    ev({ id: "b", t: 2, clipT: null }),
  ], "near");
  assert.equal(activeTouch(list, 5), 0);
});
