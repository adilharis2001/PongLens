# Serve Review Quarter-speed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Start every newly loaded serve-research video at 0.25× playback speed.

**Architecture:** Add a small media-default helper to the serve research view module and invoke it from the labeler's existing metadata-loaded handler before seek and autoplay.

**Tech Stack:** React 19; TypeScript; Node test runner.

## Global Constraints

- Set both active and default playback rates to `0.25`.
- Apply the rate only when a new video loads.
- Preserve user-selected rate and position through anchor autosaves.

---

### Task 1: Quarter-speed playback default

**Files:**
- Modify: `src/app/research/serve-detection/serveDetectionView.test.ts`
- Modify: `src/app/research/serve-detection/serveDetectionView.ts`
- Modify: `src/app/research/serve-detection/ServeDetectionLabeler.tsx`

**Interfaces:**
- Produces: `applyServeReviewPlaybackDefaults(media)`.
- Consumed by: the video `onLoadedMetadata` handler.

- [ ] Write a failing test proving both rates become `0.25`:

```typescript
const media = { defaultPlaybackRate: 1, playbackRate: 1 };
applyServeReviewPlaybackDefaults(media);
assert.deepEqual(media, {
  defaultPlaybackRate: 0.25,
  playbackRate: 0.25,
});
```

- [ ] Run:

```bash
node --test --experimental-strip-types src/app/research/serve-detection/serveDetectionView.test.ts
```

Expected: FAIL because the helper is missing.

- [ ] Implement:

```typescript
export function applyServeReviewPlaybackDefaults(media: {
  defaultPlaybackRate: number;
  playbackRate: number;
}): void {
  media.defaultPlaybackRate = 0.25;
  media.playbackRate = 0.25;
}
```

Invoke it before seek and autoplay in `onLoadedMetadata`.

- [ ] Run:

```bash
node --test --experimental-strip-types src/app/research/serve-detection/serveDetectionView.test.ts
npm run test:research
npm run lint
npm run build
```

- [ ] Commit:

```bash
git add src/app/research/serve-detection
git commit -m "feat: default serve review to quarter speed"
```

Merge to `main`, push, and wait for Vercel production Ready.
