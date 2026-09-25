import assert from "node:assert/strict";
import test from "node:test";

import {
  BOTTOM_BAR_H,
  LET_H,
  MIN_RAIL,
  RAIL_GAP,
  TOP_BAR_H,
  markLandscape,
  pairTileHeight,
  railPair,
} from "./markLandscape.ts";

/**
 * The approved board's own arithmetic, copied line for line from
 * renderVals() in docs/superpowers/specs/2026-09-24-ios-hand-cut-
 * landscape-mockup.dc.html. The module must agree with it everywhere, not
 * only on the three boards drawn.
 */
function board(w: number, h: number, sl: number, sr: number, sb: number) {
  const topH = 42, botH = 41, gap = 8;
  const avail = w - sl - sr - 24;
  const midH = h - sb - topH - botH;
  const boxW = Math.min(avail - 192, midH * 16 / 9);
  const boxH = boxW * 9 / 16;
  const rail = Math.max(96, (avail - boxW) / 2);
  const tileW = rail - gap;
  const x0 = sl + 12;
  const yMid = topH + (midH - boxH) / 2;
  const leftX = x0, picX = x0 + rail, rightX = picX + boxW + gap;
  const bigFs = tileW >= 150 ? 22 : (tileW >= 100 ? 19 : 16);
  const aFs = tileW >= 150 ? 30 : (tileW >= 100 ? 26 : 22);
  const letH = 44;
  const aH = (boxH - 2 * gap - letH) / 2;
  const half = (boxH - gap) / 2;
  return {
    avail, midH, boxW, boxH, rail, tileW, x0, yMid, leftX, picX, rightX,
    bigFs, aFs, aH, half, botTop: topH + midH, botHeight: botH + sb,
  };
}

const close = (a: number, b: number, what: string) =>
  assert.ok(Math.abs(a - b) < 1e-9, `${what}: ${a} vs ${b}`);

function sameAsBoard(w: number, h: number, sl: number, sr: number, sb: number) {
  const g = markLandscape(w, h, { left: sl, right: sr, bottom: sb });
  const b = board(w, h, sl, sr, sb);
  const at = `${w}x${h} (${sl},${sr},${sb})`;
  close(g.avail, b.avail, `${at} avail`);
  close(g.midH, b.midH, `${at} midH`);
  close(g.boxW, b.boxW, `${at} boxW`);
  close(g.boxH, b.boxH, `${at} boxH`);
  close(g.rail, b.rail, `${at} rail`);
  close(g.tileW, b.tileW, `${at} tileW`);
  close(g.x0, b.x0, `${at} x0`);
  close(g.yMid, b.yMid, `${at} yMid`);
  close(g.leftX, b.leftX, `${at} leftX`);
  close(g.picX, b.picX, `${at} picX`);
  close(g.rightX, b.rightX, `${at} rightX`);
  close(g.bottomTop, b.botTop, `${at} bottomTop`);
  close(g.bottomH, b.botHeight, `${at} bottomH`);
  close(g.answerH, b.aH, `${at} answerH`);
  close(g.pairHalf, b.half, `${at} pairHalf`);
  assert.equal(g.pairFont, b.bigFs, `${at} pairFont`);
  assert.equal(g.answerFont, b.aFs, `${at} answerFont`);
}

test("the three approved boards, exactly", () => {
  // iPhone 12 with its safe areas; mobile web rotated; mobile web full screen.
  sameAsBoard(844, 390, 47, 47, 21);
  sameAsBoard(852, 348, 0, 0, 0);
  sameAsBoard(660, 393, 0, 0, 0);
});

test("agrees with the board across phone sizes and safe areas", () => {
  for (const w of [568, 640, 667, 736, 812, 844, 852, 874, 896, 926, 932, 956]) {
    for (const h of [320, 340, 348, 375, 390, 393, 414, 430, 440]) {
      for (const [sl, sr, sb] of [[0, 0, 0], [47, 47, 21], [59, 59, 21], [0, 44, 0]]) {
        sameAsBoard(w, h, sl, sr, sb);
      }
    }
  }
});

test("iPhone 12: the numbers the Swift port must reproduce", () => {
  const g = markLandscape(844, 390, { left: 47, right: 47, bottom: 21 });
  assert.equal(g.avail, 726);
  assert.equal(g.midH, 286);
  close(g.boxW, 286 * 16 / 9, "boxW");
  assert.equal(g.boxH, 286);
  close(g.rail, (726 - 286 * 16 / 9) / 2, "rail");
  assert.equal(g.x0, 59);
  assert.equal(g.yMid, TOP_BAR_H);
  assert.equal(g.bottomTop, 328);
  assert.equal(g.bottomH, 62);
  assert.equal(g.pairFont, 19);
  assert.equal(g.answerFont, 26);
  assert.equal(g.answerH, (286 - 2 * RAIL_GAP - LET_H) / 2);
});

test("660 x 393: the picture is capped by width and the rails sit at their floor", () => {
  const g = markLandscape(660, 393);
  assert.equal(g.rail, MIN_RAIL);
  assert.equal(g.tileW, MIN_RAIL - RAIL_GAP);
  assert.equal(g.boxW, 660 - 24 - 2 * MIN_RAIL);
  assert.equal(g.boxH, g.boxW * 9 / 16);
  // Centred between the bars, not pushed against the top one.
  close(g.yMid, TOP_BAR_H + (g.midH - g.boxH) / 2, "yMid");
  assert.equal(g.pairFont, 16);
  assert.equal(g.answerFont, 22);
});

test("zones tile the width with nothing overlapping", () => {
  for (const [w, h, sl, sr, sb] of [
    [844, 390, 47, 47, 21],
    [852, 348, 0, 0, 0],
    [660, 393, 0, 0, 0],
    [932, 430, 59, 59, 21],
  ]) {
    const g = markLandscape(w, h, { left: sl, right: sr, bottom: sb });
    close(g.leftX + g.tileW + RAIL_GAP, g.picX, "left rail to picture");
    close(g.picX + g.boxW + RAIL_GAP, g.rightX, "picture to right rail");
    close(g.rightX + g.tileW, g.x0 + g.avail, "right rail to the margin");
    assert.ok(g.yMid >= TOP_BAR_H, "below the top bar");
    assert.ok(g.yMid + g.boxH <= g.bottomTop + 1e-9, "above the bottom bar");
    close(g.bottomTop + g.bottomH, h, "bottom bar reaches the screen edge");
    assert.ok(g.tileW >= MIN_RAIL - RAIL_GAP);
  }
});

test("another aspect ratio gets its own box, never bars inside a 16:9 one", () => {
  const g = markLandscape(852, 348, { left: 0, right: 0, bottom: 0 }, 4 / 3);
  const midH = 348 - TOP_BAR_H - BOTTOM_BAR_H;
  assert.equal(g.boxH, midH);
  close(g.boxW, midH * 4 / 3, "boxW");
  close(g.rail, (828 - g.boxW) / 2, "rail");
  // A nonsense aspect falls back to the board's 16:9.
  const bad = markLandscape(852, 348, undefined, 0);
  sameAsBoard(852, 348, 0, 0, 0);
  close(bad.boxW, markLandscape(852, 348).boxW, "fallback");
});

test("a screen too small for the rails gives an empty picture, not a negative one", () => {
  const g = markLandscape(200, 120);
  assert.equal(g.boxW, 0);
  assert.equal(g.boxH, 0);
});

test("the right rail: gate, pair and review, top to bottom", () => {
  const base = { started: true, opened: "fresh" as const, reviewing: false, adjusting: false, open: false };
  const labels = (s: Parameters<typeof railPair>[0]) =>
    railPair(s).map((t) => `${t.label}:${t.tone}`);

  assert.deepEqual(labels({ ...base, started: false }), ["Begin Cutting:lit"]);
  assert.deepEqual(labels({ ...base, started: false, opened: "review" }), ["Begin review:lit"]);
  assert.deepEqual(labels({ ...base, started: false, opened: "choice" }), [
    "Keep marking:lit",
    "Review the points:unlit",
  ]);
  assert.deepEqual(labels(base), ["Begin Point:lit", "End Point:off"]);
  assert.deepEqual(labels({ ...base, open: true }), ["Back to last point:unlit", "End Point:lit"]);
  assert.deepEqual(labels({ ...base, reviewing: true }), ["Adjust:lit", "Resume:unlit"]);
  assert.deepEqual(labels({ ...base, reviewing: true, adjusting: true }), [
    "Confirm:lit",
    "Resume:off",
  ]);
  // A selected point outranks a rally left open elsewhere: the slots mean
  // Adjust and Resume while one is selected.
  assert.deepEqual(labels({ ...base, reviewing: true, open: true }), ["Adjust:lit", "Resume:unlit"]);
});

test("rail tile heights follow the board", () => {
  const boxH = 265;
  const [keep, review] = railPair({ started: false, opened: "choice", reviewing: false, adjusting: false, open: false });
  close(pairTileHeight(keep, 2, boxH), (boxH - RAIL_GAP) * 0.58, "keep marking");
  close(pairTileHeight(review, 2, boxH), (boxH - RAIL_GAP) * 0.42, "review the points");
  const [begin] = railPair({ started: true, opened: "fresh", reviewing: false, adjusting: false, open: false });
  close(pairTileHeight(begin, 2, boxH), (boxH - RAIL_GAP) / 2, "half");
  const [gate] = railPair({ started: false, opened: "fresh", reviewing: false, adjusting: false, open: false });
  assert.equal(pairTileHeight(gate, 1, boxH), boxH);
});

test("marking a processed match again: the gate always has a way to start again", () => {
  const gate = { started: false, reviewing: false, adjusting: false, open: false, startAgain: true };
  const labels = (s: Parameters<typeof railPair>[0]) =>
    railPair(s).map((t) => `${t.label}:${t.tone}:${t.action}`);
  assert.deepEqual(labels({ ...gate, opened: "choice" }), [
    "Keep marking:lit:keepMarking",
    "Review the points:unlit:reviewPoints",
    "Start again:unlit:startAgain",
  ]);
  assert.deepEqual(labels({ ...gate, opened: "review" }), [
    "Begin review:lit:beginReview",
    "Start again:unlit:startAgain",
  ]);
  // A draft with points still to call opens at the gate only here, and
  // carries on from the first uncalled point.
  assert.deepEqual(labels({ ...gate, opened: "scoring" }), [
    "Keep marking:lit:beginCutting",
    "Start again:unlit:startAgain",
  ]);
  // Nothing to clear: no Start again.
  assert.deepEqual(labels({ ...gate, opened: "fresh", startAgain: false }), [
    "Begin Cutting:lit:beginCutting",
  ]);
  // The shares still fill the rail exactly.
  for (const opened of ["choice", "review", "scoring"] as const) {
    const tiles = railPair({ ...gate, opened });
    const boxH = 265;
    const sum = tiles.reduce((h, t) => h + pairTileHeight(t, tiles.length, boxH), 0);
    close(sum + RAIL_GAP * (tiles.length - 1), boxH, `${opened} fills the rail`);
  }
});
