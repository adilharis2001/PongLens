# Broader Coach Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/coaches` around the roster-first coaching workspace while keeping paid match reviews as an optional final capability.

**Architecture:** Keep the existing six-section landing-page skeleton and shared responsive marketing components. Replace coach-specific copy, feature visuals, hero captures, walkthrough captures, metadata, onboarding destination, and video assets without changing the underlying coach workspace or media components.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Tailwind CSS 4, Motion, Node test runner, Playwright capture scripts, ffmpeg, existing OpenAI narration pipeline

**Spec:** `docs/superpowers/specs/2026-09-04-coach-landing-broader-workspace-design.md`

## Global Constraints

- The page is roster-first: students, lesson entries, sharing, matches, then optional paid reviews.
- Video lesson recording must say `coming soon` until the product flow ships.
- Product copy stays plain, calm, specific, and free of idiom, hype, em dashes, and unapproved uses of `AI`.
- Section headings do not get explanatory subtitles.
- New feature visuals are code-native Motion/CSS animations; walkthrough and hero images are real app captures.
- Existing `LandingVideo` and `WalkthroughBand` responsive behavior remains shared with the player page.
- Verify mobile at exactly `393 × 660` and desktop at `1280 × 720` or wider.
- Preserve unrelated working-tree changes.

---

### Task 1: Lock the coach landing content and navigation contract

**Files:**
- Create: `src/app/coaches/coachLanding.test.ts`
- Modify: `src/components/SiteHeader.tsx`
- Modify: `src/components/SiteFooter.tsx`
- Modify: `src/app/coaching/start/page.tsx`
- Create: `src/app/coaching/start/CoachModeStart.tsx`
- Modify: `package.json`

**Interfaces:**
- `SiteHeader({ featureHref?: string })` defaults to `/#features`.
- `SiteFooter({ audience?: "players" | "coaches" })` defaults to `players`; `coaches` renders `For players` linking to `/`.
- `CoachModeStart({ userId: string })` marks the authenticated account as a coach, remembers the coach workspace, and replaces the route with `/coaching`.
- `npm run test:coach-landing` runs the landing contract test.

- [ ] **Step 1: Write the failing source-contract test**

Create a Node test that reads the shared chrome and start route and asserts:

```ts
assert.match(header, /featureHref/);
assert.match(footer, /audience/);
assert.match(start, /CoachModeStart/);
```

- [ ] **Step 2: Run the test and confirm the old page fails**

Run: `node --test --experimental-strip-types src/app/coaches/coachLanding.test.ts`

Expected: FAIL because the shared chrome interfaces and coach-mode start component do not exist.

- [ ] **Step 3: Add contextual public-site navigation**

Add the optional `featureHref` prop to `SiteHeader`, and the optional `audience` prop to `SiteFooter`. Preserve existing defaults so every current caller remains unchanged.

- [ ] **Step 4: Change `/coaching/start` into the general coach-mode entry**

Keep the existing signed-out redirect. Render `CoachModeStart` for authenticated visitors. In its mount effect:

```ts
await createClient().auth.updateUser({ data: { is_coach: true } });
setWorkspace(userId, "coach");
router.replace("/coaching");
router.refresh();
```

Render one stable line, `Setting up coach mode…`, while it completes and a retry button if the update fails. The paid storefront remains available from the existing embedded `CoachStart` card inside the coach workspace.

- [ ] **Step 5: Add the test script and rerun the contract test**

Add:

```json
"test:coach-landing": "node --test --experimental-strip-types src/app/coaches/coachLanding.test.ts"
```

Run: `npm run test:coach-landing`

Expected: PASS.

- [ ] **Step 6: Commit the entry and navigation behavior**

```bash
git add package.json src/components/SiteHeader.tsx src/components/SiteFooter.tsx src/app/coaching/start src/app/coaches/coachLanding.test.ts
git commit -m "Make coach mode the landing page entry"
```

---

### Task 2: Build the roster-first coach feature animations

**Files:**
- Create: `src/components/anim/coach/StudentRoster.tsx`
- Create: `src/components/anim/coach/StudentJournal.tsx`
- Create: `src/components/anim/coach/LessonRecording.tsx`
- Create: `src/components/anim/coach/JournalShare.tsx`
- Test: `src/app/coaches/coachLanding.test.ts`

**Interfaces:**
- Each component exports a zero-argument React component.
- Each root is an absolutely positioned `role="img"` surface matching the existing `3 / 2` feature-card frame.
- Each component uses `useReducedMotion()` and has a readable static reduced-motion state.

- [ ] **Step 1: Extend the failing test with visual contracts**

Assert that all four files exist, export the named component, include `role="img"`, include a descriptive `aria-label`, and call `useReducedMotion`.

- [ ] **Step 2: Run the test and confirm the new visual assertions fail**

Run: `npm run test:coach-landing`

Expected: FAIL because the four components do not exist.

- [ ] **Step 3: Implement `StudentRoster`**

Draw three compact student rows. Animate a cyan focus treatment moving between rows while counts for `matches` and `entries` remain stable.

- [ ] **Step 4: Implement `StudentJournal`**

Draw one lesson entry with short note lines, a photo tile, and a link row. Animate the note arriving without changing the card's size.

- [ ] **Step 5: Implement `LessonRecording`**

Draw a recording timer, waveform, and transcript lines. Animate the waveform and the transition from recording to prepared notes; the reduced-motion state shows both the waveform and finished notes without implying active capture.

- [ ] **Step 6: Implement `JournalShare`**

Draw a coach entry and a student journal card. Animate a copy of the entry moving between them, followed by a stable `Shared` state.

- [ ] **Step 7: Run the focused test and lint the components**

Run:

```bash
npm run test:coach-landing
npx eslint src/components/anim/coach/StudentRoster.tsx src/components/anim/coach/StudentJournal.tsx src/components/anim/coach/LessonRecording.tsx src/components/anim/coach/JournalShare.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit the new visuals**

```bash
git add src/components/anim/coach src/app/coaches/coachLanding.test.ts
git commit -m "Add coach workspace landing animations"
```

---

### Task 3: Rewrite the coach landing page

**Files:**
- Modify: `src/app/coaches/page.tsx`
- Test: `src/app/coaches/coachLanding.test.ts`

**Interfaces:**
- The page uses `StudentRoster`, `StudentJournal`, `LessonRecording`, `JournalShare`, `FindingPoints`, and `TermsDial` as its six feature visuals.
- `SiteHeader` receives `featureHref="#features"`.
- `SiteFooter` receives `audience="coaches"`.
- Both primary calls to action link to `/coaching/start` and read `Set up coach mode`.

- [ ] **Step 1: Extend the failing test to cover every approved section**

Assert the exact hero, six feature titles, seven walkthrough titles, nine FAQ questions, CTA heading, metadata description, contextual header/footer props, and absence of these stale lead claims:

```ts
assert.doesNotMatch(page, /Show your students/);
assert.doesNotMatch(page, /What you work with/);
assert.doesNotMatch(page, /Your first offering takes/);
```

Also assert that `Video record` appears only with `coming soon` in the same answer or card.

- [ ] **Step 2: Run the test and confirm it fails on the old page**

Run: `npm run test:coach-landing`

Expected: FAIL on the copy assertions.

- [ ] **Step 3: Replace the metadata and JSON-LD**

Keep the title and canonical URL. Replace the page, OpenGraph, and Twitter description with the approved broader-workspace description. Change the JSON-LD service name to `Coaching workspace for table tennis coaches`, and describe student management, lesson entries, lesson recording, shared matches, and optional paid reviews.

- [ ] **Step 4: Replace the hero and feature section**

Use the exact approved hero and feature copy. Add `id="features"` to the coach feature section. Keep one cyan phrase per card caption at most.

- [ ] **Step 5: Replace the video and walkthrough framing**

Change the video heading to `See coaching on PongLens`. Replace the walkthrough with the seven approved chapters and their future screenshot basenames. Keep the existing `WalkthroughBand` timing at a readable value of at least `7500` milliseconds per screenshot.

- [ ] **Step 6: Replace the FAQ and closing CTA**

Use the approved nine answers and closing copy exactly. Keep video lesson recording explicitly marked as coming soon.

- [ ] **Step 7: Update the hero composition and contextual chrome**

Point the hero images at the new student-page and lesson-entry captures from Task 4. Pass `featureHref="#features"` and `audience="coaches"` to the shared chrome.

- [ ] **Step 8: Run the focused test and lint the page**

Run:

```bash
npm run test:coach-landing
npx eslint src/app/coaches/page.tsx src/components/SiteHeader.tsx src/components/SiteFooter.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit the rewritten page**

```bash
git add src/app/coaches/page.tsx src/app/coaches/coachLanding.test.ts src/components/SiteHeader.tsx src/components/SiteFooter.tsx
git commit -m "Reframe the coach landing page around students"
```

---

### Task 4: Capture the current coach workspace for the hero and walkthrough

**Files:**
- Modify: `scripts/demos/shots.mjs`
- Create: `public/showcase/coach-students-m.jpg`
- Create: `public/showcase/coach-student-t.jpg`
- Create: `public/showcase/coach-add-student-m.jpg`
- Create: `public/showcase/coach-invite-m.jpg`
- Create: `public/showcase/coach-entry-compose-m.jpg`
- Create: `public/showcase/coach-entry-m.jpg`
- Create: `public/showcase/coach-entry-shared-m.jpg`
- Reuse: `public/showcase/coach-points-m.jpg`
- Reuse: `public/showcase/coach-offering-m.jpg`

**Interfaces:**
- New shot definitions use the existing staged `coach` account.
- Student routes are discovered from rendered `/coaching/students` links rather than hard-coding production row IDs.
- Every shot waits for a stable text anchor before capture.

- [ ] **Step 1: Add shot definitions for the roster and student page**

Add helpers that open `/coaching/students`, select the first student link, and wait for `Journal` and `Matches`. Add a tablet viewport capture for the hero and a mobile roster capture.

- [ ] **Step 2: Add shot definitions for add, invite, compose, and share states**

Use visible controls to open each state. Do not insert or share real data during capture; forms may be opened, and existing staged shared/private entries may be selected.

- [ ] **Step 3: Run the capture against local development**

Start the app with `npm run dev`, then run:

```bash
SERVICE_KEY="$(security find-generic-password -a openclaw -s ponglens-service-role -w)" \
BASE=http://localhost:3000 node scripts/demos/shots.mjs \
  coach-students-m coach-student-t coach-add-student-m coach-invite-m \
  coach-entry-compose-m coach-entry-m coach-entry-shared-m
```

Expected: seven JPEGs under `public/showcase`, each at the configured 2x capture size.

- [ ] **Step 4: Inspect every capture**

Check that no personal account data, browser loading state, cropped action, broken image, or stale paid-review-first screen appears. Recapture any failed frame.

- [ ] **Step 5: Point the page at the final capture names and rerun the page test**

Run: `npm run test:coach-landing`

Expected: PASS with every referenced `-m.jpg` or tablet asset present.

- [ ] **Step 6: Commit the capture definitions and images**

```bash
git add scripts/demos/shots.mjs public/showcase src/app/coaches/page.tsx
git commit -m "Capture the coach workspace for the landing page"
```

---

### Task 5: Rebuild the coach landing video around the coaching workspace

**Files:**
- Modify: `scripts/demos/landing/SCRIPT-COACH.md`
- Modify: `scripts/demos/landing/chapters/coach.json`
- Modify: `scripts/demos/landing/flows/coach.mjs`
- Modify: `scripts/demos/landing/flows/coach-desktop.mjs`
- Modify: `scripts/demos/landing/flows/coach-mobile.mjs`
- Regenerate: `scripts/demos/landing/voice/coach.json`
- Regenerate: `public/demo/coach.vtt`
- Replace: `public/demo/coach-desktop.mp4`
- Replace: `public/demo/coach-desktop.jpg`
- Replace: `public/demo/coach-mobile.mp4`
- Replace: `public/demo/coach-mobile.jpg`
- Modify: `src/lib/videos.ts`
- Modify: `src/app/coaches/page.tsx`

**Interfaces:**
- Chapter JSON is the source for narration generation.
- `voice/coach.json` is generated by the existing TTS command and drives both captures.
- Desktop and mobile flows share one beat sequence in `coach.mjs`.
- `COACH_LENGTH` is measured from the final published file with `ffprobe`.

- [ ] **Step 1: Write the full replacement script**

Expand the approved eight-part outline into plain spoken lines. Every section starts with a screen change that can be covered by its title card. Mention video lesson recording only as coming soon and do not stage a fake working flow.

- [ ] **Step 2: Replace the chapter map**

Use these section labels in order: `Your students`, `Connect them`, `Keep the lesson`, `Record the lesson`, `Share it`, `Their matches`, `Paid reviews`. Give every navigation boundary at least `2.6` seconds of pause.

- [ ] **Step 3: Generate and inspect narration metadata**

Run:

```bash
node scripts/demos/tutorial/tts.mjs coach ../landing --reuse
node scripts/demos/landing/captions.mjs coach coach
```

Expected: regenerated `voice/coach.json` and `public/demo/coach.vtt`, with every spoken line matching the chapter source.

- [ ] **Step 4: Rewrite the shared browser flow**

Drive the real staged coach through the roster, one student, entry creation or an existing entry, sharing, a student match, and finally the paid-review area. Preserve the existing `arrive`, `place`, `glide`, staging, and cleanup rules. Do not leave new rows or sharing changes behind after capture.

- [ ] **Step 5: Capture desktop and mobile raw cuts**

Run:

```bash
node scripts/demos/tutorial/capture.mjs coach-desktop ../landing
node scripts/demos/tutorial/capture.mjs coach-mobile ../landing
ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 scripts/demos/landing/raw/tut-coach-desktop.mp4
ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 scripts/demos/landing/raw/tut-coach-mobile.mp4
```

Expected dimensions: `1440 × 810` and `390 × 844`.

- [ ] **Step 6: Render and publish both cuts**

Run:

```bash
node scripts/demos/landing/render.mjs coach-desktop coach
node scripts/demos/landing/render.mjs coach-mobile coach
node scripts/demos/landing/publish.mjs coach-desktop coach-desktop
node scripts/demos/landing/publish.mjs coach-mobile coach-mobile
```

- [ ] **Step 7: Measure and synchronize video metadata**

Measure both files with `ffprobe`. Set `COACH_LENGTH` to the human-readable desktop duration and update the coach `VideoObject.duration` to the matching ISO 8601 value.

- [ ] **Step 8: Watch both complete videos and inspect captions**

Watch from first frame through fade-out. Confirm every section card precedes its screen, nothing loads on camera, every caption matches the narration, and no private or real-coach data appears.

- [ ] **Step 9: Commit the rebuilt video and pipeline**

```bash
git add scripts/demos/landing public/demo/coach* src/lib/videos.ts src/app/coaches/page.tsx
git commit -m "Rebuild the coach landing video around students"
```

---

### Task 6: Verify the complete coach landing page

**Files:**
- Modify if required by verification: files from Tasks 1-5 only

**Interfaces:**
- `/coaches` is fully usable signed out.
- `/coaching/start` signs in if needed, then enters coach mode.
- Player landing defaults and shared components remain unchanged.

- [ ] **Step 1: Run focused and related tests**

Run:

```bash
npm run test:coach-landing
npm run test:marketing
npm run test:auth
npm run test:qa
```

Expected: PASS.

- [ ] **Step 2: Run lint and production build**

Run:

```bash
npm run lint
npm run build
```

Expected: PASS.

- [ ] **Step 3: Inspect desktop rendering**

At `1280 × 720`, verify the hero composition, six-card grid, landscape video, desktop walkthrough list, all FAQ rows, contextual header link, `For players` footer link, and final CTA.

- [ ] **Step 4: Inspect mobile rendering**

At `393 × 660`, verify the hero fits, feature cards have a next-card peek, the portrait video is selected, walkthrough chips and captions remain together, FAQs fit without horizontal overflow, and tap targets remain full size.

- [ ] **Step 5: Inspect reduced motion and links**

Emulate `prefers-reduced-motion: reduce`. Confirm each feature visual remains understandable. Follow `#features`, `#how`, both coach-mode CTAs, the player footer link, and sign-in behavior.

- [ ] **Step 6: Review the final diff for unrelated changes**

Run:

```bash
git diff --check
git status --short
git diff --stat HEAD~5..HEAD
```

Confirm only the approved landing, capture, video, and onboarding files were changed by this work.

- [ ] **Step 7: Commit any verification fixes**

Stage only files from Tasks 1-5 that verification changed, inspect the staged
names with `git diff --cached --name-only`, then commit them with:

```bash
git commit -m "Polish the broader coach landing page"
```
