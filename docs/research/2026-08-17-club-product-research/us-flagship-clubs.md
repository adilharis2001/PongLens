# US flagship table tennis clubs — site survey

Product-discovery study for PongLens, 2026-08-17. Method: WebFetch of each club's
homepage plus key subpages where reachable, supplemented with search snippets when a
site blocked fetching. Paraphrased throughout; no long quotes. 29 venues examined.

A note on the brief: "Lily Yip TTC (NJ)" and "LYTTC (Dunellen NJ)" are the same club
(Lily Yip Table Tennis Center, Dunellen NJ), so they appear once below. Extra clubs
were added to keep the count up (Paddle Palace, Austin TTC, NTTTC, AGTTA, Experior,
Alameda, Schaumburg, NYCTTA, Seattle Pacific).

Legend for "type": FT = full-time dedicated center; academy = coaching-first
operation; community = part-time or rec-center club; social = entertainment venue.

---

## 1. Lily Yip Table Tennis Center (LYTTC) — Dunellen, NJ
- **URL:** lyttc.wordpress.com — **Type:** FT center (15,000 sqft, 24 tables, 2 floors)
- **Programs:** junior + adult coaching, summer camps (June–Aug), Friday night league, school field trips, USATT tournaments (August Open, Wasserman Open with $15k prizes).
- **Coaches:** a "Camps and Coaching" section exists but no roster, no bios, no rates. This is an Olympian's club and her own site doesn't profile the coaching staff.
- **Booking:** table reservations and league signup via Square appointment/signup links; "first come, first serve" league registration.
- **Pricing:** membership page exists but rates not shown in page content.
- **Leagues/results:** Friday league; no results publishing visible on the site.
- **Video:** none observed.
- **Tech:** free-tier WordPress.com subdomain (a flagship US club without its own domain), Square for payments.
- **Pain signals:** no coach profiles, no visible pricing, no results, no news flow; the wordpress.com address itself.

## 2. Westchester Table Tennis Center — Pleasantville, NY
- **URL:** westchestertabletennis.com — **Type:** FT center (14,000 sqft, 19 tables; Will Shortz's club)
- **Programs:** group + private lessons for kids and adults, free Monday group training for sub-1600 players, 9-week summer camp with international pros, Parkinson's night.
- **Coaches:** names appear in passing (Ben Nisbet, Rawle Alleyne, Kokou Fanny) but there is no roster page with bios.
- **Booking:** none online. Contact is a personal AOL address (wshortz@aol.com) and two phone numbers.
- **Pricing:** fully published — day rates ($15/$12/$8) and 3/6/12-month memberships ($750/yr adult).
- **Leagues/results:** league every Tue/Thu; results described as live as soon as posted. Monthly USATT 4-star tournaments with detailed results pages.
- **Video:** the standout — monthly tournament finals are livestreamed/posted to YouTube; a library of club videos going back to 2011.
- **Tech:** old custom ASP site, no booking or payment integration at all.
- **Pain signals:** one of the best-run clubs in the country runs on an AOL email and a hand-edited ASP site; video exists but only for the monthly tournament, nothing for league nights or members.
- **Freshness:** very current (2026 events posted).

## 3. Maryland Table Tennis Center (MDTTC) — Gaithersburg, MD
- **URL:** mdttc.com — **Type:** FT center since 1992, ITTF Hot Spot, USATT Center of Excellence
- **Programs:** junior program, group classes, private coaching, spring/summer camps, open play, leagues, tournaments.
- **Coaches:** a /coaches page is linked but subpage fetches 404'd during the study (the homepage loads; deep links flake). No bios were retrievable.
- **Booking:** membership managed in Wellness Living (card on file, auto-renew, cancel by phoning staff); tournaments via OmniPong. No visible lesson booking tool.
- **Pricing:** not shown anywhere fetched.
- **Leagues/results:** leagues listed; no results mechanism visible.
- **Video:** none observed.
- **Tech:** Next.js rebuild + Wellness Living + OmniPong; pro-shop link.
- **Pain signals:** no pricing, no dated news, deep links intermittently broken, membership cancellation requires calling staff.

## 4. ICC Table Tennis Center — Milpitas, CA
- **URL:** indiacc.org/tabletennis (redirect stub) → icctt.org — **Type:** FT center (10,000 sqft; produced Lily Zhang, Ariel Hsing, Nikhil Kumar, other Olympians)
- **Programs:** junior/adult classes, camps (bundled with the parent org's chess/art/STEM camps), Sat league (over 1200), Sun league (under 1200).
- **Coaches:** claims 12 full-time + 6 part-time coaches — none named, no profiles. Arguably the strongest coaching bench in the country, invisible online.
- **Booking:** phone/email only (sports@indiacc.org).
- **Pricing:** membership links exist; no numbers shown.
- **Leagues/results:** two rating-banded weekend leagues; no results published.
- **Video:** none.
- **Tech:** WordPress; the parent-org page is just a redirect notice.
- **Pain signals:** "no upcoming events" box, no dates anywhere, no way for a prospective player to see who teaches or what it costs. The Olympian pipeline is the pitch, and the site doesn't show it.

## 5. Triangle Badminton & Table Tennis — Morrisville, NC
- **URL:** trianglebtt.com — **Type:** FT multi-sport center (30,000 sqft)
- **Programs:** described only generically (coaching, memberships, camps, after-school, track-out days, corporate events); no program pages with detail.
- **Coaches:** none listed.
- **Booking:** email/phone. Site is a Shopify storefront, so commerce exists but not court/lesson booking.
- **Pricing:** member hours shown; no prices.
- **Leagues/results:** nothing.
- **Video:** none.
- **Tech:** Shopify; logo asset dated 2015.
- **Pain signals:** a 30,000 sqft facility whose site says almost nothing; no coach info, no pricing, no league content, no freshness signals.

## 6. Princeton Pong — Princeton, NJ
- **URL:** princetonpong.com — **Type:** FT center + academy. **The positive outlier of the study.**
- **Programs:** leveled group lessons (7–17 and adults, 90-min weekly sessions, 7:1 ratio), JETT junior elite academy, full-day summer camps, privates/semi-privates, Senior Day, monthly rated tournaments, Tuesday divisional league, Saturday weekly "Slice-Off."
- **Coaches:** six coaches with photos, real bios, and published hourly rates (e.g., 3× Olympian David Zhuang $90/hr; USATT national coach Ying Peng $90/hr).
- **Booking:** Square Checkout for camps/lessons, Glofox portal for memberships, Stadium TT for tournament signup/results, Spindex for league — four separate systems stitched together.
- **Pricing:** everything published: walk-in ($20/$17/$45 family), memberships $40–$82/month, robot rental $5/hr (free on premium), initiation fee.
- **Leagues/results:** tournament results on Stadium TT; league on Spindex; "winners' circle" updates.
- **Video:** YouTube channel; no member match video or analysis service.
- **Tech:** modern site; Square + Glofox + Stadium TT + Spindex.
- **Pain signals:** the main one is fragmentation — a member touches four different accounts/tools. Nothing connects league results, coaching, and any video.

## 7. Broward Table Tennis Club — Hollywood, FL
- **URL:** browardtabletennis.com — **Type:** FT center (17,500 sqft, 20 tables per directory listings)
- **Site status:** under maintenance; the only content is a phone number and a line saying the club is still open, call us. The legacy domain 2xtremepong.com 301-redirects to the same maintenance page.
- **Everything else:** unknowable from the web. Facebook is the de facto site.
- **Pain signals:** a major regional center whose entire web presence is a maintenance page; prospective players get a phone number.

## 8. Houston International Table Tennis Academy (HITTA) — Katy, TX
- **URL:** hittacademy.com — **Type:** academy
- **Programs:** Olympic Dreams youth training, advanced competitive training, adult beginner groups, privates, open play, leagues, several camps (some bundling Chinese language/culture), after-school enrichment, birthday parties; hosts USATT/ITTF-Americas/WTT Youth events.
- **Coaches:** three named (Hui Wang, Hangyu Li, Wantong Liu) with titles only — no bios or credentials pages.
- **Booking:** a custom app on Base44 (loves-hitta.base44.app) plus phone/in-person. Mindbody listing exists separately.
- **Pricing:** open play $15/session or $40/month unlimited; membership tiers exist but no numbers.
- **Leagues/results:** league play offered; no results publishing seen.
- **Video:** YouTube/Instagram linked; nothing structural.
- **Tech:** Webflow + Base44; blog posts dated May/June 2026 — actively maintained.
- **Pain signals:** coaches without profiles; league without results; membership without prices.

## 9. Texas Table Tennis Training Center — Houston, TX
- **URL:** texastabletennis.com — **Type:** FT center (6,000 sqft, 12 tables, est. 2013)
- **Site status:** homepage server-renders only a title ("Premier Training Facility"); guessed subpages 404. Effectively an empty shell to any crawler and thin even in search snippets. Facebook is the active channel.
- **Booking:** phone/email per directory listings.
- **Pain signals:** near-zero web content for a 13-year-old training center; no programs, coaches, prices, or results visible anywhere.

## 10. Samson Dubina Table Tennis Academy — Akron, OH
- **URL:** samsondubina.com — **Type:** academy (501c3)
- **Site status:** hard-403s automated fetches (bot protection), so details below come from search snippets.
- **Programs:** group classes, privates, daily training, camps, Thursday league, tournaments; Nittaku Academy branding.
- **Coaches:** Samson himself is the brand; guest pros announced via news posts (e.g., Yutaka Nakano).
- **Booking:** email/text Samson directly to sign up for lessons and classes; rates published in content ($25–$57 per 30 min depending on age/payment).
- **Pricing:** membership tiers public: ~$67/mo individual, $87/mo household, premium teen/adult ~$397/mo bundling uniform, groups, privates, tournaments, camps, USATT membership.
- **Leagues/results:** runs on TTLive — draws, group movement, result entry, instant rating calc. One of the few clubs with a real results system.
- **Video:** publishes weekly training videos as content marketing; strong article/video library.
- **Pain signals:** everything routes through one person's phone/email; site blocks robots (also blocks previews/link unfurls); no online booking despite heavy content output.

## 11. Power Pong Academy — Costa Mesa, CA
- **URL:** none of its own; coaching sold at shop.powerpong.us/collections/coaching — **Type:** academy attached to the Power Pong robot business (Attila Malek, USATT Hall of Famer; located at Orange Coast College fitness complex)
- **Programs:** privates and small groups by appointment, summer camps, corporate/school programs.
- **Coaches:** Attila and Amanda Malek, described in a paragraph on the shop page; no structured profiles.
- **Booking:** phone Amanda directly; the only bookable web object is a $220 gift card (sold out at fetch time).
- **Pricing:** not shown beyond the gift card.
- **Video:** none club-side (robot product videos exist).
- **Tech:** Shopify.
- **Pain signals:** an academy run out of a robot company's shop page; no schedule, no rates, no roster.

## 12. Pong Planet — San Carlos + Hayward, CA
- **URL:** pongplanet.com — **Type:** FT centers (2 locations)
- **Programs:** camps, privates, group classes, round-robin leagues, tournaments, after-school, parties, corporate events, chess.
- **Coaches:** named only inside testimonials (James, Daniel); no roster or bios.
- **Booking:** email/phone per location; "table and room reservations" advertised but no tool.
- **Pricing:** a Memberships heading with no numbers.
- **Leagues/results:** leagues advertised; no standings or results anywhere.
- **Video:** none; YouTube link only.
- **Tech:** no identifiable booking/payment stack; undated content, forward-dated copyright.
- **Pain signals:** everything a prospect wants (price, coach, level of play) is absent; leagues run but leave no public trace.

## 13. Spartans Table Tennis Club — San Jose, CA
- **URL:** spartansttc.com — **Type:** academy/club (shares address and contact with 888 TTC; tao@888ttc.com)
- **Programs:** "Formal Student Program" navigation, coaching-team page — no detail server-side.
- **Coaches:** page exists, no content retrieved.
- **Booking:** phone/email.
- **Pricing:** none.
- **Tech:** Wix; footer © 2022.
- **Pain signals:** stale two-plus years; minimal information architecture; identity blurred with 888 TTC.

## 14. 888 Table Tennis Center — San Jose, CA
- **URL:** 888ttc.com — **Type:** FT center (30,000 sqft; ITTF High Performance Training Center, USATT national training center)
- **Programs:** Super 8s juniors, beginner seasonal camps, 2026 summer camp bundles ($999 two-week), privates, groups, open play, ITDP high-performance program, "888 League Play" billed as among the Bay Area's largest.
- **Coaches:** self-described elite training team — zero names, zero bios, zero photos on the site.
- **Booking:** "book a lesson" links push to 888pong.com (their store domain); no named booking system; phone/email otherwise.
- **Pricing:** camps only; no lesson/membership rates.
- **Leagues/results:** league heavily promoted, no results, standings, or schedule visible.
- **Video:** none.
- **Tech:** WordPress + separate store domain; undated news.
- **Pain signals:** a national-training-center-grade facility where a prospect cannot learn one coach's name, a lesson price, or a league standing.

## 15. Wang Chen Table Tennis Club — Manhattan, NY
- **URL:** wangchenttc.com — **Type:** FT club (Upper West Side; additional NJ locations)
- **Programs:** after-school, summer camp, privates, parties/corporate.
- **Coaches:** only Wang Chen herself has a bio (Olympic 5th, world #4, Hall of Fame). No other coach appears.
- **Booking:** table booking via a Square site; lessons by contact.
- **Pricing:** none shown.
- **Leagues/results:** none mentioned.
- **Video:** none; press clippings instead (NYT, NY1).
- **Tech:** Wix + Square; footer © 2020; a camp heading still says 2024.
- **Pain signals:** stale copy, single-coach visibility, no pricing.

## 16. New York City Table Tennis Academy — Manhattan, NY
- **URL:** thetabletennisacademy.org — **Type:** academy (300 W 61st St)
- **Site status:** returns HTTP 500 — dead at fetch time. Facebook page is the only living presence.
- **Pain signals:** the entire data point is that a Manhattan academy's website is an error page.

## 17. Seattle Pacific Table Tennis Club — Bellevue, WA
- **URL:** spttc.net — **Type:** FT center (9,600 sqft, 16 tables per directories)
- **Site status:** connection reset on all fetch attempts (http/https, with/without www) — unreachable during the study. Facebook active.
- **Pain signals:** a flagship Pacific Northwest club effectively offline on the open web.

## 18. Portland Table Tennis Club — Portland, OR
- **URL:** portlandtabletennis.com — **Type:** community club/nonprofit (open 365 days)
- **Programs:** drop-in play, competitions Tue/Wed/Fri, classes on set evenings (~$100/6 weeks).
- **Coaches:** coaching is outsourced to a partner (Jeff Mason, Peace and Pong, own website); no roster on the club site.
- **Booking:** none; "see the host"; pay at the door.
- **Pricing:** membership tiers mentioned (day pass to annual), numbers not listed.
- **Leagues/results:** three competition nights, nothing published.
- **Video:** none. Robot available in-house.
- **Tech:** WordPress; sparse and somewhat dated.
- **Pain signals:** class signup means contacting a different organization; no results; no rates.

## 19. Paddle Palace Club — Portland, OR
- **URL:** paddlepalaceclub.com — **Type:** FT club owned by the Paddle Palace equipment retailer (Hoarfrost family)
- **Programs:** juniors 7–18, adult drop-in, leagues, classes, privates, summer camps (2026 listed).
- **Coaches:** three pictured (Judy and Ryan Hoarfrost, head coach Jiwei Xia) with titles; "former national team members and an Olympian" claimed but no depth.
- **Booking:** members reserve via 10sPortal; RacquetDesk login also present; drop-ins just show up ($15/$12).
- **Pricing:** drop-in shown; membership costs not.
- **Leagues/results:** most recent published tournament results are the 2023 Oregon States — three years stale.
- **Video:** none; YouTube link only.
- **Tech:** WordPress + 10sPortal/RacquetDesk (tennis-industry tools).
- **Pain signals:** results frozen in 2023; membership pricing hidden; two logins for one small club.

## 20. Denver Table Tennis Alliance — Denver, CO
- **URL:** denverttalliance.com — **Type:** community club (rec-center hours 3 days/week)
- **Programs:** none described; hours and contact only.
- **Coaches:** none listed. **Booking:** email/phone. **Pricing:** a /rates page linked, contents not surfaced.
- **Leagues/results/video/store:** none.
- **Tech:** GoDaddy site builder + reCAPTCHA form; a stray Butterfly shop logo.
- **Pain signals:** the site is a business card; a second half-built Square site exists in parallel (denver-table-tennis-alliance.square.site).

## 21. Atlanta International Table Tennis Academy (AITTA) — Suwanee, GA
- **URL:** yangtabletennis.com — **Type:** academy (former ITTF Hot Spot; merged Yang's + Atlanta academies)
- **Programs:** junior team program, adult lessons, spring/summer camps with prices ($300–$320/wk), monthly tournament, MLTT partnership.
- **Coaches:** head coach Shigang Yang featured with credentials (former US national/junior team coach); the rest of the team unnamed.
- **Booking:** download a PDF form and email it to a gmail address, or hand it in at the desk. No online anything.
- **Pricing:** camps yes; classes/membership no.
- **Leagues/results:** achievements celebrated as news posts linking out to MLTT/Paddle Palace coverage; no systematic results.
- **Video:** one embedded YouTube video (MLTT Cup); a personal YouTube channel.
- **Tech:** WordPress with a 2013-era theme (Tempera); news is genuinely active into 2026.
- **Pain signals:** PDF-and-email registration at an elite academy; reputation carried by word of mouth rather than the site.

## 22. Atlanta Georgia Table Tennis Association (AGTTA) — Norcross, GA
- **URL:** agtta.org — **Type:** community club (18 tables, largest in Georgia)
- **Programs:** league play, tournaments (via OmniPong), free coaching sessions, SafeSport-certified staff.
- **Coaches:** certification claimed; nobody named.
- **Booking:** email a volunteer's AOL/personal address.
- **Pricing:** none shown; donations via PayPal/Zelle.
- **Leagues/results:** league referenced; publishing method not visible.
- **Video:** one Spring 2024 YouTube link.
- **Tech:** WordPress; © 2015 footer.
- **Pain signals:** decade-old shell kept barely alive; tournament life happens on OmniPong, invisible on the club's own site.

## 23. Schaumburg Table Tennis Club — Schaumburg, IL
- **URL:** sttc.net — **Type:** community club (30 years old, park-district rec center)
- **Site status:** domain is parked and listed for sale at GoDaddy. Directory listings still print an @sttc.net contact email, which presumably bounces. Facebook is the living channel.
- **Pain signals:** a 30-year-old club let its domain lapse; its published contact email rides on the dead domain.

## 24. Experior Table Tennis Club — Addison, IL (Chicago)
- **URL:** tabletennischicago.com — **Type:** FT center (Chicago's first, Butterfly-sponsored)
- **Site status:** announced temporary closure as of May 2024; last post is that announcement. Site still up (WordPress, dated theme).
- **What it had:** membership $80/mo–$420/6mo, $10 walk-in, phone/email booking, tournament results posted as blog articles, YouTube channel.
- **Pain signals:** two years of silence after "temporarily closed"; the web presence neither confirms life nor death.

## 25. Alameda Table Tennis Club — Alameda, CA
- **URL:** alamedattc.org — **Type:** community club (14 tables)
- **Site status:** DNS no longer resolves; Yelp marks the club CLOSED; Facebook announced closure. Some activity migrated to an MMTTA page.
- **Pain signals:** a club dies and its digital footprint just 404s — no history, no records, no forwarding.

## 26. Austin Table Tennis Club — Austin, TX
- **URL:** austintabletennis.net — **Type:** FT center (12,000+ sqft, nonprofit)
- **Programs:** Fall 2026 youth program (ages 6–17, dated sessions), junior program with USATT-certified coaches, training camps, adult league, Sunday Super League with cash prizes, **"Video Coaching" listed as an explicit service** — the only traditional club in this survey selling video analysis on its site.
- **Coaches:** "National Champion" leadership and certified coaches claimed; staff page exists, thin bios.
- **Booking:** Google Form + email to a coaching address; Stadium TT for tournaments.
- **Pricing:** membership page present, rates not surfaced; framed as tax-deductible donation.
- **Leagues/results:** league recaps published as blog posts (Aug 5, 2026 recap — very fresh); no structured standings.
- **Video:** streams on Twitch (@austinttc) plus YouTube — one of only two traditional clubs in the survey with live streaming.
- **Tech:** Wix + Google Forms + Stadium TT.
- **Pain signals:** the most video-forward traditional club still books lessons over a Google Form, and its league history lives in prose recaps.

## 27. North Texas Table Tennis Club (NTTTC) — Dallas–Fort Worth, TX
- **URL:** ntttc.org — **Type:** club/academy (est. 2015; now split TT/pickleball)
- **Programs:** kids classes (6+), adult classes, seasonal camps, weekly leagues, parties, corporate events, private coaching.
- **Coaches:** one named (Shuai Wang, ex-Sichuan provincial team); nobody else.
- **Booking:** phone/email; "registration open" links land on info pages.
- **Pricing:** oddly, only the pickleball prices are published ($25–$35/session); table tennis rates absent.
- **Leagues/results:** weekly leagues mentioned; no results.
- **Video:** none.
- **Tech:** GoDaddy builder; © 2015–2024.
- **Pain signals:** the newer sport (pickleball) got the pricing transparency the founding sport never had.

## 28. PingPod — NYC + NJ, Boston, Chicago, Miami, others
- **URL:** pingpod.com — **Type:** autonomous 24/7 venue chain (contrast case)
- **Model:** unstaffed pods; app-based booking and door access; from ~$20/hr; memberships incl. kids tiers; lessons, group classes, leagues, after-school, parties layered on top.
- **Video:** built-in. A "Replays" feature records table video automatically; the venue platform is PodPlay, which PingPod spun out as its tech arm. This is the only operator in the survey where match video is infrastructure rather than an afterthought.
- **Tech:** modern CMS + native app + Square for gift cards; PodPlay under the hood.
- **Relevance:** demonstrates that automatic capture + replay of every session is a shippable consumer feature; PingPod owns it only inside its own venues. Traditional clubs have nothing equivalent.

## 29. SPiN — NYC (x2), SF, Seattle, Chicago, Boston, Philadelphia, DC, Toronto
- **URL:** wearespin.com — **Type:** social venue chain (contrast case)
- **Model:** hospitality-first — reservations through Toast (a restaurant platform), chef menus, cocktails, corporate events, party packages; explicitly no membership. "SPIN PRO" in-house instructors for events; PingPongParkinson partnership.
- **Video:** a documentary; nothing player-facing.
- **Tech:** WordPress/Elementor + Toast.
- **Relevance:** competitive infrastructure (ratings, results, coaching progression) is absent by design; SPiN treats tables like restaurant covers. Useful boundary marker for what club-facing tooling is NOT.

---

# Cross-cutting observations

## Booking and registration
- Real online booking is the exception: Princeton Pong (Square/Glofox), Lily Yip (Square), Wang Chen (Square tables), HITTA (custom Base44 app), Paddle Palace (10sPortal), PingPod (own app).
- The rest are phone/email/at-the-desk: Westchester, ICC, 888 (store links), Pong Planet, Triangle, Denver, NTTTC, Portland, AGTTA, Samson Dubina (text the owner), Power Pong (call the coach's cell), AITTA (PDF by email).
- No club uses CourtReserve/Mindbody visibly on-site (HITTA has a Mindbody directory listing only). Tools that do appear: Square, Glofox, Wellness Living, 10sPortal/RacquetDesk, Base44, GoDaddy builders, Toast, Stadium TT, Spindex, OmniPong, TTLive.
- Fragmentation at the well-run end: Princeton Pong members juggle four systems; MDTTC pairs Wellness Living with OmniPong; Paddle Palace pairs 10sPortal with RacquetDesk.

## Coaching visibility
- Only Princeton Pong publishes a full roster with photos, bios, and rates. Everywhere else coaches are unnamed (888, ICC, Triangle, Pong Planet, AGTTA), names-only (HITTA), or founder-only (Wang Chen, AITTA, Samson, Power Pong, NTTTC).
- ICC claims 18 coaches and names none; 888 claims a top national training team and names none.

## Pricing
- Shown fully: Westchester, Princeton Pong, Experior (pre-closure), Samson Dubina (in content), Broward (formerly). Partial: HITTA, 888 (camps), AITTA (camps), NTTTC (pickleball only), Paddle Palace (drop-in only). Hidden: MDTTC, ICC, Pong Planet, Triangle, Wang Chen, AGTTA, Denver, Lily Yip.

## Results and league data
- Nobody has a first-party results product. Results live in external tools (Stadium TT, Spindex, OmniPong, TTLive), blog prose (Austin, Experior, AITTA), or nowhere (888, Pong Planet, NTTTC, ICC, Portland, Denver). Paddle Palace's freshest results are 2023.
- Westchester is the only traditional club whose league results are described as live-posted, and the only one that films its (monthly tournament) finals.

## Video
- Traditional clubs with any video: Westchester (YouTube livestreams of monthly finals), Austin (Twitch streams + a bookable Video Coaching service), Samson Dubina (weekly instructional content), AITTA (one embedded video). That's 4 of 27 traditional venues.
- Zero clubs film league nights for members, attach video to results, or offer recorded-match review as a standard paid service (Austin's Video Coaching line is the lone gesture).
- PingPod alone treats per-table recording/replay as infrastructure — and it is proprietary to their venues.

## Web presence fragility
- Dead or broken outright during the study: NYCTTA (HTTP 500), Seattle Pacific (unreachable), Schaumburg (domain for sale), Alameda (DNS gone, club closed), Broward (maintenance page), Texas TTTC (empty shell), Experior (closed, silent since 2024).
- Stale footers/copy: Spartans (©2022), Wang Chen (©2020, "2024 camp"), AGTTA (©2015), NTTTC (©2015–2024), Triangle (2015 assets).
- Facebook is the operational channel for Broward, Seattle Pacific, Schaumburg, Texas TTTC, NYCTTA — roughly one club in five here runs on Facebook with a dead or hollow website behind it.
