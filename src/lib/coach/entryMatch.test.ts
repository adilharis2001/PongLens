import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseEntryMatchRequest,
  setCoachEntryMatch,
  type EntryMatchRepository,
} from "./entryMatch.ts";

const COACH = "00000000-0000-4000-8000-000000000001";
const OTHER_COACH = "00000000-0000-4000-8000-000000000002";
const STUDENT = "00000000-0000-4000-8000-000000000003";
const PLAYER = "00000000-0000-4000-8000-000000000004";
const ENTRY = "00000000-0000-4000-8000-000000000005";
const LESSON = "00000000-0000-4000-8000-000000000006";
const MATCH = "00000000-0000-4000-8000-000000000007";

function repository(
  overrides: Partial<EntryMatchRepository> = {},
): EntryMatchRepository & { writes: ({ lessonId: string; matchId: string | null })[] } {
  const writes: ({ lessonId: string; matchId: string | null })[] = [];
  return {
    writes,
    async entry() {
      return { id: ENTRY, coachId: COACH, studentId: STUDENT, lessonId: LESSON };
    },
    async student() {
      return { id: STUDENT, coachId: COACH, playerId: PLAYER };
    },
    async lesson() {
      return { id: LESSON, userId: COACH, kind: "coach" };
    },
    async match() {
      return { id: MATCH, userId: PLAYER };
    },
    async updateLessonMatch(lessonId, matchId) {
      writes.push({ lessonId, matchId });
      return true;
    },
    ...overrides,
  };
}

test("entry-match requests accept one entry UUID and a UUID or null match", () => {
  assert.deepEqual(parseEntryMatchRequest({ entryId: ENTRY, matchId: MATCH }), {
    entryId: ENTRY,
    matchId: MATCH,
  });
  assert.deepEqual(parseEntryMatchRequest({ entryId: ENTRY, matchId: null }), {
    entryId: ENTRY,
    matchId: null,
  });
  for (const body of [
    {},
    { entryId: "entry", matchId: MATCH },
    { entryId: ENTRY, matchId: "match" },
    { entryId: ENTRY },
  ]) {
    assert.equal(parseEntryMatchRequest(body), null);
  }
});

test("a coach can link, change, and unlink their entry to that student's visible match", async () => {
  const data = repository();
  assert.equal(
    await setCoachEntryMatch(data, COACH, { entryId: ENTRY, matchId: MATCH }),
    "saved",
  );
  assert.equal(
    await setCoachEntryMatch(data, COACH, { entryId: ENTRY, matchId: null }),
    "saved",
  );
  assert.deepEqual(data.writes, [
    { lessonId: LESSON, matchId: MATCH },
    { lessonId: LESSON, matchId: null },
  ]);
});

test("entry match linking refuses every ownership and visibility mismatch", async () => {
  const cases: [string, Partial<EntryMatchRepository>][] = [
    ["entry hidden by RLS", { entry: async () => null }],
    [
      "entry owned by another coach",
      {
        entry: async () => ({
          id: ENTRY,
          coachId: OTHER_COACH,
          studentId: STUDENT,
          lessonId: LESSON,
        }),
      },
    ],
    [
      "roster row owned by another coach",
      { student: async () => ({ id: STUDENT, coachId: OTHER_COACH, playerId: PLAYER }) },
    ],
    [
      "lesson owned by another coach",
      { lesson: async () => ({ id: LESSON, userId: OTHER_COACH, kind: "coach" }) },
    ],
    [
      "lesson is not a coach entry",
      { lesson: async () => ({ id: LESSON, userId: COACH, kind: "practice" }) },
    ],
    ["match hidden by RLS", { match: async () => null }],
    [
      "match belongs to another player",
      {
        match: async () => ({
          id: MATCH,
          userId: "00000000-0000-4000-8000-000000000008",
        }),
      },
    ],
  ];

  for (const [label, overrides] of cases) {
    const data = repository(overrides);
    assert.equal(
      await setCoachEntryMatch(data, COACH, { entryId: ENTRY, matchId: MATCH }),
      "not_found",
      label,
    );
    assert.deepEqual(data.writes, [], label);
  }
});

test("unlink still requires the caller's coach entry but no match read", async () => {
  let matchReads = 0;
  const data = repository({
    async match() {
      matchReads += 1;
      return null;
    },
  });
  assert.equal(
    await setCoachEntryMatch(data, COACH, { entryId: ENTRY, matchId: null }),
    "saved",
  );
  assert.equal(matchReads, 0);
  assert.deepEqual(data.writes, [{ lessonId: LESSON, matchId: null }]);
});

test("a failed lesson update is reported without claiming success", async () => {
  const data = repository({ updateLessonMatch: async () => false });
  assert.equal(
    await setCoachEntryMatch(data, COACH, { entryId: ENTRY, matchId: MATCH }),
    "failed",
  );
  assert.deepEqual(data.writes, []);
});
