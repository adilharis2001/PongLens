# Minors, consent and kill switches — design

Date: 2026-09-14. Owner decisions recorded in chat the same day. This is the
working spec for the implementation; Adil is not the reader.

## Decisions

- Minimum age 13, 16 in the EEA (country from the request, no question asked).
  Under age: explain, sign out, remove an empty account. No parent flow yet.
- One explicit acceptance, once: the first onboarding screen, button labelled
  "Agree and continue". Login page keeps plain Terms and Privacy links only.
- New accounts only for the onboarding screen and the upload confirmation.
  Existing rows are backfilled as accepted so nothing changes for them.
- AI consent sheet for everyone, once, on first use of an AI-assisted feature.
  Required by App Review Guideline 5.1.2(i). Names OpenAI and Deepgram. The
  word "AI" is allowed on the sheet and the Account switch (owner-approved
  exception, alongside "Improve with AI").
- Recollect off for everyone via `recollect_enabled`. Returns later as an
  ordinary AI feature under the same consent.
- YouTube import removed from web and iOS. Worker handler retired in a later
  sealed worker release, not here.
- Coach orders stay live but the existing `coach_reviews_enabled` switch grows
  to hide the whole ordering experience on the web when off. Open orders stay
  reachable for their buyer and coach. Value stays `true` now. No order data is
  touched.
- Coach sample page requires sign-in while orders exist.
- EU, UK and Swiss App Store storefronts off (owner action). Age rating 13+.
- Declared Age Range API skipped for 1.0. Not a review requirement.
- Simulator walkthrough on a fresh account before any TestFlight build.
- Work in a fresh worktree from origin/main. The root checkout's local main
  had diverged (112 local-only commits, 374 behind), so the branch was
  rebuilt on origin/main and the work cherry-picked across.

## Data

Migration `20260915000000_consent_and_age.sql`:

- `player_profiles` add: `terms_accepted_at timestamptz`, `terms_version text`,
  `ai_features_enabled boolean`, `ai_consent_at timestamptz`,
  `ai_consent_version text`, `upload_confirmed_at timestamptz`.
- New owner-only table `player_birthdates(user_id, birth_year, birth_month)`,
  so the coach SELECT policy on `player_profiles` never exposes a birthdate.
- Backfill existing rows: `terms_accepted_at = created_at`,
  `terms_version = 'legacy'`, `upload_confirmed_at = created_at`. Leave
  `ai_features_enabled` null (sheet shows once).
- `app_config` insert: `recollect_enabled = 'false'`,
  `terms_version = '2026-09-14'`, `ai_consent_version = '2026-09-14'`.
- Recreate the public allow-list policy as the union of the newest list on
  main (`20260911090000_keep_score_end_rules.sql`), `purchases_enabled`, and
  the three keys above. Applied to the live database 2026-09-14; a first
  version cut from a stale list hid three newer keys for about forty minutes
  before the union replaced it.
- Server helper `src/lib/consent.ts`: `readConsent(userId)` returns the
  columns above; `requireTerms`, `requireAiConsent`, `requireUploadConfirmed`
  each return a 403 body `{ error: "<reason>_required" }`.

## 1. Onboarding first screen

Web `src/app/onboarding/OnboardingFlow.tsx`: new step `"start"` ahead of the
role card, shown when `terms_accepted_at` is null. `onboarding/page.tsx` reads
the column. Middleware `src/lib/supabase/middleware.ts:65-87` adds
`terms_accepted_at` to its existing `player_profiles` select and redirects when
null. Coaches hit this step before their auto-finish.

iOS `OnboardingScreen.swift`: step 0. `RootView.checkOnboarding` selects
`terms_accepted_at` alongside `setup_done_at`; gate `.needed` gains
`needsTerms`.

Screen: title "When were you born?". Two wheels (iOS `Picker` `.wheel`, month
and year; web two native `<select>` styled like the existing input). Wheels
start on the current month and year. Below: "By continuing you agree to the
Terms and Privacy Policy." with links. Button: "Agree and continue".

Under age: title "PongLens is for players 13 and over." Body: "A parent or
guardian can create an account and add you." Button "Sign out". If the account
has no matches, call the existing delete-account route first. EEA threshold 16
from `x-vercel-ip-country` on web and `Locale.current.region` on iOS; list of
EEA codes in `src/lib/consent.ts` and mirrored in Swift.

Login: web `src/app/login/page.tsx:53-69` and iOS `LoginScreen.swift:97-105`
become "Terms · Privacy" links, no sentence.

Writes: `player_birthdates` row, then `terms_accepted_at`, `terms_version`
(from config) on the profile upsert both platforms already do.

## 2. AI consent sheet and switch

Trigger points (client shows the sheet before the call when
`ai_features_enabled` is not true; server returns `ai_consent_required` as the
backstop):

- Web: `components/dictation.tsx`, `DictateButton.tsx`, `journal/AskPanel.tsx`,
  `journal/JournalEditor.tsx` (Improve with AI, photo reading),
  `journal/NoteEditor.tsx`, `journal/LessonCard.tsx`, `components/entryPhoto.tsx`,
  `feedback/FeedbackForm.tsx`, `coaching/students/[id]/StudentView.tsx`,
  `coaching/offerings/OfferingsEditor.tsx`, `coaching/profile/ProfileEditor.tsx`,
  `coaching/orders/[id]/CoachOrder.tsx`, `coaching/videos/LessonVideos.tsx`.
- iOS: `LessonTranscriber.swift`, `PointExtras.swift`, `JournalScreen.swift`
  (Ask, Improve with AI), `PageScan.swift`, `EntryPhoto.swift`,
  `LessonRecordScreen.swift`, `CoachEntryComposer.swift`, `FeedbackScreen.swift`,
  `CoachOfferingsScreen.swift`, `CoachProfileScreen.swift`,
  `CoachOrderScreen.swift`, `LessonVideoScreen.swift`.
- Routes gated: `api/transcribe`, `api/journal-ask`, `api/lesson` (and
  `lesson/note`), `api/journal-ocr`, `api/entry-image`, `api/feedback/assist`,
  `api/offerings/draft`, `api/profile/draft`, `api/reviews/assist`,
  `api/lesson-video`. Worker frame checks are core processing, not gated.

Sheet copy (web `components/AiConsentSheet.tsx`, iOS `AiConsentSheet.swift`,
same bottom-sheet treatment as the share sheet):

- Title: "AI features"
- Body: "Some features send your content to two companies so they can do
  their job: Deepgram turns voice notes into text, and OpenAI reads notes,
  photos and lesson transcripts to write summaries, answer questions in Ask,
  and tidy rough entries. They are not allowed to use your content to train
  their models. You can switch this off any time in Account."
- Buttons: "Allow" (primary), "Not now".

Allow writes `ai_features_enabled = true`, `ai_consent_at`,
`ai_consent_version`. Account switch "AI features" in Your game, web
`account/page.tsx` beside the Recollect slot, iOS `AccountScreen.swift` row 59
area. Off sets `ai_features_enabled = false`; the sheet reappears on next use.

## 3. Recollect switch

`getRecollectEnabled()` in `src/lib/config.ts` beside `getCommerceEnabled`.
Consulted at: `api/lesson/route.ts:252` (`beginRecollect`),
`lib/recollect/processor.ts:51`, `lib/recollect/repository.ts:102-107`,
`lib/recollect/view.ts:80-119`, `journal/page.tsx:35-36`,
`account/page.tsx:117-119`, `api/recollect/settings/route.ts`. iOS: add the
key to `AppState.refreshConfigFlags` (`AppState.swift:126-152`) and read it in
`AccountStore.swift:85-104` and `JournalStore.swift:417-431`. Off hides the
tab and the toggle and stops generation.

## 4. YouTube import removal

Delete `src/components/YouTubeImport.tsx`, its use in `app/upload/page.tsx`
and anywhere else, `src/app/api/import-url/`. iOS: remove `importFromYouTube`
and its UI in `UploadScreen.swift:448-457`, and the ToS note at
`UploadScreen.swift:101`. Terms: remove the imported-link paragraph in §5.
Admin processing `KIND_LABELS` keeps `youtube_import` so old rows still read.
Worker `worker.py:136-167` untouched until the next sealed release.

## 5. Upload confirmation

First upload only, new accounts only. Checkbox: "I have the right to upload
this video, including a parent's permission for anyone under 18 in it." Web
`dashboard/UploadCard.tsx` (both layouts), iOS `UploadScreen.swift` and the
record flow before the first `RecordingQueue.enqueue`, coach lesson videos
`coaching/videos/LessonVideos.tsx` and `LessonVideoScreen.swift`. Routes
`api/upload-url` and `api/lesson-video` require `upload_confirmed_at` and
`terms_accepted_at`. Tick writes `upload_confirmed_at`.

## 6. Coach orders behind the existing switch

Off state for `coach_reviews_enabled` hides on the web: coaching hub Orders,
Offerings and Sponsored sections and the sell-reviews offer
(`coaching/CoachHub.tsx`, `coaching/page.tsx`), `coaching/orders`,
`coaching/offerings`, `coaching/sponsored`, `orders` list, `review-invite`,
Stripe connect and payout routes under `api/stripe`, and any book-a-review
entry point on match pages. Exception: `orders/[id]` and
`coaching/orders/[id]` stay reachable while the order is open (not completed,
cancelled or refunded), for its buyer and its coach. Value stays `true`.
`/admin/reviews` already edits the key. Sample page
`coach/[handle]/sample/page.tsx` requires a session.

## 7. Provider calls

`store: false` on every `chat/completions` body in the nine web routes and
`lib/recollect/openai.ts`, and on the worker content-check and broadcast-gate
calls (`worker.py:7712, 7850`) in the next worker release. Deepgram already
sends `mip_opt_out=true`.

## 8. Legal pages

Privacy §2 and §8: name OpenAI and Deepgram for the AI and speech steps only.
§1: add "the birth month and year you give us at signup". §5 and Terms §2:
Recollect is switched off; remove "enabled by default". Terms §5: drop the
imported-link paragraph. Privacy §12 already states 13 and 16.

## App Store Connect (owner)

Age rating 13+. Availability: EU, UK, Switzerland off. App Privacy answers
match `PrivacyInfo.xcprivacy`. Demo account with a processed match in review
notes. Live support URL.

## Order of work

1. Migration, config keys, consent helper, Recollect off.
2. Onboarding screen and gates, login links, both platforms.
3. AI sheet, route gating, Account switch, both platforms.
4. YouTube import removal.
5. Upload confirmation.
6. Orders switch coverage and sample page sign-in.
7. Provider flags, legal pages.
8. `npm run build`, iOS build, simulator walkthrough on a fresh account at
   393×660 and native, screenshots for approval, then TestFlight.

## Copy rules that apply

Plain sentences, no headings with subtitles, no em dashes, one accent phrase
at most. "AI" only on the consent sheet, the Account switch and Improve with
AI. Buttons are real buttons, 44pt on iOS and mobile web, full width there.
