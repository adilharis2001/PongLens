/**
 * A full-screen takeover (the marker) owns the whole screen: the page
 * behind it is not drawn at all while it is open, and none of the page's
 * videos plays.
 *
 * Why not just a high z-index: on a desktop the match page's own player
 * was drawn ON TOP of the marker's full-screen video (Adil, 2026-09-25,
 * a 1920x965 window), although the marker is position:fixed at z-80 on
 * <body> and the page's player has no z-index at all. The DOM order was
 * right (elementsFromPoint names the marker), but the whole page, its
 * player included, was still being drawn underneath the marker, and a
 * <video> is handed to the graphics hardware as a layer of its own, where
 * the page's stacking rules do not reach. So the page's videos must not be
 * drawn at all: every other child of <body> is `visibility: hidden` (so
 * nothing is painted and the scroll position and layout stay exactly as
 * they were) and `inert` (so a keyboard cannot tab into a page nobody can
 * see) until the takeover closes. The point sheet's clip also autoplays
 * on a desktop, so it kept playing, with sound, under the marker: every
 * video outside the takeover is paused, and one that starts while the
 * takeover is up is paused again. Paused, never unloaded: clearing a src
 * would lose each player's place.
 *
 * No React and no DOM beyond what is used, so the node tests hold it.
 */

interface Styled {
  style: { visibility: string };
  inert?: boolean;
  contains(node: unknown): boolean;
}

interface Pausable {
  paused: boolean;
  pause(): void;
}

export interface PageDoc {
  body: { children: ArrayLike<unknown> };
  querySelectorAll(selector: "video"): ArrayLike<Pausable>;
  addEventListener(type: "play", listener: (e: { target: unknown }) => void, capture: boolean): void;
  removeEventListener(type: "play", listener: (e: { target: unknown }) => void, capture: boolean): void;
}

const styled = (el: unknown): el is Styled =>
  typeof el === "object" &&
  el !== null &&
  typeof (el as Styled).style === "object" &&
  typeof (el as Styled).contains === "function";

const pausable = (el: unknown): el is Pausable =>
  typeof el === "object" && el !== null && typeof (el as Pausable).pause === "function";

/**
 * Hide and silence everything outside `root`. `root` must already be in
 * the document, as a descendant of <body> (the marker portals itself
 * there). Returns the undo, which puts back exactly what was there before.
 */
export function holdPageBehind(root: { contains(node: unknown): boolean }, doc: PageDoc): () => void {
  const restore: (() => void)[] = [];
  const children = Array.from(doc.body.children);
  for (const el of children) {
    if (!styled(el) || el.contains(root)) continue;
    const visibility = el.style.visibility;
    const inert = el.inert;
    el.style.visibility = "hidden";
    if (inert !== undefined) el.inert = true;
    restore.push(() => {
      el.style.visibility = visibility;
      if (inert !== undefined) el.inert = inert;
    });
  }

  const outside = (v: unknown) => !root.contains(v);
  for (const v of Array.from(doc.querySelectorAll("video"))) {
    if (outside(v) && !v.paused) v.pause();
  }
  const onPlay = (e: { target: unknown }) => {
    const v = e.target;
    if (pausable(v) && outside(v)) v.pause();
  };
  doc.addEventListener("play", onPlay, true);

  return () => {
    doc.removeEventListener("play", onPlay, true);
    for (const undo of restore) undo();
  };
}
