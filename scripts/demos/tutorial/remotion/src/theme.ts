/** The app's own tokens (src/app/globals.css), so the video and the
 *  product cannot drift apart. */
export const INK = "#0a0a0f";
export const SURFACE = "#14141c";
export const EDGE = "#262633";
export const CYAN = "#22d3ee";
export const MAGENTA = "#e879f9";

/** Canvas and phone geometry. The screen is the app's 390x844 CSS viewport
 *  scaled up, so every cue rect can stay in CSS pixels all the way through. */
export const CANVAS = { w: 1080, h: 1920 };
export const VIEWPORT = { w: 390, h: 844 };
export const SCREEN_W = 606;
export const SCREEN_H = Math.round((SCREEN_W * VIEWPORT.h) / VIEWPORT.w);
export const SCREEN_X = Math.round((CANVAS.w - SCREEN_W) / 2);
export const SCREEN_Y = 232;
/** CSS px -> screen px. */
export const S = SCREEN_W / VIEWPORT.w;
