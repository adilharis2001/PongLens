# Forum sweep: what club operators, coaches and competitive players complain about

Product-discovery research for PongLens club-facing exploration. Swept 2026-08-17.

**Method note.** Reddit is blocked to both the search API and WebFetch; threads were read
through a redlib mirror (safereddit.com) in the browser pane, searched with
`restrict_sr` on r/tabletennis. TableTennisDaily, MyTableTennis.net and OOAK are
Cloudflare-blocked to plain fetchers; read in the browser pane directly. All Reddit URLs
below are canonical reddit.com URLs. Everything is paraphrased; the handful of short
quotes are marked and attributed. "Prevalence" = how widely the sentiment is echoed in
replies, not just the OP's view.

---

## Theme 1 — Club league nights and ladders: spreadsheets, volunteers, and tool sprawl

### 1.1 "I got tired of our table tennis Excel sheet" (app launch)
- https://www.reddit.com/r/tabletennis/comments/1sofm2e/ — Apr 2026 — player/developer
- Pain: every playing group has one person maintaining a score spreadsheet; formulas rot,
  standings go stale, matches don't get logged, people argue about head-to-head history.
  Built an iOS app (Smoosh) to replace it.
- Replies: small thread. One sardonic reply that a thousand programs already do this —
  the ladder-app market is saturated with hobby builds. A Dutch reply says the national
  federation's own app (NTTB) is the system of record there, i.e. in strong-federation
  countries this layer is already owned.

### 1.2 Ranking format for local clubs (TableTennisDaily)
- https://www.tabletennisdaily.com/forum/topics/ranking-format-for-local-clubs.26379/ — Dec 2021 — club player/organizer, Panama
- Pain: the club's local ranking ran on one member's Excel sheet with a complex formula;
  he no longer has time, so the ranking died with the volunteer. Asking the forum what
  system to use.
- Replies point to RatingsCentral or a pyramid/challenge board. Nobody names a tool the
  club could just adopt without a statistician volunteer. Classic volunteer-fragility story.

### 1.3 Best league/tournament software for an 8-table USATT club
- https://www.reddit.com/r/tabletennis/comments/q9oalu/ — Oct 2021 — club organizer
- Pain: searched for club league software and found only 5-year-old posts. Options boil
  down to OmniPong (dated, tied to USATT sanctioning) or RatingsCentral.
- Replies (22, substantive): USATT leagues force every player into a $25/yr membership.
  RatingsCentral's rating deflates ~8 points per player per tournament (a club measured
  it across 5 events) and, in their words, players hate watching their number sink while
  they improve; Table Tennis Minnesota was evaluating "rolling our own" league system.
  Also: players stop entering tournaments out of fear of losing rating points.
- Prevalence: high agreement that the tooling is thin and the ratings mechanics drive
  player behaviour.

### 1.4 Questions setting up a league for our local club
- https://www.reddit.com/r/tabletennis/comments/1r766mc/ — Feb 2026 — two volunteer organizers, no experience
- Pain: want a "headache free" league to re-spark the club and bring younger players
  back; unsure how OmniPong works, whether SPINDEX can host it, whether every player
  must create an account (older membership = onboarding friction).
- Replies: Challonge for brackets, SPINDEX (rep answers: 20+ clubs run league nights on
  it, free), an Italian tool (mecci), and a dev plugging pingpongarena.app. Bracket
  tools force knockout formats; multi-week group leagues are the underserved shape.

### 1.5 Start-a-league advice (2019)
- https://www.reddit.com/r/tabletennis/comments/eea37v/ — Dec 2019 — club members, 12-table rec-center club
- Pain: 30-40 players on busy nights, no league structure. Replies describe the manual
  workload plainly: someone must coordinate and organize all scores, run seeding,
  promotion/relegation between table groups, announce on a Facebook page; "lots of
  programs" exist but none named as standard. SimplyCompete (USATT's then-portal)
  suggested for storing ratings.

### 1.6 Club website with league tracking + USATT integration
- https://www.reddit.com/r/tabletennis/comments/5t1ovl/ — Feb 2017 — web-developer club member, Michigan
- Pain: wants club site to track league results and sync USATT ratings; no API exists —
  one reply scraped all 45k USATT players himself. Another club runs on embedded Google
  Sheets and wants out "in a year or two". A third points to a club whose league software
  is visibly ancient. Volunteer developers keep rebuilding this from scratch.

### 1.7 Supply-side corroboration (title-level, not deep-read)
- Free Elo/ladder app "used by clubs & offices": https://www.reddit.com/r/tabletennis/comments/1rvuzjj/ (Mar 2026)
- New league/match-tracking/Elo website: https://www.reddit.com/r/tabletennis/comments/1h4gefo/ (Dec 2024)
- Free tournaments/rankings app for clubs: https://www.reddit.com/r/tabletennis/comments/1vo3hyk/ (Aug 2026)
- Office ladder ask: https://www.reddit.com/r/tabletennis/comments/bhah6x/ (2019)
- A steady stream of hobby developers ships ladder/league apps at r/tabletennis roughly
  monthly; most are free, iOS-first, and none has visibly won.

**Theme read:** the pain is real and chronic (2017 → 2026, same complaints), but the
buyer expects free. The one place money already moves: a German club leader (thread 6.2)
says the fees his club pays for national tournament software and organisation exceed
their rent — with a direct wish (quote, translated context): *"There really should be a
free SW"* (user reini_urban, r/tabletennis, Jan 2022). Clubs resent paying for this layer
but do pay it where federations force it.

---

## Theme 2 — Coaching: what it costs, how it's found, and the video-review gap

### 2.1 How much do you spend on coaching? (TableTennisDaily)
- https://www.tabletennisdaily.com/forum/topics/how-much-do-you-spend-on-coaching.31866/ — Sep 2023 — adult competitive players
- Numbers volunteered: £70 for 2 hours (UK); $68/month group + $44/week 1-on-1
  (=$244/month); $100/hr with a former US Olympian ($30/hr for the starter coach before
  her); $8.50-10.50/hr in Vietnam. One player notes he records his lessons to consolidate
  afterwards. Another says he pays a lot with little match-result ROI but enjoys it.
- Prevalence: many data points, no dissent on the price levels themselves.

### 2.2 What do coaches charge per hour where you live? (TableTennisDaily)
- https://www.tabletennisdaily.com/forum/topics/how-much-do-ping-pong-coaches-charge-per-hour-where-you-live.36520/ — 2025 — players worldwide (read via search synthesis)
- Range: $80-100 Bay Area / NYC ~$65 / DC suburbs ~$70 / Princeton Pong $80-90;
  Tokyo $30-100; Greece ~25 EUR; Prague ~40 EUR; Saigon $8-10.

### 2.3 Opinion about online table tennis coaching
- https://www.reddit.com/r/tabletennis/comments/1rcsg3k/ — Feb 2026 — curious player; replies incl. a working coach
- Pains and signals: feedback loop online is slow; a real coach (30 students/wk at his
  club) says he can diagnose from video and screenshots but can't convey feel; several
  warn about Instagram "grifters" selling online coaching — trust is a real barrier.
  One reply does the arbitrage math: at $100/hr US rates it can be worth paying someone
  abroad a fraction of that to review your game — and another immediately asks where to
  find someone who reviews games cheaply (an unprompted willingness-to-pay signal for
  exactly PongLens's paid-review shape).
- A coach-side tool is named: OnForm (video markup app, monthly fee) — "anyone earning
  more than a few hundred a month coaching" can justify it.
- Side signal: online coaching forces players to record themselves, which one reply
  frames as its own benefit (seeing "what is feel and what is real").

### 2.4 Has anyone tried online coaching, sync or async?
- https://www.reddit.com/r/tabletennis/comments/1lqq7br/ — Jul 2025 — serious player (coach moving away)
- Plan: compile the week's training videos, review together on a call — async review
  around a trusted relationship, not a marketplace stranger. He already records every
  practice session. Replies: serve coaching works well online; most people get little
  from it unless they can self-correct.

### 2.5 Does online coaching work? (parent)
- https://www.reddit.com/r/tabletennis/comments/r3naku/ — Nov 2021 — parent seeking lessons for son, no club nearby
- Asks directly whether a hub exists to find private coaches — coach discovery is a gap.
  Replies: online is fine for polishing an existing game, not for beginners; the
  community already does informal video feedback for free whenever someone posts a clip;
  Samson Dubina named as a reputable US coach doing online lessons/camps.

### 2.6 Coach-side: where do I sell online coaching?
- https://www.reddit.com/r/tabletennis/comments/1pdidvi/ — Dec 2025 — strong player (~2250 German rating) wanting coaching income
- Replies: without an existing audience it's hard; build a YouTube following, offer
  free first lessons to Reddit/Discord posters, try Fiverr. No purpose-built platform
  exists for table tennis coaches to find students — each coach must self-market.
- One tangent: coaching inside VR (Eleven Table Tennis) is a thing people do.

### 2.7 Are there any AI video review coaching softwares that are good?
- https://www.reddit.com/r/tabletennis/comments/1rd21h1/ — Feb 2026 — player
- The ask itself shows appetite for automated review, but the thread is hostile: replies
  mock it as trying to avoid paying a human, and one states flatly that AI + table
  tennis products are presumed scams until proven otherwise. Downvoted to 0.
- Go-to-market lesson: this community punishes "AI" framing (consistent with PongLens's
  no-"AI"-in-copy rule) while quietly using video review itself.

### 2.8 Coaching lessons worth it? (OOAK)
- https://ooakforum.com/viewtopic.php?t=7413 — Jun 2009 — club player offered $30/hr lessons
- Old but stable pattern: coaching's value is the trained eye spotting what you can't;
  $25-60/hr band even then; paying creates commitment; a monthly check-in plus drilling
  with friends is a common budget pattern.

**Theme read:** in-person coaching is expensive and geographically lumpy; async video
review already happens informally (recorded lessons, weekly footage compilations, free
Reddit/Discord critique) and semi-commercially (OnForm-equipped coaches, cheap-review
arbitrage). Discovery and trust are the missing rails on both sides — players can't find
vetted coaches, coaches can't find students without becoming YouTubers.

---

## Theme 3 — Match video: recording is normal, reviewing is the chore

### 3.1 Automatic dead-time cutter (tt-clips)
- https://www.reddit.com/r/tabletennis/comments/1tt3xkr/ — May 2026 — engineer/player launching a paid tool
- The market's shape in one thread: BetterPlay has done this for ~5 years at ~$7 per
  hour of footage; tt-clips priced $15/month unlimited; a free manual-trim web tool
  (velox) posted in replies; a request for automatic scoring as the next feature; and a
  paying subscriber complaining his three uploads sat in a queue for 10 hours with no
  way to cancel (reliability is a differentiator).
- Community temper: technically literate skeptics argue this is a solved on-device CV
  problem and resent cloud-AI pricing; general fatigue at repeated launches.
- Prevalence: 24 comments; the pain (nobody wants to scrub 40 minutes for 12 minutes of
  play) is undisputed even by the skeptics.

### 3.2 Rally-only cutter (side project)
- https://www.reddit.com/r/tabletennis/comments/1va0u93/ — Aug 2026 — player/developer
- Baseline stated plainly: phone on tripod, a 20-minute match is roughly half dead time.
  Free browser tool; detailed tester feedback (audio-based detection fails in noisy
  multi-table halls and chatty sessions). One reply: *"Every 2 weeks some makes the same
  thing"* (u/Billythecrazedgoat, Aug 2026) — the niche is crowded with free half-working
  side projects, none robust in real club conditions.

### 3.3 Highlight capture app (SClips)
- https://www.reddit.com/r/tabletennis/comments/1p9rib9/ — Nov 2025 — solo dev/player; 36 comments, warm
- Pains he built against: trimming forever, phone storage, battery drain, needing a
  second person to film. Approach: dash-cam style rolling buffer + smartwatch tap.
- Replies: many feature asks (front camera + score display, Android port, ring remotes);
  an open-source fork appears within days that tags every rally by timestamp for
  automatic highlight reels; SwingVision (tennis) named as the category benchmark with a
  warning not to charge SwingVision prices.

### 3.4 Filming my own gameplay... but I am insecure
- https://www.reddit.com/r/tabletennis/comments/1j2a2g9/ — Mar 2025 — 3-year player
- First time seeing himself on video was a shock — imagined level vs actual level. The
  blockers are social and logistical: embarrassment about setting up a camera at the
  club, fear of asking the partner, no stand (phone propped on a bench behind a bottle).
- Replies (17): in Japan filming is so universal nobody asks permission; partners
  usually want the footage too; practical rigs (GoPro + 1.8 m pole, chair + backpack,
  music stand); stop recording each set to make review easier; a beginner Discord where
  people post training videos for free group feedback.
- Prevalence: strong consensus that self-video is the highest-leverage improvement tool
  and that Western club culture makes it awkward.

### 3.5 Tripod for recording matches
- https://www.reddit.com/r/tabletennis/comments/18sx5ev/ — Dec 2023 — player
- Small thread but crisp: ordinary tripods are too short to clear court barriers; answers
  converge on cheap ($15-25) tall, heavy tripods.

### 3.6 Camera equipment to record trainings and matches (TableTennisDaily)
- https://www.tabletennisdaily.com/forum/topics/camera-equipment-to-record-trainings-and-matches.19959/ — Jan 2019 — players
- Consensus: modern phone + cheap tripod is the whole setup; 1080p60 matters for the
  ball; storage is the recurring worry (film, upload to YouTube, delete local). Nobody
  mentions any club providing filming.

### 3.7 GoPro/SJCAM at the club (MyTableTennis)
- https://mytabletennis.net/forum/gopro-sjcam-to-record-matches_topic110329.html — Feb 2016 — USATT 1914 player + club members
- A club that owns a GoPro admits usage is limited by the editing burden: *"if I had
  more time and/or hated video editing less"* they'd use it more (user bes, Feb 2016).
  Coach's Eye (iPad analysis app of that era) called easier but too narrow a view.
  Wide-angle action cams catch 3-4 tables from the wall — single-table framing is its
  own problem.

**Theme read:** recording is already the norm among improvers (phone + $20 tripod), and
has been for a decade. What players lack is everything after the record button: cutting,
finding points, scoring, storage. The after-capture chore is exactly the layer PongLens
automates, and multiple small competitors are validating (and under-serving) it.

---

## Theme 4 — Ratings: locked up, distrusted, and emotionally loaded

### 4.1 A community-built replacement for USATT's portal
- https://www.reddit.com/r/tabletennis/comments/1uu5why/ — Jul 2026 — player/developer; 14 comments, enthusiastic
- USATT moved ratings to JustGo and the portal is widely despised — first reply calls it
  the *"garbage justgo site"* (u/swinginfriar, Jul 2026) and predicts a takedown notice
  rather than a fix. The builder reverse-engineered the JustGo API. Users ask for exactly
  the stats PongLens-adjacent products care about: head-to-head vs a chosen player,
  points gained/lost per match, rating graphs vs age peers, tournament-win spotlights.
  The old SimplyCompete layout is mourned.
- Prevalence: unanimous in-thread; corroborated by a 2026 rating-calculator app thread
  (https://www.reddit.com/r/tabletennis/comments/1qnu9dy/).

### 4.2 SPINDEX 2.0 (MLTT's free global rating)
- https://www.reddit.com/r/tabletennis/comments/1q6eqe2/ — Jan 2026 — MLTT exec; 49 upvotes, 21 comments
- The stated wedge: under 1% of players worldwide have any rating because ratings only
  come from sanctioned play. SPINDEX gives anyone a 0-3000 rating with a confidence
  level, free for players and organizers, modeled on UTR/DUPR/GHIN. Clubs already
  adopting it for round robins and 1v1 challenge matches ("making our games more
  intense" per one club user).
- Replies: demand for score reporting in-app, algorithm transparency (USATT's old
  "how was my rating calculated" tool remembered fondly), worry about MLTT's longevity.
- Strategic note: a well-capitalized player is giving away the club-rating layer.

### 4.3 Ratings mechanics drive behaviour (from 1.3)
- Same q9oalu thread: players quit entering tournaments to protect their number;
  deflationary systems feel like theft; the meaning of "2000" is identity. Any product
  showing stats must respect how sensitive this number is.

### 4.4 The "estimate my rating" genre
- Constant thread type: players post video asking strangers to guess their USATT/
  equivalent level (e.g. https://www.reddit.com/r/tabletennis/comments/1t2o4bl/,
  https://www.reddit.com/r/tabletennis/comments/1u1uwwb/, 1dz3sag, 18lh6jq). Players
  without sanctioned ratings have no objective mirror and improvise one from upvotes.

**Theme read:** federation ratings are gate-kept behind bad portals and sanctioned play;
players want their number, their trend, and their head-to-heads, and volunteer devs keep
having to steal the data back. The unrated majority wants any credible level signal.

---

## Theme 5 — Running a club: space, insurance, economics, and survival

### 5.1 Rent-a-table "smart venue" reality check
- https://www.reddit.com/r/tabletennis/comments/1tg7ljl/ — May 2026 — prospective venue operator (Bellevue WA), building record-your-match/highlights venue (pingsmash.com)
- Competitive players push back hard: a club with varied opponents beats a bookable pod;
  club membership is $50-100/month against PingPod-style $25-50/hour. One reply recounts
  the Indianapolis club dying at $50/month, reopening at $100, dying again — club
  economics are brutal. Another already films his matches with a 30 EUR phone stand and
  challenges the venue to beat that.
- The most useful sentence for PongLens comes from the skeptic: *"follow me to a
  tournament and record all of my game film"* and compile stats and highlights — that
  he'd find amazing (u/Jkjunk, May 2026). Capture bolted to a venue is the wrong end;
  capture that follows the player is wanted.

### 5.2 TT club as a business (Nepal, with DE/AR club leaders replying)
- https://www.reddit.com/r/tabletennis/comments/s59hcq/ — Jan 2022 — would-be founder + two club leaders
- Germany (Dresden club leader): clubs survive as associations on subsidized school
  halls; rental fees are tiny; the national tournament software/organisation fees are
  the bigger line item; players pay ~10 EUR/month. Argentina (national #38): ~120 clubs,
  maybe 5 profitable; membership ~10 USD/month; you need 80+ members to break even.
  The founder later admits the plan died on capital.
- Prevalence: club-economics pessimism is consistent across countries.

### 5.3 Starting a club against a park district (MyTableTennis)
- https://mytabletennis.net/forum/need-advice-on-starting-a-table-tennis-club_topic109414.html — Apr 2015 — two would-be founders, Chicago
- Pains: the facility sees TT as "covered" by its casual program and won't grant hours;
  one-hour sessions can't attract serious players (chicken-and-egg on demonstrated
  demand); insurance/liability is the private-route killer; USATT club affiliation ($75)
  buys insurance and a listing but no space and no sponsors.

### 5.4 High-school club bootstrap (OOAK)
- https://ooakforum.com/viewtopic.php?f=6&t=22736 — May 2013 — teacher/volunteer coach, Ohio
- Pains: equipment money (asks whether anyone donates basic paddles/balls); advice is
  user-pays plus donated used gear; wants a place where casuals can learn and the
  talented can "see how they are progressing" — progress visibility as a stated goal.

### 5.5 Club culture threads (both forums)
- https://www.tabletennisdaily.com/forum/topics/do-these-things-happen-in-the-club-where-you-play-table-tennis.36529/ — Feb 2025 — players across countries
  - Table-allocation politics (best tables informally reserved for strong players),
    the constant balancing act between newbie-friendliness and letting serious players
    train, waiting systems (racket queue, winner stays, 20-minute rotations), tables
    blocked by social players.
- https://ooakforum.com/viewtopic.php?t=26414 — Aug 2014 — paying member
  - Paid a full year up front, then found the top-team clique won't play outsiders;
    resorts to texting specific players before sessions to guarantee a real match;
    considering demanding a refund. A reply describes a "top table" win-and-move-up
    session as the retention fix that keeps everyone coming back.
- https://www.tabletennisdaily.com/forum/topics/how-to-get-better-at-table-tennis-when-you-have-no-one-to-play-with-and-get-competitive.32813/ — Jan 2024 — intermediate newcomer, Stuttgart
  - Nobody at his level will hit with him; training days are segregated by team; the
    fix offered is social (ask the trainer to pair you) because no structural one exists.

### 5.6 League/participation decline (UK)
- https://www.tabletennisdaily.com/forum/topics/uk-table-tennis-prospects.33555/ — Apr 2024 — league players
- Local league losing teams and divisions every year; no juniors, mostly pensioners;
  no viable money in the sport for prospects; national body criticized. Background
  condition for any UK club product: shrinking, ageing base.

**Theme read:** club operators' hard problems are space, insurance, and unit economics —
not software. Software touches them only where it (a) runs the league nights that keep
members engaged (the retention machine several threads credit), (b) reduces volunteer
load, or (c) is a cost they already resent paying (federation tournament software).
Level-matching inside clubs is the one member-experience pain software could plausibly fix.

---

## Theme 6 — Peer video feedback culture (context for paid review)

- Constant genre: players post their footage asking for free critique —
  https://www.reddit.com/r/tabletennis/comments/1t1tmvw/ (May 2026),
  https://www.reddit.com/r/tabletennis/comments/1t2gogk/, 1uikhu4 (Jun 2026),
  1vje88m (Aug 2026), plus Discord groups (beginner server in 3.4; coach-run server
  in 2.6 replies).
- A free web video-analysis tool thread: https://www.reddit.com/r/tabletennis/comments/1p73t9b/ (Nov 2025).
- Implication: the free tier of "someone looks at my video" is abundant and normalized.
  Paid review must be clearly better than Reddit strangers: named coach, credibility,
  structure, turnaround, continuity — which is the marketplace's job to signal.

## Theme 7 — Discovery: finding clubs, coaches, partners

### 7.1 Club directory built out of frustration
- https://www.reddit.com/r/tabletennis/comments/1rh2l27/ — Feb 2026 — 1700 USATT player, NJ
- Pain: official club listings are outdated — wrong hours, nothing about league
  schedule, coaching availability, pricing, or skill-level fit. Built table10is.com
  (55 clubs, 22 states), verifying data club by club; owners send corrections.
  Replies ask for exactly a league finder by day + skill level.

### 7.2 Pro-stats fan site (adjacent)
- https://www.reddit.com/r/tabletennis/comments/1u7ovk9/ — Jun 2026 — developer
- WTT/ITTF data is scattered and clunky; he built 11edge.io for player form and
  head-to-heads. Shows the same head-to-head/form appetite at fan level; data plumbing
  (no APIs anywhere in this sport) is the recurring tax.

### 7.3 Partner-finding asks
- e.g. https://www.reddit.com/r/tabletennis/comments/18elfut/ (San Diego hitting
  partner), plus 5.5's Stuttgart thread — finding opponents at your level, at your
  time, is a standing ask nobody has productized for clubs.

---

## Cross-cutting observations

1. **The builder flood.** r/tabletennis sees a hobby-built ladder app, stats site, or
   video cutter launched roughly every other week. The community is fatigued, quick to
   name prior art, and allergic to subscription pricing from unknowns. Credibility and
   longevity are scarce; features are not.
2. **"AI" is a slur here.** Multiple threads (2.7, 3.1) treat AI-branded tools as
   presumptive scams or cost-inflated wrappers. Products that do the same work without
   the label read as honest craftsmanship.
3. **Price anchors.** Video cutting: $7/hr (BetterPlay) or $15/mo (tt-clips), with free
   rivals. Coaching: $30-100/hr US in person; OnForm subscription on the coach side;
   explicit interest in paying a fraction of in-person rates for async review. Club
   software: expected free (SPINDEX, Challonge), resented where charged (German
   federation software, USATT membership gating leagues).
4. **Recording is solved; reviewing is not.** Phone plus cheap tripod is universal.
   The unpaid work after capture — trimming, scoring, storing, sharing — is where
   threads consistently stall, and where clubs that own cameras stop using them.
5. **Capture should follow the player, not the venue.** The strongest single demand
   statement in the sweep (5.1) is a competitive player saying venue-bound recording is
   worthless to him but tournament-following game film with stats and highlights would
   be amazing.

---

## Ranked pain themes (strength = distinct threads with the sentiment)

1. **Post-capture video chore** (cutting dead time, finding points, highlights, storage) —
   7 threads (3.1-3.7, 5.1). WTP: proven — BetterPlay charges per hour, tt-clips has
   paying subscribers, SwingVision cited as the (overpriced) benchmark.
2. **Coaching access + async video review** — 8 threads (2.1-2.8). WTP: strongest of
   all — people already pay $30-100/hr and ask on-thread where to buy cheap remote
   review; coaches pay for OnForm; coaches lack any student-acquisition channel.
3. **League/ladder record-keeping fragility** — 8 threads (1.1-1.7, 5.5). WTP: weak from
   clubs (free expected; SPINDEX is free and funded); but federation software fees show
   clubs do pay when forced, and resent it.
4. **Ratings access and trust** — 6 threads (4.1-4.4, 1.3, plus calculator thread).
   WTP: none direct (players expect ratings free); the value is engagement and identity,
   not revenue.
5. **Club economics and survival** — 6 threads (5.1-5.4, 5.6, 2.2 context). WTP: clubs
   are poor; anything sold to clubs must save volunteer hours or drive membership.
6. **DIY recording logistics and social friction** — 6 threads (3.4-3.7, 5.1, 2.4).
   WTP: hardware-level only ($15-25 tripods); the norm is self-serve.
7. **Level-matching and partner-finding inside clubs** — 5 threads (5.5 x3, 7.3, 1.4).
   WTP: unproven; it's a membership-experience feature, not a purchase.
8. **Discovery of clubs and coaches (stale directories)** — 4 threads (7.1, 2.5, 2.6,
   7.3). WTP: unproven directly; classic marketplace top-of-funnel.
