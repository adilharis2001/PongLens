# Coach Outreach Design

The first space in the marketing hub. A list of table tennis coaches, every
way of reaching each one, and the stage each is at.

## What the evidence changed

Three assumptions went into this and two of them were wrong. The probe that
corrected them ran on 2026-08-12 and cost about thirteen cents.

**Google is not the discovery engine.** Ten Serper queries across five
languages returned 93 results and 16 unique handles, several of them junk:
a lawn tennis coach, a club's post, an account called `@popular`. 17% yield.

**Instagram's own user search is.** One query through Apify's
`instagram-scraper` returned 33 profiles that were essentially all real
table tennis coaches, for nine cents. Roughly $2.60 per thousand coaches,
so cost is not the constraint.

**Instagram does not hand over an email.** Not one profile in 43 exposed a
contact address, including with the paid about-section add-on enabled. Every
address in this pipeline comes from following the link in the bio and, when
that fails, one hop to the site's own contact page. That path converted
5 of 21 links, so roughly 10% of coaches end up with a usable email.

The consequence is the shape of the product: **Instagram DM is the primary
channel and email is the bonus.** A card leads with Message, not Email.

## Data

Four tables in migration 101.

`outreach_coaches` is keyed by Instagram handle, the only identifier every
coach reliably has. Language and country are inferred, by script detection
and stopwords for the first and by link TLD, WhatsApp country code and place
names for the second. Both are for sorting and neither decides anything
irreversible, so a wrong guess costs an eyebrow rather than a row.

`outreach_channels` is separate rather than a column, because a coach has
several, they arrive from different places, and where each came from
matters: an address published on a club's contact page is different footing
for a cold email in Europe than one scraped off a profile. `source` records
which.

`outreach_touches` records what was said, on which channel, in which
direction. Instagram messages are sent by hand and marked here; email is
queued here and drained by the Fastmail worker. One table either way, so a
coach's history reads as one list.

`outreach_runs` logs each agent run with what it found, what it wrote and
what it cost.

Access is the marketing role or the admin, the same gate as the hub, through
`is_marketing()` from migration 100.

## Sending

Mail goes from `adil@ponglens.com` through Fastmail, not Resend. The domain
is not cold: magic links and receipts have been building its reputation for
months, and magic links are the strongest engagement signal there is. What
protects it now is volume discipline and a reviewed message, not a warming
service.

Fastmail is never called from a route handler, which is the rule the support
mailbox already set. The page's send button moves a touch to `queued`; the
launchd agent on the Mac drains the queue over JMAP, whose token already
carries the `submission` capability. Nothing in the web app sends anything.

DMARC went in at `p=none` with Postmark digests on 2026-08-12, to be
tightened to `quarantine` once the reports confirm only Fastmail and Resend
are passing. The root SPF still ends in `?all` and should become `~all` at
the same time.

Instagram DMs are never automated. Meta's penalty for DM automation is the
account, and that account is the asset here: it carries Adil's own match
videos, which is most of why a coach would answer at all.

## Page

`/marketing/coach-outreach`, one card per coach. Name, handle, followers,
country, whether they write in English, why we think they coach, and which
search found them. Then a row of channel buttons: Message and Profile
always, then email, WhatsApp, Telegram, website, YouTube where they exist.
A stage control sits on the right.

Filters narrow by stage, by English, by having an email, and by free text.
"Still open" hides the four resting stages so the list says how much work is
actually live.

One markup at every width rather than a desktop table beside a mobile list,
which keeps this page clear of the dual-layout trap.

## Verification

`npm run test:marketing` covers channel links, follower formatting, channel
ordering and deduplication, the stage list, the filters, the summary, that
both routes run the gate and stay out of the index, and that the list
component sends nothing. Beyond that: lint, a real `npm run build` in a
worktree, and a signed-in pass over the real pipeline at 1280x900 and
393x660.

## Not built yet

- The draft, send and reply agents. Only discovery exists.
- Federation and club directories as a second source, which is where
  published addresses actually live and would lift the email share.
- The launchd schedule and the Run now button. Discovery runs by hand today.
