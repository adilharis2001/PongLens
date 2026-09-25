import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_ASPECT,
  MIN_ASPECT,
  MIN_TRIM_S,
  SEEK_STALE_MS,
  previewAspect,
  scrubSeeker,
  stampEnd,
  stampStart,
  type SeekableVideo,
} from "./trimSeek.ts";

/** A <video> that records what was asked of it and answers 'seeked' when
 *  told to. */
function fakeVideo(opts: { fastSeek?: boolean; readyState?: number; playing?: boolean } = {}) {
  const log: string[] = [];
  let listeners: (() => void)[] = [];
  let time = 0;
  const v = {
    get currentTime() {
      return time;
    },
    set currentTime(t: number) {
      time = t;
      log.push(`exact ${t}`);
    },
    paused: !opts.playing,
    readyState: opts.readyState ?? 4,
    pause() {
      v.paused = true;
      log.push("pause");
    },
    addEventListener(_type: "seeked", fn: () => void) {
      listeners.push(fn);
    },
    ...(opts.fastSeek
      ? {
          fastSeek(t: number) {
            time = t;
            log.push(`fast ${t}`);
          },
        }
      : {}),
  };
  const seeked = () => {
    const now = listeners;
    listeners = [];
    now.forEach((fn) => fn());
  };
  return { v: v as SeekableVideo, log, seeked };
}

test("Start here / End here put the handle at the playhead, never under five seconds apart", () => {
  assert.equal(MIN_TRIM_S, 5);
  assert.equal(stampStart(30, 600), 30);
  assert.equal(stampStart(598, 600), 595);
  assert.equal(stampStart(3, 4), 0);
  assert.equal(stampEnd(500, 30, 600), 500);
  assert.equal(stampEnd(32, 30, 600), 35);
  assert.equal(stampEnd(700, 30, 600), 600);
});

test("the preview box takes the video's shape, within limits", () => {
  assert.equal(previewAspect(null, null), DEFAULT_ASPECT);
  assert.equal(previewAspect(1920, 1080), 16 / 9);
  assert.equal(previewAspect(1440, 1080), 4 / 3);
  // Wider than 16:9 is letterboxed; portrait sits in a 4:3 box.
  assert.equal(previewAspect(2560, 1080), DEFAULT_ASPECT);
  assert.equal(previewAspect(1080, 1920), MIN_ASPECT);
  assert.equal(previewAspect(0, 1080), DEFAULT_ASPECT);
});

test("dragging: one fast seek in flight, the newest position next, the rest dropped", () => {
  const { v, log, seeked } = fakeVideo({ fastSeek: true });
  const s = scrubSeeker(() => 0);
  s.scrub(v, 10);
  s.scrub(v, 11);
  s.scrub(v, 12);
  s.scrub(v, 13);
  assert.deepEqual(log, ["fast 10"]);
  seeked();
  assert.deepEqual(log, ["fast 10", "fast 13"]);
  seeked();
  assert.deepEqual(log, ["fast 10", "fast 13"]);
  s.scrub(v, 20);
  assert.deepEqual(log, ["fast 10", "fast 13", "fast 20"]);
});

test("without fastSeek (Chrome) the drag's seeks are exact, still one at a time", () => {
  const { v, log, seeked } = fakeVideo();
  const s = scrubSeeker(() => 0);
  s.scrub(v, 10);
  s.scrub(v, 11);
  assert.deepEqual(log, ["exact 10"]);
  seeked();
  assert.deepEqual(log, ["exact 10", "exact 11"]);
});

test("release: the exact frame where the handle stopped, whatever was waiting", () => {
  const { v, log, seeked } = fakeVideo({ fastSeek: true });
  const s = scrubSeeker(() => 0);
  s.scrub(v, 10);
  s.scrub(v, 14);
  s.release(v, 14.2);
  assert.deepEqual(log, ["fast 10", "exact 14.2"]);
  assert.equal(v.currentTime, 14.2);
  // The fast seek's answer arriving late does not move the picture again.
  seeked();
  assert.deepEqual(log, ["fast 10", "exact 14.2"]);
});

test("a playing preview pauses when a handle is grabbed", () => {
  const { v, log } = fakeVideo({ fastSeek: true, playing: true });
  scrubSeeker(() => 0).scrub(v, 5);
  assert.deepEqual(log, ["pause", "fast 5"]);
});

test("before the metadata there is nothing to wait for", () => {
  const { v, log } = fakeVideo({ fastSeek: true, readyState: 0 });
  const s = scrubSeeker(() => 0);
  s.scrub(v, 5);
  s.scrub(v, 6);
  assert.deepEqual(log, ["exact 5", "exact 6"]);
});

test("a seek that never answers does not freeze the picture", () => {
  const { v, log } = fakeVideo({ fastSeek: true });
  let clock = 0;
  const s = scrubSeeker(() => clock);
  s.scrub(v, 5);
  s.scrub(v, 6);
  assert.deepEqual(log, ["fast 5"]);
  clock = SEEK_STALE_MS;
  s.scrub(v, 7);
  assert.deepEqual(log, ["fast 5", "fast 7"]);
});
