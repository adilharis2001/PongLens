# PongLens — working notes

Standards that were learned the expensive way. Each rule below cost a round
of rework at least once, so the reasoning is kept with it: a rule you
understand survives a case it does not literally cover.

---

## Copy

**Friendly, direct, and only as many words as the idea needs.** Draft it the
way you would describe the feature to a friend, then delete anything that
sounds like presenting.

- **No explanatory subtitle under a heading.** Not under page titles, not
  under section headings. "Learn" needs nothing beneath it. Sections explain
  themselves through their content, the way the big consumer apps do. This
  is the single most repeated correction in this project's history.
- **No sales framing.** Rejected outright: "the whole product in order.
  Every screen below is real", "Six chapters, thirty seconds each way." It
  reads as AI-generated filler and undermines trust in the page it sits on.
- **Not clipped either.** Complete, natural sentences. The middle ground
  between showman and telegram.
- **Vary the rhythm.** Every line landing as two balanced clauses is its own
  tell. If three sentences in a row have the same shape, rewrite one.
- **No em dashes in product copy.** No the word "AI" anywhere in the
  product. "Workspace" is too corporate.
- **Positioning line:** "the table tennis toolkit for competitive players."
  Not "video studio", not "training platform", not "performance hub".
- **Accent:** at most one key phrase per caption in `text-cyan-glow`.
- **Don't print a number the UI already shows.** A chapter list saying 0:55
  above a player reading 0:54 reads as a bug, and it was one.

Empty states get one short line ("No coaches yet."), not a paragraph
explaining what the section would contain.

---

## Design and layout

**Compute the ceiling before laying anything out.** Aspect ratio times
available space, first, out loud. A 9:16 video needs 699px of height to be
full-width on a 393px phone. Discovering that after three rounds of
trimming margins is how a video ended up 53% of screen width.

- **Verify mobile at 393×660, not 393×844.** Mobile browser chrome (URL bar,
  tab strip, bottom toolbar) takes roughly 180px. Testing at full device
  height means testing against space the user does not have. Always state
  the viewport a screenshot was taken at.
- **Never subtract a fixed length from a variable viewport.** `100dvh - 18rem`
  is comfortable at 860px and brutal at 660px. Use `min()` of the real
  limits, or a proportion.
- **Media-first pages go full-bleed.** App chrome is a choice, not a given.
  `src/app/match/[id]/page.tsx` is the precedent: it uses `AppNav` directly
  instead of `AppShell`, because `AppShell` brings a max-width column, its
  own padding and the `.page-enter` animation.
- **Size boxes on a `div`, never on a `<video>` or `<img>`.** A media element
  has no intrinsic size until its metadata arrives, so `width: auto` starts
  at the spec's default 300×150 and visibly jumps when the file answers.
- **An explicit height plus a max-width defeats `aspect-ratio`.** You get a
  correctly-clamped box of the wrong shape with the picture letterboxed
  inside it. Give the box one definite dimension that already accounts for
  the other limit.
- **Native video controls only once playback has started.** Idle, the browser
  paints its own play button, skip controls and scrubber across the picture,
  and on iOS an expand icon in the exact corner a title wants. Design the
  idle state; hand over to native controls on play.
- **Anything overlaid on a video must clear out while it plays.** The native
  scrubber lives along the bottom edge, where a chapter strip wants to be.

### Traps specific to this codebase

- **Both responsive layouts render at once**, one hidden with `display: none`
  (`lg:hidden` beside `hidden lg:flex`). Nothing is conditionally mounted.
  Never portal or `position: fixed` a child out of the hidden branch — it
  escapes the only thing silencing it. This started two videos playing at
  once from a single tap.
- **`position: fixed` resolves against the nearest transformed ancestor.**
  `AppShell`'s `.page-enter` holds a transform for the 200ms of its entry
  animation, which is long enough for a fast tap to get a "full screen" the
  size of the shell's column.
- **`lg:grid-cols-[minmax(0,1fr)_320px]` does not generate.** The comma
  inside `minmax()` defeats Tailwind. Use flex or a stock utility. To settle
  any "is this class real" question, compile the stylesheet directly rather
  than guessing — see the note in the memory on dev-server clobbering.
- **A `<video>` removed from the document keeps playing with sound.** Pause
  on unmount, every time.
- **Do not clear `src` in an effect cleanup.** StrictMode runs effects
  mount → cleanup → mount, React sees no prop change, and the second mount
  has no source at all.

---

## Tutorial videos

The pipeline lives in `scripts/demos/tutorial/`; `SCRIPT.md` there is the
authority on chapters and production rules. What matters at this level:

- **Narration is generated first**, and its measured line durations drive the
  capture. Audio and picture line up by construction rather than by editing.
- **Annotations are recorded as data** against the elements they point at, so
  re-running a capture after a UI change moves the boxes with it.
- **The chapters live in R2**, never `public/` — nine files is about 50MB
  that would otherwise ride along in every Vercel deploy forever.
- **Captures sign in as real accounts**, so the addresses come from
  `TUTORIAL_ACCOUNT` / `TUTORIAL_COACH` in the environment. This repo is
  public and a magic link is minted for whatever is set.
- **Captures write to real data.** `guard.mjs` snapshots and restores, and it
  needs to cover rows created as well as columns changed.
- **Watch the whole render**, not just the beat you were worried about. A
  sheet left open for 17 seconds got through review because only one moment
  was checked.
- Voice is `sage` at 1.3 speed. Every chapter carries a one-second logo
  intro and a logo outro.

---

## Working style

- **When feedback is about feel or organisation rather than a specific
  defect, offer two or three concrete directions and let Adil choose.** Ten
  rounds of guessing produced a cramped layout; one direction question
  produced the right one in a single pass. Reach for it early.
- **Run the real `npm run build` before claiming a change is safe.** A
  filtered `tsc` hid a broken import path and shipped a failed deploy. Never
  grep the typecheck down to "my" files.
- **Build in a `git worktree` with its own `.next`** when a dev server is
  already running in this checkout. They share the directory and corrupt
  each other.
- **State what was verified and what was not.** "Typecheck passed" is the
  sentence most likely to be used to skip a real check, so it is the one
  that must not be wrong.
