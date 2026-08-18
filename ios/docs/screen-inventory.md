# Screen inventory — player-facing web app → iOS

Extracted 2026-08-17. Copy strings quoted verbatim — the iOS port reuses them.

## Navigation (mirror exactly)

Tabs in order: Home `/dashboard` (house icon) · Matches `/matches` (film frame w/ play
wedge; owns `/match/*`, deliberately NOT `/upload`) · Journal `/journal` (notebook;
owns `/improve`) · Coaching `/coaching` (whistle) — CONDITIONAL.

Coaching tab gate (any of): coach_profiles row; coach_links coach_id=me accepted;
coach_links player_id=me not revoked; review_orders student_id=me. Cache the answer
(web: sessionStorage "pl-coach-tab") to avoid the tab popping in after first paint.

Mobile: top bar h-14 (logo left; bell + avatar right — avatar pushes Account, cyan
border when on it), bottom bar h-16, 3–4 equal columns, icon 24pt over 10px label,
active = cyan + filled icon. NO upload item in the bar — "the bar holds destinations
only". Upload = FAB on Home + Matches ("Upload" + up arrow); Journal FAB = "New" +
plus. Every nav action checks the upload guard ("Upload in progress…" confirm).

NotificationBell: magenta unread badge ("9+" cap). Panel "Notifications" +
"Mark all read". Empty: "You're all caught up" / "Coach notes and finished matches
land here." Kinds: note, coach_joined, reel_ready (tap downloads), reel_failed,
match_failed, upload_failed, order_* , sample_*, clarification_requested,
review_delivered, followup_received. Poll 60 s.

Onboarding gate: no display name OR no player_profiles row → /onboarding.

app_config gates: commerce_enabled (balances, minutes, process toggle),
coach_reviews_enabled, minute/storage/sponsored packs, support_email.

## /login
Centered max-w-sm, no nav. Logo → card: "Sign in to PongLens" / "Upload a match or
pick up where you left off." Google button + email magic link + "By signing in you
agree to our Terms and Privacy Policy."

## /onboarding
Step name (if none): "What should we call you?" / "We'll use this across PongLens."
placeholder "Alex", "Continue"/"Saving…". Step profile: "How do you play?" —
Handedness (Right-/Left-handed), Grip (Shakehand/Penhold), "Your level" hint "Pick
the highest one that's true." — Beginner "Learning the basic strokes." ·
Intermediate "You rally with spin and control." · Advanced "Strong technique, and
you train regularly." · Club "You play club matches or a local league." · Regional ·
National · International. Button "Done"/"Skip for now"; "You can change any of this
later in Account." Writes player_profiles upsert + user_metadata name. Errors:
"We couldn't save that. Try again." / "We couldn't save your name. Try again."

## /dashboard (Home)
H1 "Hey {firstName} 👋". Sections (each with ArrowLink right):
- Next-action block (priority): loading skeleton → EMPTY: 🏓 "Upload your first
  match" / "PongLens cuts the dead time out of your footage and breaks the match
  into points, so you can review it point by point and add notes for yourself or a
  coach." + "Upload a match" + CameraGuide row → ACTIVE WORK: "Your match is
  processing"/"{n} matches are processing" + "Most videos finish in under 30
  minutes. We'll email you when it's ready." + "Meanwhile: review {title}" →
  CONTINUE card: thumb 80×128, eyebrow/title/meta + chevron. Eyebrows: "Score it" /
  "{n} points to score"; "Keep scoring"; "Continue" / "Scored. Star your best
  points"; "Continue" + date · points + score pill.
- First steps: "First steps", "{done} of {total}", "Hide". 9 rows: Create your
  account (always done) · Upload your first match · Score a game · Star a highlight
  · Add a note to a point · Add what you're working on · Share or export a match ·
  Share a match with your coach · Watch the tutorial videos. Footer "Every step has
  a guide in Learn." Hidden at ≥5 matches, all done, dismissed
  (user_metadata.first_steps_dismissed), or coach-only.
- "Recent matches" (or "Shared with me" when no own matches) + "View all". ≤3 rows:
  thumb, title, status chip if not ready, meta, games pill.
- "Your game" + "My stats". Hidden until 3 fully-scored matches. Form dots (last 10),
  W-L matches, W-L games; ≥20 serve-known: "Serve {pct} / Receive {pct}"; ≥30
  described: one insight sentence.
- "Coaching" + "All matches": amber rows per sharing player "{n} matches shared ·
  latest {date}". Only when viewer also has own matches.
- "Working on" + "Journal": cue chips card → /journal. Hidden with no cues.
- "Latest activity" + "Journal": ≤2 note rows ({author} · {matchTitle} · {timeAgo},
  amber border when not yours) + ≤3 export rows (share + download when ready).
  Quiet fallback: "Notes you add while reviewing a match collect in your Journal."
- "Processed videos ({n})" collapsible legacy section: "Videos processed without a
  point breakdown. Matches keep their download on the match page."
- BalancesCard (commerce).
Poll 10 s + "ponglens:job-created" event. Errors: "Couldn't create a download link.
Try again shortly." / "Couldn't prepare the video. Try again shortly."

## /matches (library)
H1 "Matches" + UploadFab. Search "Search matches" + filter toggle. Filters:
STATUS All·Ready·Not processed·Processing·Failed / TYPE Any type·Drills·Practice·
Match·League·Tournament / SCORE Any score·Scored·Unscored / SORT Recently uploaded·
Match date. Month rail at ≥13 items >1 month ("Aug 25 · 7"). Grid 2–3 cols; cards:
16:9 thumb, status chip top-left when not ready, title, "{secondary} · {n} points",
footer: games pill or dashed "Add score" (ready, unscored, not drills/practice),
note badge (amber + "coach" when coach wrote) → /journal?match=, film glyph when
export ready. Overflow ⋮ (own, non-processing): "Share" (ready only), "Delete
match". RENDER_CAP 24 + "Show {n} more". "Shared with me" section: "Matches players
shared with you. Open one to watch and leave coach notes." + per-player sub-grids.
Empty: 🏓 "No matches yet" / "Upload your first match. When processing finishes it
will appear here, broken into points and ready to review." + "Upload a match".
Filtered: "No matches for \"{q}\" with these filters." Delete modal: "Delete this
match?" → "Checking how much space this frees…" → "This frees {bytes}. Clips,
video, notes, and the scorecard are deleted. This cannot be undone." "Cancel" /
"Delete match"/"Deleting…". Error "Could not delete the match. Try again."
canOpenMatch: ready + uploaded always; processing/failed only when raw_path.
Poll 10 s active / 30 s idle.

## /match/[id]
See behavioral-spec.md (full detail). Uses AppNav directly, full-bleed.

## /upload
UpLink "Matches" (mobile), H1 "Upload" + "How to record" anchor. UploadCard (see
behavioral-spec.md §3), YouTubeImport, CameraGuide, BalancesCard, feedback link —
all hidden while uploading.
YouTubeImport: "Import from YouTube", "Paste a YouTube link", "Checking…", toggles
"Process right away"/"Break it into points"/"Placement maps"/"Cut strictness".
"We're fetching it". Errors: "That doesn't look like a YouTube video link." /
"Couldn't queue the import. Try again." / "We couldn't process this video."
CameraGuide sheet: "Where to place the camera" — "Diagonally behind you, raised a
little" · "The whole table in frame, so the ball lands clearly on both sides" ·
"Neither player blocking the table" + callout "Hold your phone landscape
(sideways). Vertical video still works, but accuracy drops." + "Got it".

## /journal
See behavioral-spec.md §2. H1 "Journal", FAB "New".

## /stats ("My game")
H1 "My game"; tabs "My stats" / "Tactics" (?view=tactics). My stats: heroes
Matches W–L · Games W–L · Points won %. "Winning points" (hint "Across {n} scored
match(es)"): Serve win %, Receive win %, At 9+ in the game, After losing a point,
Games past 10-10, Best run of points ("{n} in a row"), Points won–lost. No-serve
hint: "Set who served first in your matches to split points by serve and receive."
"Results" ("Fully scored matches, most recent first"): form dots + rows + "Show all
{n}". Empty: "Finish scoring a match — every point decided — and its result lands
here." "Opponents" ("Fully scored matches only"). Tactics: "My serves" ("Share of
those points you won · {n} described"), "Against their serves", "Why you lose"
("Only points you lost, across every match" + "Why, in your words").
Loading "Reading your matches…". Empty: "Nothing to count yet." / "Score the points
in your matches and this page builds itself: serve and receive, pressure points,
patterns across every match." + "Go to matches". "No patterns yet." / "Tactics
build from the follow-ups on scored points: how each point ended, the serve's spin
and length, and where the deciding ball went. Answer those on a few matches and the
patterns show up here." Per-section: "No serves of yours described yet. They come
from the serve question on points that turned on the serve." / "Nothing described
on their serves yet. Reading the spin is the skill — describe a few and see which
ones trouble you." / "Say why you lost a point and the pattern shows up here."

## /learn
H1 "Learn", search "Search the guides", "Tutorial videos" row, groups: Get started
(upload-a-video, upload-from-youtube) · Review and score (match-viewer,
score-points, score-keeper, tags) · Your game (match-analysis, stats-over-time,
journal) · Share and export (export, share-a-link, invite-a-coach) · For coaches
(for-coaches). Search empty: "Nothing found for that." / "Try another word, or
browse the guides below. Missing a guide you needed? Tell us through Send feedback
on the Account page."
/learn/[slug]: back "Learn", title, summary, sections (steps, paragraphs, bullets,
screenshots, "Good to know " tips), "Keep going" related cards.
/learn/videos: AppNav direct, full-bleed player. Chapters: home "Start here" ·
upload "Upload a match" · viewer "Watch it back" · point "Score a point" ·
keepscore "Score Keeper" · analysis "Read your match" · export "Export and share" ·
coach "You and your coach" · journal "The journal". Via /api/tutorial-url. First
play sets user_metadata.tutorial_started.

## /account
H1 "Account". Order: identity card (avatar 48, editable name, email) → Admin/QA
rows (conditional) → "Your game" group: "My stats" · "Tactics" · "Player profile" ·
Recollect toggle ("Bring useful guidance from lessons and practice notes back at
the right time."; error "Couldn't save that change. Try again.") →
ShareLinksSection ("This match"/"Starred points"/"Tagged points", "Manage",
"Copy link"/"Copied", "Revoke"/"Revoking…", "Revoke all"; error "Couldn't revoke.
Try again.") → "Processing minutes" #minutes (commerce): "Reading balance…" → "You
have {n} minutes." + explainer "Processing is what turns a video into a match: the
dead time cut out, every point its own clip. One minute of footage uses one minute
from your balance, and trimming off the warm-up first uses fewer." + PackTiles +
history; error "Checkout did not open. Try again." → "Storage" #storage: "Reading
usage…" → "{used} of {limit} GB used" + bar + "Storage is full. Your videos stay
put; delete some or add space to upload more." + explainer "Storage holds your
match videos, so your playing history lives in one place instead of scattered
across phones. Your uploads and their cut versions count toward the space. Point
clips and notes don't." → "Support": "How-to guides" · "Tutorial videos" · "Send
feedback" · "Contact support" (mailto support_email) → "Legal": Terms · Privacy →
"Sign out".
/account/player: back "Account", H1 "Player profile". Handedness, grip, level,
"Forehand rubber"/"Backhand rubber" (Inverted/Short pips/Long pips/Anti-spin +
"Model (optional)"), "Playing style" (Attacker/All-round/Defender). Upserts
player_profiles.

## /feedback
H1 "Feedback". Sub (QA): "Bugs, ideas, anything off. Your reports stay off the
board and come straight to us." (else) "…It lands on the board so others can vote."
Form: textarea "A bug, an idea, anything." + dictation, "About a match?" picker
("Not about a specific match"), "Severity", "Attach screenshot" + "Remove
screenshot", submit "Sending…"/"Uploading…", success "Sent to us." / "Posted —
others can upvote it." Errors: "Keep recordings under 10 MB." / "Couldn't
transcribe that. Try again." / "Voice input isn't supported in this browser." /
"Microphone access was blocked." / "Couldn't attach one image." / "Images only
(PNG, JPEG, WebP)." / "Could not send. Try again." Board: chips "Building",
"Declined", "Not on the board"; upvote/"Remove vote". Deep link ?matchId=.

## /coaching (hub; wide)
H1 "Coaching"; dual accounts get Segmented "Coach"/"Your coaches" (sessionStorage
"pl-coaching-view").
Coach view: pills "View page", "Copy link"/"Copied", "QR" ("Scan to open your page.
Put it up at the club."). Setup "Before your first order" {done} of 3: "Create an
offering" ("What you review, what it costs, and how long you take.") · "Set up
payouts"/"Finish payouts setup" ("Stripe confirms who you are and connects your
bank account.") · "Publish your page" ("Makes your page visible to anyone you send
the link to."). Workspace: queue ("Your move", "In progress", "Waiting on them",
"No active orders.", "All orders"); money strip (earned/completed/active); rows
"Orders" ("Reviews players have bought from you.") · "Offerings" ("What you sell
and the price you set.") · "Sponsored reviews" ("Cover a review for a student. They
pay nothing.") · "Your page" ("Your public page, where players find and buy.",
"{n} opens this week"/"Hidden"); "Payouts" (country select, "Stripe cannot change
this later…"); availability "Taking new orders" + "Most orders at once" ("New
purchases pause at the limit.", No limit/1/2/3/5/10/20).
Player view: "From your coaches" (≤3 match groups, "Open the match", author amber +
age, "Voice note"/"Drawing" fallbacks); "Reviews you bought" (≤3 rows → /orders/id,
"All your reviews"); SharingSection ("Add a coach", scope "All matches",
"Copy link", "Remove coach"/"Removing…"; empty "No coaches yet."; error "Couldn't
update. Try again.").
Not-a-coach: CoachNudgeCard "You already coach {n} players here." / "A page lets
them pay you for the deep reviews." / "Set up your page" + "Not now" — or
BecomeCoachCard "Offer paid reviews" / "Your price, your scope, your turnaround."
/coaching/start: "Set up your coach page", "Your name" ("How students know you"),
"Your page" ponglens.com/coach/ + handle ("your-name", "Three to thirty characters:
letters, numbers and dashes."), "Create your coach page"/"Creating".
/coaching/orders: UpLink "Coaching", H1 "Orders", groups "Your move"/"In progress"/
"Waiting on them"/"Done"; empty "No orders yet."
/coaching/orders/[id] + FindingEditor: coach workspace (defer to web v1).
/coaching/offerings, /coaching/profile: authoring editors (defer to web v1).
/coaching/sponsored: "Sponsored reviews" / "For students you already coach. They
use your link, send a match, and pay nothing."

## /orders (student)
H1 "Your reviews". Empty "No reviews yet." Rows {offering_title} · {coach_name} +
status + price → /orders/{id}. RPC student_review_orders.

## /orders/[id]
Status headlines: awaiting_submission "Pick your match" · submitted "Sent to
{coach}" + "You can cancel any time before they start." · in_review "{coach} is on
it" + "Promised by {weekday}, {date}." · clarification "{coach} has a question" ·
delivered "Your review is ready" + "{n} follow-up questions included if anything is
unclear." · completed "Your review" · declined "{coach} declined this one" + "Your
refund goes back to the card you paid with." · cancelled "Cancelled". "Test" pill
in test billing; "Covered by {coach}" or price. SubmitWizard (≤30 candidate
matches, intake questions, "Send to {coach}"/"Sending"). "Questions" ChatThread.
Delivered: sample-consent ("{coach} would like to show this review on their page as
an example, with your match footage. Up to you." "Share it"/"No thanks"),
ReviewBody, FollowupThread "Ask your follow-up", "Mark as done" + "Completes on its
own after a week either way." Timeline: Ordered · Match sent · {coach} started ·
Review delivered · Done · Cancelled. Cancel "Yes, cancel it"/"Cancelling".
Testimonial "What did you get out of it?" → "Sent. They may show it on their page
with your first name."

## /s/[token] (public share)
No chrome. H1 = title or machine line ("Point 14 · 12s rally", "5 points · A vs
M"). Player (single clip or sequential "Previous clip"/"Next clip"). CTA "Analyze
your own match — free" → /. Footer "Report this video" mailto. Dead link: "This
link was turned off." Empty collection: "Nothing here right now."

## /coach-invite/[token]
States: "Invite not found" ("This invite link isn't valid. Ask for a fresh link.")
· logged out "You're invited" ("A player wants to share their table tennis matches
with you on PongLens. Sign in to view them." + "Sign in to continue") · own "This
is your invite link" ("Send it to your coach. When they accept, they can watch your
matches and leave notes.") · "Already accepted" ("{player}'s matches are in your
dashboard under \"Shared with me\".") · "Invite revoked" ("The player revoked this
invite. Ask them for a new link.") · "Invite already used" ("Someone already
accepted this invite. Ask the player for a new link.") · pending "{player} shared
their matches / a match with you" ("You can watch all their matches, point by
point, and leave coach notes.").

## /review-invite/[token]
"{coach} is covering a review for you" → "{offering_title}, at no cost to you. You
send a match, and {coach} usually turns a review around in {n} days." / "This link
is no longer active. Ask {coach} for a new one."

## Sheets
ShareSheet: "Share" / "Anyone with the link can watch. Revoke it anytime from your
account." Rows: "Starred points ({n})" ("Public link · updates as you star"),
"This match", "This point", "Tagged points", "With your coach". Naming step:
title input (default machine title), "Share"/"Creating link…"/"Copied". Errors
"Couldn't create the link. Try again." / "Copy failed. Select the link and copy it
manually."
ShareWithCoachSheet: "Share with coach", "Create invite link"/"Creating…",
"Copy link"; share text "Watch my table tennis matches on PongLens".
Export sheet: "Export" + "Include score" toggle; tiles "Full match" ("Whole match,
with scoreboard"/"The playtime video"), "Starred points" ("Your starred rallies, in
order" / "Star points to export them"), per-tag ("Points with this tag, in order"),
"Raw match" ("Your original upload, uncut"). "Create" → "Rendering — we'll email
you" → "Save · 0:32" / download.

## Complexity ranking
Extreme: /match/[id] (Player + MatchView) — budget the majority here.
High: /upload, /journal, coach-side /coaching/orders/[id] + editors (DEFER to web).
Medium: /dashboard, /matches, /orders/[id]. Low–medium: /stats, /account,
/feedback, /s/[token]. Low: learn, login, onboarding, orders, account/player,
invites, coaching/start, sponsored.
Skip (web/SFSafariViewController): /coaches, /coach/[handle], /coach/[handle]/
sample, /videos, /terms, /privacy, coach authoring editors v1.

## iOS structure
Tabs: Home · Matches · Journal · (Coaching). Slim top bar: logo left, bell + avatar
trailing (avatar → Account; Account is never a tab). FABs: Upload on Home+Matches,
New on Journal. Pushed: match, upload (or fullScreenCover), stats, learn, account,
feedback, orders. Sheets: share, coach share, export, point detail (phone), side
picker, tag picker, camera guide, gestures, journal composer, notifications,
filters. Full-screen covers: login, onboarding, match player takeover.
Universal links: /s/, /coach-invite/, /review-invite/, /orders/, /match?p=,
/journal?match=, /stats?view=, /account#minutes, /upload?order=, /feedback?matchId=.
