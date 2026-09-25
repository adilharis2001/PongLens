import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { holdPageBehind, type PageDoc } from "./pageBehind.ts";

/** A tiny page: <body> children that may contain each other, and videos
 *  that live inside one of them. */
function page() {
  const node = (name: string, visibility = "", inert = false) => {
    const kids: unknown[] = [];
    const n = {
      name,
      style: { visibility },
      inert,
      kids,
      contains(other: unknown): boolean {
        return other === n || kids.some((k) => k === other || (k as { contains?: (o: unknown) => boolean }).contains?.(other));
      },
    };
    return n;
  };
  const video = (playing: boolean) => {
    const v = { paused: !playing, pause() { v.paused = true; }, contains: () => false };
    return v;
  };
  const app = node("app");
  const toast = node("toast", "visible");
  const marker = node("marker");
  const markerRoot = node("marker-root");
  marker.kids.push(markerRoot);
  const topPlayer = video(false);
  const detailClip = video(true);
  const markerVideo = video(true);
  app.kids.push(topPlayer, detailClip);
  markerRoot.kids.push(markerVideo);
  const listeners: ((e: { target: unknown }) => void)[] = [];
  const doc: PageDoc = {
    body: { children: [app, toast, marker] },
    querySelectorAll: () => [topPlayer, detailClip, markerVideo],
    addEventListener: (_t, fn) => { listeners.push(fn); },
    removeEventListener: (_t, fn) => { listeners.splice(listeners.indexOf(fn), 1); },
  };
  const play = (v: { paused: boolean }) => {
    v.paused = false;
    listeners.forEach((fn) => fn({ target: v }));
  };
  return { doc, app, toast, marker, markerRoot, topPlayer, detailClip, markerVideo, play, listeners };
}

test("the marker owns the screen: the rest of <body> is hidden and inert, then put back exactly", () => {
  const p = page();
  const undo = holdPageBehind(p.markerRoot, p.doc);
  assert.equal(p.app.style.visibility, "hidden");
  assert.equal(p.app.inert, true);
  assert.equal(p.toast.style.visibility, "hidden");
  // The marker's own branch is untouched.
  assert.equal(p.marker.style.visibility, "");
  assert.equal(p.marker.inert, false);
  undo();
  assert.equal(p.app.style.visibility, "");
  assert.equal(p.app.inert, false);
  assert.equal(p.toast.style.visibility, "visible");
});

test("no video outside the marker plays while it is open, and none is unloaded", () => {
  const p = page();
  const undo = holdPageBehind(p.markerRoot, p.doc);
  // The point sheet's autoplaying clip stops; the marker's own does not.
  assert.equal(p.detailClip.paused, true);
  assert.equal(p.markerVideo.paused, false);
  // One that starts while the marker is up is paused again.
  p.play(p.topPlayer);
  assert.equal(p.topPlayer.paused, true);
  p.play(p.markerVideo);
  assert.equal(p.markerVideo.paused, false);
  // Closed: the page is its own again.
  undo();
  assert.equal(p.listeners.length, 0);
  p.play(p.topPlayer);
  assert.equal(p.topPlayer.paused, false);
});

test("the marker puts itself on <body> from every host and holds the page behind it", () => {
  const read = (path: string) => readFileSync(path, "utf8");
  const marker = read("src/app/match/[id]/MarkPoints.tsx");
  assert.match(marker, /return holdPageBehind\(root, document\);/);
  assert.match(marker, /return createPortal\(\s*<div\s*ref=\{rootRef\}/);
  assert.match(marker, /<\/div>,\s*document\.body,\s*\);\s*\}\s*$/);
  // Hosts render it plainly; no second portal around it.
  const more = read("src/app/match/[id]/recut/MoreOptions.tsx");
  assert.doesNotMatch(more, /createPortal/);
  assert.match(more, /\{marking && \(\s*<MarkPoints/);
  // Paused, never unloaded.
  const behind = read("src/lib/pageBehind.ts");
  assert.doesNotMatch(behind, /removeAttribute\(["']src|\.src\s*=|\.load\(\)/);
});
