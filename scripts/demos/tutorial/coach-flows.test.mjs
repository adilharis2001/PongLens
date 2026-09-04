import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const BROWSER_CHAPTERS = [
  "coach-start",
  "coach-add-student",
  "coach-connect-account",
  "coach-lesson-entry",
  "coach-share-entry",
  "coach-review-match",
  "coach-feedback",
  "coach-paid-review",
];

process.env.TUTORIAL_COACH ??= "coach@example.invalid";
process.env.TUTORIAL_STUDENT ??= "student@example.invalid";
process.env.TUTORIAL_ACCOUNT ??= "player@example.invalid";

async function loadFlow(slug) {
  const file = path.join(DIR, "flows", "coach", `${slug}.mjs`);
  return import(pathToFileURL(file));
}

test("every browser coach chapter has a capture flow", async () => {
  const missing = [];
  for (const slug of BROWSER_CHAPTERS) {
    try {
      await loadFlow(slug);
    } catch (error) {
      if (error?.code === "ERR_MODULE_NOT_FOUND") missing.push(slug);
      else throw error;
    }
  }
  assert.deepEqual(missing, []);
});

test("coach flows schedule every narration beat exactly once", async () => {
  for (const slug of BROWSER_CHAPTERS) {
    const manifest = JSON.parse(
      await readFile(path.join(DIR, "chapters", "coach", `${slug}.json`), "utf8"),
    );
    const flow = await loadFlow(slug);
    const scheduled = [];
    await flow.run(null, null, {
      beat(id) {
        scheduled.push(id);
        return { start: 0, end: 1, dur: 1 };
      },
      showScene: async () => {},
      voice: { total: 1 },
    });
    assert.deepEqual(
      scheduled,
      manifest.lines.map((line) => line.beat),
      `${slug} must schedule each manifest beat once and in order`,
    );
  }
});

function selectorHasIntent(selector) {
  if (!selector || typeof selector !== "object") return false;
  if (typeof selector.aria === "string" && selector.aria.trim()) return true;
  if (typeof selector.text === "string" && selector.text.trim()) return true;
  if (typeof selector.sectionOf === "string" && selector.sectionOf.trim()) return true;
  return (
    typeof selector.sel === "string" &&
    selector.sel.trim() &&
    selector.within &&
    selectorHasIntent(selector.within)
  );
}

test("every coach flow selector names accessible or scoped element intent", async () => {
  for (const slug of BROWSER_CHAPTERS) {
    const flow = await loadFlow(slug);
    assert.ok(Array.isArray(flow.scenes) && flow.scenes.length > 0, `${slug} scenes`);
    for (const scene of flow.scenes) {
      for (const [name, selector] of Object.entries({
        target: scene.target,
        secondaryTarget: scene.secondaryTarget,
        waitFor: scene.waitFor,
        action: scene.action?.target,
      })) {
        if (!selector) continue;
        assert.ok(
          selectorHasIntent(selector),
          `${slug}/${scene.beat} ${name} has no accessible or scoped intent`,
        );
      }
    }
  }
});

const GUARDED_TABLES = {
  "coach-add-student": ["coach_students"],
  "coach-connect-account": ["coach_students", "coach_student_invites"],
  "coach-lesson-entry": [
    "coach_entries",
    "coach_entry_lessons",
    "coach_entry_photos",
  ],
  "coach-share-entry": ["coach_entries", "coach_entry_links"],
  "coach-feedback": ["notes", "note_drawings"],
  "coach-paid-review": [
    "coach_profiles",
    "offerings",
    "review_orders",
    "review_findings",
    "review_attachments",
  ],
};

test("coach flows that can touch staged data declare the affected guard tables", async () => {
  for (const [slug, expected] of Object.entries(GUARDED_TABLES)) {
    const flow = await loadFlow(slug);
    assert.equal(flow.guard?.kind, "coach", `${slug} coach guard`);
    for (const table of expected) {
      assert.ok(flow.guard.tables.includes(table), `${slug} guard missing ${table}`);
    }
  }
});

test("coach match review stages a real Original and three trusted serve maps", async () => {
  const flow = await loadFlow("coach-review-match");
  const player = await import("./fixtures/player-match.mjs");
  const { collectServePlacementObservations } = await import(
    "../../../src/lib/placement/placementAggregate.ts"
  );
  assert.equal(flow.guard?.kind, "player");
  assert.equal(typeof flow.stage, "function");
  assert.deepEqual(flow.guard.pointIds, player.STAGED_POINTS.map((point) => point.id));
  assert.deepEqual(
    flow.scenes.find((scene) => scene.beat === "open-match")?.target,
    { text: "Original", tag: "button" },
  );
  assert.deepEqual(
    flow.scenes.find((scene) => scene.beat === "analysis-maps")?.target,
    { text: "Match analysis", tag: "h2" },
  );
  assert.deepEqual(
    flow.scenes.find((scene) => scene.beat === "analysis-maps")?.secondaryTarget,
    { text: "Serve placement", tag: "h2" },
  );

  const points = player.STAGED_POINTS.map((point) => ({
    id: point.id,
    placement: player.stagedPlacement(point),
    confirmed_winner: "user",
  }));
  const serving = new Map(
    points.map((point) => [
      point.id,
      { server: "user" },
    ]),
  );
  const observations = collectServePlacementObservations({
    points,
    userSide: "near",
    gameIndexByPoint: new Map(points.map((point) => [point.id, 0])),
    serving,
  });
  assert.equal(observations.length, 3);
});

test("coach lesson entry selects the student's real shared match", async () => {
  const flow = await loadFlow("coach-lesson-entry");
  const scene = flow.scenes.find((candidate) => candidate.beat === "link-match");
  assert.deepEqual(scene?.target, { aria: "Link a match" });
  assert.deepEqual(scene?.action, {
    type: "select",
    target: { aria: "Link a match" },
    value: "efff9208-abf2-4a20-a498-18cc5a5130b3",
  });
});

test("the coach scene runner can select an accessible match option", async () => {
  const { showScene } = await import("./flows/coach/shared.mjs");
  const page = {
    async waitForFunction() {},
    async evaluate(_fn, argument) {
      return Array.isArray(argument) ? true : undefined;
    },
    viewportSize() {
      return { width: 390, height: 844 };
    },
  };
  const clock = {
    async sleep() {},
    async until() {},
    async rect() {
      return { x: 10, y: 100, w: 200, h: 40 };
    },
    mark() {
      return "cue";
    },
    close() {},
  };
  await showScene(
    page,
    clock,
    {
      beat: "link-match",
      action: {
        type: "select",
        target: { aria: "Link a match" },
        value: "efff9208-abf2-4a20-a498-18cc5a5130b3",
      },
      target: { aria: "Link a match" },
      label: "Keep the match beside the entry",
    },
    { start: 0, end: 1, dur: 1 },
  );
});

test("coach Home and paid review block only automatic review sweeps", async () => {
  for (const [slug, firstRoute] of [
    ["coach-start", "/coaching"],
    ["coach-paid-review", "/coaching/orders"],
  ]) {
    const flow = await loadFlow(slug);
    assert.equal(flow.entry, "/coaching/students");
    assert.equal(flow.scenes[0]?.route, firstRoute);
    assert.equal(typeof flow.prepare, "function");

    let pattern;
    let handler;
    await flow.prepare({
      async route(nextPattern, nextHandler) {
        pattern = nextPattern;
        handler = nextHandler;
      },
    });
    assert.equal(pattern, "**/api/reviews/transition");

    for (const request of [
      { method: "POST", body: { action: "sweep" }, aborts: true },
      { method: "GET", body: null, aborts: false },
      { method: "POST", body: { action: "accept" }, aborts: false },
    ]) {
      let aborted = null;
      let continued = false;
      await handler({
        request: () => ({
          method: () => request.method,
          postDataJSON: () => request.body,
        }),
        async abort(reason) {
          aborted = reason;
        },
        async continue() {
          continued = true;
        },
      });
      assert.equal(aborted, request.aborts ? "blockedbyclient" : null, slug);
      assert.equal(continued, !request.aborts, slug);
    }
  }
});

test("coach flow imports need only the coach and connected student accounts", () => {
  const env = { ...process.env };
  delete env.TUTORIAL_ACCOUNT;
  env.TUTORIAL_COACH = "coach@example.invalid";
  env.TUTORIAL_STUDENT = "student@example.invalid";
  const module = pathToFileURL(
    path.join(DIR, "flows", "coach", "coach-start.mjs"),
  ).href;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", `await import(${JSON.stringify(module)})`],
    { env, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
});

test("the coach guard exposes an adapter boundary for cleanup testing", async () => {
  const guard = await import("./guard.mjs");
  assert.equal(typeof guard.snapshotCoach, "function");
  assert.equal(typeof guard.restoreCoach, "function");
  assert.equal(typeof guard.withCoachGuard, "function");
});

function memoryAdapter(ownerId, ownerEmail, initial) {
  const tables = structuredClone(initial);
  return {
    tables,
    async verifyOwner(id, email) {
      assert.equal(id, ownerId);
      assert.equal(email, ownerEmail);
    },
    async list(table) {
      return structuredClone(tables[table] ?? []);
    },
    async update(table, key, row) {
      const index = (tables[table] ?? []).findIndex(
        (candidate) => (candidate.id ?? candidate.user_id ?? candidate.order_id) === key,
      );
      assert.notEqual(index, -1, `${table}/${key} exists before update`);
      tables[table][index] = structuredClone(row);
    },
    async insert(table, row) {
      tables[table] ??= [];
      tables[table].push(structuredClone(row));
    },
    async delete(table, key) {
      tables[table] = (tables[table] ?? []).filter(
        (candidate) => (candidate.id ?? candidate.user_id ?? candidate.order_id) !== key,
      );
    },
  };
}

const fakeHelpers = (showScene) => ({
  beat: () => ({ start: 0, end: 1, dur: 1 }),
  showScene,
  voice: { total: 1 },
});

test("a completed coach flow restores changed rows and removes marker rows", async () => {
  const { withCoachGuard } = await import("./guard.mjs");
  const flow = await loadFlow("coach-add-student");
  const initial = {
    coach_students: [
      { id: "existing", coach_id: flow.guard.ownerId, display_name: "Maya Chen" },
    ],
  };
  const adapter = memoryAdapter(flow.guard.ownerId, flow.guard.ownerEmail, initial);

  await withCoachGuard(adapter, flow.guard, () =>
    flow.run(
      null,
      null,
      fakeHelpers(async (_page, _clock, scene) => {
        if (scene.beat !== "add-student") return;
        adapter.tables.coach_students[0].display_name = "Changed on camera";
        adapter.tables.coach_students.push({
          id: "created",
          coach_id: flow.guard.ownerId,
          display_name: "Tutorial fixture added student",
        });
      }),
    ),
  );

  assert.deepEqual(adapter.tables, initial);
});

test("a coach flow that throws mid-beat still restores deleted rows and marker rows", async () => {
  const { withCoachGuard } = await import("./guard.mjs");
  const flow = await loadFlow("coach-share-entry");
  const initial = {
    coach_entries: [
      { id: "entry", coach_id: flow.guard.ownerId, shared_at: null },
    ],
    coach_entry_links: [
      { id: "link", owner: flow.guard.ownerId, title: "Existing link" },
    ],
  };
  const adapter = memoryAdapter(flow.guard.ownerId, flow.guard.ownerEmail, initial);

  await assert.rejects(
    withCoachGuard(adapter, flow.guard, () =>
      flow.run(
        null,
        null,
        fakeHelpers(async (_page, _clock, scene) => {
          if (scene.beat !== "updates") return;
          adapter.tables.coach_entries = [];
          adapter.tables.coach_entry_links.push({
            id: "created-link",
            owner: flow.guard.ownerId,
            title: "Tutorial fixture public link",
          });
          throw new Error("injected capture failure");
        }),
      ),
    ),
    /injected capture failure/,
  );

  assert.deepEqual(adapter.tables, initial);
});

test("the capture guard dispatches coach scopes through the guarded adapter", async () => {
  const { snapshot, restore } = await import("./guard.mjs");
  const flow = await loadFlow("coach-add-student");
  const initial = {
    coach_students: [
      { id: "student", coach_id: flow.guard.ownerId, display_name: "Maya Chen" },
    ],
  };
  const adapter = memoryAdapter(flow.guard.ownerId, flow.guard.ownerEmail, initial);
  const snap = await snapshot("unused-service-key", flow.guard, adapter);
  assert.equal(snap.kind, "coach");
  adapter.tables.coach_students[0].display_name = "Changed";
  await restore("unused-service-key", snap, adapter);
  assert.deepEqual(adapter.tables, initial);
});

test("an interrupted player placement stage restores lifecycle, placement JSON, and its raw object", async () => {
  const { withPlayerGuard } = await import("./guard.mjs");
  const ownerId = "6eb09df4-7d44-4ef9-b1cc-8cdfc4119fc4";
  const matchId = "efff9208-abf2-4a20-a498-18cc5a5130b3";
  const pointIds = [
    "055ea148-4449-4370-948c-807a8e081411",
    "6fe132c2-55be-40ae-b328-fba2efbdadc5",
    "06128a30-88a3-4330-8ab5-a5c002d1b4e8",
  ];
  const rawObject = {
    bucket: "ponglens-raw",
    key: `${ownerId}/task10-${matchId}-original.mp4`,
  };
  const initial = {
    match: {
      id: matchId,
      user_id: ownerId,
      raw_path: null,
      placement_status: "ready",
      placement_failure_code: null,
      placement_retry_count: 0,
      placement_retry_expires_at: null,
      placement_retry_job_id: null,
      placement_generation_job_id: "old-job",
      placement_mapped_points: 44,
    },
    points: pointIds.map((id, index) => ({
      id,
      match_id: matchId,
      deleted: index === 0,
      placement: { x: 0.2 + index / 10, y: 0.4, confidence: 0.9 },
    })),
  };
  const state = structuredClone(initial);
  const objects = new Set();
  const adapter = {
    async verifyOwner(id, email) {
      assert.equal(id, ownerId);
      assert.equal(email, "uploader-test@example.com");
    },
    async getMatch(id) {
      assert.equal(id, matchId);
      return structuredClone(state.match);
    },
    async getPoints(id, ids) {
      assert.equal(id, matchId);
      assert.deepEqual(ids, pointIds);
      return structuredClone(state.points);
    },
    async updateMatch(_id, patch) {
      Object.assign(state.match, structuredClone(patch));
    },
    async updatePoint(id, patch) {
      Object.assign(state.points.find((point) => point.id === id), structuredClone(patch));
    },
    async objectExists(object) {
      return objects.has(`${object.bucket}/${object.key}`);
    },
    async deleteObject(object) {
      objects.delete(`${object.bucket}/${object.key}`);
    },
  };
  const spec = {
    kind: "player",
    ownerId,
    ownerEmail: "uploader-test@example.com",
    matchId,
    pointIds,
    cleanupRawObjects: [rawObject],
  };

  await assert.rejects(
    withPlayerGuard(adapter, spec, async () => {
      Object.assign(state.match, {
        raw_path: `r2://${rawObject.bucket}/${rawObject.key}`,
        placement_status: "retrying",
        placement_failure_code: "missing_original",
        placement_retry_count: 2,
        placement_retry_expires_at: "2026-09-05T00:00:00Z",
        placement_retry_job_id: "retry-job",
        placement_generation_job_id: "new-job",
        placement_mapped_points: 0,
      });
      state.points.forEach((point) => {
        point.deleted = false;
        point.placement = null;
      });
      objects.add(`${rawObject.bucket}/${rawObject.key}`);
      throw new Error("injected placement capture failure");
    }),
    /injected placement capture failure/,
  );

  assert.deepEqual(state, initial);
  assert.equal(objects.size, 0, "the capture-created raw object is removed");
});

test("coach staging owns the complete read-mostly tutorial state", async () => {
  const sql = await readFile(path.join(DIR, "..", "stage_coach.sql"), "utf8");
  assert.match(sql, /Tutorial fixture:/);
  assert.match(sql, /insert into coach_links/i);
  assert.match(sql, /insert into share_links/i);
  assert.match(sql, /insert into notes/i);
  assert.match(sql, /miguel-demo@example\.com/);
  assert.match(sql, /uploader-test@example\.com/);
  assert.doesNotMatch(sql, /insert into (notifications|jobs|email_outbox)/i);
});
