# Journal Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden Journal dictation, media lifecycle, authorization, and mobile behavior without redesigning the feature.

**Architecture:** Keep match voice-note persistence backward compatible while adding an explicit ephemeral transcription mode for Journal dictation. Treat entry photos as staged R2 media with owner-checked accounting, explicit deletion APIs, and a worker orphan sweep. Extract small pure boundaries for route classification, transcription mode, tag ownership, and media-path parsing so the critical contracts can be exercised without live Supabase credentials.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Supabase/PostgreSQL RLS and migrations, Cloudflare R2, Python 3 worker, Node test runner, Python unittest.

## Global Constraints

- Existing match voice notes must continue to persist audio by default.
- Journal and Working On dictation must never write audio to PongLens R2 or its storage ledger.
- Every entry-image path must be restricted to `r2://ponglens-media/entry/<auth.uid()>/`.
- Ledger negation must be idempotent.
- Referenced Journal images remain for the account lifetime.
- Unreferenced Journal images receive a two-day grace period before worker cleanup.
- No production database mutation is part of this repository implementation.
- Do not rename the `lessons` table or redesign the Journal feed in this batch.

---

### Task 1: Protected routes and ephemeral transcription

**Files:**
- Create: `src/lib/journal/transcription.ts`
- Create: `src/lib/journal/transcription.test.ts`
- Modify: `src/lib/auth/paths.ts`
- Modify: `src/lib/auth/paths.test.ts`
- Modify: `src/lib/supabase/middleware.ts`
- Modify: `next.config.ts`
- Modify: `src/app/api/transcribe/route.ts`
- Modify: `src/app/journal/JournalEditor.tsx`
- Modify: `src/app/journal/WorkingOn.tsx`
- Modify: `package.json`

**Interfaces:**
- Produces: `shouldPersistTranscription(value: FormDataEntryValue | null): boolean`
- Produces: `isProtectedAppPath(path: string): boolean`
- Existing callers of `/api/transcribe` remain persistent unless they send multipart `persist=false`.

- [ ] **Step 1: Write failing pure-contract tests**

Add to `src/lib/journal/transcription.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { shouldPersistTranscription } from "./transcription.ts";

test("transcription persists unless the caller explicitly disables it", () => {
  assert.equal(shouldPersistTranscription(null), true);
  assert.equal(shouldPersistTranscription("true"), true);
  assert.equal(shouldPersistTranscription("false"), false);
});
```

Extend `src/lib/auth/paths.test.ts`:

```ts
test("all signed-in destinations use the central protection gate", () => {
  for (const path of ["/journal", "/improve", "/stats", "/matches"]) {
    assert.equal(isProtectedAppPath(path), true);
  }
  assert.equal(isProtectedAppPath("/"), false);
  assert.equal(isProtectedAppPath("/privacy"), false);
});
```

Add a `test:journal` script that includes Journal TypeScript tests.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npm run test:journal
npm run test:auth
```

Expected: failures because both pure helpers are missing.

- [ ] **Step 3: Implement the pure helpers and central path classification**

Create `src/lib/journal/transcription.ts`:

```ts
export function shouldPersistTranscription(
  value: FormDataEntryValue | null,
): boolean {
  return value !== "false";
}
```

Move the middleware prefix list into `isProtectedAppPath()` in
`src/lib/auth/paths.ts`, including `/journal`, `/improve`, and `/stats`, and
call the helper from middleware.

- [ ] **Step 4: Implement persistent and ephemeral route branches**

In `/api/transcribe`:

1. read `persist` from the same `FormData` as `audio`;
2. derive `const persist = shouldPersistTranscription(form.get("persist"))`;
3. only generate an R2 key, call `putObject`, and append the voice ledger when
   `persist` is true;
4. always send the validated bytes to Deepgram;
5. return `{ transcript }` for ephemeral requests and
   `{ audio_path, transcript }` for persistent requests.

Do not change the default match-note behavior.

- [ ] **Step 5: Wire Journal callers and microphone policy**

Append `persist=false` to the JournalEditor and WorkingOn `FormData`.
Change the global Permissions Policy from `microphone=()` to
`microphone=(self)`.

- [ ] **Step 6: Verify GREEN**

Run:

```bash
npm run test:journal
npm run test:auth
npm run lint
```

Expected: all tests pass and lint has no new errors.

- [ ] **Step 7: Commit**

```bash
git add package.json next.config.ts src/lib/auth src/lib/journal src/lib/supabase/middleware.ts src/app/api/transcribe/route.ts src/app/journal/JournalEditor.tsx src/app/journal/WorkingOn.tsx
git commit -m "fix: make journal dictation ephemeral"
```

---

### Task 2: Journal ownership and mobile interaction

**Files:**
- Create: `src/lib/journal/tags.ts`
- Modify: `src/lib/journal/transcription.test.ts`
- Modify: `src/app/journal/NotesFeed.tsx`
- Modify: `src/app/journal/JournalEditor.tsx`
- Modify: `src/app/journal/WorkingOn.tsx`

**Interfaces:**
- Produces: `journalTagsForOwner(tags: Tag[], ownerId: string): Tag[]`
- Journal queries tags with an explicit owner filter; the pure helper remains
  defense in depth for supplied or cached rows.

- [ ] **Step 1: Write failing owner-scope test**

Add:

```ts
test("journal tags exclude vocabularies owned by coached players", () => {
  const own = { id: "own", owner_id: "viewer", label: "Footwork", created_at: "1" };
  const player = { id: "player", owner_id: "player-1", label: "Footwork", created_at: "2" };
  assert.deepEqual(journalTagsForOwner([player, own], "viewer"), [own]);
});
```

- [ ] **Step 2: Run and verify RED**

Run `npm run test:journal`.

Expected: failure because `journalTagsForOwner` does not exist.

- [ ] **Step 3: Implement ownership scoping**

Create `tags.ts` with a single owner filter. Apply `.eq("owner_id", userId)` to
the Journal tag query and apply the helper before storing the result.

- [ ] **Step 4: Make editor closure safe**

Add a single internal close function in JournalEditor that:

- stops active microphone tracks;
- marks the current recording as discarded before stopping it;
- prevents the recorder `onstop` handler from submitting discarded audio;
- triggers staged-image cleanup through the API added in Task 4 when a remote
  image path exists;
- calls the parent `onClose`.

Use it for the backdrop and close button. Add
`max-h-[calc(100dvh-1rem)] overflow-y-auto` to the mobile panel, restoring
desktop overflow behavior with `sm:max-h-[calc(100dvh-2rem)]`.

- [ ] **Step 5: Clarify active cue state**

Keep the completion circle visible but hide its checkmark until
hover/focus. History keeps the permanent checkmark.

- [ ] **Step 6: Verify GREEN**

Run:

```bash
npm run test:journal
npm run lint
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/journal src/app/journal
git commit -m "fix: scope and stabilize journal interactions"
```

---

### Task 3: Entry-image storage migration and parser

**Files:**
- Create: `supabase/migrations/056_journal_hardening.sql`
- Create: `src/lib/journal/entryImage.ts`
- Create: `src/lib/journal/journalMigration.test.ts`
- Modify: `src/lib/journal/transcription.test.ts`
- Modify: `src/app/api/entry-image/route.ts`

**Interfaces:**
- Produces: `parseOwnedEntryImage(path: string, userId: string): { bucket: string; key: string } | null`
- Produces PostgreSQL RPCs:
  - `ledger_append_entry_image(p_bytes bigint, p_key text) returns void`
  - `ledger_negate_entry_image(p_key text) returns int`

- [ ] **Step 1: Write failing parser and migration tests**

Parser expectations:

```ts
assert.deepEqual(
  parseOwnedEntryImage(
    "r2://ponglens-media/entry/user-1/image.jpg",
    "user-1",
  ),
  { bucket: "ponglens-media", key: "entry/user-1/image.jpg" },
);
assert.equal(
  parseOwnedEntryImage(
    "r2://ponglens-media/entry/other/image.jpg",
    "user-1",
  ),
  null,
);
assert.equal(
  parseOwnedEntryImage("r2://ponglens-raw/entry/user-1/image.jpg", "user-1"),
  null,
);
```

The migration test reads the SQL and asserts that it contains the new ledger
kind, both owner-prefix checks, explicit revoke/grant statements, and a recent
notes index.

- [ ] **Step 2: Run and verify RED**

Run `npm run test:journal`.

Expected: missing parser and migration failures.

- [ ] **Step 3: Implement migration**

`056_journal_hardening.sql` will:

1. replace `storage_ledger_kind_check` with
   `('clip', 'cut', 'voice', 'reel', 'entry_image', 'other')`;
2. define `ledger_append_entry_image` with authentication, positive byte
   bounds, and exact caller-prefix validation;
3. define `ledger_negate_entry_image` with authentication and caller-prefix
   validation, delegating to `_ledger_negate_keys(array[p_key])`;
4. revoke both functions from `public, anon`;
5. grant both to `authenticated`;
6. add `notes_created_at_idx on notes (created_at desc)`.

- [ ] **Step 4: Implement parser and upload accounting**

Use `parseOwnedEntryImage` anywhere an entry image path crosses an API
boundary. After `putObject`, call `ledger_append_entry_image` with the byte
length and full R2 URI. Log ledger errors without failing the completed upload.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npm run test:journal
npm run test:costs
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/056_journal_hardening.sql src/lib/journal src/app/api/entry-image/route.ts
git commit -m "feat: account for journal entry images"
```

---

### Task 4: Explicit staged-image and entry deletion

**Files:**
- Modify: `src/lib/journal/entryImage.ts`
- Modify: `src/lib/journal/transcription.test.ts`
- Modify: `src/app/api/entry-image/route.ts`
- Create: `src/app/api/journal-entry/route.ts`
- Modify: `src/app/journal/JournalEditor.tsx`
- Modify: `src/app/journal/LessonCard.tsx`

**Interfaces:**
- Produces: `entryImageDeleteRequest(path: unknown, userId: string)` returning
  either the parsed object or a stable validation error.
- `DELETE /api/entry-image` consumes `{ imagePath: string }`.
- `DELETE /api/journal-entry` consumes `{ entryId: string }`.

- [ ] **Step 1: Write failing deletion-boundary tests**

Cover:

- non-string and malformed paths are rejected;
- another user's prefix is rejected;
- a valid caller-owned media path yields its bucket and object key.

The production change that makes these tests pass is the pure
`entryImageDeleteRequest` boundary used by both deletion routes.

- [ ] **Step 2: Run and verify RED**

Run `npm run test:journal`.

- [ ] **Step 3: Implement staged-image DELETE**

In `DELETE /api/entry-image`:

1. authenticate;
2. parse JSON;
3. validate with the pure boundary;
4. query `lessons` for `image_path` under RLS;
5. return `409` when referenced;
6. delete the R2 object;
7. call `ledger_negate_entry_image`;
8. return `{ ok: true }`.

Deleting a nonexistent object remains idempotent because `deleteObjects`
accepts R2 `404`.

- [ ] **Step 4: Implement saved-entry DELETE**

Create `/api/journal-entry`:

1. authenticate and validate a non-empty entry id;
2. select `id, image_path` from `lessons` through RLS;
3. return `404` when absent;
4. delete the row and return `500` if that fails;
5. if the image path is valid for the caller, best-effort delete it and negate
   the ledger;
6. log cleanup failure but return `{ ok: true }` because the row is gone.

- [ ] **Step 5: Wire editor and card**

JournalEditor calls staged-image DELETE when:

- the user presses Remove;
- the editor closes with an accepted staged photo;
- replacing future staged state requires discarding the prior object.

LessonCard waits for `/api/journal-entry` success before invoking `onDeleted`.
On failure it keeps the card and shows `Couldn't delete this entry. Try again.`

- [ ] **Step 6: Verify GREEN**

Run:

```bash
npm run test:journal
npm run lint
npm run build
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/journal src/app/api/entry-image/route.ts src/app/api/journal-entry/route.ts src/app/journal
git commit -m "fix: clean up journal media on deletion"
```

---

### Task 5: Worker orphan sweep

**Files:**
- Modify: `worker/worker.py`
- Create: `worker/tests/test_journal_media_retention.py`

**Interfaces:**
- Produces: `unreferenced_entry_objects(objects, referenced, cutoff)` as a
  deterministic selector used by the R2 sweep.
- Produces: `entry_image_sweep(conn)` retention tier.

- [ ] **Step 1: Write failing selector tests**

Use simple object dictionaries with `Key` and timezone-aware `LastModified`.
Assert that:

- old unreferenced `entry/` objects are selected;
- referenced objects are retained;
- objects newer than the two-day cutoff are retained.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
worker/venv/bin/python -m unittest worker.tests.test_journal_media_retention -v
```

Expected: import failure because the selector does not exist.

- [ ] **Step 3: Implement selector and sweep**

Add `ENTRY_ORPHAN_GRACE_DAYS = 2`. Query all non-null
`lessons.image_path` values, list `entry/` objects, select old unreferenced
keys through the pure helper, delete in batches, and call
`ledger_negate_keys`.

Register `r2-entry-orphans` as an independent `retention_sweep` tier.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
worker/venv/bin/python -m unittest worker.tests.test_journal_media_retention -v
worker/venv/bin/python -m unittest discover -s worker/tests -q
```

- [ ] **Step 5: Commit**

```bash
git add worker/worker.py worker/tests/test_journal_media_retention.py
git commit -m "fix: sweep orphaned journal images"
```

---

### Task 6: Final integration verification and review

**Files:**
- Modify only files required by failures found during verification.

**Interfaces:**
- Consumes all prior task contracts.
- Produces a buildable, tested hardening batch and an unapplied migration.

- [ ] **Step 1: Run the complete verification gate**

```bash
set -e
npm run lint
for verify_script in test:auth test:learn test:match-structure test:costs test:placement test:research test:journal; do
  npm run "$verify_script"
done
npm run build
worker/venv/bin/python -m unittest discover -s worker/tests -q
```

Expected:

- zero lint errors;
- every Node test passes;
- production build exits zero;
- every worker test passes.

- [ ] **Step 2: Inspect the final diff**

Run:

```bash
git status --short
git diff --check
git diff HEAD~5 --stat
```

Confirm:

- no unrelated files changed;
- no secrets or environment values appear;
- migration number follows the repository sequence;
- match voice-note persistence remains the default.

- [ ] **Step 3: Review against the design**

Re-read:

```text
docs/superpowers/specs/2026-07-29-journal-hardening-design.md
```

Verify every in-scope requirement has code and regression coverage. Record
deferred product changes in the final handoff rather than expanding scope.

- [ ] **Step 4: Commit any verification-only corrections**

If verification required corrections, commit only those files:

```bash
git add <corrected-files>
git commit -m "fix: finish journal hardening verification"
```
