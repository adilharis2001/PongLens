/**
 * Does a match still have the original upload behind it?
 *
 * Its own module, with no "use client", because both halves need it: the
 * server components decide whether to draw the pill, and keeping it beside
 * the button would make it a client export the server cannot call.
 *
 * ONE SIGNAL, AND IT IS A GUARANTEE. `matches.raw_path` is written at
 * upload and never cleared on the success path — the only statement in the
 * repo that nulls it is the content-gate rejection, which deletes the file
 * in the same breath. And r2_raw_sweep skips any object a live library row
 * points at: "a raw referenced by a live library row is the user's stored
 * video, it never ages out." All 71 matches carrying the column were
 * checked against the bucket and all 71 files are there. So this can be
 * answered from a column already on the row: no probe, no R2 HEAD on the
 * page's critical path, and no pill appearing a beat late and shifting the
 * layout.
 *
 * WHAT WE DELIBERATELY DO NOT DO is fall back to the source job's
 * input_path the way the Export sheet's DOWNLOAD does. It looks like free
 * coverage — 27 processed matches read null here while their file is still
 * in R2 — but the two are not the same kind of answer. raw_path means the
 * sweep is protecting the file; input_path only means a job once pointed
 * there, and those files are on the ordinary 30-day clock. Wiring the
 * fallback put an Original pill on all three demo matches, and every one of
 * them opened on "The original is no longer available", because their July
 * jobs had already been swept. A button that does nothing is worse than no
 * button. Making it honest would need an R2 HEAD on every match page load,
 * to serve a set that empties itself around 2026-09-12.
 *
 * The Export sheet keeps its own fallback, because a download that turns
 * out to be unavailable has somewhere to say so and this pill does not.
 */

const RAW_PREFIX = "r2://ponglens-raw/";

export function hasOriginalVideo(rawPath: string | null | undefined): boolean {
  return typeof rawPath === "string" && rawPath.startsWith(RAW_PREFIX);
}
