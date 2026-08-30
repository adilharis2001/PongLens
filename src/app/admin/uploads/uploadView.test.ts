import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPointRows,
  formatClock,
  fpsLabel,
  gapLabel,
  gbLabel,
  pointFlags,
  polygonPoints,
  quadFromCorners,
  readAssembly,
  readTable,
  retentionPct,
  routeExplanation,
  timelineSegments,
  timelineSummary,
  troubleLines,
  type AdminUploadPoint,
  type MatchJson,
  type UploadDetail,
} from "./uploadView.ts";

function point(overrides: Partial<AdminUploadPoint>): AdminUploadPoint {
  return {
    id: "p",
    idx: 0,
    t0: 0,
    t1: 1,
    cut_t0: null,
    has_clip: true,
    server: null,
    server_override: null,
    confirmed_winner: null,
    confirmed_how: null,
    is_let: false,
    deleted: false,
    edited: false,
    starred: false,
    tight_start: false,
    tight_end: false,
    misread_kind: null,
    direction: null,
    scored_at_cut_s: null,
    serve_start_at_cut_s: null,
    rally_end_cut_s: null,
    game_end_override: null,
    game_winner_override: null,
    placement_status: null,
    placement_flagged: false,
    notes: 0,
    admin_note: null,
    admin_theme_ids: [],
    ...overrides,
  };
}

/* ---------------------------------------------------------------- clocks */

test("formatClock covers minutes, hours, and bad input", () => {
  assert.equal(formatClock(0), "0:00");
  assert.equal(formatClock(754), "12:34");
  assert.equal(formatClock(5025), "1:23:45");
  assert.equal(formatClock(null), null);
  assert.equal(formatClock(-1), null);
  assert.equal(formatClock(Number.NaN), null);
});

test("retentionPct refuses the readings it cannot make", () => {
  assert.equal(retentionPct(1000, 770), 77);
  assert.equal(retentionPct(0, 100), null);
  assert.equal(retentionPct(null, 100), null);
  assert.equal(retentionPct(100, null), null);
  // A cut longer than its source is a bug upstream, not a >100% reading.
  assert.equal(retentionPct(100, 140), 100);
});

test("gbLabel drops to MB below a gigabyte", () => {
  assert.equal(gbLabel(2 * 1024 ** 3), "2 GB");
  assert.equal(gbLabel(1.55 * 1024 ** 3), "1.6 GB");
  assert.equal(gbLabel(400 * 1024 ** 2), "400 MB");
});

/* ----------------------------------------------------------------- cards */

test("point rows order by time, measure gaps, and number only the visible", () => {
  const rows = buildPointRows([
    point({ id: "b", idx: 1, t0: 30, t1: 38 }),
    point({ id: "a", idx: 0, t0: 10, t1: 20 }),
    point({ id: "c", idx: 2, t0: 50, t1: 55, deleted: true }),
    point({ id: "d", idx: 3, t0: 60, t1: 66 }),
  ]);
  assert.deepEqual(rows.map((r) => r.id), ["a", "b", "c", "d"]);
  assert.deepEqual(rows.map((r) => r.gapBeforeS), [10, 10, 12, 5]);
  assert.deepEqual(rows.map((r) => r.lengthS), [10, 8, 5, 6]);
  // The owner's numbering skips removed points, so the card after a
  // removed one must not jump — this is the number shown in the app.
  assert.deepEqual(rows.map((r) => r.displayNo), [1, 2, null, 3]);
});

test("numeric strings from the RPC are coerced before arithmetic", () => {
  const rows = buildPointRows([
    point({
      id: "a",
      t0: "10" as unknown as number,
      t1: "22" as unknown as number,
      cut_t0: "3" as unknown as number,
    }),
  ]);
  assert.equal(rows[0].lengthS, 12);
  assert.equal(rows[0].cut_t0, 3);
});

test("timeline segments are percentages of the whole source", () => {
  const rows = buildPointRows([
    point({ id: "a", t0: 0, t1: 50 }),
    point({ id: "b", t0: 50, t1: 100, deleted: true }),
  ]);
  const segs = timelineSegments(rows);
  assert.deepEqual(segs.map((s) => Math.round(s.leftPct)), [0, 50]);
  assert.deepEqual(segs.map((s) => Math.round(s.widthPct)), [50, 50]);
  assert.deepEqual(segs.map((s) => s.deleted), [false, true]);
  assert.deepEqual(timelineSegments([]), []);
});

test("the summary splits play from what the cut removed", () => {
  const rows = buildPointRows([
    point({ id: "a", t0: 0, t1: 60 }),
    point({ id: "b", t0: 120, t1: 180 }),
  ]);
  assert.equal(timelineSummary(rows), "2:00 of play · 1:00 removed");
  assert.equal(timelineSummary([]), null);
});

test("flags separate a human's correction from ordinary pipeline vocabulary", () => {
  assert.deepEqual(pointFlags(point({ edited: true })), [
    { label: "edited", tone: "warn" },
  ]);
  assert.deepEqual(pointFlags(point({ misread_kind: "double" })), [
    { label: "misread", tone: "warn" },
  ]);
  assert.deepEqual(pointFlags(point({ tight_start: true, tight_end: true })), [
    { label: "split both ends", tone: "muted" },
  ]);
  assert.deepEqual(pointFlags(point({})), []);
});

test("gapLabel stays quiet under a second", () => {
  assert.equal(gapLabel(0.4), null);
  assert.equal(gapLabel(4.6), "5s dead before");
});

/* ----------------------------------------------------------------- table */

test("the quad is read in A,B,C,D order under either key spelling", () => {
  const pipeline = quadFromCorners({
    A_near_1: [1, 2],
    B_near_2: [3, 4],
    C_far_2: [5, 6],
    D_far_1: [7, 8],
  });
  assert.deepEqual(pipeline, [[1, 2], [3, 4], [5, 6], [7, 8]]);
  // The vision schema names the same corners differently. Same order out.
  const vision = quadFromCorners({
    D_far_left: [7, 8],
    B_near_right: [3, 4],
    A_near_left: [1, 2],
    C_far_right: [5, 6],
  });
  assert.deepEqual(vision, pipeline);
});

test("a quad missing any corner is refused, never partially drawn", () => {
  assert.equal(
    quadFromCorners({ A_near_1: [1, 2], B_near_2: [3, 4], C_far_2: [5, 6] }),
    null
  );
  assert.equal(
    quadFromCorners({
      A_near_1: [1, 2],
      B_near_2: [3, 4],
      C_far_2: [5, 6],
      D_far_1: [Number.NaN, 8],
    }),
    null
  );
  assert.equal(quadFromCorners(undefined), null);
});

test("polygonPoints renders SVG-ready pairs", () => {
  assert.equal(polygonPoints([[1.24, 2], [3, 4.06]]), "1.2,2.0 3.0,4.1");
});

test("a refused table and an unrecorded one are different answers", () => {
  // The ladder ran and declined. That is a correct outcome, not a defect.
  const refused = readTable({ calibration: { ok: false } }, null);
  assert.equal(refused.state, "refused");
  assert.equal(refused.quad, null);

  // We never got to ask — the match predates the record, or R2 was unread.
  const unknown = readTable(null, { camera: "side-on" });
  assert.equal(unknown.state, "unknown");
  // Camera comes from the DB column, so it survives an unreadable file.
  assert.equal(unknown.camera, "side-on");
});

test("a real keypoint calibration reads as detected, with its provenance", () => {
  const reading = readTable(
    {
      calibration: {
        ok: true,
        source: "keypoints",
        note: "keypoint detector, 14/14 frames agree, spread 1.2px",
        agreement: { frames_sampled: 16, frames_used: 14, spread_px: 1.21 },
        table_corners_px: {
          A_near_1: [470.8, 619.2],
          B_near_2: [613.8, 755],
          C_far_2: [1178, 551.3],
          D_far_1: [967.5, 513.9],
        },
      },
    },
    { camera: "side-on" }
  );
  assert.equal(reading.state, "detected");
  assert.equal(reading.detector, "keypoints");
  assert.equal(reading.agreement?.frames_used, 14);
  assert.deepEqual(reading.quad?.[0], [470.8, 619.2]);
});

test("a quad with no named source is the retired pink-rim calibrator", () => {
  // The pipeline defaults the key to exactly this, so an absent `source`
  // is not "unknown detector" — it is a specific, distrusted one.
  const reading = readTable(
    {
      calibration: {
        ok: true,
        table_corners_px: {
          A_near_1: [1, 1],
          B_near_2: [2, 1],
          C_far_2: [2, 2],
          D_far_1: [1, 2],
        },
      },
    },
    null
  );
  assert.equal(reading.detector, "pink_rim");
});

/* -------------------------------------------------------------- assembly */

test("the route is read from the worker's own sentence", () => {
  const mj: MatchJson = {
    pipeline: "v2",
    notes: [
      "rescued 1 vetoed span(s) with net-crossing evidence",
      "points v2: 97 cards, 0 serves, 306 crossings, camera 0.28, "
        + "serves/min 0.00, route end-on",
    ],
  };
  const a = readAssembly(mj);
  assert.equal(a.route, "end-on");
  assert.equal(a.routeFrom, "notes");
  assert.equal(a.cards, 97);
  assert.equal(a.serves, 0);
  assert.equal(a.crossings, 306);
  assert.equal(a.cameraShape, 0.28);
  assert.equal(a.servesPerMin, 0);
});

test("serve-anchored is read the same way, with its rate", () => {
  const a = readAssembly({
    pipeline: "v2",
    notes: [
      "points v2: 126 cards, 98 serves, 385 crossings, camera 1.56, "
        + "serves/min 4.25, route serve-anchored",
    ],
  });
  assert.equal(a.route, "serve-anchored");
  assert.equal(a.servesPerMin, 4.25);
  assert.match(routeExplanation(a) ?? "", /4\.25 serves a minute/);
});

test("a structured assembly block outranks the sentence", () => {
  const a = readAssembly({
    pipeline: "v2",
    assembly: { route: "end-on", serves_per_min: 1.4, cards: 60 },
    notes: [
      "points v2: 60 cards, 8 serves, 90 crossings, camera 0.3, "
        + "serves/min 1.40, route serve-anchored",
    ],
  });
  assert.equal(a.route, "end-on");
  assert.equal(a.routeFrom, "structured");
});

test("with no sentence, a v2 match whose cards carry no serve is end-on", () => {
  // points_endon writes serve_s: None on every card it builds, so this
  // survives the sentence being reworded.
  const a = readAssembly({
    pipeline: "v2",
    notes: ["some future wording nobody thought to keep parseable"],
    points: [{ idx: 0, serve_s: null }, { idx: 1, serve_s: null }],
  });
  assert.equal(a.route, "end-on");
  assert.equal(a.routeFrom, "inferred");
});

test("the same tell must NOT call a v1 match end-on", () => {
  // Every v1 point has serve_s null too. Inferring from that would
  // relabel the entire pre-v2 archive.
  const a = readAssembly({
    pipeline: "v1",
    points: [{ idx: 0, serve_s: null }, { idx: 1, serve_s: null }],
  });
  assert.equal(a.route, null);
  assert.equal(a.routeFrom, null);
});

test("a v2 match that fell back to v1 reports why", () => {
  const a = readAssembly({
    pipeline: "v1",
    notes: [
      "table calibration unavailable: placement and winner/how suggestions skipped",
      "points v2 requested but fell back to v1: no table calibration",
    ],
  });
  assert.equal(a.route, null);
  assert.equal(a.fallbackReason, "no table calibration");
});

test("a match with no record at all answers null, not a guess", () => {
  const a = readAssembly(null);
  assert.equal(a.pipeline, null);
  assert.equal(a.route, null);
  assert.equal(routeExplanation(a), null);
  // Seven of the 139 processed matches predate the `pipeline` key.
  assert.equal(readAssembly({ notes: [] }).pipeline, null);
});

/* --------------------------------------------------------------- trouble */

function detail(over: Partial<UploadDetail["match"]>, job?: UploadDetail["job"]): UploadDetail {
  return {
    match: {
      id: "m",
      user_id: "u",
      opponent_name: null,
      match_type: null,
      venue: null,
      played_at: null,
      created_at: "2026-08-01T00:00:00Z",
      status: "ready",
      user_side: null,
      player_near_name: null,
      player_far_name: null,
      first_server: null,
      first_server_source: null,
      clip_pads: null,
      story_crop: null,
      placement_status: "not_requested",
      placement_mapped_points: 0,
      placement_failure_code: null,
      placement_flagged: false,
      content_checked_at: null,
      duration_s: null,
      original_name: null,
      match_json_path: null,
      has_cut: true,
      has_thumb: true,
      raw_available: true,
      ...over,
    },
    owner: null,
    job: job ?? null,
    spend: { minutes: 0, storage_bytes: 0 },
    totals: {
      points: 0, visible: 0, deleted: 0, scored: 0, unscored: 0, skipped: 0,
      starred: 0, edited: 0, with_clip: 0, with_cut_t0: 0, with_tap: 0,
      with_rally_end: 0, with_placement_ready: 0,
      src_duration_s: null, cut_duration_s: null,
    },
    points: [],
  };
}

test("a healthy upload has nothing to report", () => {
  assert.deepEqual(troubleLines(detail({})), []);
});

test("placement's real failure value is final_failed, not failed", () => {
  // 'failed' is not one of the four live placement_status values, so a
  // page testing for it reports nothing on the matches that did fail.
  assert.deepEqual(troubleLines(detail({ placement_status: "failed" })), []);
  const real = troubleLines(
    detail({ placement_status: "final_failed", placement_failure_code: "no_table_found" })
  );
  assert.equal(real.length, 1);
  assert.equal(real[0].detail, "no_table_found");
});

test("a gate refusal is told in the words the uploader was given", () => {
  const lines = troubleLines(
    detail({ status: "failed" }, {
      id: "j", kind: "deadspace_cut", status: "failed", progress: 0,
      error: "rejected", user_message: "This looks like broadcast footage.",
      created_at: "", updated_at: "", original_name: null, strictness: null,
      placement_requested: false, trim_start_s: null, trim_end_s: null,
      charged_minutes: null, funding: null, linked_by: "options",
    })
  );
  assert.equal(lines[0].title, "Turned away at upload");
  assert.equal(lines[0].detail, "This looks like broadcast footage.");
});

test("a cut that shipped before the points stage died says so", () => {
  const lines = troubleLines(
    detail({ status: "failed" }, {
      id: "j", kind: "deadspace_cut", status: "done", progress: 100,
      error: "points stage failed", user_message: null,
      created_at: "", updated_at: "", original_name: null, strictness: null,
      placement_requested: false, trim_start_s: null, trim_end_s: null,
      charged_minutes: null, funding: null, linked_by: "job_id",
    })
  );
  assert.match(lines[0].title, /cut shipped/);
});

test("an unprocessed upload is explained, not shown as broken", () => {
  const lines = troubleLines(detail({ status: "uploaded", has_cut: false }));
  assert.equal(lines[0].tone, "amber");
  assert.equal(lines[0].title, "Not processed yet");
});

test("every rate a phone reports for 30 fps reads as 30", () => {
  // All four of these appear across the last twenty-five uploads.
  for (const measured of [29.976, 29.986, 29.999, 30.0]) {
    assert.equal(fpsLabel(measured).value, "30 fps");
  }
  assert.equal(fpsLabel(59.94).value, "60 fps");
  assert.equal(fpsLabel(23.976).value, "24 fps");
});

test("the measured rate is kept underneath, and dropped when it adds nothing", () => {
  assert.equal(fpsLabel(29.976).detail, "29.976 measured");
  assert.equal(fpsLabel(30).detail, null);
});

test("a rate near nothing standard is reported, not rounded into a category", () => {
  assert.equal(fpsLabel(45).value, "45.00 fps");
  assert.equal(fpsLabel(45).detail, null);
});

test("a missing frame rate is not recorded, never zero", () => {
  assert.equal(fpsLabel(null).value, "Not recorded");
  assert.equal(fpsLabel(undefined).value, "Not recorded");
  assert.equal(fpsLabel(0).value, "Not recorded");
});
