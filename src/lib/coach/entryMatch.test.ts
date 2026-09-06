import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseEntryMatchRequest,
  setCoachEntryMatch,
  type EntryMatchRepository,
} from "./entryMatch.ts";
import * as entryMatchClient from "./entryMatch.ts";

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

test("a rejected create link request rolls back the just-created lesson", async () => {
  assert.equal(typeof entryMatchClient.finalizeCreatedEntryMatch, "function");
  const calls: { url: string; method: string; body: unknown }[] = [];
  const result = await entryMatchClient.finalizeCreatedEntryMatch(
    async (url, init) => {
      calls.push({
        url: String(url),
        method: String(init?.method),
        body: JSON.parse(String(init?.body)),
      });
      if (String(url) === "/api/coaching/entry-match") {
        throw new TypeError("network unavailable");
      }
      return { ok: true };
    },
    { entryId: ENTRY, lessonId: LESSON, matchId: MATCH },
  );

  assert.equal(result, "rolled_back");
  assert.deepEqual(calls, [
    {
      url: "/api/coaching/entry-match",
      method: "PATCH",
      body: { entryId: ENTRY, matchId: MATCH },
    },
    {
      url: "/api/journal-entry",
      method: "DELETE",
      body: { entryId: LESSON },
    },
  ]);
});

test("confirmed rollback clears a deleted upload but preserves words for reattachment", () => {
  assert.equal(
    typeof entryMatchClient.recoverConfirmedEntryMatchRollback,
    "function",
  );
  const state: {
    draft: string;
    photoPath: string | null;
    error: string | null;
  } = {
    draft: "Keep the elbow in front on the next forehand.",
    photoPath: "r2://ponglens-media/coach/photo.jpg",
    error: null,
  };

  entryMatchClient.recoverConfirmedEntryMatchRollback(
    { hasUploadedPhoto: true },
    {
      clearPhoto() {
        state.photoPath = null;
      },
      setError(message) {
        state.error = message;
      },
    },
  );

  assert.equal(state.draft, "Keep the elbow in front on the next forehand.");
  assert.equal(state.photoPath, null);
  assert.match(state.error ?? "", /reattach the photo before trying again/i);
});

test("a failed create rollback reports the surviving entry for reconciliation", async () => {
  assert.equal(typeof entryMatchClient.finalizeCreatedEntryMatch, "function");
  for (const cleanup of [
    async () => ({ ok: false }),
    async () => {
      throw new TypeError("cleanup network unavailable");
    },
  ]) {
    let requests = 0;
    const result = await entryMatchClient.finalizeCreatedEntryMatch(
      async (url, init) => {
        requests += 1;
        if (String(url) === "/api/coaching/entry-match") {
          throw new TypeError("link network unavailable");
        }
        assert.equal(init?.method, "DELETE");
        return cleanup();
      },
      { entryId: ENTRY, lessonId: LESSON, matchId: MATCH },
    );
    assert.equal(result, "saved_unlinked");
    assert.equal(requests, 2);
  }
});

test("a failed create rollback reconciles once and retires the retry path", async () => {
  assert.equal(typeof entryMatchClient.completeCreatedEntryMatch, "function");
  let requests = 0;
  let reconciliations = 0;
  const result = await entryMatchClient.completeCreatedEntryMatch(
    async (url) => {
      requests += 1;
      if (String(url) === "/api/coaching/entry-match") {
        throw new TypeError("link network unavailable");
      }
      return { ok: false };
    },
    { entryId: ENTRY, lessonId: LESSON, matchId: MATCH },
    async () => {
      reconciliations += 1;
    },
  );

  assert.equal(result, "reconciled");
  assert.equal(requests, 2);
  assert.equal(reconciliations, 1);
});

test("rejected existing-entry link, change, and unlink requests return false", async () => {
  assert.equal(typeof entryMatchClient.persistEntryMatch, "function");
  const changedMatch = "00000000-0000-4000-8000-000000000009";
  for (const matchId of [MATCH, changedMatch, null]) {
    let requests = 0;
    const saved = await entryMatchClient.persistEntryMatch(
      async () => {
        requests += 1;
        throw new TypeError("network unavailable");
      },
      ENTRY,
      matchId,
    );
    assert.equal(saved, false);
    assert.equal(requests, 1);
  }
});

test("rejected existing-entry changes clear busy state and report failure", async () => {
  assert.equal(typeof entryMatchClient.updateExistingEntryMatch, "function");
  const changedMatch = "00000000-0000-4000-8000-000000000009";
  for (const matchId of [MATCH, changedMatch, null]) {
    const busy: (string | null)[] = [];
    const saved: (string | null)[] = [];
    let failures = 0;
    await entryMatchClient.updateExistingEntryMatch(
      async () => {
        throw new TypeError("network unavailable");
      },
      { entryId: ENTRY, matchId },
      {
        setBusy(value) {
          busy.push(value);
        },
        onSaved(value) {
          saved.push(value);
        },
        onFailed() {
          failures += 1;
        },
      },
    );
    assert.deepEqual(busy, [ENTRY, null]);
    assert.deepEqual(saved, []);
    assert.equal(failures, 1);
  }
});
