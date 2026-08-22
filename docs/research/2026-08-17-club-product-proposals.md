# Club product proposals — what 122 club websites say clubs actually lack

2026-08-17. Six research passes: 29 major US centers and academies, 36 US
regional/community clubs, 28 UK/Ireland clubs, 29 continental European clubs
(DE/FR/SE/NL/ES/DK/BE/AT/CH), 32 forum threads read in full (r/tabletennis,
TableTennisDaily, MyTableTennis.net, OOAK, 2009–2026), and a full map of the
software already serving table tennis clubs. Per-club and per-thread notes are
in [`2026-08-17-club-product-research/`](2026-08-17-club-product-research/).

Scope constraint from the outset: tournament and event management (OmniPong,
Stadium TT/Compete) is explicitly out. The question was what else clubs need
that overlaps what PongLens already ships for players and coaches.

---

## What PongLens brings to this

Match upload, automatic point detection and clip cutting, in-app scoring,
placement heatmaps and serve analysis, a chaptered match player, stats, a
training journal, learn guides, coach profile pages, and a paid coach-review
marketplace on Stripe Connect. Plus two distribution assets: the outreach
worker already discovering and contacting clubs and coaches (43 clubs, 39
coaches in the pipeline), and the marketing hub that manages those touches.

---

## The six findings that matter

**1. The performance layer is empty at every club, in every country, at every
tier.** Across 122 clubs, exactly one — Austin TTC — sells video analysis as a
bookable service. Four of 27 traditional US flagship venues have any video at
all; zero of 36 US regional clubs so much as mention recording; UK and EU club
video is spectator broadcast (ORF, ETTU TV, hand-run YouTube livestreams),
never analysis tied to a player. Even residential academies selling coaching
by the hour — Borussia Düsseldorf's andro TT-Schule, Hennebont's Ping Center —
never mention video in the offer. Eastern Kentucky TT has 31 years of
championship lore and zero footage. No club anywhere links a result to video
of the match.

**2. Coaches are invisible even where coaching is the core product.** Princeton
Pong is the only US club publishing a roster with photos, bios, and rates. ICC
Milpitas claims 18 coaches and names none; 888 TTC touts a national-caliber
training team and names none; Levallois (17 French titles) names nobody. A
prospective student cannot evaluate or book a specific coach almost anywhere.
On the other side, a 2250-rated coach on Reddit can't find students without
becoming a YouTuber, and parents ask the forum where coach discovery lives.
Nobody has built the rails.

**3. Results have no first-party home — but nobody will pay for that layer
alone.** Club results live in external tools, blog prose, photos of paper, or
nowhere (Portland runs competitions three nights a week and publishes no
outcomes). The volunteer-Excel ladder dies with the volunteer, a complaint
repeated identically from 2017 to 2026. But the buyer expects free: SPINDEX is
free and funded, Stadium is free, federation platforms are free. Results are a
wedge and a glue layer, not a product.

**4. The coaching bottleneck runs opposite directions on each continent.** In
Europe, demand exceeds supply: enrollment freezes and waitlists at 1. TTC
Köln, ETV Hamburg, Roskilde; TTC München openly advertising that it lacks
trainers; selective intake at Ormeau and Kingfisher. In the US and online,
supply exceeds discovery: coaches can't find students, students can't find
coaches. Tools that stretch one coach's review hours, and rails that connect
coaches to students, both have real audiences.

**5. Willingness to pay is proven only after the match ends.** Players already
pay for exactly the layer PongLens automates: BetterPlay has charged ~$7 per
hour of footage for five years; tt-clips has $15/mo subscribers (complaining
about 10-hour queues — reliability is a differentiator); SwingVision at
$150/yr is the community's named benchmark. Coaching runs $30–100/hr in the
US, and a thread literally asks where to buy cheap remote game review. Coaches
pay for OnForm. Even casual German players pay €15/yr for richer rating stats.
Club-side software, by contrast, tolerates €15–99/mo at most — and clubs are
poor: UK clubs run on charity crowdfunders, and club software competes with
rent.

**6. Capture must follow the player, and never say "AI".** The single
strongest demand statement in the forum sweep came from a competitive player
rejecting a venue-bound smart-table concept while explicitly wishing for game
film, stats, and highlights that follow him to tournaments — which is
PongLens's actual shape. Separately, two threads treat "AI"-branded table
tennis tools as presumptive scams. The existing no-"AI" copy rule is
externally validated; so is per-table video: audio-based rally detectors
fail in noisy multi-table halls, which our vision pipeline doesn't rely on.

---

## What not to build

- **Tournament day and league administration.** OmniPong + Stadium (free) own
  US tournaments; TTLeagues, click-TT/myTischtennis, and SPID are
  federation-funded, mandatory, and free. Hostile ground for a paid product.
- **Club admin / membership / billing.** Crowded with localized incumbents
  (membermojo, ClubSpark→CoachA, AdminMyMembers, vereinsplaner, Klubmodul,
  svenskalag, HelloAsso, Spond free at the grassroots). Three TT-specific
  entrants (Hello Club, ClubMon, Paak) are all sub-scale with no visible
  traction: real need, tiny budgets, a feature not a company.
- **Venue tech and hardware.** PodPlay sells the whole autonomous-venue stack
  ($8M raised); Trainerbot is the hardware cautionary tale. We should ride the
  phone-plus-tripod norm that already exists, not sell cameras.
- **Ratings as a product.** Free everywhere, emotionally loaded (players quit
  tournaments to protect their number), and SPINDEX is a funded free
  land-grab. Ratings are engagement, never revenue.

---

## Proposals, rated

Axes: **Need** (evidence the gap is real) · **Pay** (evidence someone pays) ·
**Leverage** (how much of the build already exists in PongLens) ·
**Distribution** (fit with the outreach pipeline and current users).

### 1. Coaching pages — every club gets a real coach roster, with booking and paid video review behind it — **A**

A club-branded page on PongLens: its coaches with photos, bios, credentials,
rates, a way to book a lesson, and each coach's existing paid-review
storefront. The pitch to a club owner is disarmingly small: "your website
names none of your coaches; we'll host the coaching page you never built."
Students get a review loop with a named, club-affiliated coach — which is
precisely the trust signal the community says online coaching lacks (forum
threads warn about Instagram grifters; a club roster is the anti-grifter
credential).

- **Who pays:** coaches, via the existing marketplace fee on reviews (and
  eventually lesson bookings). Anchors: $30–100/hr lessons, $25–50 async
  reviews, OnForm precedent on the coach side.
- **Leverage:** coach profiles, review marketplace, Stripe Connect, and the
  outreach worker already exist. Incremental build is a club entity, a roster
  page, and invite flow — weeks, not months.
- **Distribution:** the outreach pipeline is already aimed at exactly these
  clubs and coaches; this gives those touches a concrete, free-to-accept offer.
- **Risks:** marketplace chicken-and-egg (mitigated: the page is useful to the
  club even before a single review is sold); coaches who won't maintain a
  profile (we build it for them from what's public, they claim it).
- **Need A · Pay A · Leverage A · Distribution A → start here.**

### 2. Club nights — film the league night, every match comes back cut into points and clips, with a results page and each player's footage in their own account — **A−**

The club puts a phone on a tripod behind each table (the setup improvers
already use), uploads the night, and PongLens returns: per-match cut videos,
points and clips, a club results page where every result links to its footage,
and a claim flow (QR at the table or roster match) that lands each player's
matches in their own PongLens account. The club gets the living results page
no club has and recruiting-grade proof of its level; players get the footage
they already want without the chore that stops everyone (the club that owns a
GoPro and doesn't use it because of editing burden is the whole story);
coaches get a stream of reviewable matches.

- **Who pays:** the club, at a tier inside the observed €15–99/mo tolerance
  (call it $39–79/mo with a processing allowance), and players upsell to subs
  and reviews. Where a club is too poor, invert it: free club page, players
  pay — the capture follows the player either way.
- **Leverage:** this is the entire existing pipeline — point detection,
  dead-space cutting, clips, scoring, placement when calibration passes, R2
  storage, magic-link accounts. Incremental: multi-match intake per session, a
  claim flow, the club results page, per-club metering (cost dashboards
  already exist).
- **Risks:** processing cost per night is the real one — the dead-space work
  directly reduces it, and metering caps it; volunteer discipline (someone
  must set up phones and upload — make it one person's five-minute job);
  venues whose footage fails table calibration still get points and clips by
  design, just not placement maps.
- **Need A · Pay B+ · Leverage A · Distribution A → the flagship. Pilot with
  two or three clubs before pricing it.**

### 3. A club page that shows the level — **B+**

A free, living public profile per club: sessions and how to join (solving the
cash-at-the-door, gmail-front-door onboarding seen everywhere), real match
footage from members, and an honest picture of the playing standard — the
thing no club site, league table, or federation portal conveys, and the pain a
1700-rated player was frustrated enough about to hand-build a 55-club
directory (table10is.com). This is deliberately unpaid: it is the funnel for
proposals 1 and 2 and an SEO asset in the way /learn is.

- **Need A · Pay none by design · Leverage B+ · Distribution A → build
  alongside proposal 1; it's mostly the same page.**

### 4. The weekly highlight reel — **B**

From a processed club night, auto-assemble a short club-branded highlight reel
for the club's Instagram. Clubs are marketing-poor with decaying websites, and
our own outreach data says Instagram is where clubs actually live; this is the
feature that makes a club owner *feel* proposal 2 working. Not a standalone
product — it ships inside the club tier and sells it.

- **Need B+ · Pay B (as part of the club tier) · Leverage A− (clip selection
  heuristics needed) → component of proposal 2.**

### 5. Group review — one coach, a whole training group's footage — **B−**

For the waitlisted European clubs and the US clubs with no coach at all:
players in a group upload their matches; the coach reviews in batch with
voice-over annotations and shares back per player. Stretches scarce coach
hours (the European constraint) and gives coach-less clubs remote access to
vetted coaches (the US regional constraint). €25–50/mo coach tier has the
only TT-specific precedent (Spinsight Team Pro).

- **Need B+ · Pay B · Leverage B · Distribution B → second wave, once
  proposal 1 has active coaches on the platform.**

### 6. A level signal from video — **C+**

The "estimate my rating" genre is a standing forum ritual because under 1% of
players worldwide hold any official rating. PongLens sees enough of a player's
matches to place them on a credible scale. Worth building eventually as an
engagement and identity feature — with care, because a rating is identity
(deflationary systems make players quit tournaments) and SPINDEX gives away
verified-match ratings for free. Never paywalled, never marketed with the
word the community hates.

- **Need B · Pay none · Leverage B+ → later, for retention.**

---

## Recommended sequence

1. **Now: proposals 1 + 3 together** (coach roster + free club page — largely
   one artifact). Smallest build, immediate revenue rail through the existing
   marketplace, and it turns every outreach touch into a concrete offer:
   "we built your club's coaching page; claim it."
2. **Next: proposal 2 as a two-or-three-club pilot** — one flagship-type club
   with real league nights, one regional club, ideally from the existing
   outreach list. Validate per-night processing cost and whether the claim
   flow converts bystanders into accounts. Price the club tier only after.
3. **Later:** 4 ships inside 2's tier; 5 once coaches are active; 6 once the
   corpus supports it.

## Revenue reality check

The stated goal is a livelihood, not a venture case. Order-of-magnitude, at
maturity: 60 clubs on a $49/mo tier ≈ $35k/yr; 400 player subscriptions at
$79/yr ≈ $32k/yr; 150 reviews/mo at $40 with a 15% fee ≈ $11k/yr. The
addressable universe is on the order of ten thousand clubs across the US and
Western Europe (Germany alone has thousands of Vereine); the sketch above
needs sixty of them plus the player base they bring. No venture-backed
competitor is aimed at this exact seam: Stupa sells to federations, PodPlay
to venues, and the phone-app entrants have no distribution.

## Evidence pack

- [`us-flagship-clubs.md`](2026-08-17-club-product-research/us-flagship-clubs.md) — 29 major US venues
- [`us-regional-clubs.md`](2026-08-17-club-product-research/us-regional-clubs.md) — 36 regional/community clubs
- [`uk-ireland-clubs.md`](2026-08-17-club-product-research/uk-ireland-clubs.md) — 28 UK/Ireland clubs, TTLeagues boundary
- [`eu-continental-clubs.md`](2026-08-17-club-product-research/eu-continental-clubs.md) — 29 continental clubs, click-TT boundary
- [`forum-pain-points.md`](2026-08-17-club-product-research/forum-pain-points.md) — 32 threads, ranked pains, price anchors
- [`software-landscape.md`](2026-08-17-club-product-research/software-landscape.md) — competitors, adjacencies, dead pool
