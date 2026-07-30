# Journal Hardening Design

## Goal

Fix the Journal's immediate privacy, authorization, media-lifecycle, and
mobile usability gaps without redesigning the feature or changing its product
model.

The batch must preserve the existing distinction between:

- match voice notes, whose audio is intentionally stored and playable; and
- Journal and Working On dictation, whose audio is sent for transcription but
  must not be stored by PongLens.

## Scope

This batch includes:

1. allowing same-origin microphone access;
2. ephemeral dictation for Journal entries and Working On cues;
3. complete accounting and cleanup for attached Journal images;
4. Journal tag vocabulary scoped to the signed-in author's tags;
5. consistent early-access and onboarding protection for Journal routes;
6. a viewport-safe mobile Journal editor;
7. a clearer active-cue completion control;
8. focused regression coverage.

The following remain separate projects:

- renaming `lessons` to `journal_entries`;
- coach-authored shared lessons;
- a server-paginated unified Journal feed and search;
- preserving relational provenance from takeaways to Working On cues.

## 1. Microphone policy and transcription modes

The global `Permissions-Policy` header will allow the application's own origin
to use the microphone while continuing to deny third-party frames:

```text
microphone=(self)
```

`POST /api/transcribe` will accept an optional multipart field named
`persist`. Its contract is:

- omitted or any value other than the exact string `false`: preserve the
  existing voice-note behavior by storing audio in R2, appending the voice
  storage ledger, and returning `audio_path`;
- exact string `false`: send the audio bytes to Deepgram without writing them
  to R2 or the storage ledger, and return only the transcript.

The default remains persistent so existing match-note clients are backward
compatible. JournalEditor and WorkingOn will explicitly send `persist=false`.
Both modes still authenticate the caller and enforce the existing media type
and size limits.

## 2. Journal image lifecycle

### Accounting

A forward-only migration will:

- add `entry_image` to the `storage_ledger.kind` constraint;
- add `ledger_append_entry_image(p_bytes, p_key)`, restricted to authenticated
  callers and the caller's `r2://ponglens-media/entry/<uid>/` prefix;
- add `ledger_negate_entry_image(p_key)`, with the same owner-prefix check,
  which delegates to the existing idempotent ledger-negation function.

`POST /api/entry-image` will append the accepted image to the ledger after R2
storage succeeds. A ledger failure is logged but does not turn a successfully
stored image into a failed upload.

### Staged-image deletion

`DELETE /api/entry-image` will accept `{ imagePath }` and:

1. authenticate the caller;
2. parse and validate the exact media bucket and caller-owned `entry/` prefix;
3. check through RLS that no Journal entry currently references the path;
4. return `409` if it is referenced;
5. delete the R2 object;
6. idempotently negate its ledger balance.

JournalEditor will call this endpoint when an accepted staged image is removed
or when the editor is dismissed. The editor does not need to block closing on
cleanup; failed cleanup is covered by the worker sweep.

### Saved-entry deletion

`DELETE /api/journal-entry` will accept `{ entryId }` and:

1. authenticate the caller;
2. load the caller-owned `lessons` row through RLS;
3. delete the database row;
4. best-effort delete its validated attached R2 image;
5. negate the image ledger balance after successful object deletion.

The row is deleted before R2 cleanup. If media cleanup fails, the entry is
still deleted and the worker orphan sweep removes the object later. The route
returns success once the durable user-visible row is gone.

### Orphan safety net

The daily worker retention process will sweep `ponglens-media/entry/`.
Objects older than two days that are not referenced by any
`lessons.image_path` row will be deleted and their ledger keys negated.
Referenced images remain for the account lifetime.

The two-day grace period protects uploads whose Journal entry is still being
composed and matches the established annotated-sketch cleanup pattern.

## 3. Authorization and role correctness

The Journal's tag query will include:

```text
owner_id = signed-in user id
```

This matches the `entry_tags` RLS contract. A coach's visibility into a
player's point-tag vocabulary will continue on match-specific surfaces, but
those player-owned tags will not appear as choices for the coach's private
Journal entries.

Protected-route classification will move to a pure, tested helper shared by
middleware. `/journal`, `/improve`, and `/stats` will receive the same
authentication, early-access, and onboarding gates as the rest of the
authenticated application. Existing route checks remain defense in depth.

## 4. Journal editor and Working On UI

The mobile editor panel will have a dynamic-viewport maximum height and
vertical scrolling. The desktop centered-dialog behavior remains unchanged.

Closing the editor will:

- stop any active microphone tracks;
- mark an in-progress recording as discarded so its `onstop` callback does not
  submit it for transcription;
- request deletion of any accepted staged image;
- preserve the existing text draft in component state so an accidental close
  can be recovered by reopening before navigation.

An active Working On cue will render an empty completion circle. Its checkmark
will appear on hover/focus as an affordance and permanently only after the cue
moves to History. This removes the current visual implication that active cues
are already complete.

## 5. Failure handling

- Ephemeral transcription never falls back to persistent storage.
- A failed staged-image cleanup is quiet in the editor because the worker is
  the reliable fallback.
- A saved-entry delete failure keeps the card visible and shows a concise
  retryable error. Optimistic permanent removal is not used.
- Worker cleanup is best-effort and isolated like the other retention tiers;
  one failed tier cannot stop queue polling or the remaining sweeps.
- Every ledger negation is idempotent.

## 6. Testing

Test-first coverage will include:

- exact parsing of persistent versus ephemeral transcription mode;
- Journal and Working On callers explicitly selecting ephemeral mode;
- protected-path classification for Journal, Improve, and Stats;
- Journal tag selection excluding other owners' tags;
- migration contracts for image kind, owner-prefix checks, grants, and
  idempotent negation;
- entry-image deletion path validation and referenced-image refusal through a
  small pure authorization/parser boundary;
- worker orphan selection retaining referenced images and grace-period
  objects while deleting old unreferenced objects;
- source-level wiring checks only where a framework boundary cannot be
  exercised without a live Supabase session.

The final verification gate is:

```text
npm run lint
all existing npm test:* scripts
npm run build
worker/venv/bin/python -m unittest discover -s worker/tests -q
```

No production database mutation is part of this repository implementation.
The new migration will be ready to apply through the normal Supabase migration
workflow.
