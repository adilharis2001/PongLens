import assert from "node:assert/strict";
import test from "node:test";

import { selectPrimaryMatchJob } from "./primaryMatchJob.ts";

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
