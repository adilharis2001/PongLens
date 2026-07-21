# PongLens Product Spec v2 — Match-centric experience
Status: agreed direction (2026-07-21). Mobile-first throughout (80–90% mobile usage assumed).

## 1. Product model
One flow, one object. A user uploads a video and gets a **Match**. There are exactly
two player-value features, everything else is embedded capability:
1. **Pure play cut** (dead time removed)
2. **Point-by-point breakdown** (clips per point; server shown; placement map optional;
   scorecard optionally confirmed by the user; notes + coach feedback live here)

Server detection, player ID, end-swap handling, placement maps: internal capabilities
surfaced inside the point view. Never presented as separate features. No AI-surfaced
shot counts, movement, spin, or speed until accuracy is proven (winner/how may show an
AI *suggestion* only inside the optional scorecard confirmation).

## 2. Upload flow (mobile sheet)
1. Pick video → 2. "What do you want?" menu:
   - **Cut the dead time** (always on, it is the base)
   - **Break it into points** (toggle, default ON)
   - **Placement maps** (toggle, default OFF, labeled "adds processing time")
   - **Cut strictness** (segmented: Tight / Normal / Loose → maps to pre/post padding
     and merge-gap params in cut_deadspace; Tight = 0.5/1.0/1.5s, Normal = current
     1.0/1.6/2.2s, Loose = 1.6/2.4/3.5s)
3. Upload w/ progress → confirmation ("email lands when it's ready").
Job kinds become a flags object on the match row, not separate kinds.

## 3. Match page (the product's core screen)
Mobile-first vertical layout:
- Header: opponent-name field (user-editable), date, download cut video button.
- **Point timeline**: vertical list of point cards. Card = thumbnail + point number +
  server chip ("You served" / "Opponent served") + duration + note/star indicators.
- **Point view** (tap a card): clip player (portrait-friendly), placement map (if
  generated), server line, then:
  - **Scorecard (optional)**: "Who won this point?" Me/Opponent + "How did it end?"
    (net, missed table, double bounce, clean winner, edge/net-cord, serve fault, let)
    — prefilled with AI suggestion *only here*, clearly marked "suggestion". Skippable
    forever; a match with zero confirmations is fully functional.
  - **Notes**: text + **voice note button** (mic icon → record → server-side STT →
    editable transcript stored with audio). Player and coach notes visually distinct.
- Match-level: overall notes (text/voice), running score IF user confirmed points
  (score appears only from confirmed data, never from AI alone).
- **App feedback affordance**: small "Something wrong with this match?" link on every
  match → freeform + optional screenshot → feedback table (this is our accuracy
  telemetry channel; voice supported).

## 4. Coach experience (extension, not a product)
- Any user can share: Match → "Share with coach" → invite link (scoped: this match or
  all my matches, revocable). Recipient signs in with Google like anyone; the link
  creates a `coach_links` row (player_id, coach_user_id, scope, status).
- Coach's dashboard gains a "Shared with me" section listing players → matches.
- Coach can: view everything the player sees, add per-point coach notes (text/voice)
  and an overall match review. No edit rights on player data. RLS enforced.
- No role at signup; roles emerge from links. Coach-side is the future paid tier.

## 5. Voice notes / STT
- Recommendation: **Deepgram Nova** (existing account bookmark; excellent accuracy,
  ~$0.004/min) via a small server route; fallback option OpenAI transcription with the
  existing key. Decision needed from Adil: Deepgram key available?
- Flow: MediaRecorder in browser → upload audio blob to storage → worker/route
  transcribes → transcript editable inline. Keep audio 90 days, transcript forever.

## 6. Processing changes (Mac worker)
- Points pipeline (already proven): activity spans → play splitter → per-point clips
  (with audio) + server detection (pose+ball proximity) + optional placement maps +
  winner/how suggestions (stored, surfaced only in scorecard UI).
- New params: strictness preset; placement flag. Reuse umpire_v3 only for
  suggestions; nothing else surfaces.
- Output contract per match: cut.mp4, points/NN.mp4, match.json (points, servers,
  bounces if placement on, suggestions).

## 7. Storage architecture — Cloudflare R2 migration
- Supabase keeps: auth, Postgres (matches/points/notes/links/feedback), queue, RLS.
- R2 keeps all binary: raw uploads, cut videos, point clips, voice audio.
  Zero egress fees; ~$0.015/GB-mo. Buckets: `ponglens-raw`, `ponglens-media`.
- Retention: raw 7 days → delete; cut video 30 days → delete; point clips +
  match.json + transcripts: keep while account active; voice audio 90 days.
  (Worker cron enforces; policy text updated to match.)
- Upload path: browser → R2 presigned multipart URL (via server route) → worker pulls
  from R2, pushes results to R2; dashboard streams via presigned GETs.
- NEEDED FROM ADIL: Cloudflare account (free), create R2 + API token (Object Read &
  Write), store in Keychain as `ponglens-r2-key-id` / `ponglens-r2-secret` +
  account id as `ponglens-r2-account`. Everything else is my plumbing.

## 8. Homepage / legal updates
- Homepage: reframe around the Match experience: "Upload a match. Get pure play, every
  point clipped, and a place for you and your coach to work on it." Feature cards →
  (1) pure play cut, (2) point-by-point with notes, (3) coach sharing. Placement maps
  shown inside point-view screenshot rather than promised as analysis. Plain copy, no
  em dashes, no AI-speak. Screenshots > animation for the features section.
- Terms: add coach-sharing consent (sharing grants named users access until revoked),
  voice recordings + transcripts are user content, feedback may be used to improve
  accuracy, subprocessors list (Supabase, Cloudflare R2, Vercel, Resend, STT vendor).
- Privacy: new retention table (7/30/90/account-lifetime tiers), R2 named, voice data
  section, coach-access section, deletion on request covers all tiers.

## 9. Rollout order
1. R2 plumbing + retention worker (before storage bills exist)
2. Match page + point timeline + notes (productize the proven review UI)
3. Scorecard confirmation + suggestions
4. Voice notes + STT
5. Coach links + shared views
6. Homepage/legal refresh (ships with 2)
Each phase independently shippable; friends keep using the current dashboard meanwhile.

## Out of scope now (see BACKLOG.md)
Serve trainer (next big feature after this), pressure fingerprint, TikTok/auto-reels,
equipment intelligence (maybe), opponent scouting (rejected for now), club leagues
(rejected for now), spin/speed/movement surfacing, auto-scoring as verdict.
