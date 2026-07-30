# Serve Follow-up Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep follow-up video playback stable across anchor autosaves and start each eligible clip from its saved exact serve contact.

**Architecture:** Add two pure playback helpers to the existing serve research view module: one produces a stable media-session key from assignment identity, and one derives the initial follow-up playback time. The labeler uses the stable key for its media-loading effect and seeks/plays once when the newly loaded video's metadata becomes available.

**Tech Stack:** React 19; Next.js 15; TypeScript; Node test runner.

## Global Constraints

- Autosave must not fetch, remount, seek, pause, or reset the current video.
- Follow-up clips with exact contact start at that exact timestamp.
- Occluded clips and original-review mode start at zero.
- Autoplay rejection leaves the player paused at the intended timestamp.

---

### Task 1: Stable follow-up playback

**Files:**
- Modify: `src/app/research/serve-detection/serveDetectionView.test.ts`
- Modify: `src/app/research/serve-detection/serveDetectionView.ts`
- Modify: `src/app/research/serve-detection/ServeDetectionLabeler.tsx`

**Interfaces:**
- Produces: `serveMediaSessionKey(assignment)` and
  `initialServePlaybackTime(mode, humanLabel, durationS)`.
- Consumed by: the labeler's protected-media effect and video metadata event.

- [ ] **Step 1: Write failing playback tests**

```typescript
const beforeSave = { id: "assignment-1", human_label: null };
const afterSave = {
  id: "assignment-1",
  human_label: { followup: { first_bounce: { status: "exact" } } },
};
assert.equal(
  serveMediaSessionKey(beforeSave),
  serveMediaSessionKey(afterSave),
);
assert.equal(
  initialServePlaybackTime(
    "followup",
    { actual_serve_contact_s: 1.25 },
    5,
  ),
  1.25,
);
assert.equal(
  initialServePlaybackTime(
    "followup",
    { actual_serve_contact_s: 8 },
    5,
  ),
  5,
);
```

Also assert that a different assignment ID changes the session key and that
original mode or absent exact contact returns zero.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test --experimental-strip-types src/app/research/serve-detection/serveDetectionView.test.ts
```

Expected: FAIL because the playback helpers do not exist.

- [ ] **Step 3: Implement the pure helpers**

`serveMediaSessionKey` returns only the assignment ID. The initial-time helper
accepts unknown stored label data, reads only a finite non-negative exact
contact in follow-up mode, and clamps it to `[0, durationS]`.

- [ ] **Step 4: Wire the labeler to the helpers**

Replace the media effect's whole-assignment dependency with the stable session
key. On `loadedmetadata`, seek to the initial time, update the displayed time,
and call `play()`. Catch autoplay rejection without resetting the seek.

- [ ] **Step 5: Verify GREEN and regressions**

```bash
node --test --experimental-strip-types src/app/research/serve-detection/serveDetectionView.test.ts
npm run test:research
npm run lint
npm run build
```

- [ ] **Step 6: Commit, merge, and deploy**

```bash
git add src/app/research/serve-detection/serveDetectionView.test.ts \
  src/app/research/serve-detection/serveDetectionView.ts \
  src/app/research/serve-detection/ServeDetectionLabeler.tsx
git commit -m "fix: keep serve follow-up playback stable"
```

Merge into `main`, push, wait for the production deployment to reach Ready,
and verify the live route still redirects anonymous users to login.

