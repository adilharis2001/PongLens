# Continental European table tennis club websites — product-discovery notes

Researched 2026-08-17. 29 clubs across DE (10), FR (6), SE (3), NL (4), ES (2), DK/BE/AT/CH (4).
Method: WebFetch of each homepage plus 1–2 key pages; searches to locate official sites.
All content paraphrased. "Partial" = site blocked bots or would not render; noted as a tech
observation and filled from search results only.

Scope note: tournament/event management deliberately ignored. For Germany, click-TT /
myTischtennis observations are collected at the end.

---

## Germany (10)

### 1. Borussia Düsseldorf — Düsseldorf, DE
- URL: https://www.borussia-duesseldorf.com/ — type: professional club (record champion, TTBL)
- Offers: pro roster with profiles (Fan Zhendong, Dang Qiu, Källberg...), coaching staff (Danny Heister), TTBL schedule/standings, amateur + para sections with training times, holiday kids camps, birthday packages, school projects, tickets via Reservix, fan shop, on-site Sporthotel with its own booking engine (Guestline).
- Second property: andro TT-Schule (tt-schule.borussia-duesseldorf.com) — 50+ residential courses/year for club players of any level, personal training, lodging+meals under one roof, 30,000 participants since 1994, 60% repeat rate. Booking via course-schedule pages. DE/EN. **No video analysis mentioned anywhere in the training offer.**
- Tech: TYPO3; DE + EN; ticketing and hotel are third-party platforms. No member area, no PDF forms seen.
- Freshness: news through 17.08.2026 — very current.
- Video: no livestream section on own site (TTBL broadcasts live elsewhere, e.g. Dyn); no analysis offering.
- Pain signals: even the best-resourced club in Europe keeps training a text page and outsources every transaction; its famous TT school sells hours of coaching with no video/analysis component.

### 2. TTF Liebherr Ochsenhausen — Ochsenhausen, DE
- URL: https://ttfo.de/ — type: professional club (TTBL)
- Offers: news, matches, roster, tickets, merch shop (external smshrs.com), PDF magazine, "Amateure" section for the local/youth side, jobs, partners (Liebherr + 8 platinum sponsors), 70-year anniversary section.
- Tech: WordPress; German only.
- Freshness: August 2026 articles — current.
- Video: YouTube/Instagram links; no livestreams on site.
- Pain signals: no membership fees, no coaching-staff page, no training times, no click-TT integration visible — the amateur half of the club is a thin annex to the pro marketing site. A newcomer cannot tell what training would cost or who teaches it.

### 3. 1. FC Saarbrücken-Tischtennis — Saarbrücken, DE
- URL: https://fcs-tischtennis.de/ — type: professional club (TTBL champions 2020)
- Offers: TTBL news/squad/schedule, tickets via Reservix, volunteer + mascot-child programs, Breitensport across three venues (mentioned but no schedules on the homepage), bylaws + safeguarding policy, fan prediction game, away-travel coordination, merch.
- Video: club documentary series "Blau & Schwarz" hosted on the DYN streaming platform — pro-level storytelling, nothing for the amateur side.
- Tech: WordPress; German, plus a dedicated Chinese-inquiry email address (china@fcs-tischtennis.de).
- Freshness: current into August 2026.
- Pain signals: Breitensport exists as a paragraph, not a product; training times require contacting the club.

### 4. TTC Neu-Ulm — Neu-Ulm, DE
- URL: https://www.ttcnu.de/ — type: former professional club (TTBL; dissolved Dec 2024)
- **Finding: the domain has lapsed and now serves a German-language online-casino comparison site.** No trace of the club remains at its own URL. Wikipedia + click-TT confirm the dissolution.
- Pain signal (archetype): when a club dies, its entire digital record dies with it — history, results context and any media only survive on federation portals and Wikipedia. Nothing the club built was durable.

### 5. TTC Berlin Eastside — Berlin, DE
- URL: https://www.ttc-berlin-eastside.de/ — type: professional women's club (Bundesliga, Champions League) + community Verein
- Offers: 1. Damen team pages, Champions League info, full teams directory, youth section with training tips, "Systemtraining" adult course products (Basics & Technik / Taktik & System under a B-licence coach), health-sport courses (7 EUR/h), membership page, trial-training form, documents section, sponsors, video archive. Own modern hall (Paul-Heyse-Str.), daily training Mon–Fri (youth 16:00–18:30, adults 18:30–21:30, seniors Mon 15:00–18:00).
- Results: league data via click-TT; tickets via vr-ticket.de; membership via vereinsplaner.com forms.
- **Video: YouTube livestreams of home matches, match replays with chapter markers, ETTU feeds — the closest thing in this corpus to a chaptered match player, done by hand on YouTube.**
- Tech: mix of an older CMS (page titles still say "Ihr Unternehmen" — an unconfigured template artifact) + vereinsplaner integration; German only. Membership deep link 404'd during research.
- Freshness: current (WTT Feeder Berlin, 19–23 Aug 2026).
- Pain signals: template boilerplate in page titles; broken membership URL; everything transactional lives on three different third-party platforms.

### 6. Post-SV München (Tischtennis-Abteilung) — Munich, DE
- URL: https://www.psv-muenchen.de/de/sportarten/sportangebote-abteilungen/tischtennis/ — type: department of a large multi-sport Verein (dept. founded 1936)
- Offers: 5 men's teams, 6 youth teams, girls team "when enough candidates"; Trainingszeiten page; membership via the parent club's fee calculator and forms; youth-trainer team page; news column ("frisch vom Tisch").
- Tech: parent-club CMS; German only; PDF downloads section; online booking exists for tennis but not table tennis.
- Pain signals: the department is a sub-page of a big Verein site; contact person is a named individual with an email; no department-level fees; results live on club team pages/click-TT. A newcomer must email Peter Späth to learn anything concrete.

### 7. TTC 1992 München — Munich, DE
- URL: https://www.ttc1992muenchen.de/ — type: small dedicated Verein with its own hall
- Offers: hall hours (Tue/Thu 17–22, Sat 10–20, Sun 9:30–13:30), youth training 3×/week, fees published (adults 30 EUR/quarter, youth 15, hobby 20), 6 men's + 4 youth teams, standings embedded via myTischtennis links, contact-form membership ("we reply to confirm"), self-directed quarterly payments.
- Tech: WordPress; German with an English welcome note; no member portal, no booking, no online payment, no PDF forms.
- Freshness: active (May 2026 posts).
- Video: none. Sponsors: none shown. "Trainers actively sought."
- Pain signals: joining = write a form and wait; paying = remember to transfer money yourself; the club openly advertises that it lacks youth trainers.

### 8. 1. TTC Köln — Cologne, DE
- URL: https://ttckoeln.de/ (training: /training/) — type: medium Verein (5 men's, 2 women's, 4 boys' teams)
- Offers: training times per group (men Mon–Fri evenings, youth Tue–Fri afternoons, hobby Mon/Wed with one instructor-led session, women Thu + Sat), two school halls, Mini-Meisterschaften with QR registration, myTischtennis logo linking results.
- **Capacity exhausted: the club states it currently cannot take members; applicants join a waitlist and get invited to screening training in order.**
- Tech: WordPress; German (Kölsch greeting); Instagram; no fees, no coach names, no member portal, no PDF, no video.
- Pain signals: demand exceeds supply and the site's only tool for it is a waitlist paragraph; no way to judge level except league names.

### 9. ETV Hamburg (Tischtennis) — Hamburg, DE
- URL: https://www.etv-hamburg.de/de/sportangebot/sportangebote-und-abteilungen/tischtennis/ — type: department of a very large multi-sport Verein (~180 TT members)
- Offers: full range "highest Hamburg league to guided hobby groups"; PingPong-Parkinson program 3×/week; contact persons; training schedule page; event calendar.
- **Youth enrollment frozen due to demand** — inquiries go to a named volunteer's mobile number.
- Tech: modern parent-club site with accessibility tools; member portal via Clubity (course registration + membership); German only.
- Freshness: last dept. news December 2025 — semi-stale.
- Pain signals: youth waitlist managed over a personal phone number; the department's identity is buried in a corporate multi-sport site.

### 10. HSV Tischtennis — Hamburg (Eppendorf), DE
- URL: https://tischtennis.hsv.de/home — type: department of a famous pro football club; amateur level
- Offers: training page, web membership form, youth section; section head and youth coordinator listed with personal emails/mobiles; links out to DTTB and the Hamburg federation for anything competitive.
- Tech: standard CMS; members-only internal area; German only.
- Freshness: **no dated news at all** — impossible to tell if the club is alive from the site.
- Pain signals: personal freenet/web.de emails as the official contact path; undated content; competitive life fully outsourced to federation portals.

---

## France (6)

### 11. Levallois Sporting Club TT — Levallois-Perret (Paris), FR
- URL: https://levallois-sporting-club.com/tennis-de-table/ — type: professional club (17 French titles) + huge community section, 22-table dedicated hall
- **The FFTT directory still points to tennisdetable.levallois-sporting-club.fr, which no longer resolves (DNS dead).** The live info sits on the parent club's WordPress page.
- Offers: rich schedule Mon–Fri 12:00–22:30 + Sat morning; Baby-Ping (3–4y), Mini-Pong (5–6y), youth, adult leisure/competition tracks, Sport Santé sessions (Parkinson's, Alzheimer's, cancer recovery); full published price grid 125–410 EUR/yr incl. FFTT licence, resident vs non-resident rates; board members named but **no coaches named**; downloadable PDF medical questionnaires; LSC "mysportroom" platform for scheduling.
- No league results, no FFTT SPID links, no news dates, no streams, no sponsors on the section page. French only.
- Pain signals: dead official subdomain still referenced by the federation; a top-3 French club whose public page cannot name a single coach.

### 12. Garde du Vœu Hennebont TT — Hennebont (Brittany), FR
- URL: https://www.gvhtt.com/ + https://pingcenter-gvhtt.com/en — type: professional club (Pro A, vice-champion 2025) + residential academy/training center
- Offers: Pro A roster (Simon Gauzy etc.); Ping Center: year-round camps one week to a month+, academy for school grades 6–12 with daily coaching, adaptive sport, 3,500 m² venue with 1,000 seats, accommodation for international trainees since 2023; e-commerce booking with 5% prepay discount or 20% deposit, gift vouchers; English site version.
- Missing on both sites: membership fees for the local club, coach bios, results links, news dates, streams. **No video analysis mentioned in a paid residential training product.**
- Pain signals: the commercial camp business is far more webified than the member club; the club side has no visible onboarding at all.

### 13. C'Chartres TT (ex Chartres ASTT) — Chartres, FR
- URL: https://www.cchartrestt.com/ — type: professional club (Pro A, ETTU Cup winner 2011)
- **The official site is frozen: a notice says it is no longer updated after a technical incident and redirects visitors elsewhere.** The city's own site is now the more reliable source about the team.
- Tech: Wix. French only. Nothing else retrievable — no training, membership, video.
- Pain signals: a Pro A club has effectively no working website; its digital presence collapsed to a Wix placeholder and municipal pages.

### 14. ASUL Lyon 8 Tennis de Table — Lyon, FR
- URL: https://www.asul8tt.com/ — type: large club (13 FFTT labels)
- Offers: programs by age (4–7, 8–17, adult leisure, adult competition, handisport/adapted); 2026–27 planning + price grid documents; separate re-registration vs new-registration flows; payment via PayAsso; discovery tournaments for trial; photo/video albums; 22+ partners incl. Crédit Mutuel, andro; mobile app.
- Results: sections for team championship and "player progression" exist but no FFTT SPID data surfaced; effectively announcements.
- Tech: "sportsregions" club-CMS platform with member login (used to post news); French only.
- Freshness: messy — latest real articles June 2024 next to future-dated 2026 entries; date discrepancies visible.
- Pain signals: no coach names on the homepage; content dating is broken enough to erode trust; "player progression" is a menu item without live data behind it.

### 15. Marseille Tennis de Table — Marseille, FR
- URL: https://marseille-tennis-de-table.com/ — type: medium club (175 members, ~50% youth), self-described top formative club in the city
- Offers: 3 named, credentialed coaches (2× DEJEPS, 1× BPJEPS) — rare in this corpus; two venues (10-table COSEC Curtel); leisure and competitor slots published on a sub-page; 9 senior teams D3–R2; 40 youth criterium teams; school/social-center partnerships; pre-registration + trial session via HelloAsso; press coverage (La Provence, France 3).
- Tech: WordPress; French only; no portal, no streams, no booking; points-calculator and stats sections referenced but thin.
- Freshness: latest post January 2025 on homepage at research time — drifting stale.
- Pain signals: even the best-run community club in the sample manages joining through HelloAsso pre-registration and "we'll call you in late August".

### 16. Tennis de Table de Gerland (Lyon 7) — Lyon, FR
- URL: https://www.ttgerland.fr/ — type: medium club, National 2 men's team
- Offers: online registration for 2026–27 showing rates, slots and remaining places (best onboarding UX in the French sample); multi-activity and summer camps; leisure/retiree/handisport/women's sections; youth circuits; National 2 match reports; 4 institutional sponsors; RSS feeds; Android/iOS app.
- Results: club announcements; no direct FFTT/SPID links visible.
- Tech: sportsregions platform, member login, integrated donations; French only.
- Freshness: current (July 2026).
- Pain signals: no coach names, no video, results as prose rather than data.

---

## Sweden (3)

### 17. Eslövs AI BTK — Eslöv, SE
- URL: https://eaibtk.se/ — type: elite club (14 Swedish men's titles; Pingisligan men + 2 women's teams)
- Offers: Pingisskola 3 evenings/week with loaner rackets; supporter membership 500 SEK incl. free entry to all Pingisligan home matches + refreshments; payment via Swish/Bankgiro; ~40 sponsor logos; partnership folder as PDF.
- Results: **external on Profixio** (direct links for men's and women's tables).
- Tech: WordPress maintained by a named local freelancer; Swedish only.
- Freshness: site static-ish; the live channel is Facebook (posts 1–3 weeks old).
- Video: one YouTube link in a Facebook post; no streaming offer.
- Pain signals: no coach names, no training fees beyond the supporter tier, the real news feed has migrated to Facebook.

### 18. Söderhamns UIF — Söderhamn, SE
- URL: https://www.suif.se/ — type: elite club (7 Swedish titles, Pingisligan; runs a bordtennisgymnasium with the local school)
- Offers: elite group, youth elite group, recreational "PingPongPower" series, seniors, Parkinson table tennis; member login; sponsors Stadium, STIGA, Länsförsäkringar.
- Results: league widget shows last result; otherwise federation/Profixio ecosystems.
- Tech: **built on svenskalag.se**, a free Swedish club-management platform (team pages, member register, billing baked in); Swedish only.
- Freshness: current (Aug 15 posts on camps).
- Pain signals: no visible schedules/fees/coaches on the public side — the platform pushes everything behind member login; "no match booked" placeholder on the elite team page mid-August.

### 19. Ängby SK — Stockholm (Vällingby), SE
- URL: https://www.angby.com/ — type: large club/academy (Waldner's and Appelgren's club; Superettan men, Pingisligan women)
- Offers: Pingisskola across five venues; fall-term registration links; member-only training/competition sections; named young coaches with ETTU certifications in news; summer camp with 180 international players; equipment sales during a venue relocation.
- Results/video: **Swedish federation's YouTube channel for live league matches; Solidsport integration; SVT Play clips** — streaming exists but all at federation/broadcaster level.
- Tech: Wix; Swedish with occasional bilingual headings; sponsors incl. Butterfly Sverige, TTEX.
- Freshness: current-ish (spring 2025+ posts visible).
- Pain signals: fees not public; member content walled; club declined Pingisligan promotion for 2026/27 (cost/logistics story between the lines).

---

## Netherlands (4 — two partial due to bot-blocking)

### 20. TTV Amstelveen — Amstelveen, NL
- URL: https://ttvamstelveen.nl/ — type: small/medium NTTB club
- Offers: precise seasonal schedules (youth Mon/Thu paused until Aug 24/27; seniors 19:45; competition players Mon/Thu 20:00–21:30; 55+ Fri 15:00); two free trial visits; enrollment form; contribution page; named trainer (John Scott) for sign-up training; youth successes reported; six local sponsors; own YouTube channel.
- Results: **"check the NTTB page for latest results"** verbatim posture; tournaments via Toernooi.nl.
- Tech: WordPress + Elementor; Dutch with an English toggle (rare!).
- Freshness: current (Aug 12, 2026).
- Pain signals: results and rankings fully outsourced; video channel exists but is not connected to training.

### 21. NTTC (Nieuwerkerkse TTC) — Nieuwerkerk a/d IJssel (Zuidplas), NL
- URL: https://nttc.nl/ — type: small NTTB club
- Offers: trial sessions ("proefspelen") in the nav; membership = general fee + mandatory NTTB bond contribution + per-season competition surcharge, cancellation only per half-year before fixed dates; **enrollment forms are physical, available at the club's premises**; youth section; club championships.
- Results: partly on own site, plus NTTB league links.
- Tech: unremarkable CMS; Dutch only.
- Freshness: active (spring competition 2026 recap).
- Pain signals: paper enrollment; fee structure explained in prose with the bond's bureaucracy exposed to the newcomer.

### 22. Taverzo — Zoetermeer, NL (partial: site returns HTTP 403 to fetchers)
- URL: https://www.taverzo.nl/ — type: large club (~250 members, founded 1962, own new hall; eredivisie history; added pickleball 2023)
- Tech observed: legacy PHP CMS with `index.php?page=N&sid=N` URLs; aggressive bot-blocking (403 on every page).
- Pain signals: a 250-member club with its own facility runs on a homegrown early-2000s CMS that modern crawlers cannot even read; discoverability suffers (its best descriptions live on municipal directory sites).

### 23. TTV Amsterdam — Amsterdam, NL (partial: JS-only site)
- URL: https://ttvamsterdam.nl/ — type: medium city club (Dutch + English site structure, "/en/memberships/" exists)
- Tech observed: the site ships as a JavaScript app that renders nothing without a browser — fetchers see only the club name. Has NL/EN routes, memberships page, club-philosophy page; part of NTTB RTN-Midden regional training web.
- Pain signals: over-engineered in the opposite direction from Taverzo — invisible to non-JS crawlers/SEO; substance unverifiable without a browser.

---

## Spain (2)

### 24. UCAM Cartagena TM — Cartagena, ES
- URL: https://www.ucamdeportes.com/tenis-de-mesa — type: professional women's club (23 league titles, 4 European Cups), university-owned since 2004
- Offers: history, palmarés, three featured player profiles (Szőcs, Cantero, Xiao), news.
- Missing: training schedules, academy/escuela info, coach list, membership, streams, results links (no RFETM link).
- Tech: Drupal within the university's sports portal; Spanish only; sponsors Nike, Drift Gaming, PCBOX.
- Freshness: news to December 2025 — months stale at research time.
- Pain signals: the club is a brand page inside a university site; a kid in Cartagena wanting to train has no visible path in.

### 25. Girbau Vic TT — Vic (Catalonia), ES
- URL: https://www.victt.com/ — type: elite women's club (Superdivisió, ETTU Cup finalist) + full community club, founded 1978
- Offers: escola with initiation and pre-tecnificació groups; summer casal with dates; teams from Superdivisió down to 4th territorial, veterans, Parkinson program, adults; hosts the 40th Open Internacional Ciutat de Vic with draws/results sections; PDF competition normatives.
- Tech: custom/Drupal-like CMS; **trilingual Catalan/Spanish/English**; sponsors Girbau (title), Movento Stern, CaixaBank.
- Freshness: weekly updates, latest July 2026 — excellent.
- Pain signals: training times and fees not public; no member area; results live with RFETM; no video/streaming.

---

## Denmark / Belgium / Austria / Switzerland (4)

### 26. Roskilde Bordtennis BTK 61 — Roskilde, DK
- URL: https://roskildebordtennis.dk/ — type: elite club (12 Danish titles in 14 years, CL quarterfinals 2019/20) + 285-member community club **with a waiting list**
- Offers: coaches page, training times page, talent development, 11 teams incl. youth leagues; enrollment/withdrawal pages; fees + licence page for 2025–26; **Klubmodul** platform for registration and fee payment; member login; sponsors (Spar Nord, BAUHAUS, Butterfly); Facebook/Instagram/YouTube.
- Results: external on BordtennisPortalen.dk.
- Tech: WordPress (stock Mantra theme); Danish only.
- Freshness: May 2026 (assembly + coach hire) — moderately current.
- Pain signals: waiting list again; the club's competitive data, payment system and video channel are three unconnected silos.

### 27. TTC Sokah Hoboken — Antwerp (Hoboken), BE
- URL: https://www.sokah.be/ — type: elite club (Superdivisie) + large recreational club
- Offers: training, registration (online with user profiles), tariff page, club calendar, B-Criterium tournament (~260 entries), news-rich homepage; ~18 sponsors; YouTube playlist ("MP visuals") of match videos.
- Results: VTTL competition + a separate recreational federation (KAVVV, on tafeltennis.kavvv.be) — two parallel results systems for one club.
- Tech: Joomla; Dutch only.
- Freshness: current (Aug 2026).
- Pain signals: no coach names; fees and training hidden behind menu links with thin content; the club's video exists as an unlabeled YouTube playlist disconnected from teams/matches.

### 28. LINZ AG Froschberg — Linz, AT
- URL: https://www.froschberg.at/ — type: professional women's club (dominant in Austria since 1998) + performance center; umbrella over three legal entities (ASKÖ Froschberg, LZ women's academy, SPG Linz men)
- Offers: performance center with international training partners; named coaches (Vincent Aumoitte arriving, Josef Plachy departing, Attila Bathory, Joo Saehyuk); B-team in 2nd Bundesliga; 25th LINZ AG youth championships (kids from 25 countries); grassroots "Fun & Action" summer program.
- Video/streams: **ORF Sport+ broadcasts league finals; ETTU TV for Europe Cup** — all broadcaster-level; YouTube embeds blocked behind cookie consent.
- Results: reported as prose match recaps on-site; ÖTTV referenced, no live data.
- Tech: **Jimdo** website builder; German; membership info absent; contact page only.
- Freshness: excellent (Aug 2026, recaps within days).
- Pain signals: Austria's flagship club runs on a website builder; three-entity structure is confusing; no path for an ordinary kid/parent beyond a phone number.

### 29. TTC Neuhausen — Neuhausen am Rheinfall, CH
- URL: https://www.ttc-neuhausen.ch/ — type: elite club (STTL men + women) and leading Swiss youth club, founded 1975
- Offers: club-owned hall marketed as available 24/7/365 to members; youth training, Schnupperpass trial, school-sport programs, SwissPing, individual coaching pages; Trainerteam page (names not on homepage); ~20 sponsors; fundraising via fundraiso.ch; hosting Swiss youth championships May 2026.
- Results: links out to STTL/click-tt.ch (Swiss nuLiga instance — same software family as German click-TT).
- Tech: WordPress; German with some English links.
- Freshness: current (July 2026).
- Pain signals: fees not public; the 24/7 hall access — the club's best asset — has no booking/occupancy tooling visible; results outsourced to the Swiss federation portal.

---

## click-TT / myTischtennis: what they cover vs don't (verified on Borussia Düsseldorf's club page)

Cover: club master data (address, halls with route planner, officials), team lists and league
assignments per season, fixtures and results in table form, and — via myTischtennis accounts —
official TTR ratings and player match records. This is the league-operations layer, and every
German club in the sample (plus Switzerland via click-tt.ch) leans on it completely.

Do NOT cover: training times, membership onboarding/payment, fees, coach profiles, youth program
info, club news, any media or video, any statistic beyond team-match results, waitlist/capacity
management, facility booking. Interface is early-2000s server-rendered tables. Everything on the
"not covered" list is exactly what club websites try to provide and mostly fail at — and none of
it overlaps with tournament management.

Parallel federation portals playing the same role elsewhere: FFTT SPID (FR, often not even
linked by clubs), Profixio + svenskalag/IdrottOnline (SE), NTTB + Toernooi.nl (NL), RFETM (ES),
BordtennisPortalen (DK), VTTL + KAVVV (BE), ÖTTV (AT), click-tt.ch/STTL (CH).

---

## Cross-cutting observations for PongLens

1. Club-admin (membership, billing, booking) is already being eaten by country-specific
   platforms: vereinsplaner + Clubity + Klubmodul + svenskalag + sportsregions + mysportroom +
   HelloAsso/PayAsso/Swish. That layer is crowded and localized — poor entry point.
2. The empty layer everywhere is performance and development: no club in 29 shows player
   development over time, match video tied to points/stats, or coach-to-player feedback tooling.
   Even paid residential academies (Borussia TT-Schule, Hennebont Ping Center) never mention
   video analysis in their offer.
3. Where video exists it is broadcast (federation YouTube, ORF, Dyn, ETTU TV, Eastside's own
   hand-chaptered YouTube livestreams) — production for spectators, never analysis for players.
4. Youth demand exceeds coaching supply (waitlists at 1. TTC Köln, ETV Hamburg, Roskilde;
   TTC 1992 München begging for trainers). Tools that make one coach's review time go further
   have a real audience.
5. Club websites decay: dead domains (Neu-Ulm→casino), frozen sites (Chartres), dead subdomains
   (Levallois), undated news (HSV), broken date logic (ASUL Lyon 8). Clubs are bad at owning
   infrastructure; anything sold to clubs must be near-zero-maintenance.
