import test from "node:test";
import assert from "node:assert/strict";
import { availabilityNotice, normalizeServiceStatus, serviceLane, processingContext, processingExitMessage } from "./processingAvailability.ts";

test("completion email wording is limited to a saved automatically processed match", () => {
  assert.equal(processingContext("youtube_import", false), "import");
  assert.equal(processingContext("hand_cut", true), "hand");
  assert.equal(processingContext("content_check", true), "saved_video");
  assert.equal(processingContext("deadspace_cut", true), "saved_match");
  assert.equal(processingContext(null, true), "queued_work");
  for (const context of ["hand", "saved_idle", "queued_work", "before_import", "export"] as const) {
    assert.doesNotMatch(availabilityNotice("unavailable", context)!.body, /email/);
  }
  assert.doesNotMatch(availabilityNotice("unavailable", "saved_idle")!.body, /queued|check will continue/);
  assert.match(processingExitMessage("saved_match"), /email/);
  for (const context of ["hand", "saved_video", "import"] as const) assert.doesNotMatch(processingExitMessage(context), /email/);
});

test("only an unavailable lane gets an outage notice", () => {
  for (const state of ["available", "unknown", undefined, null]) assert.equal(availabilityNotice(state, "saved_match"), null);
  assert.match(availabilityNotice("unavailable", "saved_match")!.body, /saved and queued/);
  assert.match(availabilityNotice("maintenance", "saved_match")!.title, /maintenance/i);
});
test("unfinished uploads never tell the player to leave or claim the file is saved", () => {
  for (const context of ["uploading", "before_upload"] as const) {
    const notice = availabilityNotice("unavailable", context)!;
    assert.doesNotMatch(notice.body, /saved|leave|email/);
  }
  assert.match(availabilityNotice("unavailable", "uploading")!.body, /Keep this page open/);
});
test("an imported request is queued but its video is not yet stored", () => {
  const notice = availabilityNotice("unavailable", "import")!;
  assert.match(notice.body, /request is queued/);
  assert.doesNotMatch(notice.body, /video is saved|email/);
});
test("a saved video awaiting only its check does not promise automatic match processing", () => {
  const notice = availabilityNotice("unavailable", "saved_video")!;
  assert.match(notice.body, /video is saved/);
  assert.doesNotMatch(notice.body, /email|saved and queued/);
});
test("clip/share work does not promise an email or imply match processing is unavailable", () => {
  const notice = availabilityNotice("unavailable", "fast")!;
  assert.match(notice.title, /Clip updates and exports/);
  assert.doesNotMatch(notice.body, /email|video processing/i);
});
test("job routing matches the existing queue routing", () => {
  assert.equal(serviceLane("reclip", "fast"), "fast");
  assert.equal(serviceLane("reclip", "main"), "main");
  assert.equal(serviceLane("reel", "fast", "v:abc"), "fast");
  assert.equal(serviceLane("reel", "fast", "starred"), "main");
  assert.equal(serviceLane("hand_cut"), "hand");
  assert.equal(serviceLane("content_check"), "main");
  assert.equal(serviceLane("deadspace_cut"), "main");
});
test("missing, malformed and stale responses become unknown instead of maintenance", () => {
  const now = Date.parse("2026-09-13T06:00:00Z");
  for (const input of [null, {}, { main: "maintenance" }, { main: "unavailable", observed_at: "2026-09-13T05:50:00Z" }]) {
    assert.equal(normalizeServiceStatus(input, now).main, "unknown");
  }
  const healthy = normalizeServiceStatus({ main: "unavailable", fast: "available", hand: "made_up", observed_at: "2026-09-13T06:00:00Z" }, now);
  assert.equal(healthy.main, "unavailable");
  assert.equal(healthy.fast, "available");
  assert.equal(healthy.hand, "unknown");
});
