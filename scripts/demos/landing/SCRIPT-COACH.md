# Coach video — script v1

For a table tennis coach who has never heard of PongLens. Not a tutorial.
Same pipeline, same voice, same music and same presentation layer as the
landing video, so the two read as one product.

Target 1:30 to 1:45. Roughly 200 words of narration.

---

## The through-line

**The watching is already done, so all you do is the coaching.** Every
beat is a consequence of the one before: you set a price, students find
your page, an order arrives, the match arrives already cut into points,
you write on those points, they get it, you get paid.

The one thing worth landing early: **a coach's real cost is not the
coaching, it is the two hours of video.** That is the thing PongLens takes
away, and it is the only reason a coach would move work here from
WhatsApp.

## What this script must not do

**No selling.** A coach is being asked to put their name on a page and
take money from their own students. Overselling reads as risk. Every line
is a plain statement of what happens.

**No idiom.** A lot of table tennis coaches read English as a second
language. No "starts the clock", no "whose move it is", no "the words
land". Ordinary verbs, short sentences. This was the note that came back
on the /coaches page copy and it applies double to a video, where nobody
can re-read a line.

**It has to be about coaching table tennis, not about freelancing.** What
is only true here: students already send you match videos you never get
to, a match is a couple of hundred points, most of the recording is
picking the ball up, and you end up saying the same three things to every
player. A script that would work for a guitar teacher is the wrong script.

**Say what this is inside the first ten seconds.** One sentence: coaches
get paid to review their students' matches.

---

## Beats

Times come from the measured narration, the same as every other cut here.
Each beat names what is on screen; nothing in the narration describes a
control the picture is already showing.

### 1 · What this is

> "PongLens is where table tennis coaches get paid to review their
> students' matches."

Miguel's public page, offerings and prices in frame. The product named
over the thing a coach would actually own, not over a menu.

### 2 · What you sell

> "You decide what a review includes, what it costs, and how many days you
> need."

The offering editor: price, turnaround, what's included.

### 3 · Your page

> "Everything you sell sits on one page, with your background and what your
> players have said about you."

The storefront from the top: name, credentials, the testimonial.

### 4 · Getting it to students

> "Send that link to your students, or put the code up at the club."

Copy link and the QR card on the coaching hub.

### 5 · Payouts

> "Payments run through Stripe. You connect it once, and it pays your
> bank."

The payouts card on the hub.

### 6 · The order arrives

> "When a student buys a review, they send you one of their matches and
> answer your questions."

The new order screen with their brief. Their answers are the shot.

### 7 · Your decision

> "You read their answers before you decide, then accept or decline.
> Nothing starts until you accept."

Accept and start, actually clicked. The order this happens to is created
for the shoot and deleted afterwards.

### 8 · What arrives

> "The match arrives with the standing around already cut out. Every point
> is its own clip, with the score on the picture."

The workspace: the player and the point strip.

### 9 · The work

> "So you are not scrolling a video looking for a rally. You watch, and you
> write what you saw."

A rally running, then the pattern being written.

### 10 · The link to the points

> "Then you attach the points that show it, and your student watches
> exactly what you mean."

Point chips going on a finding.

### 11 · Speaking it

> "Or say it out loud instead of typing, and your words arrive as text."

The dictation control and the recording bar.

### 12 · What they get

> "Your student gets your review with a clip on every point you picked, and
> it stays in their account."

The delivered review as the student reads it, scrolling to "Watch these
points".

### 13 · Getting paid

> "When the review is finished, Stripe sends your share to your bank."

The hub: earned, completed, and the payouts card.

### 14 · Close

> "PongLens. Get paid to review your students' matches."

Logo, held. Same close as the landing cut, and the same words as the
/coaches headline.

---

## Deliberately not in it

- The platform fee. True and disclosed on /coaches, but a number in a
  video is a number without its context, and the fee is configurable.
- Templates, attachments, follow-up questions, pausing new orders. All
  real, none of them are why a coach would start.
- Anything about the free coach sharing players already use. It is a
  different product and it would need its own sentence to not confuse.
- "Your students do not need PongLens already." True and useful, but it
  answers an objection the viewer has not had yet at that point in the
  video, and it costs a beat.

If the cut runs short once the narration is measured, that last one is the
first thing to add back, after beat 6:

> "They do not need an account first. Buying a review brings them in."

---

## Production notes

1. **Shot from the staged coach**, Miguel Santos, not a real coach. Every
   other storefront on this database belongs to a real person and this
   video is public. See `scripts/demos/stage_coach.sql`.
2. **The order the video accepts is made by the capture** and deleted in
   the driver's `finally`, the same bracket the landing review beat uses.
   A beat that films found data is one cleanup away from filming a 404.
3. **Do not touch coach user `f15e9358`.** That is the landing video's
   throwaway coach, and its cleanup deletes the profile outright.
4. **Desktop first.** Building a review is a two-pane laptop screen; the
   phone cut is worth having but it is not where this work happens.
5. Voice `sage` at 1.58, lead 0.3, gap 0.25, and `music/bed.mp3` ducked
   the same way. Identical to the landing cut on purpose.
