# PongLens tutorial videos — script v2

Revised 2026-08-01 from Adil's notes. Pipeline: `scripts/demos/tutorial/`,
Remotion renderer. Chapters are captured, rendered and reviewed **one at a
time**.

---

## 1. What we are making

Two things out of one pipeline.

**A · The tour** — six chapters, ~3:20. What a first-time user watches.
**B · The library** — twelve chapters, one per feature, watched on demand
from `/learn`.

The tour is not a separate production: it is chapters 1, 3, 4, 6, 9 and 10
cut to four lines each and stitched.

### Where they live

`/learn` already has 13 guides with matching slugs (`guides.ts`). Each guide
gets its chapter embedded at the top. Plus one entry point on Home's
first-steps checklist. Not a forced interstitial — the app deliberately has
no tour-on-signup and this should not become one by the back door.

### Why chapters

30-40s is where a how-to holds attention; one chapter = one job; chapters
are reusable in `/learn`, in empty states and in support replies; and a bad
take costs one chapter, not a whole video.

---

## 2. What needs explaining, and what does not

**Self-explanatory** — the match library (a grid of cards), writing a journal
entry (a text box), picking a file. These get folded in, not narrated.

**Earns a chapter** — anything hidden (viewer gestures, the Export score
toggle), novel (Recollect), or mislabelled by its own appearance: tags look
like labels but are a cross-match collection that exports as video, and the
point scorecard looks optional but is the engine behind every stat.

**Through-line of the tour:** score your match, and the stats, the maps, the
collections and a video with the scoreboard on it all fall out of it.

---

## 3. The chapters

★ = also in the 3-minute tour. Source match: **Gui** (`a0fb8f44`, Adil's
account) unless noted.

---

### 1 ★ Start here · ~0:36 · `/dashboard`

Opens the whole thing, so it carries the intro.

1. "PongLens takes a video of your match and turns it into something you can study."
2. "Here is a quick run through what it does."
3. "Home picks up wherever you left off, so a match you started scoring sits right at the top."
4. "Under that, your recent matches, and how your game is going across all of them."
5. "Anything you have exported lands here too, ready to download or send on."
6. "And the short list of things you are working on stays in view, before you play."

*Shots: greeting → Keep scoring card → Recent matches → Your game →
Latest activity (a rendered export row with its download button) → Working on.*

---

### 2 ★ Upload a match · ~0:40 · `/upload`

Now goes further than before: submit a real YouTube import and show the
match filling itself in while it processes.

1. "Everything in PongLens starts with a match video. This is the Upload tab."
2. "Not sure how to film it? How to record shows you the camera angle that works best."
3. "Pick a video from your phone. MP4 or M O V, up to two gigabytes. The upload starts as soon as you choose it."
4. "No file to hand? Paste a YouTube link and PongLens imports the match from there."
5. "While it processes, fill in who you played, where, and which side of the table you were on."
6. "Some of it fills itself in from the video. You get an email when the match is ready."

*Shots: Upload header → How to record sheet (**dismissed**) → dropzone →
paste `youtu.be/m_3fX8dFclQ` → Import → processing card → metadata form
with the opponent name auto-filled → Saved flash.*

**TTS check:** "M O V" must read as three letters. If `sage` runs them
together, respell in the line and re-generate that line only.

**This chapter writes.** It creates a `youtube_import` job and a match row,
and the worker will really start downloading. Capture, then delete the match
and job and archive the queue message. See §5.

---

### 3 ★ Watch it back · ~0:38 · Gui → full video

1. "Your match comes back with the standing around removed. Just the play."
2. "Double tap the right of the screen to skip to the next point."
3. "Hold that side and it runs at double speed, only while you hold it."
4. "Hold the left side for 0.25 speed, to see what your hand actually did."
5. "Pinch to zoom in on the table, and drag to move around."
6. "Star a rally you want to come back to, or leave a note on it, without leaving the video."

*Dropped: the question-mark gestures sheet. Added: star and note, so the
line count holds and the viewer's own affordances get shown.*

**TTS check:** "0.25 speed" should read as "nought point two five". Listen
before rendering.

---

### 4 ★ Score a point · ~0:42 · Gui → point view

1. "Open any point and you get that rally on its own, with the score going into it."
2. "Say who won it. That is the only part that matters."
3. "Then, if you want, how it ended. Into the net, off the end, a clean winner."
4. "And when you lost it, why. Misread the spin. Too passive. Out of position."
5. "Answer a few of these and the app can tell you things the score alone cannot."
6. "Skip every one of them and everything still works."

---

### 5 Keep score · ~0:42 · Gui → Keep score

Re-shoot. Now opens with a definition, and calls out the server fix.

1. "Keep score is a PongLens screen built for one job: scoring a whole match far faster than watching it back."
2. "It plays the match one point at a time and waits for you."
3. "Watch the rally, then tap who won it. The score keeps itself."
4. "The lit ball shows who is serving. Tap it to hand the serve over if it got that wrong."
5. "Tap Why to note what went wrong."
6. "Skip a let, cut dead space, or split a clip that caught two points."
7. "Every point you score feeds your scorecard, your stats, and your placement maps."

**Fix from the first take:** the Why sheet must be closed with its **Skip**
control before the last two beats. Escape does not close it.

---

### 6 ★ Read your match · ~0:38 · Gui → analysis

1. "Once the points are scored, the match reads itself back to you."
2. "How you did serving, how you did receiving, and what happened once the game got tight."
3. "Whether you bounce back after losing a point, and your longest run."
4. "Swipe across for what actually cost you points, in the words you picked."
5. "None of this is guessed. It is built from what you confirmed."

*Line 4 is live now that the Gui match has 20 why-you-lost answers.*

---

### 7 Placement maps · ~0:35 · **Chris** (`5bd279f4`, 135 mapped points)

1. "When the ball can be tracked, PongLens maps where it landed."
2. "Your serves, or theirs. The serve on its own, or the whole rally."
3. "A dot for each landing, or a heat map of where the ball kept going."
4. "Narrow it to one game to see how the pattern moved."
5. "This one is still in beta. If a map looks wrong, say so and it stops counting."

---

### 8 Tags · ~0:33 · Gui → point → tags

1. "A tag is a short label you put on a point. Backhand error. Third ball attack."
2. "They are your words, not a fixed list. Type a new one and it exists."
3. "Tag a few points and the journal gathers every one of them, across every match."
4. "So the pattern shows up even when it is spread over months."
5. "And any tag can be exported as its own video, in order."

**Writes** (creates tag + point_tag rows). Needs the cleanup pass.

---

### 9 ★ Export and share · ~0:38 · Gui → Export

1. "Once a match is scored, you can take it with you."
2. "Turn on Include score and the scoreboard is burned into the video."
3. "Export the full match, just your starred rallies, or everything under one tag."
4. "Or send a link. Whoever you send it to can watch without an account."
5. "The original upload is there too, while it is still being kept."

*Do not press Create — a render costs worker time. Show the sheet and the
toggle only.*

---

### 10 ★ You and your coach · ~0:40 · both sides

1. "Invite your coach with a link. One match, or everything you play."
2. "They see the same points, in the same order, with the same score."
3. "They can pause on a frame and draw straight on it."
4. "The note lands on that exact point, not in a message thread you will lose."
5. "And it shows up in your journal, next to your own."
6. "They cannot change your scores. It stays your match."

**Writes** (coach note + drawing). Needs the cleanup pass. Shot from the
demo account, which already has an accepted coach link and coach notes.

---

### 11 The journal · ~0:40 · `/journal`

1. "Everything you write down lives in one place."
2. "Notes from your matches, lessons from your coach, and your own practice entries."
3. "Take a picture of a page from your notebook and it is stored here as text you can search."
4. "Paste in the transcript of a coaching session and PongLens boils it down to the few things it was really about."
5. "And keep a simple list of what you are working on, pinned at the top."

---

### 12 Recollect · ~0:38 · `/journal` → Recollect

1. "Your coach tells you something good. Two weeks later it is gone."
2. "Recollect reads back what you wrote down, and asks you about it later."
3. "Tap a card to see the cue, in the words you saved it in."
4. "Keep the ones still worth working on and they join your list."
5. "It only ever uses your own notes. It never invents coaching."

**Needs production capture** (`BASE=https://www.ponglens.com`) —
`/api/recollect` needs `SUPABASE_SERVICE_ROLE_KEY`, which `.env.local` lacks.

---

## 4. The tour cut

Chapters 1, 3, 4, 6, 9, 10 at four lines each, stitched with a 0.4s dip.
~3:22. Header reads `PONGLENS · n OF 6`; the library cut shows the chapter
title only.

---

## 5. Running a capture

This repo is public, so the accounts the flows sign in as are not written
down in it. A magic link gets minted for whatever these are set to, so they
belong in your shell, not in `flows/`:

```
export SERVICE_KEY="…"                      # supabase service role
export TUTORIAL_ACCOUNT="you@example.com"   # whose matches get shot
export TUTORIAL_COACH="coach@example.com"   # chapter 8 only
node scripts/demos/tutorial/capture.mjs <chapter>
```

Everything the pipeline generates — `out/`, `raw/`, `audio/`,
`remotion/public/` — is ignored. The finished chapters live in
`r2://ponglens-media/tutorial/`; `publish.mjs` puts them there and the app
signs reads through `/api/tutorial-url`.

---

## 6. Production rules

1. **Dismiss what you open, and prove it closed.** The Why sheet stayed open
   for 17 seconds of the first Keep score render because the flow pressed
   Escape and assumed. Every flow that opens an overlay clicks the real
   dismiss control and waits for the node to detach, failing loudly if it
   does not.
2. **Snapshot before anything that writes.** `guard.mjs` covers column
   changes. It still needs a **delete pass** for rows created during a
   capture — notes, tags, point_tags, drawings, and the chapter 2 job and
   match. Build that before chapters 2, 8 and 10.
3. **Chapter 2 leaves a real job running.** Delete the match and job and
   archive the pgmq message straight after the capture, so the worker does
   not spend a full download and pipeline on a throwaway.
4. **Never press Create in Export.** It queues a render.
5. **Capture against production** for anything needing the service-role key.
6. **One chapter at a time**, and watch the whole render, not just the beat
   you were worried about.

---

## 7. Still open

- Voice is `sage` at 1.15 speed, ~158 wpm. Two lines need a listen before
  committing: "M O V" and "0.25 speed".
- Recollect has no `/learn` guide yet; worth writing one alongside chapter 12.
- Gui has 2 how-it-ended answers and no serve diagnoses, so chapter 4 line 3
  demonstrates the control rather than a full data set. Fine as is.
