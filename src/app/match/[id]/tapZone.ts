/**
 * Which third of the picture a double tap landed in.
 *
 * The split used to be halves: left went back a point, right went forward.
 * Thirds keep both of those exactly where they were — the outer thirds
 * still mean "back" and "forward", so nobody's muscle memory breaks — and
 * give the middle to replaying the rally on screen, which is the thing
 * people reach for most often and the only one of the three that had no
 * gesture at all.
 *
 * Shared by every surface that walks points: the match player, the shared
 * starred viewer, and the coach workspace, on web and mirrored on iOS.
 * One function so the boundaries cannot drift apart between them.
 *
 * NOT used by press-and-hold, which keeps its own left/right halves. Two
 * different gestures do not need the same boundary, and thirds there would
 * leave the middle of the frame unable to change speed.
 */
export type TapZone = "prev" | "replay" | "next";

/**
 * @param x     Pointer position measured from the left of the picture.
 * @param width The picture's width in the same units.
 *
 * A zero or negative width is a surface that has not been measured yet.
 * That answers "replay", the harmless one: replaying the rally you are
 * already watching is a no-op you can see, where a mis-resolved "next"
 * would silently take you somewhere you did not ask to go.
 */
export function tapZone(x: number, width: number): TapZone {
  if (!(width > 0)) return "replay";
  const fraction = x / width;
  if (fraction < 1 / 3) return "prev";
  if (fraction > 2 / 3) return "next";
  return "replay";
}
