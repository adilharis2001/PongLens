# Responsive Journal Mic Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the clunky Working on microphone circle with a labeled desktop pill that collapses into the cue input on narrow mobile screens.

**Architecture:** A pure presentation helper maps recording state to visible and accessible copy, making the state contract testable without rendering React. `WorkingOn.tsx` consumes that helper and renders two responsive presentations wired to the same state and click handler: a desktop pill at `sm` and wider, and an icon inside the input below `sm`.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS, Node test runner

## Global Constraints

- At widths of 640px and wider, show an outlined microphone pill labeled **Dictate**.
- Below 640px, show the same microphone action inside the cue input.
- Keep Add outside the field and visually primary at every width.
- Reserve narrow-screen input padding so text cannot run beneath the microphone.
- Idle, recording, and transcribing states remain accessible and share one recording handler.
- Do not change recording, transcription, or ephemeral-audio behavior.
- Limit production changes to the Working on composer and its focused presentation helper.

---

### Task 1: Responsive Working On microphone

**Files:**
- Create: `src/lib/journal/workingOnMic.ts`
- Test: `src/lib/journal/workingOnMic.test.ts`
- Modify: `src/app/journal/WorkingOn.tsx:180-243`

**Interfaces:**
- Consumes: `type WorkingOnMicState = "idle" | "recording" | "writing"`
- Produces: `workingOnMicPresentation(state: WorkingOnMicState): { label: string; ariaLabel: string; disabled: boolean }`

- [ ] **Step 1: Write the failing presentation tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { workingOnMicPresentation } from "./workingOnMic.ts";

test("idle microphone invites dictation", () => {
  assert.deepEqual(workingOnMicPresentation("idle"), {
    label: "Dictate",
    ariaLabel: "Speak the cue",
    disabled: false,
  });
});

test("recording microphone becomes a stop control", () => {
  assert.deepEqual(workingOnMicPresentation("recording"), {
    label: "Stop",
    ariaLabel: "Stop recording",
    disabled: false,
  });
});

test("transcribing microphone reports work and disables input", () => {
  assert.deepEqual(workingOnMicPresentation("writing"), {
    label: "Writing…",
    ariaLabel: "Transcribing cue",
    disabled: true,
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm run test:journal
```

Expected: FAIL because `workingOnMic.ts` does not exist.

- [ ] **Step 3: Implement the presentation helper**

```ts
export type WorkingOnMicState = "idle" | "recording" | "writing";

export function workingOnMicPresentation(state: WorkingOnMicState) {
  if (state === "recording") {
    return { label: "Stop", ariaLabel: "Stop recording", disabled: false };
  }
  if (state === "writing") {
    return {
      label: "Writing…",
      ariaLabel: "Transcribing cue",
      disabled: true,
    };
  }
  return { label: "Dictate", ariaLabel: "Speak the cue", disabled: false };
}
```

- [ ] **Step 4: Implement the responsive component**

In `WorkingOn.tsx`:

1. Type the existing `rec` state with `WorkingOnMicState`.
2. Derive `micPresentation` and reuse one `toggleRecording` handler.
3. Wrap the input in `relative min-w-0 flex-1`.
4. Give the input `pr-12 sm:pr-3`.
5. Render an icon-only `sm:hidden` button absolutely inside the input.
6. Render a `hidden sm:inline-flex` pill between the field and Add button.
7. Use the same microphone, stop-square, and spinner glyph for both buttons.
8. Add a cyan `focus-visible` ring; use restrained red styling while recording.

The mobile button is `h-9 w-9`. The desktop pill is `h-9` with `px-3` and a
six-pixel icon-to-label gap.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm run test:journal
```

Expected: all Journal tests pass, including the three new microphone-state tests.

- [ ] **Step 6: Run verification**

Run:

```bash
npm run lint
npm run build
```

Expected: lint has no new errors and the production build succeeds.

- [ ] **Step 7: Review the responsive contract**

Confirm in the source that:

- the desktop pill is hidden below `sm`;
- the in-field icon is hidden at `sm` and wider;
- both invoke `toggleRecording`;
- both use the same presentation state;
- the input reserves right padding only when the icon is inside it.

- [ ] **Step 8: Commit**

```bash
git add \
  src/lib/journal/workingOnMic.ts \
  src/lib/journal/workingOnMic.test.ts \
  src/app/journal/WorkingOn.tsx
git commit -m "fix: polish responsive journal mic control"
```
