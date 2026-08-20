# UK and Ireland table tennis clubs — product-discovery notes

Researched 2026-08-17 via WebSearch/WebFetch (plus curl where TLS or bot walls blocked the fetcher).
Scope note: tournament/event management deliberately out of scope. TTLeagues/TT Clubs usage recorded
per club; a summary of what that platform does and does not cover is at the end.

Method caveats: TT Clubs (`*.ttclubs.co.uk`) and TTLeagues (`*.ttleagues.com`) sites are JS-rendered
shells to a plain fetcher, so their content is described from search snippets and secondary pages.
tabletennisireland.ie and membermojo.co.uk sit behind Cloudflare challenges and could not be read
directly.

---

## England

### 1. BATTS Table Tennis Club — Harlow, Essex
- **URLs:** https://www.battsharlow.com/ (Webflow, "Norman Booth Centre"), https://battstabletennisclub.wixsite.com/batts (Wix), plus https://battsttc.ttclubs.co.uk/ (TT Clubs) and https://harlow.ttleagues.com/club/168
- **Type:** community club with performance history (formed 1994, own centre since 2006, one of the leading clubs in the South East); Jack Petchey Foundation logo suggests grant/charity funding.
- **Offer:** junior coaching, private coaching, club sessions, junior tournaments, "BATTS Super Singles Championship"; the centre also sells pickleball, badminton and party bookings (venue diversification to pay the bills).
- **Payments/booking:** custom "Booking Buddy" system on the Webflow site; **bank details listed on the page for direct payment** — no card checkout. Membership/fees page on the Wix site has no online join flow; contact is phone/email.
- **Leagues/results:** Harlow TT League on TTLeagues; British Clubs League affiliation.
- **Tech:** THREE overlapping sites (Webflow + Wix + TT Clubs shell), single web-design credit on the Webflow site — classic volunteer/one-person maintenance.
- **Video:** YouTube branding/links prominent on the Webflow site; no analysis offer.
- **Pain signals:** fragmented identity across three sites; bank-transfer payments; news lives in downloadable PDFs on the Wix site.

### 2. London Progress TTC — London (historical)
- **URL:** none live; history via http://sportingpolemics.co.uk/ping-london-from-london-progress-to-london-ping/
- **Type:** was Britain's most successful club (ten consecutive British League Premiership titles); trained at Willesden, Stonebridge Park, then Southall.
- **Status:** effectively defunct (~2014, around the emergence of Ping London). Decline story: shifted from community club to elite-at-all-costs, imported professional players, juniors couldn't break into the top team and drifted away.
- **Discovery relevance:** cautionary structural tale — no digital footprint remains; the seed club no longer exists as an operating entity. "Urban Progress TTC" in Barnet council's directory appears to be a separate/descendant entity.

### 3. Morpeth TTC — Bethnal Green, London (Tower Hamlets)
- **URL:** http://www.morpethttc.co.uk/ (hand-rolled static HTML; Windows backslash asset paths; some paths fall through to an IONOS/Sedo domain-parking page)
- **Type:** community/performance club based at Morpeth School, E2 (free Saturday membership with school ID).
- **Offer:** member-only sessions 6 nights + Saturday; Monday junior coaching 18:00–19:30 and adult coaching 19:30–21:30; "Mini Morpeth" Saturdays; adult 6-week beginner block £60.
- **Membership:** Adult £200, U18 £110, U15 £95, family £200; day visitor £10 booked **48h in advance by email**. Season runs Sep–Aug.
- **Payments/booking:** email only (info@MorpethTTC.co.uk) for everything — no online payment, no booking system, no member login.
- **Leagues/results:** "MTTC team results" page; club plays in Central London league (listed on centrallondon.ttleagues.com). Also has a TT Clubs shell (morpethttc.ttclubs.co.uk) that renders empty to non-JS clients.
- **Video:** none. Blog contains three posts: how to put the net on, put the table up, put the table down.
- **Pain signals:** heavy — visitor page says "no visitors allowed at the moment"; parked-domain fallbacks; email-only workflow; a "blog" that is really venue instructions. Strong volunteer-run signature.

### 4. Ormesby TTC — Middlesbrough
- **URL:** https://ormesbytabletennisclub.org.uk/ (WordPress)
- **Type:** performance club with deep history (founded 1957; 15-table dedicated facility; British Premier League senior champions 2025-26).
- **Offer:** very full schedule — 50+ morning sessions 3x/week, junior sessions 5 evenings/week, "Pathway Development" sessions, "Top Squad" 4 evenings/week, disability and Parkinson's sessions, beginner coaching, open practice; fitness suite (£5 induction, £12/month).
- **Payments/booking:** none online — contact is two named volunteers' mobile numbers. No prices for sessions/membership on the site.
- **Leagues/results:** Middlesbrough/Cleveland league on tabletennis365; British Clubs League junior and senior results reported as news posts.
- **News:** actively maintained (July 2026 tournament reports; Jose Ransome memorial crowdfunding campaign for a women & girls programme, May 2026).
- **Video:** British Premier League coverage "on TTE TV" with a YouTube link — i.e. video exists only when the national body films them.
- **Pain signals:** phone-two-volunteers booking; no visible pricing; fundraising via crowdfunder; results live off-site.

### 5. Urban TTC — Barnet, North London
- **URL:** https://www.urbantabletennis.com/ (custom site, /en/ paths)
- **Type:** performance club / coaching business (founded 2002; TTE Talent Development Centre 2015; Centre of Excellence 2017; produced England internationals incl. Denise Payet, Commonwealth Games bronze).
- **Offer:** school clubs (breakfast/lunch/after-school across north London + Herts), GCSE PE delivery, holiday camps, weekend coaching, personal training, Junior Masterclass, U11 squads, players pathway.
- **Payments/booking:** email enquiries; no visible booking/membership platform.
- **Leagues/results:** British Premier League team (head coach Gergely Urban).
- **Video:** **UTTC-TV** section — they film/livestream their own British League fixtures and training content. But the freshest references found are 2018 fixtures; the section looks abandoned.
- **Pain signals:** content stale in places; no online commerce despite being effectively a coaching business; video effort started then stalled — evidence of appetite for match video without a sustainable pipeline.

### 6. Fusion TTC — Rotherhithe/South Bermondsey, London SE16
- **URL:** https://fusionttc.co.uk/ (WordPress) + https://fusionttc.ttclubs.co.uk/ (TT Clubs: memberships, venue, league pages)
- **Type:** community club with performance layer; volunteer executive committee explicitly mentioned; Donic-sponsored; 14 tables full-time.
- **Offer:** social play, league nights, open sessions, coaching, junior camps (Easter/Spring/Summer); junior/cadet British Clubs League squads with "rising stars" news.
- **Payments/booking:** player login + table booking + membership tiers **via the TT Clubs platform**; one of the clearer online-payment setups seen.
- **Leagues/results:** British Clubs League; Central London league (club 820); results reported as WordPress news posts rather than a live feed.
- **News:** current (2026 posts).
- **Video:** none found.
- **Pain signals:** two-site split (marketing WordPress + transactional TT Clubs); results as hand-written news posts; contact a personal address (john@) — volunteer-dependent.

### 7. Brighton Table Tennis Club — Brighton
- **URL:** https://brightontabletennisclub.com/ (WordPress; separate shop platform)
- **Type:** charity-backed community club, two venues (Kemptown, Moulsecoomb); Senior British League Premier champions 2023-24 — rare both/and club.
- **Offer:** huge community programme: prisons (High Down, Downview), hospitals, Down's Syndrome Assoc., Grace Eyre, Virtual School for children in care, school partnerships; "AllStars TT" junior programme; own internal "BTTC League".
- **Payments:** "Fees & Direct Debit" page — recurring direct debit exists; join via a form page.
- **Leagues/results:** British League; internal league; no live results hub on-site.
- **News:** active blog/newsletters; 2025-26 activity visible.
- **Video:** a commissioned feature film for Brighton Festival 2024 — storytelling video, not performance video.
- **Pain signals:** **active crowdfunding campaign** for the Moulsecoomb expansion ("match funding x 3") — capital fundraising pressure; scale of social programmes implies admin load far beyond what the site tooling supports.

### 8. Greenhouse Sports — Marylebone, London
- **URL:** https://www.greenhousesports.org/ + Greenhouse Centre page
- **Type:** charity (no. 1098744) using sport + mentoring in high-deprivation schools; the Greenhouse Centre (converted church, Cosway St NW1) is primarily a table tennis venue.
- **Offer:** full-time Coach-Mentors embedded in schools; TT excellence programme at the Centre; school teams (St Edward's, St George's, Marylebone Girls) in TTE competitions; some players competing internationally; Match Play Mondays; community timetable 7 days/week.
- **Payments:** donation-driven (JustGiving, corporate partners, marathon fundraising); programmes free to participants.
- **Tech:** professional charity site; "Greenhouse Connect App" referenced — they already invest in software for engagement.
- **Video:** promo video content; YouTube presence; nothing analytical.
- **Pain signals:** entirely fundraising-financed; impact measurement is their currency (educational outcomes, wellbeing) — a performance product would have to speak that language, not league points.

### 9. Nottingham Sycamore TT Academy — Gedling, Nottingham
- **URLs:** https://sycamoretabletennis.academy/ (**dead — DNS/connection fails**), TTE listing last updated Feb 2022; https://nottinghamsycamorettc.ttclubs.co.uk/; nottingham.ttleagues.com/club/1511
- **Type:** community/performance academy; historically ~12 teams in the Nottingham league, top team long-time Premier champions; Premier Club status.
- **Venue:** Carlton le Willows TT Centre, Wood Lane, Gedling NG4 4AA — the same venue as Nottingham TTC (below); the two appear to have consolidated, with the Sycamore domain left to rot.
- **Pain signals:** own domain dead, TTE directory stale (2022), identity now split between a TT Clubs shell and the Nottingham TTC site. A player searching "Sycamore" today lands on a broken site.

### 10. Nottingham Table Tennis Club — Gedling, Nottingham (discovered)
- **URL:** https://www.nottinghamttc.co.uk/
- **Type:** community/performance club at Carlton le Willows Academy; 12 tables; beginner-to-international range.
- **Offer:** TT Kidz (TTE framework) for 7-11s, junior league opportunities, over-50s groups, coaching at all levels.
- **Payments/booking:** **AdminMyMembers** platform for membership; site reassures "we do not store your bank details".
- **Leagues/results:** Nottingham & District League (TTLeagues) + National Leagues.
- **Video:** none.
- **Pain signals:** membership prices hidden behind platform navigation; news recency unclear.

### 11. Halton TTC — Widnes, Cheshire
- **URLs:** http://www.haltontabletennis.co.uk/ (**dead — connection refused on 80 and 443**); active identity lives on Facebook (HaltonTTC) and X (@HaltonTTC); halton.ttleagues.com is the local league.
- **Type:** performance club — TTE **Talent Development Centre**, home of the North West Pathway Development and Regional centre; based at Halton Stadium since 1999.
- **Offer (from directories/social):** junior evening sessions 6-7pm beginners then intermediate/advanced; teams in Junior British League, British League, National Cadet and National Junior leagues; hosts tournaments; disability sessions listed on Every Body Moves.
- **Payments/booking:** none online; contact is a personal email (k_tonge@sky.com) and phone.
- **Pain signals:** a national-pathway club whose website is dead and whose front door is a personal sky.com address — the strongest "capability without infrastructure" example in this slice.

### 12. St Neots TTC — St Neots, Cambridgeshire
- **URLs:** https://stneotsttc.com/ (WordPress.com) + https://membermojo.co.uk/stneotsttc (membership platform; Cloudflare-blocked to fetchers) + stneotsttc.ttclubs.co.uk
- **Type:** community club with performance history, founded 1944; one of the biggest purpose-built TT centres in the country (9 tables / 36 players); "50 years of coaching the youth of St. Neots"; historically self-financed by community volunteer hours.
- **Offer:** coaching, junior 1-star/2-star tournaments, teams in Bedford + Cambridge leagues (both TTLeagues), summer league, British senior/women's/junior/cadet national leagues.
- **Payments/booking:** membership via **membermojo**; general contact via email/Facebook; no session booking online.
- **News:** site content appears ~2023-vintage; no news feed.
- **Video:** none.
- **Pain signals:** three-way split (WordPress brochure + membermojo + TT Clubs shell); stale brochure site; volunteer-financed history.

### 13. Kingfisher TTC — Woodley, Reading
- **URLs:** https://www.kingfishertabletennisclub.com/ (Webflow) + legacy https://clubspark.net/KingfisherTableTennisClub/ + separate kingfishertabletennisacademy.com
- **Type:** performance club; purpose-built full-time facility; TTE PremierClub 4-star, Clubmark.
- **Offer:** group coaching, training camps, junior programme 6 days/week + holiday camps, led by Ajay Naik; selective intake pitch — "seeking young players aged 6-10 who aspire to be highly ranked"; National Cadet/Junior League + Junior British League teams.
- **Payments/booking:** mid-migration — "renewals and new members ALL handled via **CoachA**" (coacha.co.uk), table diary also on CoachA; previously ClubSpark. A named Bookings Secretary handles queries.
- **Leagues/results:** Reading & District and Bracknell/Wokingham leagues on tabletennis365 — results off-site.
- **Video:** none mentioned anywhere, including in the elite junior offer.
- **Pain signals:** platform churn (ClubSpark → CoachA) with a stranded legacy site; club/academy brand split across domains; no standard-assessment info for prospective players.

### 14. Woodfield TTC — Penn, Wolverhampton
- **URL:** https://www.woodfieldtabletennis.co.uk/ (WordPress) inside Woodfield Social & Sports Club (woodfieldssc.co.uk)
- **Type:** community club ("Wolverhampton's leading table tennis club"), section of a multi-sport social club.
- **Offer:** league, tournament and casual play all ages/abilities; coaching implied but not detailed.
- **Payments/booking:** members book tables via a dedicated system at **woodfield.bkng.uk** (login required); no payment info public.
- **Leagues/results:** Wolverhampton & District TTA — league lives on tabletennis365 AND wolverhamptondistrict.ttleagues.com (the league is mid-platform-migration itself).
- **News:** **last update August 2021** — five years stale.
- **Video:** YouTube channel linked in footer; volunteer photographer's Flickr albums.
- **Pain signals:** long-dead news feed beside a functioning booking system — the operational tool survived, the communication layer didn't.

### 15. Draycott & Long Eaton TTC — Draycott, Derbyshire
- **URLs:** https://www.dlettc.co.uk/ (TT Clubs-hosted — renders as an empty shell without JS); legacy pages on tabletennis365.com/Draycott now 404; council directory still points to a defunct tabletennisderby.co.uk.
- **Type:** community club, registered charity (no. 1099237); "Derbyshire Club of the Year 2010"; serves Derby/Nottingham/Loughborough.
- **Leagues/results:** Derby & District (derbydistrict.ttleagues.com) and Nottingham league.
- **Pain signals:** the club's public information trail is a chain of dead links (TT365 pages 404, directory URL defunct) ending at a JS shell; charity status implies grant/fundraising dependence. Whatever membership/coaching detail exists is invisible to search engines and plain fetchers.

### 16. Colebridge TTC — Birmingham/Solihull
- **URL:** https://www.colebridge.uk/ (WordPress + custom members' portal)
- **Type:** community club, part of Colebridge Young People's Club (**charity no. 523003**); Birmingham & Solihull's only dedicated single-use TT venue.
- **Offer:** open sessions (incl. Tuesday afternoons over-50s/invitational), junior coaching with a named Youth Leader & Coaching Officer; schools teams, county championships involvement.
- **Payments/booking:** join/renew via its own membership portal; members book extra table time through the portal login.
- **Leagues/results:** Birmingham league (birminghamdistrict.ttleagues.com) + B&SDTTA links; results off-site.
- **News:** actively maintained (June–July 2026: AGM, presentation evening).
- **Video:** none.
- **Pain signals:** easyfundraising partnership + charity umbrella = fundraising posture; committee/volunteer governance; results scattered.

### 17. Cippenham TTC — Slough, Berkshire (discovered)
- **URL:** https://www.cippenhamttc.co.uk/ (Wix)
- **Type:** community/performance club, founded 1973, purpose-built centre since 1996, 200+ members up to top national ranking.
- **Offer:** Monday beginners' junior coaching, Wednesday advanced + elite groups (term time), open practice Tue/Thu year-round; cadet/junior/youth British Clubs League tiers plus Maidenhead and Slough leagues (Trojans: eighth consecutive Maidenhead title, April 2026).
- **Payments/booking:** membership form + payment page on the Wix site (league fees and memberships payable online); tournament entry forms hosted online.
- **News:** actively maintained through August 2026, including AGM docs and an "annual clean of premises" volunteer day.
- **Video:** none; Flickr photo albums.
- **Pain signals:** volunteer-run governance (welfare officer, committee posts as news); results split across three leagues on two platforms.

### 18. Milton Keynes TTC — Milton Keynes (discovered)
- **URLs:** https://miltonkeynesttc.ttclubs.co.uk/ (TT Clubs shell); club listing on https://www.mkttl.co.uk/clubs/milton-keynes
- **Type:** community club, one of ~14 in the MK league.
- **Leagues/results:** MKTTL runs a **custom league site** (mkttl.co.uk — not TTLeagues): results by team/division/venue, eight divisions + Premier, singles/doubles averages, archives back to 2016-17, loan player tracking, rearranged/cancelled match reports. One of the richest volunteer-built league stats sites seen.
- **Pain signals:** the club itself has no real site — its public face is the league's stats engine plus a TT Clubs shell. Standards data exists (averages) but only inside the league silo.

### 19. Wensum TTC — Norwich (discovered)
- **URLs:** wensumttc.co.uk (**dead — DNS does not resolve**); active identity on Facebook (wensumttc); wensumttcttc.ttclubs.co.uk shell; Norwich league on norwich.ttleagues.com.
- **Type:** community club at Catton Grove Primary School; junior coaching for U18s; sessions 4 nights/week, beginner to advanced.
- **Contact:** a named volunteer's mobile number in council directories.
- **Pain signals:** dead domain, mobile-number front door, Facebook as the only living channel — small-club end of the spectrum.

### 20. Highbury TT Club — North London (discovered)
- **URL:** https://www.highburyttclub.co.uk/ (Wix)
- **Type:** community club across three venues (Bridge Academy E2, Finsbury Leisure Centre EC1, Islington Chinese Association N19).
- **Offer:** drop-in sessions 4 days/week; 1-2-1 coaching and workshops at member discount; Head Coach TTE L3.
- **Membership:** Social membership £120 for 13 months (2026-27); member rates on sessions/coaching.
- **Payments/booking:** Wix events with per-session "Book Session" buttons — functioning online booking.
- **Video/social:** TikTok, Facebook, Instagram, YouTube presence; three corporate sponsors; no analysis offer.
- **Pain signals:** no junior pathway or league/results content; venue-hire dependence (school/leisure-centre halls).

### 21. Moberly TTC — Hammersmith, London (discovered)
- **URL:** https://www.moberlyttc.com/
- **Type:** professionally-run community club (manager, head coach, adviser) at Charing Cross Sports Club.
- **Offer:** 1-2-1 coaching, kids and adult groups, camps, local and national league play.
- **Payments/booking:** own booking button + membership portal; prices not public.
- **News:** latest posts dated **October 2016** — a decade stale; yet current operational notices (2026 closures) exist, so the club is alive but the news layer is abandoned.
- **Video:** one embedded YouTube video.
- **Pain signals:** decade-old news beside live closure notices; standards information absent.

## Scotland

### 22. Drumchapel TTC — Glasgow
- **URLs:** https://drumchapeltabletennisclub.com/ (blocks non-browser clients — Cloudflare 1001/409); charity record https://www.oscr.org.uk/... SC047351; West of Scotland league at tabletennis365.com/WestofScotland/Club/700/Drumchapel
- **Type:** charity-backed community/performance club (SCIO "Drumchapel Table Tennis Development Scheme", registered 2017). Established 1989 at Drumchapel Sports Centre; 500+ members playing weekly, 16 sessions over 6 days; beginners to internationals; Scottish National League champions and 2x British National League winners.
- **Finances:** FY2025 income £52,448 / spend £52,797; **0 full-time staff**, 1-50 volunteers — a 500-member club run on ~£52k and volunteer labour.
- **Leagues/results:** West of Scotland league on tabletennis365 (Scotland is a TT365 territory, not TTLeagues).
- **Video/social:** active X/Instagram/Facebook; no video/analysis found.
- **Pain signals:** zero staff at 500 members; site inaccessible to non-browser agents (and any integration); results off-site on TT365.

### 23. North Ayrshire TTC — Saltcoats/Ardrossan/Stevenston, Ayrshire
- **URL:** https://northayrshirettc.co.uk/ (WordPress, professionally designed) + northayrshirettc.ttclubs.co.uk shell
- **Type:** community/performance club, founded 2002, 150+ members, 10x (Scottish) National League champions; sessions 5 days/week across multiple venues.
- **Offer:** classes for all ages/abilities; drop-in culture — "no need to book, just turn up"; produces schools internationalists (named juniors in news).
- **Payments/booking:** a member login/registration exists; otherwise phone/email; no visible online payments.
- **Leagues/results:** Ayrshire League, six club teams across three divisions; results referenced in news, no live feed.
- **Video:** YouTube channel + photo/video galleries on-site — one of the few clubs with a video habit.
- **News:** active (July 2026 items).
- **Pain signals:** results as prose news; no pricing online; multiple rented venues.

## Northern Ireland

### 24. Ormeau TTC — Belfast
- **URL:** https://www.ormeautabletennis.com/ + club app at ormeautt.com
- **Type:** performance/community club, founded 2013 by Keith & Gervis Knox (BBC Unsung Hero 2018); British League Premier Division champions 2022-23.
- **Offer:** structured pathway — foundation classes → intermediate squads → elite coaching; Easter/Summer camps; "Little Wing Junior League" in-house junior competition; produced Sophie Earley (2x European youth medallist) and Peadar Sheridan (European U13 no.1).
- **Payments/booking:** "register interest" forms; **sessions carry waiting lists** ("high demand"); a dedicated **club app** for members — unusual tech investment.
- **Leagues/results:** British League; Ulster league results not surfaced on-site.
- **Video:** own YouTube channel (@ormeautabletennis4445).
- **Pain signals:** waitlists = capacity constraint; news effectively one 2022-23 story — site updates lag the club's actual activity; contact still a live.co.uk address.

## Republic of Ireland

### 25. Loop Table Tennis Club — Raheny, Dublin
- **URL:** https://looptabletennis.com/ (WordPress)
- **Type:** performance-leaning community club founded 2015 by Na Ning (former Chinese professional); "Club of the Year 2022"; juniors on Irish national teams; members competing in European leagues.
- **Offer:** junior classes at three levels, adult classes, 1-2-1 coaching, open play; weekday evening and weekend slots.
- **Payments/booking:** own /online-booking/ flow — genuine online booking; fees on a separate page.
- **Leagues/results:** none surfaced on-site.
- **Video:** none.
- **Pain signals:** results/standards invisible; founder-led operation.

### 26. TT Valley (Table Tennis Valley) — Lucan, Dublin
- **URLs:** https://www.ttvalley.com/ (Wix; the older tabletennisvalley.com no longer resolves)
- **Type:** community club, ex-Club Donic (2006), at Griffeen Valley Educate Together NS; juniors historically, adults admitted from 2023; players have represented Leinster and Ireland.
- **Payments/booking:** phone + gmail address + contact form; no platform.
- **News:** most recent substantive item is the Feb 2022 reopening — stale.
- **Video:** none.
- **Pain signals:** dead old domain; gmail/phone front door; school-hall venue; no session/pricing detail online.

### 27. Leeside Table Tennis — Cork City
- **URL:** https://leesidetabletennis.wixsite.com/home (free Wix subdomain)
- **Type:** community club; 5 sessions/week; school, provincial and national level coaching claimed; Special Olympics Ireland Games 2026 mention.
- **Membership:** three tiers (6-month full, 6-month one-night, pay-as-you-go) — **no prices and no booking/contact mechanism visible on the site**.
- **Video:** none.
- **Pain signals:** free-tier Wix subdomain; no prices, no join flow; undated news.

### 28. Beech Hill TTC — Ballincollig, Cork
- **URL:** https://www.beechhilltabletennis.com/ (WordPress)
- **Type:** inclusive community club — mainstream, Paralympic and Special Olympics players integrated; parish community hall venue.
- **Offer:** Monday juniors 19:00-20:30 then adults; Wednesday evenings; rankings/events/news sections.
- **Payments/booking:** two members' mobile numbers + gmail; no online anything.
- **News:** June 2021 achievements; an October 2024 video advert — sporadic.
- **Pain signals:** phone-and-gmail operation; stale news; membership costs unpublished.

---

## TTLeagues / TT Clubs (Table Tennis England platform) — what it covers and what it doesn't

**Covers (observed across Harlow, Halton, Nottingham, Norwich, Derby, Birmingham, Cambridge, Bedford, Central London, Wolverhampton leagues and the ttclubs.co.uk club shells):**
- League administration: fixtures, divisions, team pages, results entry, tables, player averages.
- A club mini-site shell (sessions list, memberships, venue, bookings) — Fusion is the best example of a club actually transacting through it (login, table booking, membership tiers).
- Membership purchase where the club opts in (e.g. fusionttc.ttclubs.co.uk/memberships, stneotsttc.ttclubs.co.uk/sessions).

**Does NOT cover:**
- Anything video: no match filming, no clips, no analysis, no link between a league result and any footage.
- Coaching delivery and player development: pathways, squad records, session content, coach-player feedback all live off-platform (paper, WhatsApp, or nowhere).
- Playing-standard assessment for newcomers: averages exist per league silo, but nothing tells a visiting player what "Division 2 in Halton" means, and club sites don't try.
- Communications/news: clubs still run a separate WordPress/Wix/Webflow site for identity, so nearly every TTLeagues club has a two-site (often three-site) split with duplicated, diverging information.
- Scotland and Ireland entirely: Scotland's leagues run on tabletennis365 (TT365), Ireland on custom/Wix sites — TTLeagues is an England platform.
- Payments beyond membership/league fees where adopted; many clubs on it still take bank transfer or cash for coaching.

## Cross-club patterns (full list)

1. **Fragmented web presence** — brochure site + membership platform + TT Clubs shell + league site + Facebook, each partially stale: BATTS (3 sites), St Neots (3), Kingfisher (3 incl. academy domain), Sycamore/Nottingham (dead domain + shell + new site), Draycott (all links dead but the shell).
2. **Dead or decade-stale sites at real clubs** — Halton (TDC with a dead site), Wensum (dead DNS), Woodfield (news frozen 2021), Moberly (news frozen 2016), TT Valley (2022), Morpeth (parked paths), Sycamore (dead domain).
3. **No online payment/booking; email-phone-bank-transfer workflows** — Morpeth (email-only, 48h notice), BATTS (bank details on page), Ormesby (two volunteers' mobiles), Beech Hill, TT Valley, Halton (personal sky.com address), Leeside (no contact mechanism at all).
4. **Membership-platform fragmentation with churn** — membermojo (St Neots), CoachA after ClubSpark (Kingfisher), AdminMyMembers (Nottingham), custom portal (Colebridge), Wix commerce (Cippenham, Highbury), bkng.uk booking (Woodfield), TT Clubs (Fusion), club app (Ormeau). No two clubs alike.
5. **No way to assess playing standard** — results and averages live in league silos (TT365/TTLeagues/mkttl); club sites carry no level indicators, no footage of what squads look like; newcomers must email and guess.
6. **Video is desired but ad hoc and unsustained** — Urban's UTTC-TV livestreams (stalled ~2018), BATTS/North Ayrshire/Woodfield/Ormeau YouTube channels, Ormesby only filmed when TTE TV shows up, Brighton's festival film. Zero clubs advertise video analysis within coaching — including the elite junior programmes (Kingfisher, Ormeau, Halton, Urban).
7. **Waitlists and selective intake at performance clubs** — Ormeau (explicit waiting lists), Kingfisher (recruiting 6-10-year-olds only for the pathway) — demand exceeds coach capacity.
8. **Charity/fundraising financing** — Brighton (capital crowdfunder), Ormesby (memorial crowdfund for a W&G programme), Colebridge (charity + easyfundraising), Draycott (charity), Drumchapel (SCIO, £52k income, zero staff), Greenhouse (fully donor-funded), BATTS (Jack Petchey). Money for software must displace something.
9. **Volunteer-run signatures everywhere** — named individuals' mobile numbers as the club front door (Ormesby, Wensum, Beech Hill), personal email domains (Halton sky.com, Fusion john@, Ormeau live.co.uk), one-person web credits (BATTS), premises-cleaning volunteer days (Cippenham).
