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
 * input_path the way the Export sheet's DOWNLOAD does. Some legacy raws
 * were swept before commerce, so a job pointing at a path is not proof the
 * file exists. Wiring the fallback put an Original pill on all three demo
 * matches, and every one of them opened on "The original is no longer
 * available", because their July jobs had already been swept. A button
 * that does nothing is worse than no button.
 *
 * Since 2026-09 the sweep also protects raws reached only through a live
 * match's source job, and worker/backfill_raw_path.py fills this column
 * for every legacy row whose file survived (HEAD-checked). So the column
 * stays the one signal, and it is complete.
 *
 * The Export sheet keeps its own fallback, because a download that turns
 * out to be unavailable has somewhere to say so and this pill does not.
 */

const RAW_PREFIX = "r2://ponglens-raw/";

export function hasOriginalVideo(rawPath: string | null | undefined): boolean {
  return typeof rawPath === "string" && rawPath.startsWith(RAW_PREFIX);
}
