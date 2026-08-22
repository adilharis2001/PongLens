# Software landscape serving table tennis clubs

Compiled 2026-08-17 from public web research (vendor sites, app stores, federation pages, forums, press). Purpose: map what already exists so the PongLens club-facing product study avoids rebuilding it. Tournament/event management is out of scope for building but mapped here to fix the boundary.

---

## 1. TT tournament / league software (the boundary — do not build here)

### OmniPong (omnipong.com) — US
- **What it does:** Tournament entry, registration forms, draws, results, and USATT rating submission. The de facto operating system of US tournament table tennis; USATT named it the official tournament software for majors (US Open, US Nationals run on it).
- **Pricing:** Not published on the site. Directors pay per-event fees; USATT offered a 10% discount on the first tournament sanction fee for clubs switching to OmniPong. No club-subscription model visible.
- **Adoption evidence:** Entry forms for the 2025 US Open and 2026 US Nationals are hosted OmniPong PDFs; most USATT-sanctioned events list on it. Long forum history (MyTableTennis.net) of directors using it.
- **Visible gaps:** Web-1.0 interface, no mobile app, no live streaming/video tie-in, no player development features. It is registration + draws + ratings, nothing after the match ends.

### Stadium (stadiumtt.com / stadiumcompete.com) — US
- **What it does:** Modern tournament and league software for table tennis plus tennis, padel, badminton, pickleball, squash. Built-in integrations with USATT ratings, Ratings Central, and SPINDEX. Players report scores from phones; live results for spectators; Stripe player payments with no extra platform fee; CSV custom draws.
- **Pricing:** Free to use ("100% free, no credit card"); revenue via premium subscriptions, contribution perks, sponsorships.
- **Adoption evidence:** PingPod runs its monthly USATT-sanctioned tournaments on Stadium (many stadiumtt.com tournament pages for PingPod events, LYTTC opens, etc.).
- **Visible gaps:** Competition-day only. No video, no club membership/billing, no training features. It is the modern OmniPong challenger, not a club platform.

### TTLeagues (ttleagues.com) — England
- **What it does:** Table Tennis England's official league and fixture platform: divisions, fixtures, results entry, averages, a scorecard app, plus free content-managed league/club/county websites.
- **Pricing:** Free to affiliated leagues — no charge for the software; players pay TTE affiliation fees. (Replaced TT365's League Manager after TTE moved back-end services to Sport:80 in 2018.)
- **Adoption evidence:** Essentially every local league in England (Bristol, Reading, Southport, British Clubs League, etc. all on *.ttleagues.com).
- **Visible gaps:** England-only in practice; league admin, not club ops; no video or performance layer.

### click-TT + myTischtennis + nuScore — Germany
- **What it does:** click-TT is the DTTB/regional federations' league administration system (team registration, fixtures, results); nuScore is digital scoresheet entry feeding live scores into click-TT; myTischtennis.de is the community/portal layer with the andro-sponsored TTR rating, rankings, and stats. click-TT is integrated into myTischtennis so one portal covers all federations.
- **Pricing:** Federation-funded; free to clubs. myTischtennis Premium is EUR 15/year (daily-updated TTR value, TTR calculator, head-to-head comparisons), with a share going to regional associations.
- **Adoption evidence:** Mandatory infrastructure for all German league play — hundreds of thousands of licensed players.
- **Visible gaps:** Pure administration + ratings. No video, no coaching, no club business tools. Shows that players will pay a small personal subscription (EUR 15/yr) just for richer rating stats.

### FFTT SPID v2 + GIRPE (+ Paak) — France
- **What it does:** SPID ("Systeme Pongiste d'Information Decentralise") is the FFTT's licence/club/competition system with "Mon Club" and licensee portals; GIRPE is the interclub match-sheet software that auto-syncs to SPID. Paak (paak.club) is a private freemium club-management layer that explicitly positions as complementing SPID/GIRPE (members, payments, live match stats, junior pathways, coach-certification compliance): free to 100 members, EUR 29/mo (Paak One), EUR 99/mo (Pro).
- **Adoption evidence:** SPID/GIRPE are mandatory for French clubs. Paak adoption is not documented publicly.
- **Visible gaps:** Same as Germany — administration only. Paak's existence signals French clubs want a friendlier layer above federation tooling.

### Ratings Central (ratingscentral.com) — international
- **What it does:** Bayesian rating system (David Marcus) rating everyone from beginners to world class; fully automated event submission for clubs and tournament directors; used for club leagues in the US and as an official rating in parts of Australia (Table Tennis ACT, SA).
- **Pricing:** Free.
- **Visible gaps:** Ratings only — no registration, draws, video, or money handling. Widely loved by statisticians, invisible to casual players.

### USATT systems (usatt.simplycompete.com)
- **What it does:** Membership, tournament sanctioning, ratings processing, and a league module on the Simply Compete platform. Rating engine reworked (Dec 2025 rollout) after documented bugs in league ratings processing.
- **Visible gaps:** Chronic complaints about processing bugs and UX; no club-facing tooling beyond compliance. USATT outsources tournament ops to OmniPong and increasingly Stadium.

### SPINDEX (spindextt.com) — MLTT's rating
- **What it does:** Free global 0–3000 rating from Major League Table Tennis; SPINDEX 2.0 accepts verified one-on-one matches anywhere, with confidence levels. Collaboration with PingPod so everyday matches at PingPod venues count.
- **Why it matters:** A ratings land-grab targeting casual/venue play outside federation structures — evidence the "verified match anywhere" concept has backing.

### Challonge and small tools
- **Challonge:** free/cheap generic brackets (single/double elim, RR, Swiss); dozens of ad-hoc TT tournaments visible (office events, college clubs). Used where sanctioning doesn't matter.
- **Others in the niche:** r2sports (racquet-sports tournament suite, has a TT page), SPORT Software's TT Tournament Manager (German desktop + Android), Magic Sports, PlayPass (free TT club/league/tournament templates), Match Point TT (new iOS app for club events).
- **Takeaway:** Tournament day is crowded at every price point down to free.

**Category verdict:** Well-served and largely free (federation-funded or freemium). The boundary is confirmed: OmniPong + Stadium own US tournaments, national federations own leagues. Nothing here touches video or what happens between matches.

---

## 2. Generic club-management software used by TT / racket clubs

### CourtReserve
- **What it does:** Court booking, memberships, programs, POS for racket clubs. Plans start ~$25/mo base (Capterra) with Start/Grow/Scale/Enterprise tiers; unlimited courts/members on all plans.
- **TT evidence:** None found. Their own comparison content says sport-specific tools "solely designed for very specific subsets of racquet sports, such as table tennis, didn't make the cut" — CourtReserve is tennis/pickleball-first. No TT club found running it.

### Mindbody / Zen Planner / Gymdesk
- **What they do:** Fitness-industry membership billing, scheduling, check-in. Mindbody is the incumbent (typically ~$139+/mo); Zen Planner multi-location billing; Gymdesk (~$75–100/mo) markets to martial arts/"membership clubs".
- **TT evidence:** No table tennis club case studies or public examples surfaced for any of the three. TT clubs appear too small/low-ARPU for these platforms' sales motion.

### TeamUp / Spond
- **Spond:** Free team-communication/scheduling app with a dedicated "Ping Pong (Table Tennis) Team App" marketing page (invites, RSVPs, waiting lists, fundraising, sharing serve videos). Free, ad-free, no member cap — the default grassroots scheduler in the UK/Nordics. This is what many small TT clubs actually use.
- **TeamUp:** Class/membership SaaS (~$99+/mo); no TT evidence found.

### ClubSpark (Sportlabs)
- **What it does:** LTA's venue-management platform (booking, membership, coaching, websites) offered generically at clubspark.com.
- **TT evidence:** Real TT clubs live on it: Goodwin TTC, Hampstead Garden Suburb TTC, Farnborough Tennis & Table Tennis Club — typically clubs adjacent to tennis. Free/cheap via governing-body deals.

### Pitchero
- Sports-club websites/memberships for football/rugby/cricket etc. No TT support evidence found.

### Square Appointments / generic booking
- No direct TT club evidence surfaced, but plausible for lesson booking at pro-run clubs; US TT clubs more often use bare websites, Google Forms, spreadsheets, and Venmo/Zelle.

### TT-specific small SaaS (the interesting tail)
- **Hello Club (NZ):** club management (bookings, membership, payments, access control) with a dedicated table tennis landing page; claims "hundreds of squash, badminton, table tennis, tennis, and pickleball clubs" but names none. From ~US$39/mo (NZD 58–298 tiers).
- **ClubMon:** TT-specific club admin (members, fees, training groups, table assignment, payment reminders). Free to 30 members, EUR 15/mo to 200, EUR 35/mo unlimited. No named customers — looks very early.
- **Paak (France):** see section 1 — freemium, TT-aware (rankings, match stats, junior pathways).
- **Takeaway:** at least three young companies independently concluded TT clubs need cheap, TT-aware admin — and none shows real traction yet. The niche exists; the willingness to pay looks like EUR 15–99/mo, not Mindbody money.

**Category verdict:** Badly served. Big platforms ignore TT (too small); TT-specific entrants are sub-scale with no visible adoption; the observed default is Spond (free) + spreadsheets + a federation system.

---

## 3. Venue-tech (autonomous venues, cameras, replay)

### PingPod + PodPlay (pingpod.com / podplay.app) — the one to study
- **What it does:** PingPod runs ~20+ autonomous 24/7 table tennis venues (NYC-origin; six US states, England, Philippines). PodPlay Technologies (spun out 2023) white-labels the whole stack: reservations, events, memberships, payments, admin, analytics, coach connect, tournament/league management, digital scoreboards, **per-table cameras with customer-initiated instant replay (patent-pending) and "video replay with AI insights"**, door access control, 24/7 remote monitoring. Digital scoreboards integrate DUPR for pickleball; SPINDEX partnership makes PingPod matches ratable.
- **Pricing:** Four tiers (Basic = white-label web app; Basic Plus adds native apps; Pro and Autonomous+ add cameras, iPads, monitors, access control). Dollar amounts not published — demo-gated. PodPlay raised $8M (2024) and Forbes covered the licensing/franchising expansion.
- **Adoption evidence:** Powers all PingPods plus third-party venues across pickleball, padel, pool, golf sims, cricket, soccer.
- **Visible gaps:** The replay is entertainment-grade (share a moment), not analysis — no point detection, no stats, no per-player performance history, no coaching loop. Camera infrastructure exists in venues with zero performance software on top. This is the clearest adjacency to PongLens.

### SPiN (wearespin.com)
- Ping-pong social club chain (NY x2, Chicago, SF, Seattle, Philadelphia, Boston, Toronto, DC). Hospitality-first: bar/restaurant + ~12 tables, event sales, web booking. No membership requirement, no player-facing tech beyond reservations. STIGA equipment partnership.
- **Gap:** no cameras, no ratings, no competitive layer — deliberately casual.

### Bounce (UK)
- Social entertainment brand (est. 2012, London) — bar + restaurant + ping pong; sells fun (including interactive projection games), not sport. Booking is standard hospitality reservation tech. No performance tech.

### Others
- **SPINCITY (Budapest):** 24/7 modern TT club on the PingPod model — the autonomous-venue pattern is spreading to Europe independently.
- **Butterfly "Ping Pong Parlors":** sponsored bars/lounges program, equipment-led, no tech.

**Category verdict:** Venue booking/access is solved (PodPlay sells it whole). Per-table cameras are already installed in the most tech-forward venues, but nobody converts that footage into performance product. Social chains (SPiN/Bounce) are hospitality businesses, not software buyers for player development.

---

## 4. TT-specific consumer / AI apps

### SwingVision (tennis/pickleball) — the model, not a competitor
- Single-phone AI: automated scoring, shot stats, highlights, line calling; built by ex-Tesla/Apple engineers. Free tier (2 hrs/mo processing); Pro **$149.99/yr (~$12.5/mo)**. Widely reviewed as more accurate than human line calls within 10 cm. **Does not support table tennis.** Its pricing and free-tier shape is the reference consumers already understand.

### Stupa Sports Analytics (stupasports.ai) — the serious TT incumbent, but federation-facing
- Indian sports-tech: real-time TT match analytics (ball tracking, speed, placement, rally data) from video; consumer app (Stupa Analytics on iOS) plus a full-stack platform of SaaS + AI-led media + streaming for governing bodies. Performance partner of **ITTF** and federations of Brazil, Sweden, Portugal, Hungary, France, Germany; partnership with Table Tennis Australia; works WTT events and Ultimate Table Tennis; claims 30+ federations/leagues across five sports and a target of 200–300 federations.
- **Pricing:** not published; enterprise/federation sales motion. Consumer app reviews are thin — the business is clearly B2F (business-to-federation), not clubs or individual players.
- **Gap:** nothing visible for the ordinary club or self-serve competitive player; no marketplace/coaching loop.

### Phone-only AI apps (all young, all small)
- **PingPi — AI Table Tennis Coach (iOS, 2025):** turns match video into 3D-model movement analysis, rally/shot-pattern/landing-zone tracking, match reports, highlight clips. Closest consumer concept to PongLens processing; app-store scale, no visible club story.
- **Racquet AI (iOS, 2025):** upload short rally video, stroke detection/counts, insights, training-video recommendations.
- **SpinCoach (spin-coach.com):** upload match video, AI feedback on technique/footwork/shot selection plus personalized drills; multi-dimension performance scores.
- **Spinsight (spinsight.com, by MWM, France):** real-time spin/speed/placement/height measurement — but requires proprietary marked balls + starter kit and cloud processing. Free tier; **Player Pro EUR 5–10/mo; Team Pro (coaches/clubs/federations) EUR 25–50/mo.** Notable as the only one selling a club/team tier.
- **OSAI (osai.ai):** Olympic-grade TT computer vision (TTNet at 120fps; analysed Tokyo 2020 table tennis; Russian Nationals broadcast overlays; published the OpenTTGames dataset). Consumer app existed. Tracxn lists it as an unfunded Cyprus-registered company with no raise — world-class tech that never became a business. Cautionary tale: broadcast-grade TT CV alone did not find a paying market.
- **Table Tennis Tally, Match Point TT** and similar: manual scoring utilities.

### Robot-companion apps
- **Power Pong Robot app:** wireless drill control, drag-and-drop drill builder (8-ball sequences), drill sharing coach-to-student. Companion to $1–2k robots.
- **Pongfox (India):** app-controlled robot with drills, ChatGPT-driven drill generation, SmartPad hit-tracking for accuracy feedback.
- These apps are hardware attach, not standalone software businesses — but they show TT players/coaches already use apps at the table.

**Category verdict:** Nobody owns "SwingVision for table tennis." Stupa has the tech but sells to federations; OSAI had the tech and no market; the phone-app entrants (PingPi, Racquet AI, SpinCoach) are months old with no distribution, no ratings tie-in, no coach marketplace, no club story. PongLens's point-detection + clips + scoring + coach-review loop has no direct, established competitor at consumer or club level.

---

## 5. Coaching-delivery platforms

- **CoachNow (by Golf Genius):** spaces/feeds per athlete, video annotation, side-by-side compare, voice-over. Analyze tier **$59.95/yr**; PRO for coach businesses; Academy for facilities (quote-based). Marketing and case studies are golf/baseball-dominated; no visible TT coach presence.
- **OnForm:** video analysis + messaging; acquired **Hudl Technique** (ex-Ubersense) users when Hudl killed it (app discontinued Sept 2021). Positions for golf, tennis, swimming, gymnastics, track. No TT case studies found.
- **Coach's Eye (TechSmith):** the coaches' favorite annotation app for a decade — **retired Sept 2021** (fully dead Sept 2022), pushing users to VisualEyes/OnForm/CoachNow. Two of the three best-known technique apps died within a year, evidence this is a hard standalone business.
- **TopTekkers-style** (structured skills curricula): football-specific; no TT equivalent found.
- **TT reality:** coaches sell lessons via club pages (e.g., fvttc.org rates), WhatsApp/WeChat video, and YouTube-based academies (PingSkills, TableTennisDaily Academy sell their own courses rather than tooling). No evidence of meaningful TT coach adoption of CoachNow/OnForm.

**Category verdict:** Generic tools exist and are cheap, but TT coaches demonstrably aren't organized on any of them. Remote TT coaching runs on messaging apps. A TT-native review loop (what PongLens already ships) competes with free-but-painful, not with an incumbent.

---

## 6. Streaming / recording for clubs

- **Observed practice:** league nights and club tournaments stream via a phone or camcorder + OBS + YouTube, often with a free scorebug overlay (KeepTheScore, OBScoreboard). Guides exist specifically for phone-streaming table tennis (Cam One app). Westchester, LYTTC etc. post match video to YouTube channels manually.
- **Solidsport:** federation/league streaming platform (subscription + revenue share) used across Nordic minor sports; a natural fit pattern for TT federations, though no TT federation deal surfaced in this pass.
- **Pixellot:** AI auto-production cameras, algorithms for ~19 sports — table tennis not among the marketed ones. **Veo:** football-first, expanding to court sports — no TT support. **XbotGo/OBSBOT**-class tracking cameras: generic, no TT mode.
- **Stupa** offers streaming + auto-production to federations (their broadcast package), again not to clubs.

**Category verdict:** Nothing purpose-built for club TT streaming. The auto-camera vendors skip TT (small market, fast small ball, indoor lighting). Clubs that stream do it manually. Any per-table camera play (see PodPlay) has this whole lane open.

---

## 7. Dead pool and cautionary tales

| Who | What happened | Lesson |
| --- | --- | --- |
| **Trainerbot** (2016 Kickstarter, HAX) | Raised ~$260k for a smart TT robot; years of delays; never delivered; went dark. | Hardware-first TT plays die in manufacturing. |
| **OSAI** | Broadcast-grade TT computer vision (Tokyo 2020, Russian Championships, TTNet paper, open dataset); never funded, no visible traction in 2025. | Tech excellence without a buyer (clubs? federations? broadcasters?) fails; Stupa won the federation deals instead. |
| **Coach's Eye** (TechSmith) | Category-defining video-analysis app, retired 2021. | Standalone technique-video tools couldn't sustain a business even with a huge user base. |
| **Hudl Technique** | Sold to OnForm 2021, app killed. | Same lesson; consolidation to survive. |
| **TT365 League Manager** (UK) | Lost the TTE contract to Sport:80/TTLeagues in 2018 after a public dispute; lingers on legacy leagues. | Federation distribution decides winners in league software; a private vendor's moat evaporates when the NGB builds its own. |
| **Pink-note:** no US "table tennis club software" startup with funding history was found at all | The niche has never attracted venture money outside PingPod/PodPlay and Stupa. | Club software for TT is a bootstrap-sized market; video/analytics is where money went. |

---

## 8. Synthesis

### (a) Well-served needs (do not build)
- **Tournament day:** OmniPong (incumbent) + Stadium (modern, free) + Challonge (casual) + federation systems. Free-to-cheap, entrenched, USATT-integrated.
- **League administration:** national platforms (TTLeagues, click-TT/myTischtennis, SPID) are free, mandatory, and federation-distributed.
- **Ratings:** USATT, Ratings Central (free), TTR, and now SPINDEX chasing casual verified matches.
- **Venue booking/access for autonomous venues:** PodPlay sells the whole stack including hardware.
- **Grassroots scheduling/comms:** Spond, free.

### (b) Unserved or badly served for TT specifically
- **Match video → points, clips, stats for ordinary players/clubs:** no established player. Stupa sells to federations; OSAI died; PingPi/Racquet AI/SpinCoach are brand-new phone apps with no distribution. "SwingVision for TT" does not exist yet.
- **Club-level performance layer:** venues with cameras (PingPod-class) offer entertainment replay only; no one turns club footage into player history, ratings context, or coaching.
- **TT coaching delivery:** CoachNow/OnForm have no TT footprint; remote review happens over WhatsApp. A TT-native paid-review loop has no incumbent.
- **Club streaming/recording:** all DIY; auto-production vendors skip TT.
- **Club admin (TT-aware):** three sub-scale entrants (Hello Club, ClubMon, Paak) and no winner — real need, tiny budgets, probably a feature not a company.

### (c) Pricing norms clubs and players already tolerate
- **League/tournament software:** free (federation-funded or Stadium's freemium). Clubs will not pay here.
- **Club admin SaaS:** EUR 15–99/mo for TT-specific tools; ~$25–150/mo for generic racket-club platforms; Mindbody-class ($139+/mo) is above TT club budgets.
- **Venue tech:** demo-gated enterprise pricing with hardware tiers (PodPlay); only venues with real revenue (per-table hourly rental) buy it.
- **Consumer/player subscriptions:** $60–150/yr is the proven band (SwingVision $150/yr, CoachNow Analyze $60/yr, Spinsight EUR 60–120/yr player tier, myTischtennis EUR 15/yr shows even casual German players pay something for rating stats).
- **Coach/team tiers:** EUR 25–50/mo (Spinsight Team Pro) is the only TT-specific precedent; CoachNow PRO/Academy are quote-based.

### Boundary statement for the study
Everything from sign-up sheet to final bracket is owned (OmniPong/Stadium/federations) and priced at free. Everything from "the match was played" onward — video, points, clips, stats, review, player history, and the club's camera infrastructure — is open territory in table tennis, and the only well-funded adjacent players (Stupa, PodPlay) approach it from the federation and venue sides respectively, leaving players, coaches, and ordinary clubs unclaimed.
