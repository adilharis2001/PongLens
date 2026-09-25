import assert from "node:assert/strict";
import test from "node:test";

import {
  failedHandCutMatchIds,
  matchDisplayStatus,
  selectPrimaryMatchJob,
} from "./primaryMatchJob.ts";

type Job = {
  id: string;
  kind: string | null;
  status: string;
  created_at?: string;
};

const job = (
  id: string,
  kind: string | null,
  status: string,
  created_at: string,
): Job => ({ id, kind, status, created_at });

test("an active match-producing job wins over newer housekeeping and terminal jobs", () => {
  const selected = selectPrimaryMatchJob([
    job("new-check", "content_check", "processing", "2026-09-12T12:04:00Z"),
    job("old-active", "deadspace_cut", "processing", "2026-09-12T12:01:00Z"),
    job("new-terminal", "youtube_import", "done", "2026-09-12T12:03:00Z"),
  ]);

  assert.equal(selected?.id, "old-active");
});

test("the newest active match-producing job is selected even from unsorted input", () => {
  const selected = selectPrimaryMatchJob([
    job("older", "hand_cut", "queued", "2026-09-12T12:01:00Z"),
    job("newer", "youtube_import", "processing", "2026-09-12T12:03:00Z"),
    job("middle", "deadspace_cut", "queued", "2026-09-12T12:02:00Z"),
  ]);

  assert.equal(selected?.id, "newer");
});

test("a terminal match-producing job wins over a content check when no primary job is active", () => {
  const selected = selectPrimaryMatchJob([
    job("new-check", "content_check", "failed", "2026-09-12T12:04:00Z"),
    job("old-failure", "deadspace_cut", "failed", "2026-09-12T12:01:00Z"),
  ]);

  assert.equal(selected?.id, "old-failure");
});

test("the newest content check preserves its gate result when no processing job exists", () => {
  const selected = selectPrimaryMatchJob([
    job("old-check", "content_check", "done", "2026-09-12T12:01:00Z"),
    job("new-rejection", "content_check", "failed", "2026-09-12T12:04:00Z"),
  ]);

  assert.equal(selected?.id, "new-rejection");
});

test("derived jobs cannot become the match's primary processing status", () => {
  const selected = selectPrimaryMatchJob([
    job("reel", "reel", "processing", "2026-09-12T12:05:00Z"),
    job("placement", "placement_generate", "queued", "2026-09-12T12:04:00Z"),
    job("check", "content_check", "done", "2026-09-12T12:01:00Z"),
  ]);

  assert.equal(selected?.id, "check");
  assert.equal(selectPrimaryMatchJob([
    job("reel", "reel", "processing", "2026-09-12T12:05:00Z"),
    job("unknown", null, "queued", "2026-09-12T12:06:00Z"),
  ]), null);
});

test("an empty list has no primary match job", () => {
  assert.equal(selectPrimaryMatchJob<Job>([]), null);
});

const forMatch = (matchId: string, kind: string, status: string, created_at: string) => ({
  kind,
  status,
  created_at,
  options: { match_id: matchId },
});

test("a match whose latest primary job is a failed hand cut is found", () => {
  const failed = failedHandCutMatchIds([
    forMatch("a", "hand_cut", "failed", "2026-09-24T10:00:00Z"),
    // Sent again and it worked: not failed any more.
    forMatch("b", "hand_cut", "failed", "2026-09-24T10:00:00Z"),
    forMatch("b", "hand_cut", "done", "2026-09-24T11:00:00Z"),
    // Processed automatically after the hand cut failed.
    forMatch("c", "hand_cut", "failed", "2026-09-24T10:00:00Z"),
    forMatch("c", "deadspace_cut", "queued", "2026-09-24T11:00:00Z"),
    // An automatic failure is the match row's own business.
    forMatch("d", "deadspace_cut", "failed", "2026-09-24T10:00:00Z"),
    // Housekeeping after the failure does not hide it.
    forMatch("e", "hand_cut", "failed", "2026-09-24T10:00:00Z"),
    forMatch("e", "content_check", "done", "2026-09-24T11:00:00Z"),
    forMatch("e", "reclip", "done", "2026-09-24T12:00:00Z"),
  ]);
  assert.deepEqual([...failed].sort(), ["a", "e"]);
  assert.equal(failedHandCutMatchIds(null).size, 0);
});

test("a failed hand cut reads as failed only while the match sits at uploaded with nothing running", () => {
  assert.equal(matchDisplayStatus("uploaded", false, true), "failed");
  assert.equal(matchDisplayStatus("uploaded", true, true), "uploaded");
  assert.equal(matchDisplayStatus("uploaded", false, false), "uploaded");
  assert.equal(matchDisplayStatus("ready", false, true), "ready");
  assert.equal(matchDisplayStatus("processing", false, true), "processing");
});

test("a job behind a match on the page is never a card of its own", async () => {
  const { jobBehindMatch } = await import("./primaryMatchJob.ts");
  const matches = [
    // Cut again and replaced: job_id moved to the new cut's job.
    { id: "m1", job_id: "j-new" },
    // Commerce upload the worker has not linked yet.
    { id: "m2", job_id: null },
  ];
  const jobIds = new Set(matches.map((m) => m.job_id));
  const ids = new Set(matches.map((m) => m.id));
  // The original upload's job, linked only by its match_id now.
  assert.equal(jobBehindMatch({ id: "j-orig", options: { match_id: "m1" } }, jobIds, ids), true);
  assert.equal(jobBehindMatch({ id: "j-new", options: { match_id: "m1" } }, jobIds, ids), true);
  assert.equal(jobBehindMatch({ id: "j2", options: { match_id: "m2" } }, jobIds, ids), true);
  // A legacy job with no match row at all still surfaces.
  assert.equal(jobBehindMatch({ id: "j-legacy", options: {} }, jobIds, ids), false);
  assert.equal(jobBehindMatch({ id: "j-gone", options: { match_id: "deleted" } }, jobIds, ids), false);
  assert.equal(jobBehindMatch({ id: "j-none" }, jobIds, ids), false);
});
