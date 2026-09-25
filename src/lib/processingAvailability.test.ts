import test from "node:test";
import assert from "node:assert/strict";
import { availabilityNotice, normalizeServiceStatus, serviceLane, processingContext, processingExitMessage, summarizeProcessingWork, importedProcessingContext, selectImportedProcessingJob } from "./processingAvailability.ts";

test("completion email wording is limited to a saved match being cut, automatically or by hand", () => {
  assert.equal(processingContext("youtube_import", false), "import");
  assert.equal(processingContext("hand_cut", true), "hand");
  assert.equal(processingContext("content_check", true), "saved_video");
  assert.equal(processingContext("deadspace_cut", true), "saved_match");
  assert.equal(processingContext(null, true), "queued_work");
  for (const context of ["saved_idle", "queued_work", "before_import", "export"] as const) {
    assert.doesNotMatch(availabilityNotice("unavailable", context)!.body, /email/);
  }
  assert.doesNotMatch(availabilityNotice("unavailable", "saved_idle")!.body, /queued|check will continue/);
  // The worker sends the ready email for a hand cut as for an automatic one.
  for (const context of ["saved_match", "hand"] as const) {
    assert.match(processingExitMessage(context), /email/);
    assert.match(availabilityNotice("unavailable", context)!.body, /We’ll email you when your match is ready\./);
  }
  for (const context of ["saved_video", "import"] as const) assert.doesNotMatch(processingExitMessage(context), /email/);
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
  assert.equal(notice.title, "Clip updates and vertical exports are temporarily unavailable");
  assert.match(notice.body, /vertical exports/);
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
  const healthy = normalizeServiceStatus({ main: "unavailable", fast: "available", hand: "made_up", clip_lane: "fast", observed_at: "2026-09-13T06:00:00Z" }, now);
  assert.equal(healthy.main, "unavailable");
  assert.equal(healthy.fast, "available");
  assert.equal(healthy.hand, "unknown");
});

test("invalid clip routing cannot invent a main-lane outage for clip work", () => {
  const now = Date.parse("2026-09-13T06:00:00Z");
  for (const route of [undefined, null, "hand", "", 1]) {
    const status = normalizeServiceStatus({ main: "unavailable", fast: "available", hand: "available", clip_lane: route, observed_at: "2026-09-13T06:00:00Z" }, now);
    assert.equal(availabilityNotice(status[serviceLane("reclip", status.clip_lane)], "fast"), null);
  }
});

const mixedService = { main: "unavailable", fast: "available", hand: "available", clip_lane: "fast", observed_at: "2026-09-13T06:00:00Z" } as const;
test("Home preserves healthy hand progress beside a blocked main job", () => {
  const summary = summarizeProcessingWork(mixedService, [
    { kind: "deadspace_cut", status: "queued", videoSaved: true },
    { kind: "hand_cut", status: "processing", videoSaved: true, stageLabel: "Preparing clips" },
  ]);
  assert.equal(summary.blockedCount, 1);
  assert.equal(summary.continuingCount, 1);
  assert.equal(summary.continuingLabel, "Preparing clips");
  assert.match(summary.exitMessage, /email/);
  assert.ok(summary.notice);
});
test("orphan imports have an outage notice without claiming a saved video", () => {
  const summary = summarizeProcessingWork(mixedService, [{ kind: "youtube_import", status: "queued", videoSaved: false }]);
  assert.equal(summary.continuingCount, 0);
  assert.equal(summary.notice?.body, "Your import request is queued and will continue when service is restored. You can leave this page.");
});
test("Home email promises follow only active primary processing", () => {
  const services = { ...mixedService, main: "available" } as const;
  const hand = summarizeProcessingWork(services, [{ kind: "hand_cut", status: "processing", videoSaved: true }]);
  assert.equal(hand.exitMessage, "We’ll email you when your match is ready.");
  const primary = summarizeProcessingWork(services, [{ kind: "deadspace_cut", status: "processing", videoSaved: true }]);
  assert.match(primary.exitMessage, /email/i);
  const completed = summarizeProcessingWork(services, [{ kind: "deadspace_cut", status: "done", videoSaved: true }]);
  assert.equal(completed.continuingCount, 0);
  assert.doesNotMatch(completed.exitMessage, /email/);
});
test("an imported check retains its actual kind and never becomes primary processing", () => {
  const check = { id: "check", kind: "content_check", status: "processing" };
  const primary = { id: "primary", kind: "deadspace_cut", status: "queued" };
  assert.deepEqual(selectImportedProcessingJob([check]), check);
  assert.deepEqual(selectImportedProcessingJob([check, primary]), primary);
  assert.equal(selectImportedProcessingJob([{ ...primary, status: "done" }]), null);
  assert.equal(importedProcessingContext("uploaded", { kind: "content_check", status: "queued" }), "saved_video");
  assert.doesNotMatch(processingExitMessage(importedProcessingContext("uploaded", { kind: "content_check", status: "processing" })), /email/i);
  assert.equal(importedProcessingContext("uploaded", null), "saved_idle");
  assert.equal(importedProcessingContext("processing", { kind: "deadspace_cut", status: "processing" }), "saved_match");
  assert.equal(importedProcessingContext(null, null), "import");
});
test("a hand cut on the owner's iPhone is never blocked by a Mac lane", () => {
  const handDown = { ...mixedService, main: "available", hand: "unavailable" } as const;
  const phone = summarizeProcessingWork(handDown, [
    { kind: "hand_cut", status: "processing", videoSaved: true, onDevice: true },
  ]);
  assert.equal(phone.blockedCount, 0);
  assert.equal(phone.notice, null);
  // The same words as the server's own cut: a player is never told where it runs.
  assert.equal(phone.continuingLabel, "Cutting the video");
  assert.doesNotMatch(phone.continuingLabel ?? "", /iphone|phone|mac|device/i);
  assert.equal(phone.exitMessage, "We’ll email you when your match is ready.");
  // The same job handed to the Mac is blocked like any hand cut.
  const mac = summarizeProcessingWork(handDown, [{ kind: "hand_cut", status: "queued", videoSaved: true }]);
  assert.equal(mac.blockedCount, 1);
});
