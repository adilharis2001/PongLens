# Learn Guides Content Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite PongLens Learn guides as factual, easy-to-follow tutorials that also work as quick reference pages.

**Architecture:** Keep guide content as typed data in `guides.ts` and keep the existing index/detail routes. Add one optional `steps` field and renderer for ordered quick paths, then replace the guide data with code-audited copy and two logical guide splits.

**Tech Stack:** Next.js 15, React 19, TypeScript, Node.js built-in test runner, ESLint

## Global Constraints

- Preserve the existing Learn index, search, guide pages, related-guide cards, and responsive screenshot treatment.
- Use exact current product labels and behavior.
- Keep copy plain, direct, and free of hype.
- Do not change product behavior outside the Learn section.
- Reuse existing verified screenshot files.

---

### Task 1: Protect guide structure and asset references

**Files:**
- Create: `src/app/learn/guides.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `guides`, `GROUPS`, and `guideSearchText` from `src/app/learn/guides.ts`
- Produces: `npm run test:learn`, a focused structural test command for Learn content

- [ ] **Step 1: Write the failing tests**

Create tests that:

```ts
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { join } from "node:path";
import {
  GROUPS,
  guideSearchText,
  guides,
  type Guide,
} from "./guides.ts";

test("guide slugs and relationships are valid", () => {
  const slugs = guides.map((guide) => guide.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  const known = new Set(slugs);
  for (const guide of guides) {
    assert.ok(GROUPS.includes(guide.group as (typeof GROUPS)[number]));
    for (const related of guide.related ?? []) assert.ok(known.has(related));
  }
});

test("every guide starts with quick steps", () => {
  for (const guide of guides) {
    assert.ok(guide.sections[0]?.steps?.length);
  }
});

test("every guide image exists under public", () => {
  for (const guide of guides) {
    for (const section of guide.sections) {
      for (const image of section.images ?? []) {
        assert.ok(existsSync(join(process.cwd(), "public", image.src)));
      }
    }
  }
});

test("quick steps are searchable", () => {
  const guide: Guide = {
    slug: "search-test",
    title: "Search test",
    summary: "A test guide.",
    group: "Get started",
    sections: [{ steps: ["Choose the unmistakable control."] }],
  };
  assert.match(guideSearchText(guide), /unmistakable/);
});
```

Add:

```json
"test:learn": "node --test --experimental-strip-types src/app/learn/guides.test.ts"
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm run test:learn`

Expected: FAIL because `GuideSection` does not yet define `steps`, existing guides do not start with steps, and search does not index steps.

- [ ] **Step 3: Commit the test baseline**

```bash
git add package.json src/app/learn/guides.test.ts
git commit -m "test: cover Learn guide structure"
```

### Task 2: Add ordered quick steps

**Files:**
- Modify: `src/app/learn/guides.ts`
- Modify: `src/app/learn/[slug]/page.tsx`

**Interfaces:**
- Consumes: `GuideSection.steps?: string[]`
- Produces: accessible ordered quick-step lists and searchable step text

- [ ] **Step 1: Add the data field and search support**

Add `steps?: string[]` to `GuideSection` and append step strings in `guideSearchText` and `guideSnippet`.

- [ ] **Step 2: Render steps as an ordered list**

In `Section`, render each step with an explicit visible number and an `<ol>`/`<li>` structure:

```tsx
{section.steps && (
  <ol className="mt-4 max-w-2xl space-y-3">
    {section.steps.map((step, index) => (
      <li key={step.slice(0, 40)} className="flex gap-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cyan-glow/15 text-xs font-semibold text-cyan-glow">
          {index + 1}
        </span>
        <span className="pt-0.5 text-[15px] leading-relaxed text-zinc-300">
          {step}
        </span>
      </li>
    ))}
  </ol>
)}
```

- [ ] **Step 3: Run the focused test**

Run: `npm run test:learn`

Expected: only the “every guide starts with quick steps” test still fails.

- [ ] **Step 4: Commit the rendering support**

```bash
git add src/app/learn/guides.ts 'src/app/learn/[slug]/page.tsx'
git commit -m "feat: add quick steps to Learn guides"
```

### Task 3: Rewrite and reorganize every guide

**Files:**
- Modify: `src/app/learn/guides.ts`
- Modify: `src/app/learn/page.tsx`

**Interfaces:**
- Consumes: the existing guide renderer, screenshot assets, and current product vocabulary
- Produces: 13 guides with quick steps, factual explanations, useful callouts, valid related links, and clearer landing copy

- [ ] **Step 1: Rewrite Get started**

Rewrite:

- `upload-a-video`
- `upload-from-youtube`

Cover camera position, landscape orientation, supported files and limits, immediate upload, side selection, exact processing options, interrupted upload recovery, processing status, YouTube eligibility, edit-lock timing, and leaving the page after an import queues.

- [ ] **Step 2: Rewrite Review and score**

Rewrite:

- `match-viewer`
- `score-points`
- `keep-score`
- `tags`

Use current labels and behavior. Explain the difference between scoring and optional Analysis. Replace obsolete Keep Score references to a scissors button with Skip, Delete, Modify, Replay, Undo, game correction, zoom, keyboard shortcuts, and final review.

- [ ] **Step 3: Split and rewrite Your game**

Replace `stats-and-placement` with:

- `match-analysis`
- `stats-over-time`

Keep `journal`, correcting “Add entry” to “New” and explaining Practice, Lesson, dictation, tags, “Condense and summarize,” Working on, History, and adding a takeaway as a cue.

- [ ] **Step 4: Split and rewrite sharing**

Keep `export`, then replace `share` with:

- `share-a-link`
- `invite-a-coach`

Explain dynamic starred/tag links, custom link titles, revocation, public-link access, coach account access, one-match vs all-match scope, future uploads, pending invites, and removal.

- [ ] **Step 5: Rewrite the coach-facing guide**

Rewrite `for-coaches` around accepting an invite, finding shared matches, watching and downloading, point notes, voice notes, drawings, overall notes, and the owner-only controls coaches do not receive.

- [ ] **Step 6: Rewrite the Learn landing copy**

Use:

```tsx
Step-by-step help for recording, reviewing, scoring, and sharing your matches.
Start with a guide below, or search for the feature you need.
```

- [ ] **Step 7: Run structural tests**

Run: `npm run test:learn`

Expected: PASS.

- [ ] **Step 8: Commit the content pass**

```bash
git add src/app/learn/guides.ts src/app/learn/page.tsx
git commit -m "content: rewrite Learn guides"
```

### Task 4: Verify the finished Learn section

**Files:**
- Modify only if verification finds a Learn-specific issue

**Interfaces:**
- Consumes: completed Learn content and renderer
- Produces: passing tests, lint, build, and a clean image/link audit

- [ ] **Step 1: Run Learn tests**

Run: `npm run test:learn`

Expected: PASS.

- [ ] **Step 2: Run ESLint on touched source files**

Run: `npx eslint src/app/learn/guides.ts src/app/learn/guides.test.ts src/app/learn/page.tsx 'src/app/learn/[slug]/page.tsx'`

Expected: no errors.

- [ ] **Step 3: Run a production build**

Run: `npm run build`

Expected: successful Next.js production build.

- [ ] **Step 4: Check the final diff**

Run: `git diff --check HEAD~3..HEAD && git status --short`

Expected: no whitespace errors; only intentional Learn work is present.

