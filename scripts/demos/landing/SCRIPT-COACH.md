# Coach video — script v1

For a table tennis coach who has never heard of PongLens. Not a tutorial.
Same pipeline, same voice, same music and same presentation layer as the
landing video, so the two read as one product.

Runs 2:08. 335 words of narration at 197 wpm.

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

**Describe the feature, do not frame it.** No "you are not hunting for a
rally", no "not just your word for it". Nobody was hunting for a rally and
nobody was doubting the coach's word; both lines invent a problem so the
sentence has something to push against. Say what the coach does, in the
order they do it.

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

**Say what this is inside the first ten seconds**, and say it as what a
coach is FOR. The money is real and it has its own beat, but a video that
opens and closes on getting paid sells a side hustle. It opens and closes
on the student getting better, which is why a coach coaches.

---

## Beats

### 1 · What this is

> "PongLens is where table tennis coaches review their students' matches, and show them what to work on."

The coach's own home: real orders, real money on it. Not their public profile, which is a page about them rather than the thing they use.

### 2 · What you sell

> "You decide what a review includes, what it costs, and how many days you need."

The offerings list, already open, gliding down it.

### 3 · What you sell

> "Start from one of the templates and change what you like, or build your own."

One offering expanded: price, turnaround, what's included.

### 4 · Your page

> "Everything you sell sits on your profile page, along with your background, your offerings, and the testimonials your students have left you."

The public page, gliding from who they are to what they sell.

### 5 · Your page

> "Send that link to your students, or put the code up at the club."

Copy link and the QR card.

### 6 · Getting set up

> "Payments run through Stripe. You connect it once, and it pays your bank."

The payouts card on the hub, ringed.

### 7 · A new order

> "When a student buys a review, they send you one of their matches and answer your questions."

The new order with their brief, ringed.

### 8 · A new order

> "You read their answers before you decide, then accept or decline. Nothing starts until you accept."

Accept and start, clicked for real at the end of the line so the re-render lands in the gap.

### 9 · What arrives

> "The match arrives with the dead time between points already cut out. Every point is its own clip, with the score on the picture."

The workspace: the player and the point strip.

### 10 · Finding the pattern

> "You watch your student's match, one point at a time."

A rally actually running.

### 11 · Finding the pattern

> "When you notice something worth telling them, you write it down as a pattern, and link that point to it."

The sheet that turns this point into a named pattern, with a tick already on one.

### 12 · Finding the pattern

> "You can draw on the frame, or leave a voice note on it."

The pattern open, its own Draw on the frame and voice controls ringed.

### 13 · Finding the pattern

> "When the same thing happens later in the match, you add that point to the same pattern. By the end, each pattern has every point where it happened."

The patterns collapsed back to a list, each carrying the points it was built from.

### 14 · The write-up

> "You can speak your write-up instead of typing it, and your words arrive as text."

Two circles on the microphones. No label chips: on a 36px target the chip sits on what it names.

### 15 · The write-up

> "Tidy up rewrites your rough notes as clean sentences, in your own words."

The Tidy up button, ringed.

### 16 · The write-up

> "The Review tool checks your write-up before you submit it. It runs a list: every section written, a point on each pattern, and their questions answered."

The Review checklist, ringed, ticking itself as the writing grows.

### 17 · The write-up

> "If you already have a drill sheet or a practice plan, attach the file and it goes with the review."

The Attachments row. A different thing from the points on a pattern, and the first cut ran the two together.

### 18 · What they get

> "Your student gets your write-up, and a clip for every point you linked. It stays in their account."

The delivered review as the student reads it, gliding to Watch these points.

### 19 · Getting paid

> "When the review is finished, Stripe sends your share to your bank."

The hub: earned, completed, and the payouts card.

### 20 · Close

> "PongLens. Help your students play better matches."

Spoken over the logo card, not over a screen.

---

## Deliberately not in it

- The platform fee. True and disclosed on /coaches, but a number in a
  video is a number without its context, and the fee is configurable.
- Follow-up questions, pausing new orders, capping how many you take. All
  real, none of them are why a coach would start.
- Anything about the free coach sharing players already use. It is a
  different product and it would need its own sentence to not confuse.
- "Your students do not need PongLens already." True and useful, but it
  answers an objection the viewer has not had yet at that point in the
  video, and it costs a beat. It is the first thing to add back, after
  beat 7:

> "They do not need an account first. Buying a review brings them in."

---

## Production notes

1. **Shot from the staged coach**, Miguel Santos, not a real coach. Every
   other storefront on this database belongs to a real person and this
   video is public. See `scripts/demos/stage_coach.sql`.
2. **The order the video accepts is rewound by the capture** and put back
   in the driver's `finally`. Rewinding rather than creating is what keeps
   the student, the match and the three findings, so the accept, the
   patterns and the delivered review are one piece of work.
3. **Do not touch coach user `f15e9358`.** That is the landing video's
   throwaway coach, and its cleanup deletes the profile outright.
4. **Desktop first.** Building a review is a two-pane laptop screen; the
   phone cut is worth having but it is not where this work happens.
5. **Publishing.** `node scripts/demos/landing/publish.mjs coach-desktop
   coach-desktop` compresses the render to about 400 kbps and grabs the
   title card as the poster, into `public/demo/`. That is where the landing
   cuts live too: 6.5MB committed beats a bucket to keep in sync, and
   `preload="none"` means nobody downloads it who does not press play.
6. Voice `sage` at 1.45, lead 0.3, gap 0.25, and `music/bed.mp3` ducked
   the same way. Identical to the landing cut on purpose.
