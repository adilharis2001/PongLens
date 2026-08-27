import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  AREA_TITLE,
  TEST_AREAS,
  TEST_SURFACES,
  casesAtDepth,
  casesByArea,
  testCaseSearchText,
  testCases,
  type TestArea,
} from "./testLibrary.ts";

const AREA_KEYS = TEST_AREAS.map((a) => a.key);

test("case ids are unique and namespaced by area", () => {
  const ids = testCases.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate case id");

  for (const c of testCases) {
    assert.match(c.id, /^[a-z0-9-]+$/, `${c.id} is not a slug`);
    // Prefixing by area is what makes an id readable in a bug report and
    // greppable here. It also makes an id collision across areas impossible.
    assert.ok(
      c.id.startsWith(`${c.area}-`),
      `${c.id} does not start with its area "${c.area}"`,
    );
  }
});

test("every case is executable by someone who did not build this", () => {
  for (const c of testCases) {
    assert.ok(AREA_KEYS.includes(c.area), `${c.id} has an unknown area`);
    assert.ok(c.title.trim().length > 10, `${c.id} has no real title`);
    assert.ok(c.steps.length > 0, `${c.id} has no steps`);
    assert.ok(c.expected.length > 0, `${c.id} has no expected result`);
    assert.ok(c.surfaces.length > 0, `${c.id} names no surfaces`);

    // The point of the library is the product knowledge a new tester
    // lacks. A one-line "so it works" why is the failure mode this guards.
    assert.ok(
      c.why.trim().length >= 60,
      `${c.id} has a why too thin to teach anything`,
    );

    for (const step of c.steps) {
      assert.ok(step.trim().length > 0, `${c.id} has an empty step`);
    }
    for (const e of c.expected) {
      assert.ok(e.trim().length > 0, `${c.id} has an empty expectation`);
    }
  }
});

test("a blocked case says why it cannot be run", () => {
  for (const c of testCases) {
    if (c.blocked === undefined) continue;
    assert.ok(
      c.blocked.trim().length >= 20,
      `${c.id} is blocked without a usable reason`,
    );
  }
});

test("every area has cases, and every area has a title", () => {
  for (const area of AREA_KEYS) {
    assert.ok(
      casesByArea(area as TestArea).length > 0,
      `area "${area}" has no cases`,
    );
    assert.ok(AREA_TITLE[area as TestArea], `area "${area}" has no title`);
  }
});

test("the smoke set is small enough to actually run every deploy", () => {
  const smoke = testCases.filter((c) => c.depth === "smoke");
  assert.ok(smoke.length > 0, "no smoke cases");
  // If the smoke set grows past this it stops being run, which is worse
  // than having no smoke set at all.
  assert.ok(
    smoke.length <= 25,
    `${smoke.length} smoke cases is too many to run on every deploy`,
  );
  // A smoke case that cannot be run is not a smoke case.
  for (const c of smoke) {
    assert.equal(c.blocked, undefined, `${c.id} is smoke but blocked`);
  }
});

test("casesAtDepth widens rather than narrows", () => {
  const smoke = casesAtDepth("smoke").length;
  const core = casesAtDepth("core").length;
  const edge = casesAtDepth("edge").length;
  assert.ok(smoke <= core && core <= edge);
  assert.equal(edge, testCases.length);
});

test("search text covers the fields the filter box offers", () => {
  const c = testCases[0];
  const text = testCaseSearchText(c);
  assert.ok(text.includes(c.title.toLowerCase()));
  assert.ok(text.includes(c.steps[0].toLowerCase()));
  assert.equal(text, text.toLowerCase());
});

test("the area vocabulary matches the qa_bugs check constraint", () => {
  // 104 stores the area as text with a check constraint rather than an
  // enum. That is only safe while the two lists agree: a case in an area
  // the table rejects means a bug filed from that case fails to save.
  // 106 widened it, so the latest statement about the constraint wins.
  const sql = readFileSync(
    join(
      import.meta.dirname,
      "../../../supabase/migrations/106_qa_feedback_area.sql",
    ),
    "utf8",
  );
  const constraint = sql.slice(sql.indexOf("add constraint"));
  for (const area of AREA_KEYS) {
    assert.ok(
      constraint.includes(`'${area}'`),
      `qa_bugs.area rejects "${area}", which the library uses`,
    );
  }
});

test("every case names surfaces that exist", () => {
  const keys = TEST_SURFACES.map((s) => s.key);
  for (const c of testCases) {
    for (const surface of c.surfaces) {
      assert.ok(
        keys.includes(surface),
        `${c.id} names an unknown surface "${surface}"`,
      );
    }
    assert.equal(
      new Set(c.surfaces).size,
      c.surfaces.length,
      `${c.id} names a surface twice`,
    );
  }
});

test("iOS and Android carry the same cases", () => {
  // They are one product with two builds. A case that applies to one and
  // not the other is almost always a tag someone forgot to widen, and it
  // would show up as a phantom gap in the Android column.
  const ios = testCases.filter((c) => c.surfaces.includes("ios")).map((c) => c.id);
  const android = testCases
    .filter((c) => c.surfaces.includes("android"))
    .map((c) => c.id);
  assert.deepEqual(ios, android);
});

test("no surface opens with an empty release set", () => {
  // The cadence cards are the first thing on the page. A surface whose
  // release set is empty reads as "nothing to do here", which is never
  // what it means.
  for (const s of TEST_SURFACES) {
    const release = testCases.filter(
      (c) => c.depth === "smoke" && c.surfaces.includes(s.key),
    );
    assert.ok(release.length > 0, `${s.title} has no release cases`);
  }
});

test("the surface vocabulary matches the qa_case_results check constraint", () => {
  // Same trap as the area constraint above: 142 stores the surface as text
  // with a check constraint, and a mark against a surface the table
  // rejects fails to save. The library is where the vocabulary is decided,
  // so the migration has to agree with it rather than the other way round.
  const sql = readFileSync(
    join(
      import.meta.dirname,
      "../../../supabase/migrations/142_qa_case_surfaces.sql",
    ),
    "utf8",
  );
  const constraint = sql.slice(sql.indexOf("qa_case_results_surface_check"));
  for (const s of TEST_SURFACES) {
    assert.ok(
      constraint.includes(`'${s.key}'`),
      `qa_case_results.surface rejects "${s.key}", which the library uses`,
    );
  }
});
