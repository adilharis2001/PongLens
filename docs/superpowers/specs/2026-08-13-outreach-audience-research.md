# Coach and club outreach

2026-08-13. Research for the Instagram outreach program. It answers one
question: a message to a club should not be the message to a coach, so what
should the club message be. No code changed.

The pipeline holds 72 accounts. Thirty-seven carry a club, academy or training
centre name, thirty-two look like a person, and three have no name recorded to
judge by. The split is close enough to even that both messages have to be good.

Everything below about the product was checked against the repository and
against live `app_config`, not against the marketing pages.

---

## What a coach gets today

All of it is live: `coach_reviews_enabled` and `commerce_enabled` are both true
in production. A coach can claim a page at `ponglens.com/coach/theirname`, list
review offerings with their own price, scope, turnaround and intake questions,
and take card payment through Stripe Connect, with PongLens keeping 15 percent.
The work arrives already cut into points, so they never scrub a video looking
for a rally. They write findings that link to the exact rallies that show the
problem, attach a practice plan or a drill sheet, deliver a document the student
keeps for good, and answer one round of follow-up questions. There is a second
payment path where the coach pays instead of the student: a single-use sponsored
link that covers the review and up to 45 minutes of processing without touching
the student's own allowance. Three sponsored reviews are free, then five for $20
or fifteen for $50. Free collaboration is untouched underneath all of that. A
player shares a match, the coach watches it, types, speaks or draws on a frame,
and none of that costs either of them anything. So the offer to an individual
coach is specific and personal: money for work they are probably already doing
for free in a WhatsApp thread, and the first order can come from a student they
already have.

## What a club gets today

Less than a coach, and it is worth being blunt about why. There is no club in
the product. No team, no roster, no organisation account, no seats, no shared
library, no login that sees twenty players side by side. I looked for it under
every name I could think of and it is not there. A club that says yes today gets
the same product an individual gets, once per person. Each player signs up on
their own, uploads their own video, spends their own free allowance of 250
processing minutes and 10 GB, and shares each match with whichever coach account
the club nominates. That coach then sees the shared matches in one list, which
is as close to a squad view as the product comes, and it is a list of matches
rather than a picture of a squad.

Three things do work for a club right now, with nothing built:

- The head coach can hold the paid page, and the club can point its members at
  that link from its bio, its website and its group chats.
- Sponsored links let the club pay for reviews on behalf of juniors, and minutes,
  storage and sponsored credits can all be granted by email from `/admin`. A
  pilot can therefore cost the club nothing and cost us only processing.
- A match exports with the running score on screen, and starred points export as
  a reel. That is publishable material for the club's own feed.

Four things a club will ask for inside five minutes of being interested, and
will not get: one bill, one login that covers the whole squad, per player
progress across a season, and something the parents can look at. Any club offer
has to be built so that none of those four is implied.

---

## Three options for the club ask

### Option A: treat the club as a coach

The ask is that the person behind the account sets up a page and reviews one
player.

The reasoning is that most of these accounts are one coach with a club name on
the door. Median followers for the club-like accounts is 361, which is a local
operation, not a media channel. Nothing has to be built and nothing has to be
promised, because this is the product exactly as it ships.

It assumes that someone behind the account coaches individuals and would be
willing to charge for it. It assumes the account is not run by a parent
volunteer, a club secretary or a social media helper, which for a share of these
37 it will be.

For it to work, a coach has to be comfortable being paid directly for coaching
that members may already pay the club for. In plenty of clubs the fees flow
through the club and a coach taking payment on their own page is politically
awkward. That is the real failure mode here, not disinterest in the product.

### Option B: run a squad pilot

The ask is that the club picks one squad, usually the juniors, and we cover it
for a term.

The reasoning is that a club's unit is the squad, not the individual. One yes
creates ten to twenty accounts at once, produces footage from a real venue on a
real schedule, and puts the coach in the review seat every week instead of once.
It is deliverable today: minutes, storage and sponsored credits are all
grantable by email from admin, so no code and no invoice is involved.

It assumes the club will do the organising, which means chasing parents and
players to sign up, and it assumes they have some way to record. It also assumes
someone will actually watch what comes back.

For it to work, the pilot needs a named owner at the club, because a pilot
belonging to everyone dies in week two. It also needs the promise to stay honest
about the missing club view: the club sees the work through one coach's account,
one player at a time, and if the pitch implies a squad dashboard the pilot ends
the day they look for it. Worth pricing before offering: twenty juniors on the
free allowance is twenty lots of 250 processing minutes that we pay for. That is
bounded but not free.

### Option C: use the club to reach its coaches

The ask is one question. Who on your staff works with match video, and can I
show them what it does?

The reasoning is the asymmetry itself. A club is not a user, but it is a
directory of the exact people who are: three or four coaches, each with their
own students. Asking who does video costs the club nothing, needs no product fit
and no belief in us, and the answer is a name. It converts a club lead into a
coach lead, which is the audience the product actually serves. It also works
when the account is run by an admin rather than a coach, which none of the other
options survive.

It assumes the club has more than one coach and that whoever reads the DM knows
who they are. Often the answer will be "me", which lands straight in Option A,
so the question is not wasted when the assumption is wrong.

For it to work, the follow-up has to be ready. A name arrives and then we are
back in the coach conversation, which means the coach message has to be the
strong one either way.

### My recommendation

Open every club with Option C, then branch. If the answer is a name, run the
coach message at that person. If the answer is "me", that is Option A and the
club name never mattered. Hold Option B for the clubs that answer warmly and
have visible juniors, and offer it in the second or third message rather than
the first, because a season-long pilot is a large thing to ask of someone who
has not seen the product.

The reason to prefer C as the opener is that it is the only option that does not
depend on an assumption about who is reading. It is also the cheapest message to
send and the cheapest to be wrong about.

I would change my mind on one signal. If the early replies contain clubs saying
some version of "we would try this with our juniors" without being asked, then
the appetite is at the squad level, Option B becomes the opener, and the plan
should change that week.

---

## The first message

One ask per message, and only one.

**Coach.** Ask them to look at one match. Something close to: I put one of my
own matches through this and it came back cut into points, would you take a
look and tell me if this is how you would want a student's video to arrive.
The reason is that it asks for their opinion rather than their time or their
money, which is a normal thing to receive on Instagram from a player. It needs
no account, because a share link at `/s/<token>` is publicly viewable and is
the one logged-out surface that plays real match media. And it uses the only
credential we have with a stranger, which is that Adil's account carries his own
table tennis. The paid page is not mentioned in the first message at all. It is
what the second one is for.

**Club.** Ask who works with video. Something close to: do any of your coaches
go through match video with players, and would it be alright if I showed them
something I built for it. One question, answerable in a single line, and the
answer routes the whole rest of the conversation. It does not ask them to try
anything, sign up for anything, or believe anything, which matters because we
currently have nothing for a club as a club.

---

## What discovery should capture

The script today stores username, full name, bio, follower count, external
links, avatar, a one-line fit note and the search term. The Instagram details
response carries more than that and it is being discarded. Posts count, follows
count, verified flag, business account flag, business category, private flag and
the recent posts with their timestamps are all available in the same payload and
all bear directly on the two questions below.

**Club or coach.** The name and handle are the strongest signal by far: academy,
club, centre, center, TTC, training centre, or the local equivalent. On the
current 72 that alone separates 69 of them into a defensible bucket. Beyond the
name: the full name reads as an organisation or a place rather than a person,
where an individual's account usually reads "Name | Table Tennis Coach"; the bio
gives an address, opening hours, a table count or a way to book a table; the
account is a business account with a category and a directions button; the bio
link goes to a site with a membership, fees, timetable or juniors page rather
than to a page of coaching clips; posts show a hall with several tables and many
different players rather than one person demonstrating; and the following count
sits high against the follower count, because clubs follow their members back.

**Serious club or hobby account.** Recency first: posted in the last 30 days,
and something like a dozen posts in the last year. A club whose feed stops in
2023 is not running sessions now. Then a timetable or a fee list anywhere on the
profile or the site, which is the single best evidence that money already
changes hands. Then named coaching staff with credentials. Then junior squad,
league team or tournament result posts, because results mean competitive
players, which is who the product is for. A venue of its own, seen as a hall
with several tables rather than a corner of a leisure centre. And a published
contact address, which is measurably more common for clubs: 22 of the 37
club-like accounts have a website against 9 of the 32 individuals, and 6 have an
email against 1.

Two warnings about the fields that already exist.

Follower count should not be the sort key. Club median is 361 and individual
median is 558, so the two are not separable by size, and the only accounts above
100,000 are content creators who are the least likely of anyone to want a review
page.

The language guess is wrong often enough to be dangerous. The Portuguese,
Spanish and Italian patterns include single-letter stopwords such as e, o, a and
y, so ordinary English bios match them. A coach whose name and bio are entirely
in English is currently recorded as Portuguese. That means the `english` flag is
unreliable and the page's English filter hides real English speakers, so it
should not be used to choose who to write to until the patterns require at least
two distinct multi-letter matches.

---

## Questions only you can answer

1. Do clubs belong in this first round at all, or is the individual coach the
   only audience worth your DMs this month? Both messages cost the same to send,
   but only one has a finished product behind it.
2. How much are you willing to build for clubs if the replies are warm? A
   roster, one bill and a parent-visible view are the three things they will ask
   for, and they are a real feature, not a weekend.
3. What are you prepared to give away in a pilot, in minutes and sponsored
   credits, and what is the ceiling before you stop?
4. Does it matter to you where the first paid coach is? A lot of this list is in
   markets where a $50 review is a different proposition than it is in the US.
5. Is the goal of this round revenue or usage? Option A optimises for the first
   paid order, Option B for footage and habit, and they pull apart quickly.
6. Are you comfortable sending strangers a public link to your own matches as
   the demo, and is there one match you want used for that?
7. If a club says yes to a pilot, are you personally running the first term? If
   not, nobody is.
