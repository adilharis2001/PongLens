# Landing page video — script v1

Not a tutorial. A walkthrough of what the product does and why it is worth
the time, for someone who has never seen it. Two cuts of the same script:
one shot at phone size, one at desktop, served by viewport.

No annotation boxes, no chapter headers, no "chapter 1 of 9" bookends. The
tutorial pipeline's cue track is simply not used here.

Target 2:30 to 2:40. Roughly 300 words of narration plus room to breathe
between beats.

---

## The through-line

**Film it once, and everything else falls out of it.** Every beat is a
consequence of the one before, so the video never reads as a feature list.
Upload leads to watchable footage, watchable footage leads to a scored
match, a scored match leads to the analysis, the maps, the coach and the
journal.

The one number worth landing early: **an hour of footage becomes about
twenty minutes of actual table tennis.** It is the most concrete thing the
product does and it costs the viewer nothing to believe.

## Two rules the first draft broke

**Say what this is inside the first twenty seconds.** The opening beat has
to name the product and the category. A viewer forty seconds into a video
who still does not know what they are looking at has already gone.

**It has to be about table tennis, not about sport.** The first draft could
have been swapped onto tennis or squash by changing three nouns. What is
only true here: a match is a couple of hundred separate points, the rallies
are about three seconds each, the gaps between them are most of what the
camera recorded, games go to eleven so the pressure lands in the same
place every time, and you play the same club and league opponents all
season. The script should sound like it was written by someone who plays.

---

## Beats

Times are approximate and will be set by the measured narration, the same
way the tutorial chapters are.

### 1 · Where we are, and what this is · ~0:00–0:18

> "A table tennis match is two hundred points long. You will remember about
> five of them."
>
> "PongLens is the table tennis toolkit for competitive players. Give it the
> video of your match, and it gives you back the match."

**Mobile:** a phone propped on a chair at a club, a game in progress, then
that same file sitting untouched in a camera roll.
**Desktop:** the same footage as one long unwatched file.

The second line is the one that has to land. Everything after it is detail.

The dead time sentence that used to sit between these two is gone. Beats 2
and 3 pay that idea off anyway, and an opening earns its length by how fast
it gets to what the product is.

### 2 · Bring it in · ~0:26–0:44

> "Send a match in from your phone, or paste a YouTube link. It comes back
> with the dead time gone, cut into every point that was played."

**Mobile:** upload screen, file picked, then the YouTube field. Processing
card appears.
**Desktop:** same, in the wider upload layout.

### 3 · What you get back · ~0:44–1:04

> "An hour of filming becomes about twenty minutes of table tennis. Hold one
> side of the screen for double speed, the other for quarter speed, when you
> want to see what the contact actually was."

**Mobile:** the player, a point running, the 2x hold, then the 0.25x hold.
**Desktop:** the same player at desktop width.

### 4 · Score it · ~1:04–1:26

> "Scoring the whole match takes about ten minutes. It plays a point, waits
> for you to tap who won it, and moves on. The score and the serve rotation
> keep themselves."

**Mobile:** Keep score, three or four quick taps, score updating, the lit
serve indicator.
**Desktop:** same flow.

### 5 · The match reads itself back · ~1:26–1:52

> "Then the match reads itself back. What happened on your serve, what
> happened on your receive, how you held up at nine all. Score a few matches
> and the same picture builds across all of them."

**Mobile:** momentum chart, serve and receive numbers, then Your game.
**Desktop:** the wider analysis view where more of it is visible at once.

### 6 · Where the ball went · ~1:52–2:08

> "Every landing point mapped, so the corner your opponent kept going back
> to is something you can see instead of something you half remember."

**Mobile:** placement map, dots then heat map, filtered to one game.
**Desktop:** same.

### 7 · Your coach, in the footage · ~2:08–2:26

> "Send the match to your coach. They can draw straight onto the frame,
> leave a voice note on the point, or paste in the transcript from your last
> session."

**Mobile:** coach view, a drawing on a frame, a note landing.
**Desktop:** same from the coach's side.

### 8 · One place for what you are told · ~2:26–2:44

> "What you are told lands in one journal. Photograph a page from your
> notebook and it becomes searchable text. Recollect brings it back when you
> are due a reminder."

**Mobile:** journal, a scanned notebook page, then a Recollect card.
**Desktop:** same.

### 9 · Take the good ones with you · ~2:44–2:56

> "And the rallies worth keeping export with the score burned in, ready to
> post."

**Mobile:** export, Include score on, a starred-points export, the finished
file.
**Desktop:** same.

### 10 · Close · ~2:56–3:04

> "PongLens. Film the match once. Study it all season."

**Both:** logo, held, with whatever the call to action turns out to be.

---

## Deliberately not in it

- Tags and collections. Real, but it needs its own sentence to make sense
  and the journal beat already carries "one place for what you learn".
- Public share links. Folded into the coach beat by implication.
- Serve rotation, let handling, clip splitting. Craft, not benefit.
- Anything about pricing, invites or quotas.

If the video runs short once the narration is measured, tags is the first
thing to add back, after beat 8:

> "Label a point in your own words and every one like it gathers in one
> place, across every match you have scored."

---

## Production requirements

1. **Shoot from the demo account, not a real one.** The tutorial chapters
   were captured from Adil's own account, with real opponents named on
   screen. This video is public and unauthenticated. Use the staged demo
   account so no real person's name or footage is published.
2. **The file has to be publicly readable.** Everything in R2 today is
   signed and private, and `/api/tutorial-url` requires a session. A landing
   video needs either a public bucket or a public prefix on a Cloudflare
   custom domain. It should not go in `public/`: two cuts at roughly 30MB
   each would ride along in every deploy forever.
3. **A plain render.** Same capture and narration pipeline, but no cue
   track, no chapter header, no bookends.
4. **Desktop flows are new.** Every existing flow was written against a
   390x844 viewport. Desktop needs its own pass, and a check that each
   screen actually looks good at width rather than merely working.
5. **Voice.** The tutorial voice is `sage` at 1.3, which is brisk because
   those are instructions. This wants about 1.15, with a beat of silence
   between sections.
