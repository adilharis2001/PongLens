"use client";

import { useEffect } from "react";

/**
 * While a full-screen video covers the page, hide the app's navigation bars
 * underneath it (the rule is `html[data-video-cover]` in globals.css).
 *
 * They are invisible behind the video anyway, but each one carries a
 * backdrop blur, and so do the controls floating over the picture. Chrome
 * on a Mac then recomputes the hidden bar's blur beneath the playing video
 * for every frame: measured on 2026-09-24 at 1080p60, 45 to 61 dropped
 * frames in 12 seconds with freezes of about 0.2 s, against 1 dropped frame
 * with the bars hidden and every control's blur left in place. Safari and
 * the iPhone app never showed it; the blur is drawn by the system there.
 *
 * Counted, so two covers open at once do not reveal the bars when the
 * first one closes.
 */
let covers = 0;

export function useCoverAppNav(active: boolean) {
  useEffect(() => {
    if (!active) return;
    covers += 1;
    document.documentElement.dataset.videoCover = "";
    return () => {
      covers -= 1;
      if (covers === 0) delete document.documentElement.dataset.videoCover;
    };
  }, [active]);
}
